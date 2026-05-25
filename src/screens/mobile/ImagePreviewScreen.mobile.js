/**
 * 芯图相册 - 移动端图片预览页
 * 
 * 功能：
 * 1. 全屏显示图片
 * 2. 左右滑动切换
 * 3. 缩放和平移
 * 4. 显示图片信息
 * 5. 图片操作（删除、暂存、重新分类、分享、照片创玩）
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  Dimensions,
  FlatList,
  ScrollView,
  Modal,
  Share,
  NativeModules,
  Animated,
  PanResponder,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { getDefaultPresets, getColorNameTranslation, getOrientationNameTranslation, getCameraSettingsCategoryTranslation } from '../../i18n';
import { SafeAreaView, Alert } from '../../adapters/WebAdapters';
import Toast from '../../components/shared/Toast';
import UnifiedDataService from '../../services/UnifiedDataService';
import WeChatAuthService from '../../services/WeChatAuthService';
import configService from '../../services/ConfigService';
import cityLocationService from '../../services/CityLocationService';
import { logger, getUri, getLocalPath } from '../../adapters/WebAdapters';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
/** 最小缩放 = 刚开始显示的比例，缩小到此为止 */
const MIN_SCALE = 1;
const MAX_SCALE = 4;

const clampScale = (v) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, v));
const getTouchDistance = (touches) => {
  if (!touches || touches.length < 2) return 0;
  const [a, b] = touches;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) || 1;
};

const ImagePreviewScreen = ({ route, navigation }) => {
  const { t, i18n } = useTranslation('common');
  
  // ==================== 路由参数 ====================
  // 统一使用 filterType 和 filterValue
  const {
    image: initialImage,
    allImages = [],
    currentIndex = 0,
    filterType,
    filterValue,
    fromScreen,
  } = route.params || {};
  
  // 从旧参数推导（向后兼容，但优先使用新参数）
  const { category, city, color, similarityGroupId, format, resolution, orientation } = route.params || {};
  
  // 如果没有新参数，从旧参数推导
  let finalFilterType = filterType;
  let finalFilterValue = filterValue;
  
  if (!finalFilterType) {
    if (category === 'stagingBox') {
      finalFilterType = 'stagingBox';
      finalFilterValue = null;
    } else if (category) {
      finalFilterType = 'category';
      finalFilterValue = category;
    } else if (city) {
      finalFilterType = 'city';
      finalFilterValue = city;
    } else if (similarityGroupId) {
      finalFilterType = 'similarityGroup';
      finalFilterValue = similarityGroupId;
    } else if (color) {
      finalFilterType = 'color';
      finalFilterValue = color;
    } else if (format) {
      finalFilterType = 'format';
      finalFilterValue = format;
    } else if (resolution) {
      finalFilterType = 'resolution';
      finalFilterValue = resolution;
    } else if (orientation) {
      finalFilterType = 'orientation';
      finalFilterValue = orientation;
    }
  }

  // ==================== 状态管理 ====================
  const [currentImageIndex, setCurrentImageIndex] = useState(currentIndex);
  const [currentImage, setCurrentImage] = useState(initialImage); // 当前图片完整信息
  const [allImagesState, setAllImagesState] = useState(allImages); // 可变的图片列表
  const [showInfo, setShowInfo] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showEnhancePresets, setShowEnhancePresets] = useState(false);
  const [enhancePresets, setEnhancePresets] = useState({});
  const flatListRef = useRef(null);
  const [isInStagingBox, setIsInStagingBox] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);
  const isNavigatingBackRef = useRef(false); // 防止递归循环的标志
  const [locationDetail, setLocationDetail] = useState(null); // 位置详细信息

  // 手势缩放/平移（RN Animated + PanResponder，不依赖 Reanimated 以兼容部分 Android 环境）
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const translateXAnim = useRef(new Animated.Value(0)).current;
  const translateYAnim = useRef(new Animated.Value(0)).current;
  const savedScaleRef = useRef(1);
  const savedTranslateXRef = useRef(0);
  const savedTranslateYRef = useRef(0);
  const lastScaleRef = useRef(1);
  const initialPinchDistanceRef = useRef(null);
  const gestureModeRef = useRef(null); // 'pinch' | 'pan'

  useEffect(() => {
    scaleAnim.setValue(1);
    translateXAnim.setValue(0);
    translateYAnim.setValue(0);
    savedScaleRef.current = 1;
    savedTranslateXRef.current = 0;
    savedTranslateYRef.current = 0;
    lastScaleRef.current = 1;
    initialPinchDistanceRef.current = null;
  }, [currentImageIndex, scaleAnim, translateXAnim, translateYAnim]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onStartShouldSetPanResponderCapture: () => false,
    onMoveShouldSetPanResponder: (evt) => {
      const n = evt.nativeEvent.touches.length;
      if (n >= 2) return true;
      if (n === 1 && savedScaleRef.current > 1) return true;
      return false;
    },
    onMoveShouldSetPanResponderCapture: (evt) => evt.nativeEvent.touches.length >= 2,
    onPanResponderGrant: (evt) => {
      if (evt.nativeEvent.touches.length === 2) {
        gestureModeRef.current = 'pinch';
        initialPinchDistanceRef.current = getTouchDistance(evt.nativeEvent.touches);
      }
    },
    onPanResponderMove: (evt, g) => {
      const touches = evt.nativeEvent.touches;
      if (touches.length >= 2) {
        gestureModeRef.current = 'pinch';
        if (initialPinchDistanceRef.current == null) {
          initialPinchDistanceRef.current = getTouchDistance(touches) || 1;
        }
        const d = getTouchDistance(touches) || 1;
        const newScale = clampScale(savedScaleRef.current * (d / initialPinchDistanceRef.current));
        lastScaleRef.current = newScale;
        scaleAnim.setValue(newScale);
        if (newScale <= 1) {
          translateXAnim.setValue(0);
          translateYAnim.setValue(0);
          savedTranslateXRef.current = 0;
          savedTranslateYRef.current = 0;
        }
      } else if (touches.length === 1 && savedScaleRef.current > 1) {
        gestureModeRef.current = 'pan';
        const tx = savedTranslateXRef.current + g.dx;
        const ty = savedTranslateYRef.current + g.dy;
        translateXAnim.setValue(tx);
        translateYAnim.setValue(ty);
      }
    },
    onPanResponderRelease: (evt, g) => {
      if (evt.nativeEvent.touches.length < 2) {
        if (gestureModeRef.current === 'pinch') {
          savedScaleRef.current = lastScaleRef.current;
          if (savedScaleRef.current <= 1) {
            savedTranslateXRef.current = 0;
            savedTranslateYRef.current = 0;
          }
        } else if (gestureModeRef.current === 'pan') {
          savedTranslateXRef.current = savedTranslateXRef.current + g.dx;
          savedTranslateYRef.current = savedTranslateYRef.current + g.dy;
        }
        initialPinchDistanceRef.current = null;
        gestureModeRef.current = null;
      }
    },
  }), [scaleAnim, translateXAnim, translateYAnim]);

  const zoomableStyle = useMemo(() => ({
    transform: [
      { scale: scaleAnim },
      { translateX: translateXAnim },
      { translateY: translateYAnim },
    ],
  }), [scaleAnim, translateXAnim, translateYAnim]);

  // 使用 getUri 统一获取图片 URI
  const resolveImageUri = useCallback((image) => {
    if (!image) return null;
    return getUri(image);
  }, []);

  const resolveLocalPath = useCallback((image) => {
    if (!image) return null;
    
    // 使用getLocalPath获取path（可能是相对路径或绝对路径）
    // getLocalPath会自动处理拼装格式（contentUri||path），提取path部分
    // 如果image.uri是file:// URI，getLocalPath也会自动处理
    const path = getLocalPath(image);
    if (path) {
      return path;
    }
    
    // 最后的回退：直接使用image.path字段（如果有）
    return image.path || null;
  }, []);

  // 获取图片尺寸（优先使用数据库中的）
  const imageDimensions = currentImage?.imageDimensions || 
    (currentImage?.width && currentImage?.height ? 
      { width: currentImage.width, height: currentImage.height } : null);
  const displayUri = resolveImageUri(currentImage);
  const displayLocalPath = resolveLocalPath(currentImage);
  
  // 调试：检查当前图片是否有效
  React.useEffect(() => {
    if (!currentImage || !displayUri) {
      logger.error(`⚠️ 当前图片无效！索引：${currentImageIndex}，总数：${allImagesState.length}`);
      logger.error('当前图片对象:', currentImage);
    } else {
      logger.debug(`✅ 当前图片：索引${currentImageIndex}/${allImagesState.length}，URI: ${displayUri?.substring(0, 50)}...`);
    }
  }, [currentImageIndex, currentImage, allImagesState.length, displayUri]);

  // 初始化时滚动到正确的起始位置
  React.useEffect(() => {
    if (flatListRef.current && currentIndex > 0) {
      // 使用 setTimeout 确保 FlatList 已经渲染完成
      setTimeout(() => {
        flatListRef.current?.scrollToIndex({
          index: currentIndex,
          animated: false
        });
        logger.debug(`🎬 初始化滚动到位置: ${currentIndex}`);
      }, 100);
    }
  }, []);

  // 当图片索引变化时，加载完整的图片详情
  React.useEffect(() => {
    const loadImageDetails = async () => {
      // 检查索引是否有效，如果无效则自动调整
      if (currentImageIndex < 0 || currentImageIndex >= allImagesState.length) {
        if (allImagesState.length > 0) {
          // 自动调整索引到有效范围（如果超出范围，调整到最后一张）
          const adjustedIndex = currentImageIndex >= allImagesState.length 
            ? allImagesState.length - 1 
            : Math.max(0, currentImageIndex);
          logger.debug(`图片索引无效：${currentImageIndex}/${allImagesState.length}，自动调整到：${adjustedIndex}`);
          setCurrentImageIndex(adjustedIndex);
          return; // 等待索引更新后重新触发 useEffect
        } else {
          // 列表为空，无法加载
          logger.warn(`图片索引无效：${currentImageIndex}/${allImagesState.length}，列表为空，跳过详情加载`);
          return;
        }
      }
      
      const imageData = allImagesState[currentImageIndex];
      if (!imageData || !imageData.id) {
        logger.warn(`图片数据无效（索引${currentImageIndex}），跳过详情加载`);
        return;
      }

      try {
        // 从数据库加载完整详情（包括检测结果）
        const fullDetails = await UnifiedDataService.readImageDetailsById(imageData.id);
        if (fullDetails) {
          setCurrentImage(fullDetails);
          logger.debug(`✅ 加载图片详情成功: ${imageData.id}`);
          logger.debug('图片数据:', {
            hasImageDimensions: !!fullDetails.imageDimensions,
            imageDimensions: fullDetails.imageDimensions,
            width: fullDetails.width,
            height: fullDetails.height,
            hasIdCard: !!fullDetails.idCardDetections,
            hasGeneral: !!fullDetails.generalDetections,
            hasMobileNet: !!fullDetails.mobileNetV3Detections
          });
        } else {
          // 如果加载失败，使用原始数据
          setCurrentImage(imageData);
          logger.warn('从数据库加载详情失败，使用列表数据');
        }
      } catch (error) {
        logger.error('加载图片详情失败:', error);
        setCurrentImage(imageData);
      }
    };

    loadImageDetails();
  }, [currentImageIndex, allImagesState]);

  // 检查图片是否在暂存箱中
  React.useEffect(() => {
    const checkStagingBoxStatus = async () => {
      if (currentImage?.id) {
        try {
          const inStagingBox = await UnifiedDataService.isInStagingBox(currentImage.id);
          setIsInStagingBox(inStagingBox);
        } catch (error) {
          logger.error('检查暂存箱状态失败:', error);
          setIsInStagingBox(false);
        }
      } else {
        setIsInStagingBox(false);
      }
    };
    checkStagingBoxStatus();
  }, [currentImage?.id]);

  // 根据 location_id 获取位置详细信息
  React.useEffect(() => {
    const loadLocationDetail = async () => {
      // currentImage.city 字段存储的是 location_id
      if (!currentImage || !currentImage.city || typeof currentImage.city !== 'string') {
        setLocationDetail(null);
        return;
      }

      try {
        const currentLanguage = i18n.language || 'zh';
        const detail = await cityLocationService.getLocationDetail(currentImage.city, currentLanguage);
        setLocationDetail(detail);
      } catch (error) {
        logger.error('加载位置详情失败:', error);
        setLocationDetail(null);
      }
    };

    loadLocationDetail();
  }, [currentImage?.city, i18n.language]);

  // 监听页面移除事件（包括手势返回和按钮返回）
  // 这样无论是点击返回按钮还是手势返回，都能正确传递 returnedImageId
  React.useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      // 防止递归循环：如果已经在处理返回，直接返回
      if (isNavigatingBackRef.current) {
        logger.debug('🔄 已经在处理返回，跳过...');
        return;
      }
      
      // 在页面被移除之前，设置前一个屏幕的参数
      logger.debug('🔄 ImagePreview 即将被移除（手势或按钮返回），设置返回参数...', {
        category,
        fromScreen,
        currentImageId: currentImage?.id
      });
      
      // 如果是从暂存箱进入的，需要特殊处理
      if (finalFilterType === 'stagingBox' || fromScreen === 'StagingBox') {
        // 设置标志，防止递归
        isNavigatingBackRef.current = true;
        
        // 阻止默认的返回行为
        e.preventDefault();
        
        // 先移除监听器，避免循环
        unsubscribe();
        
        // 导航回暂存箱 Tab，并传递 returnedImageId
        navigation.navigate('MainTabs', {
          screen: 'StagingBox',
          params: {
            filterType: 'stagingBox',
            filterValue: null,
            fromScreen: 'StagingBox',
            returnedImageId: currentImage?.id,
          },
        });
        return;
      }
      
      // 对于其他情况，设置前一个屏幕的参数
      if (navigation.canGoBack() && currentImage?.id) {
        const routes = navigation.getState()?.routes;
        const prevRoute = routes?.[routes.length - 2];
        
        if (prevRoute) {
          // 设置标志，防止递归
          isNavigatingBackRef.current = true;
          
          // 阻止默认的返回行为
          e.preventDefault();
          
          // 先移除监听器，避免循环
          unsubscribe();
          
          // 设置前一个屏幕的参数并导航
          navigation.navigate(prevRoute.name, {
            ...prevRoute.params,
            returnedImageId: currentImage.id,
          });
        }
      }
    });

    return unsubscribe;
  }, [navigation, currentImage?.id, finalFilterType, fromScreen]);

  // ==================== 工具函数 ====================

  /**
   * 重新加载图片列表（当图片被移出当前列表时）
   */
  const reloadImageList = async () => {
    try {
      logger.debug('🔄 重新加载图片列表...', { filterType: finalFilterType, filterValue: finalFilterValue, fromScreen });
      
      // 如果是从首页进入的，删除后直接返回首页，不需要重新加载列表
      if (fromScreen === 'Home') {
        logger.debug('从首页进入，删除后直接返回首页');
        return false; // 返回 false 会触发返回上一页的逻辑
      }
      
      let updatedImages = [];
      
      // 统一使用 UnifiedDataService.readImagesByFilter
      if (!finalFilterType) {
        logger.warn('⚠️ 无法确定来源，无法重新加载');
        return false;
      }
      
      // 🆕 防御性检查：某些 filterType 需要 filterValue
      if (finalFilterType !== 'stagingBox') {
        if (!finalFilterValue || (typeof finalFilterValue === 'string' && finalFilterValue.trim() === '')) {
          logger.warn(`filterType=${finalFilterType} 需要 filterValue，但 filterValue 为空，返回空数组`);
          return false;
        }
      }
      
      updatedImages = await UnifiedDataService.readImagesByFilter(finalFilterType, finalFilterValue);
      
      logger.debug(`✅ 重新加载完成，图片数：${allImagesState.length} → ${updatedImages.length}`);
      
      // 如果列表为空，返回上一页
      if (updatedImages.length === 0) {
        logger.debug('列表已空，返回上一页');
        Alert.alert(t('common.tip') || t('common.confirm'), t('imagePreview.noImagesInCategory'), [
          { text: t('common.confirm'), onPress: goBack }
        ]);
        return false;
      }
      
      // 调整当前索引（在更新列表之前）
      let newIndex = currentImageIndex;
      if (currentImageIndex >= updatedImages.length) {
        // 如果当前索引超出范围，跳到最后一张
        newIndex = Math.max(0, updatedImages.length - 1);
        logger.debug(`索引超出范围，调整到最后一张：${newIndex}`);
      }
      
      // 使用函数式更新确保索引和列表同步更新，避免 useEffect 在索引更新前执行
      setAllImagesState(updatedImages);
      if (newIndex !== currentImageIndex) {
        // 使用函数式更新，确保使用最新的列表状态
        setCurrentImageIndex(prevIndex => {
          // 再次检查，确保索引在有效范围内
          if (prevIndex >= updatedImages.length && updatedImages.length > 0) {
            const adjustedIndex = updatedImages.length - 1;
            logger.debug(`函数式更新：调整索引：${prevIndex} → ${adjustedIndex}`);
            return adjustedIndex;
          }
          return newIndex;
        });
      }
      
      // 滚动到正确位置
      if (flatListRef.current) {
        setTimeout(() => {
          flatListRef.current?.scrollToIndex({
            index: newIndex,
            animated: true
          });
        }, 100);
      }
      
      return true;
    } catch (error) {
      logger.error('❌ 重新加载图片列表失败:', error);
      return false;
    }
  };

  /**
   * 重新加载图片列表并处理索引调整（公共函数）
   * @param {string} operationDescription - 操作描述，用于日志（如："删除"、"标记为待处置"、"修改分类"）
   * @returns {Promise<boolean>} - 是否成功重新加载
   */
  const reloadImageListWithIndexAdjustment = async (operationDescription) => {
    // 保存当前索引，用于判断是否是最后一张
    const wasLastImage = currentImageIndex === allImagesState.length - 1;
    
    // 重新加载图片列表（reloadImageList 会处理索引调整）
    const reloadSuccess = await reloadImageList();
    
    // 如果删除的是最后一张，使用函数式更新确保索引正确
    // 使用 setTimeout 确保状态更新完成后再检查
    if (reloadSuccess && wasLastImage) {
      setTimeout(() => {
        // 使用函数式更新获取最新的列表状态并调整索引
        setAllImagesState(prevList => {
          setCurrentImageIndex(prevIndex => {
            if (prevIndex >= prevList.length && prevList.length > 0) {
              const adjustedIndex = prevList.length - 1;
              logger.debug(`${operationDescription}最后一张后，调整索引：${prevIndex} → ${adjustedIndex}`);
              return adjustedIndex;
            }
            return prevIndex;
          });
          return prevList;
        });
      }, 50);
    }
    
    return reloadSuccess;
  };

  /**
   * 计算显示的序号
   */
  const getDisplayNumbers = () => {
  return {
      displayIndex: currentImageIndex + 1,
      displayTotal: allImagesState.length
    };
  };


  /**
   * 格式化文件大小
   */
  const formatFileSize = (bytes) => {
    if (!bytes) return t('imagePreview.unknown');
    const mb = bytes / (1024 * 1024);
    if (mb < 1) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${mb.toFixed(1)} MB`;
  };

  /**
   * 格式化日期
   */
  const formatDate = (dateString) => {
    if (!dateString) return t('imagePreview.unknown');
    const date = new Date(dateString);
    
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    
    return `${year}-${month}-${day} ${hour}:${minute}`;
  };

  /**
   * 格式化位置
   */
  const formatLocation = (latitude, longitude) => {
    if (!latitude || !longitude) return null;
    return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
  };

  /**
   * 获取分类显示名
   */
  const getCategoryDisplayName = (categoryId) => {
    const categoryConfig = configService.getAllCategoriesWithUI().find(c => c.id === categoryId);
    return categoryConfig?.chinese || categoryId;
  };

  // ==================== 导航操作 ====================

  /**
   * 上一张
   */
  const goToPrevious = () => {
    if (currentImageIndex > 0) {
      const newIndex = currentImageIndex - 1;
      flatListRef.current?.scrollToIndex({ index: newIndex, animated: true });
      setCurrentImageIndex(newIndex);
    }
  };

  /**
   * 下一张
   */
  const goToNext = () => {
    if (currentImageIndex < allImagesState.length - 1) {
      const newIndex = currentImageIndex + 1;
      flatListRef.current?.scrollToIndex({ index: newIndex, animated: true });
      setCurrentImageIndex(newIndex);
    }
  };

  /**
   * 返回（携带当前图片 ID，用于高亮）
   */
  const goBack = () => {
    // 如果是从暂存箱进入的，需要特殊处理
    // 注意：从暂存箱进入时，fromScreen 可能是 'category'（因为 pageType 是 'category'），所以需要检查 filterType === 'stagingBox'
    if (finalFilterType === 'stagingBox' || fromScreen === 'StagingBox') {
      // 导航回暂存箱 Tab，并传递 returnedImageId
      // 使用 navigate 到 MainTabs，然后设置 StagingBox Tab 的参数
      navigation.navigate('MainTabs', {
        screen: 'StagingBox',
        params: {
          filterType: 'stagingBox',
          filterValue: null,
          fromScreen: 'StagingBox',
          returnedImageId: currentImage?.id,
        },
      });
      return;
    }
    
    // 使用 setParams 更新当前路由的参数，然后返回
    if (navigation.canGoBack()) {
      // 先获取前一个屏幕的 key
      const routes = navigation.getState()?.routes;
      const prevRoute = routes?.[routes.length - 2];
      
      if (prevRoute) {
        // 设置前一个屏幕的参数
        navigation.navigate(prevRoute.name, {
          ...prevRoute.params,
          returnedImageId: currentImage?.id,
        });
      } else {
        navigation.goBack();
      }
    } else {
      navigation.goBack();
    }
  };

  // ==================== 图片操作 ====================

  /**
   * 删除图片（所有分类都支持）
   */
  const handleDelete = () => {
    if (!currentImage || !currentImage.id) {
      Alert.alert(t('common.error'), t('imagePreview.imageInfoIncomplete'));
      return;
    }
    
    // 所有分类都执行真正的删除
    logger.debug('执行删除操作...');
    Alert.alert(
      t('imagePreview.confirmTitle') || t('category.confirmDeleteTitle'),
      t('imagePreview.confirmDelete'),
      [
        { 
          text: t('common.cancel'), 
          style: 'cancel',
          onPress: () => logger.debug('用户取消删除')
        },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            logger.debug('用户确认删除，开始删除流程...');
            try {
              logger.debug('调用writeDeleteImages方法...');
              const result = await UnifiedDataService.writeDeleteImages([currentImage.id]);
              
              logger.debug('删除结果:', result);
              if (result.success) {
                logger.debug('删除成功，准备更新列表...');
                
                // 如果是从首页进入的，删除后直接返回首页
                if (fromScreen === 'Home') {
                  Alert.alert(t('common.success'), t('imagePreview.deleteSuccess') || t('category.deleteSuccess', { count: 1 }), [
                    { text: t('common.confirm'), onPress: goBack }
                  ]);
                  return;
                }
                
                // 重新加载图片列表并处理索引调整
                const reloadSuccess = await reloadImageListWithIndexAdjustment('删除');
                
                // 如果列表为空，reloadImageList 已经处理了返回上一页的逻辑
                // 如果列表不为空，继续浏览
                if (reloadSuccess) {
                  // 显示成功提示，但不自动返回
                  Alert.alert(t('common.success'), t('imagePreview.deleteSuccess') || t('category.deleteSuccess', { count: 1 }));
                } else {
                  // 列表为空，reloadImageList 已经处理了返回逻辑，这里不需要额外操作
                  logger.debug('列表已空，已返回上一页');
                }
              } else {
                // 删除失败通常是权限问题，属于正常情况，使用 debug 级别
                logger.debug('删除失败（可能是权限问题）:', result);
                Alert.alert(t('category.deleteFailedTitle') || t('common.error'), t('category.deleteFailedMessage') || t('category.deleteFailed'));
              }
            } catch (error) {
              // 删除失败通常是权限问题，属于正常情况，使用 debug 级别
              logger.debug('删除图片失败（可能是权限问题）:', error);
              Alert.alert(t('common.error'), t('category.deleteError') || t('common.retry'));
            }
          },
        },
      ]
    );
  };

  /**
   * 暂存图片（移动到暂存箱）
   */
  const handleStaging = async () => {
    if (!currentImage || !currentImage.id) {
      Alert.alert(t('common.error'), t('imagePreview.imageInfoIncomplete'));
      return;
    }
    logger.debug('放入暂存箱...');
    try {
      const result = await UnifiedDataService.addToStagingBox([currentImage.id]);
      if (result.success) {
        logger.debug('放入暂存箱成功');
        setCurrentImage(prev => ({
          ...prev,
          similarityGroupIndex: null,
          similarityScore: null,
          similarityGroupType: null
        }));
        setIsInStagingBox(true);
        setToastMessage(t('imagePreview.stagedMessage'));
      } else {
        logger.error('放入暂存箱失败:', result);
        Alert.alert(t('common.error'), t('category.addToStagingBoxFailed') || t('common.retry'));
      }
    } catch (error) {
      logger.error('放入暂存箱失败:', error);
      Alert.alert(t('common.error'), t('category.addToStagingBoxFailed') || t('common.retry'));
    }
  };

  /**
   * 从暂存箱移除图片
   */
  const handleRemoveFromStagingBox = async () => {
    if (!currentImage || !currentImage.id) {
      Alert.alert(t('common.error'), t('imagePreview.imageInfoIncomplete'));
      return;
    }
    logger.debug('从暂存箱移除...');
    try {
      const result = await UnifiedDataService.removeFromStagingBox([currentImage.id]);
      if (result.success) {
        logger.debug('从暂存箱移除成功');
        setIsInStagingBox(false);
        if (finalFilterType === 'stagingBox') {
          const reloadSuccess = await reloadImageList();
          if (!reloadSuccess) return;
        }
        setToastMessage(t('imagePreview.removedFromStagingMessage'));
      } else {
        logger.error('从暂存箱移除失败:', result);
        Alert.alert(t('common.error'), t('category.removeFromStagingBoxFailed') || t('common.retry'));
      }
    } catch (error) {
      logger.error('从暂存箱移除失败:', error);
      Alert.alert(t('common.error'), t('category.removeFromStagingBoxFailed') || t('common.retry'));
    }
  };

  /**
   * 获取所有分类（排除暂存箱）
   */
  const getAllCategories = () => {
    if (!configService || !configService.isConfigLoaded()) {
      return [];
    }
    
    const currentLang = i18n.language || 'zh';
    const language = currentLang === 'en' ? 'english' : 'chinese';
    
    // 注意：暂存箱不是分类，不会出现在 getAllCategoriesWithUI() 返回的列表中，所以不需要过滤
    return configService.getAllCategoriesWithUI()
      .map(category => {
        let name = configService.getCategoryDisplayName(category.id, language) || 
                   (currentLang === 'en' ? (category.english || category.chinese) : (category.chinese || category.english)) ||
                   category.id;
        // 将名称改为两行显示（每行2个字）
        if (name.length >= 3) {
          // 3个字或更多：每2个字换行
          const firstLine = name.substring(0, 2);
          const secondLine = name.substring(2);
          name = firstLine + '\n' + secondLine;
        }
        // 2个字或更少：不换行
        return {
          id: category.id,
          name: name,
          icon: '📷',
        };
      });
  };

  /**
   * 打开分类选择器 Modal
   */
  const openCategoryModal = () => {
    setShowCategoryModal(true);
    // 打开分类选择器时，关闭照片创玩 Modal
    if (showEnhancePresets) {
      setShowEnhancePresets(false);
    }
  };

  /**
   * 关闭分类选择器 Modal
   */
  const closeCategoryModal = () => {
    setShowCategoryModal(false);
  };

  /**
   * 处理分类修改
   */
  const handleCategoryChange = async (newCategory) => {
    if (newCategory === currentImage.category) {
      return; // 如果选择的是当前分类，不做任何操作
    }

    try {
      logger.debug('修改分类前检查currentImage:', {
        hasIdCard: !!currentImage.idCardDetections,
        hasGeneral: !!currentImage.generalDetections,
      });
      
      // 使用专门的分类更新接口
      await UnifiedDataService.updateImagesCategory([currentImage.id], newCategory, 'manual');
      
      // 更新本地状态
      setCurrentImage(prev => ({ 
        ...prev, 
        category: newCategory,
        confidence: 'manual'
      }));
      
      logger.debug('分类修改成功');
      
      // 自动关闭分类 Modal
      closeCategoryModal();
      
      // 重新加载图片列表（如果是从分类页进入的）
      if (finalFilterType === 'category' && finalFilterValue !== newCategory) {
        logger.debug('分类已改变，重新加载图片列表');
        await reloadImageListWithIndexAdjustment('修改分类');
      }
    } catch (error) {
      logger.error('修改分类失败:', error);
      Alert.alert(t('common.error'), t('imagePreview.changeCategoryFailed'));
    }
  };

  /**
   * 分享当前图片
   */
  const handleShare = async () => {
    const shareUri = resolveImageUri(currentImage);
    if (!currentImage || !shareUri) {
      Alert.alert(t('common.error'), t('imagePreview.imageInfoIncomplete'));
      return;
    }

    try {
      const urls = [shareUri];
      
      // 优先尝试使用原生模块分享（支持单张和多张）
      const { MultiImageShareModule } = NativeModules;
      if (MultiImageShareModule && MultiImageShareModule.shareMultipleImages) {
        // 使用原生模块分享
        await MultiImageShareModule.shareMultipleImages(urls);
        logger.debug('✅ 原生模块分享成功');
      } else {
        // 原生模块不可用，使用React Native Share
        // 添加 title 参数，让微信等分享目标显示"来自：芯图相册"
        const result = await Share.share({
          url: shareUri,
          title: t('app.name'),
        });
        
        if (result.action === Share.sharedAction) {
          logger.debug('✅ 分享成功');
        } else if (result.action === Share.dismissedAction) {
          logger.debug('用户取消分享');
        }
      }
    } catch (error) {
      logger.error('❌ 分享失败:', error);
      Alert.alert(t('category.shareFailed'), t('category.shareFailedMessage'));
    }
  };

  /**
   * 打开照片创玩 Modal
   */
  const openEnhanceModal = async () => {
    try {
      // 打开照片创玩 Modal 时，关闭分类 Modal
      if (showCategoryModal) {
        setShowCategoryModal(false);
      }
      const settings = await UnifiedDataService.readSettings();
      const rawPresets = settings?.aiEnhancePresets || {};
      
      // 获取当前语言的默认预设翻译（与 PC 端一致）
      const currentLang = i18n.language || 'zh';
      const defaultPresets = getDefaultPresets(currentLang);
      const zhDefaults = getDefaultPresets('zh');
      const enDefaults = getDefaultPresets('en');
      
      // 处理预设名称国际化
      const processedPresets = {};
      Object.entries(rawPresets).forEach(([id, preset]) => {
        // 判断是否是默认预设（通过比较名称是否等于中文或英文的默认值）
        const defaultPreset = defaultPresets[id];
        const isDefaultName = defaultPreset && (
          preset.name === zhDefaults[id]?.name ||
          preset.name === enDefaults[id]?.name
        );
        
        // 如果是默认预设，使用当前语言的翻译；否则使用用户自定义的名称
        const displayName = isDefaultName ? defaultPreset.name : preset.name;
        
        processedPresets[id] = {
          ...preset,
          name: displayName
        };
      });
      
      setEnhancePresets(processedPresets);
      setShowEnhancePresets(true);
    } catch (error) {
      logger.error('加载增强方案失败:', error);
      Alert.alert(t('common.error'), t('imagePreview.loadEnhancePresetsFailed'));
    }
  };

  /**
   * 关闭照片创玩 Modal
   */
  const closeEnhanceModal = () => {
    setShowEnhancePresets(false);
  };

  /**
   * 点击增强方案：数量与额度检查
   */
  const handleEnhancePresetPress = async (presetId) => {
    try {
      const count = 1; // 单张图片

      // 额度检查
      const credits = await WeChatAuthService.getCredits();
      if (!credits || typeof credits.remaining !== 'number') {
        Alert.alert(t('common.error'), t('imagePreview.cannotCheckCredits') || t('common.retry'));
        return;
      }

      // 如果用户未关注公众号，跳过额度检查，直接执行增强
      if (credits.isFollowed === false) {
        try {
          closeEnhanceModal();
          const preset = enhancePresets?.[presetId];
          const presetName = preset?.name || presetId;
          await performEnhance(presetId, presetName);
        } catch (e) {
          logger.error('提交增强失败:', e);
          Alert.alert(t('common.error'), e.message || t('category.submitFailed'));
        }
        return;
      }

      // 已关注公众号，进行额度检查
      if (credits.remaining < count) {
        Alert.alert(
          t('common.tip') || t('common.confirm'),
          t('category.insufficientCreditsMessageFollowWeChat', { remaining: credits.remaining, count })
        );
        return;
      }

      // 弹出二次确认：显示剩余额度与本次消耗额度
      Alert.alert(
        t('imagePreview.confirmTitle') || t('common.confirm'),
        t('imagePreview.enhanceConfirmMessage', { count, remaining: credits.remaining }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.confirm'),
            style: 'default',
            onPress: async () => {
              try {
                closeEnhanceModal();
                const preset = enhancePresets?.[presetId];
                const presetName = preset?.name || presetId;
                await performEnhance(presetId, presetName);
              } catch (e) {
                logger.error('提交增强失败:', e);
                Alert.alert(t('common.error'), e.message || t('category.submitFailed'));
              }
            }
          }
        ]
      );
    } catch (error) {
      logger.error('增强检查失败:', error);
      Alert.alert(t('common.error'), error.message || t('settings.operationFailed'));
    }
  };

  /**
   * 执行增强
   */
  const performEnhance = async (presetId, presetDisplayName) => {
    try {
      logger.debug('准备提交增强任务', { presetId, count: 1 });
      
      const enhanceUri = resolveImageUri(currentImage);
      if (!currentImage || !currentImage.id || !enhanceUri) {
        Alert.alert(t('common.error'), t('imagePreview.imageInfoIncomplete'));
        return;
      }

      const selectedItems = [{ id: currentImage.id, uri: enhanceUri }];

      // 直接导航到结果页，任务提交和轮询在结果页中处理
      if (typeof navigation !== 'undefined') {
        navigation.navigate('EnhanceResult', {
          presetName: presetDisplayName,
          presetId: presetId,
          selected: selectedItems,
          results: {},
          initialIndex: 0,
        });
      }
    } catch (error) {
      logger.error('导航到结果页失败:', error);
      Alert.alert(t('common.error'), error.message || t('settings.operationFailed'));
    }
  };

  // ==================== 渲染函数 ====================

  /**
   * 截断过长的文本，添加省略号
   */
  const truncateText = (text, maxLength = 20) => {
    if (!text || typeof text !== 'string') return text;
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  /**
   * 渲染顶部导航栏
   */
  const renderHeader = () => {
    const { displayIndex, displayTotal } = getDisplayNumbers();
    
    // 从 route.params 获取最新的参数（确保使用最新值）
    const currentParams = route.params || {};
    const currentFilterType = currentParams.filterType || finalFilterType;
    const currentFilterValue = currentParams.filterValue || finalFilterValue;
    
    // 如果是暂存箱，显示"暂存箱 (6/20)"格式
    if (currentFilterType === 'stagingBox') {
      return (
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} style={styles.headerButton}>
            <Text style={styles.headerIcon}>‹</Text>
          </TouchableOpacity>
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitle}>
              {t('category.stagingBox')} ({displayIndex} / {displayTotal})
            </Text>
          </View>
          <TouchableOpacity onPress={() => setShowInfo(!showInfo)} style={styles.headerButton}>
            <Text style={styles.headerIcon}>ℹ️</Text>
          </TouchableOpacity>
        </View>
      );
    }
    
    // 优先显示来源分类（城市、颜色、目录），而不是内容类别
    let displayName = '';
    const currentLang = i18n.language || 'zh';
    
    // 调试：记录参数值
    logger.debug('📋 ImagePreview 标题显示参数:', {
      filterType: currentFilterType,
      filterValue: currentFilterValue,
      fromScreen
    });
    
    // 统一基于 filterType 判断标题显示
    if (!currentFilterType) {
      logger.debug('⚠️ 未找到匹配的标题显示条件');
    } else {
      switch (currentFilterType) {
        case 'city':
          displayName = currentFilterValue || t('category.city');
          logger.debug('✅ 使用城市名作为标题:', displayName);
          break;
        case 'color':
          displayName = getColorNameTranslation(currentFilterValue, currentLang) || currentFilterValue || t('category.color');
          logger.debug('✅ 使用颜色名作为标题:', displayName);
          break;
        case 'directory':
          if (currentFilterValue) {
            const directoryName = currentFilterValue.split('/').pop() || currentFilterValue;
            displayName = truncateText(directoryName, 20);
            logger.debug('✅ 使用目录名作为标题:', { filterValue: currentFilterValue, directoryName, displayName });
          }
          break;
        case 'format':
          displayName = currentFilterValue || t('category.format');
          logger.debug('✅ 使用格式名作为标题:', displayName);
          break;
        case 'resolution':
          displayName = currentFilterValue || t('category.resolution');
          logger.debug('✅ 使用分辨率名作为标题:', displayName);
          break;
        case 'orientation':
          displayName = getOrientationNameTranslation(currentFilterValue, currentLang) || currentFilterValue || t('category.orientation');
          logger.debug('✅ 使用方向名作为标题:', displayName);
          break;
        case 'iso':
          displayName = getCameraSettingsCategoryTranslation('iso', currentFilterValue, currentLang) || currentFilterValue || 'ISO';
          logger.debug('✅ 使用ISO作为标题:', displayName);
          break;
        case 'aperture':
          displayName = getCameraSettingsCategoryTranslation('aperture', currentFilterValue, currentLang) || currentFilterValue || t('settings.apertureCategory');
          logger.debug('✅ 使用光圈作为标题:', displayName);
          break;
        case 'shutter':
          displayName = getCameraSettingsCategoryTranslation('shutter', currentFilterValue, currentLang) || currentFilterValue || t('settings.shutterCategory');
          logger.debug('✅ 使用快门作为标题:', displayName);
          break;
        case 'focalLength':
          displayName = getCameraSettingsCategoryTranslation('focalLength', currentFilterValue, currentLang) || currentFilterValue || t('settings.focalLengthCategory');
          logger.debug('✅ 使用焦距作为标题:', displayName);
          break;
        case 'similarityGroup':
          displayName = t('category.similarityGroup');
          logger.debug('✅ 使用相似组作为标题');
          break;
        case 'category':
          if (currentFilterValue) {
            const language = currentLang === 'en' ? 'english' : 'chinese';
            displayName = configService?.getCategoryDisplayName(currentFilterValue, language) || 
                         UnifiedDataService.getCategoryDisplayName(currentFilterValue) || 
                         currentFilterValue;
            logger.debug('✅ 使用内容分类作为标题:', displayName);
          }
          break;
        default:
          logger.debug('⚠️ 未找到匹配的标题显示条件');
      }
    }

    return (
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} style={styles.headerButton}>
          <Text style={styles.headerIcon}>‹</Text>
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>
            {displayIndex} / {displayTotal}
          </Text>
          {displayName && (
            <Text style={styles.headerCategory}>
              {displayName}
            </Text>
          )}
        </View>
        <TouchableOpacity onPress={() => setShowInfo(!showInfo)} style={styles.headerButton}>
          <Text style={styles.headerIcon}>ℹ️</Text>
        </TouchableOpacity>
      </View>
    );
  };

  /**
   * 渲染图片信息（与 PC 端保持一致）
   */
  const renderImageInfo = () => {
    if (!showInfo) return null;

    const imageDimensions = currentImage.imageDimensions;

  return (
      <View style={styles.infoPanel}>
        <View style={styles.infoPanelHeader}>
          <Text style={styles.infoPanelTitle}>{t('imagePreview.fileInfo')}</Text>
          <TouchableOpacity onPress={() => setShowInfo(false)}>
            <Text style={styles.infoPanelClose}>✕</Text>
        </TouchableOpacity>
      </View>

        <ScrollView style={styles.infoContent}>
          {/* 基本信息 */}
            <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('imagePreview.takenTime')}:</Text>
            <Text style={styles.infoValue}>
              {currentImage.takenAt ? formatDate(currentImage.takenAt) : t('imagePreview.unknown')}
              </Text>
            </View>

            <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('imagePreview.fileTime')}:</Text>
            <Text style={styles.infoValue}>
              {currentImage.timestamp ? formatDate(currentImage.timestamp) : t('imagePreview.unknown')}
            </Text>
          </View>

          {/* GPS 位置信息 */}
          {currentImage.latitude && currentImage.longitude && (
            <>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>{t('imagePreview.gpsCoordinates')}:</Text>
                <Text style={styles.infoValue}>
                  {currentImage.latitude.toFixed(6)}, {currentImage.longitude.toFixed(6)}
              </Text>
            </View>
              
              {/* 使用 getLocationDetail 接口获取并显示位置信息 */}
              {locationDetail ? (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>{t('imagePreview.shootingCity')}:</Text>
                  <Text style={styles.infoValue}>
                    {(() => {
                      const parts = [];
                      const admin2 = locationDetail.admin2_zh || locationDetail.admin2_en;
                      const admin1 = locationDetail.admin1_zh || locationDetail.admin1_en;
                      if (admin2 && admin2.trim() !== '') {
                        parts.push(admin2);
                      }
                      if (admin1 && admin1.trim() !== '' && admin1 !== 'unknown' && admin1 !== admin2) {
                        parts.push(admin1);
                      }
                      // 国家名称（根据语言设置）
                      if (locationDetail.country_code && locationDetail.country_code.trim() !== '') {
                        const currentLang = i18n.language || 'zh';
                        // 简单的国家代码映射（主要国家）
                        const countryMap = {
                          'CN': currentLang === 'en' ? 'China' : '中国',
                          'US': currentLang === 'en' ? 'United States' : '美国',
                          'JP': currentLang === 'en' ? 'Japan' : '日本',
                          'KR': currentLang === 'en' ? 'South Korea' : '韩国',
                          'GB': currentLang === 'en' ? 'United Kingdom' : '英国',
                          'FR': currentLang === 'en' ? 'France' : '法国',
                          'DE': currentLang === 'en' ? 'Germany' : '德国',
                        };
                        const countryName = countryMap[locationDetail.country_code.toUpperCase()] || locationDetail.country_code;
                        parts.push(countryName);
                      }
                      return parts.join(', ');
                    })()}
                    {currentImage.cityDistance && ` ${t('imagePreview.distance', { km: currentImage.cityDistance })}`}
                  </Text>
                </View>
              ) : currentImage.city ? (
                // 如果位置详情加载失败，显示 location_id 作为后备
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>{t('imagePreview.shootingCity')}:</Text>
                  <Text style={styles.infoValue}>
                    {currentImage.city}
                    {currentImage.province && `, ${currentImage.province}`}
                    {currentImage.cityDistance && ` ${t('imagePreview.distance', { km: currentImage.cityDistance })}`}
                  </Text>
                </View>
              ) : null}
              
              {currentImage.altitude && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>{t('imagePreview.altitude')}:</Text>
                  <Text style={styles.infoValue}>
                    {currentImage.altitude}m
                  </Text>
                </View>
              )}
              
              {currentImage.accuracy && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>{t('imagePreview.gpsAccuracy')}:</Text>
                  <Text style={styles.infoValue}>
                    ±{currentImage.accuracy}m
                  </Text>
                </View>
              )}
            </>
          )}

            <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('imagePreview.filePath')}:</Text>
            <Text style={styles.infoValue} numberOfLines={3}>
              {displayLocalPath || (displayUri ? displayUri.replace('file://', '') : t('imagePreview.unknown'))}
            </Text>
            </View>

            <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('imagePreview.dimensions')}:</Text>
            <Text style={styles.infoValue}>
                {imageDimensions ? 
                  `${imageDimensions.width} × ${imageDimensions.height}` : 
                t('imagePreview.unknown')
                }
              </Text>
            </View>

            <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('imagePreview.fileSize')}:</Text>
            <Text style={styles.infoValue}>
              {formatFileSize(currentImage.size)}
              </Text>
            </View>

          {/* 拍摄参数 */}
          {(() => {
            const hasCameraSettings = !!currentImage.cameraSettings;
            
            // 解析 cameraSettings：可能是字符串（JSON）或对象
            let cameraSettingsData = {};
            if (currentImage.cameraSettings) {
              if (typeof currentImage.cameraSettings === 'string') {
                try {
                  cameraSettingsData = JSON.parse(currentImage.cameraSettings);
                } catch (e) {
                  logger.error('📷 [拍摄参数] 解析 cameraSettings JSON 失败:', e);
                  cameraSettingsData = {};
                }
              } else if (typeof currentImage.cameraSettings === 'object') {
                cameraSettingsData = currentImage.cameraSettings;
              }
            }
            
            const hasISOCategory = !!currentImage.isoCategory;
            const hasApertureCategory = !!currentImage.apertureCategory;
            const hasShutterCategory = !!currentImage.shutterCategory;
            const hasFocalLengthCategory = !!currentImage.focalLengthCategory;
            
            // 修复逻辑：检查是否有任何拍摄参数数据（修复运算符优先级问题）
            const shouldShowCameraSettings = (hasCameraSettings && (
              cameraSettingsData.iso || 
              cameraSettingsData.aperture || 
              cameraSettingsData.shutterSpeed || 
              cameraSettingsData.focalLength
            )) || hasISOCategory || hasApertureCategory || hasShutterCategory || hasFocalLengthCategory;
            
            if (!shouldShowCameraSettings) {
              return null;
            }
            
            const currentLang = i18n.language || 'zh';
            
            // 修复：使用 'in' 操作符检查字段是否存在，而不是检查值是否为truthy
            // 这样可以正确处理0值的情况
            const hasISO = ('iso' in cameraSettingsData && cameraSettingsData.iso != null) || currentImage.isoCategory;
            const hasAperture = ('aperture' in cameraSettingsData && cameraSettingsData.aperture != null) || currentImage.apertureCategory;
            const hasShutterSpeed = ('shutterSpeed' in cameraSettingsData && cameraSettingsData.shutterSpeed != null) || currentImage.shutterCategory;
            const hasFocalLength = ('focalLength' in cameraSettingsData && cameraSettingsData.focalLength != null) || currentImage.focalLengthCategory;
            
            return (
              <>
                {/* ISO */}
                {hasISO && (
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>📷 ISO:</Text>
                    <Text style={styles.infoValue}>
                      {('iso' in cameraSettingsData && cameraSettingsData.iso != null) ? cameraSettingsData.iso : ''}
                      {currentImage.isoCategory && (
                        ('iso' in cameraSettingsData && cameraSettingsData.iso != null)
                          ? ` (${getCameraSettingsCategoryTranslation('iso', currentImage.isoCategory, currentLang)})`
                          : getCameraSettingsCategoryTranslation('iso', currentImage.isoCategory, currentLang)
                      )}
                    </Text>
                  </View>
                )}
                
                {/* 光圈 */}
                {hasAperture && (
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>📷 {t('imagePreview.aperture')}:</Text>
                    <Text style={styles.infoValue}>
                      {('aperture' in cameraSettingsData && cameraSettingsData.aperture != null) ? `f/${cameraSettingsData.aperture}` : ''}
                      {currentImage.apertureCategory && (
                        ('aperture' in cameraSettingsData && cameraSettingsData.aperture != null)
                          ? ` (${getCameraSettingsCategoryTranslation('aperture', currentImage.apertureCategory, currentLang)})`
                          : getCameraSettingsCategoryTranslation('aperture', currentImage.apertureCategory, currentLang)
                      )}
                    </Text>
                  </View>
                )}
                
                {/* 快门 */}
                {hasShutterSpeed && (
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>📷 {t('imagePreview.shutterSpeed')}:</Text>
                    <Text style={styles.infoValue}>
                      {('shutterSpeed' in cameraSettingsData && cameraSettingsData.shutterSpeed != null) ? (
                        cameraSettingsData.shutterSpeed >= 1
                          ? `${cameraSettingsData.shutterSpeed}s`
                          : `1/${Math.round(1 / cameraSettingsData.shutterSpeed)}s`
                      ) : ''}
                      {currentImage.shutterCategory && (
                        ('shutterSpeed' in cameraSettingsData && cameraSettingsData.shutterSpeed != null)
                          ? ` (${getCameraSettingsCategoryTranslation('shutter', currentImage.shutterCategory, currentLang)})`
                          : getCameraSettingsCategoryTranslation('shutter', currentImage.shutterCategory, currentLang)
                      )}
                    </Text>
                  </View>
                )}
                
                {/* 焦距 */}
                {hasFocalLength && (
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>📷 {t('imagePreview.focalLength')}:</Text>
                    <Text style={styles.infoValue}>
                      {('focalLength' in cameraSettingsData && cameraSettingsData.focalLength != null) ? `${cameraSettingsData.focalLength}mm` : ''}
                      {currentImage.focalLengthCategory && (
                        ('focalLength' in cameraSettingsData && cameraSettingsData.focalLength != null)
                          ? ` (${getCameraSettingsCategoryTranslation('focalLength', currentImage.focalLengthCategory, currentLang)})`
                          : getCameraSettingsCategoryTranslation('focalLength', currentImage.focalLengthCategory, currentLang)
                      )}
                    </Text>
                  </View>
                )}
              </>
            );
          })()}

          {/* AI 描述信息 - 独立显示，即使没有检测结果也显示 */}
          {currentImage.message && currentImage.message !== t('imagePreview.classificationComplete') && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>🤖 {t('imagePreview.aiDescription') || 'AI 描述'}:</Text>
              <Text style={styles.infoValue}>
                {currentImage.message}
              </Text>
            </View>
          )}

          {/* 检测结果 - 只有在检测到物体时才显示 */}
          {(currentImage.idCardDetections && currentImage.idCardDetections.length > 0) ||
           (currentImage.generalDetections && currentImage.generalDetections.length > 0) ||
           (currentImage.mobileNetV3Detections && currentImage.mobileNetV3Detections.predictions && currentImage.mobileNetV3Detections.predictions.length > 0) ? (
              <>
                <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>🔍 {t('imagePreview.detectionResult')}:</Text>
                <Text style={styles.infoValue}>
                  {`${((currentImage.idCardDetections?.length || 0) + (currentImage.generalDetections?.length || 0) + (currentImage.mobileNetV3Detections?.predictions?.length || 0))}${t('imagePreview.objects')}`}
                  </Text>
                </View>
                
              {/* 身份证检测结果 */}
              {currentImage.idCardDetections && currentImage.idCardDetections.length > 0 && (
                <View style={styles.detectionSection}>
                  <Text style={styles.detectionTitle}>🆔 {t('imagePreview.idCardDetection')}:</Text>
                  {currentImage.idCardDetections.map((detection, index) => (
                    <View key={index} style={styles.detectionItem}>
                      <Text style={styles.detectionText}>
                        {detection.class === 'id_card_front' ? t('imagePreview.idCardFront') : t('imagePreview.idCardBack')}
                        ({(detection.confidence * 100).toFixed(1)}%)
                    </Text>
                    </View>
                  ))}
                  </View>
                )}
                
              {/* 通用物体检测结果 */}
              {currentImage.generalDetections && currentImage.generalDetections.length > 0 && (
                <View style={styles.detectionSection}>
                  <Text style={styles.detectionTitle}>🌐 {t('imagePreview.generalDetection')}:</Text>
                  {currentImage.generalDetections.slice(0, 5).map((detection, index) => {
                    const objectInfo = configService.getYoloObjectById(detection.classId);
                    // 根据当前语言设置获取物体名称
                    const currentLang = i18n.language || 'zh';
                    let className;
                    if (objectInfo) {
                      // 优先使用当前语言的名称，如果没有则使用另一种语言
                      if (currentLang === 'en') {
                        className = objectInfo.english || objectInfo.chinese || `Class ${detection.classId}`;
                      } else {
                        className = objectInfo.chinese || objectInfo.english || `Class ${detection.classId}`;
                      }
                    } else {
                      className = `Class ${detection.classId}`;
                    }
                    
                    return (
                      <View key={index} style={styles.detectionItem}>
                        <Text style={styles.detectionText}>
                          {className} ({(detection.confidence * 100).toFixed(1)}%)
                    </Text>
                      </View>
                    );
                  })}
                  {currentImage.generalDetections.length > 5 && (
                    <Text style={styles.detectionMore}>
                      {t('imagePreview.moreObjects', { count: currentImage.generalDetections.length - 5 })}
                    </Text>
                  )}
                  </View>
                )}
                
              {/* MobileNetV3 分类结果 */}
              {currentImage.mobileNetV3Detections && currentImage.mobileNetV3Detections.predictions && currentImage.mobileNetV3Detections.predictions.length > 0 && (
                <View style={styles.detectionSection}>
                  <Text style={styles.detectionTitle}>🧠 {t('imagePreview.mobileNetDetection')}:</Text>
                  {currentImage.mobileNetV3Detections.predictions.slice(0, 5).map((prediction, index) => {
                    const mobileNetV3ClassInfo = configService?.getMobileNetV3ClassByEnglishName(prediction.class);
                    const currentLang = i18n.language || 'zh';
                    const displayName = mobileNetV3ClassInfo ? (currentLang === 'en' ? (mobileNetV3ClassInfo.english || mobileNetV3ClassInfo.chinese) : (mobileNetV3ClassInfo.chinese || mobileNetV3ClassInfo.english)) : prediction.class;
                    
                    return (
                      <View key={index} style={styles.detectionItem}>
                        <Text style={styles.detectionText}>
                          {displayName} ({(prediction.probability * 100).toFixed(1)}%)
                    </Text>
                      </View>
                    );
                  })}
                  {currentImage.mobileNetV3Detections.predictions.length > 5 && (
                    <Text style={styles.detectionMore}>
                      {t('imagePreview.moreClassifications', { count: currentImage.mobileNetV3Detections.predictions.length - 5 })}
                    </Text>
                  )}
                  </View>
                )}
              </>
          ) : null}

          {/* 分类信息 - 放在最后 */}
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('imagePreview.category')}:</Text>
            <Text style={styles.infoValue}>
              {getCategoryDisplayName(currentImage.category)}
                {currentImage.confidence === 'manual' ? ` (${t('imagePreview.manual')})` : 
                 currentImage.confidence ? ` (${(currentImage.confidence * 100).toFixed(1)}%)` : ''}
              </Text>
            </View>
        </ScrollView>
          </View>
    );
  };

  /**
   * 渲染照片创玩 Modal
   */
  const renderEnhanceModal = () => {
    return (
      <Modal
        visible={showEnhancePresets}
        transparent={true}
        animationType="slide"
        onRequestClose={closeEnhanceModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            {/* 标题栏 */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('category.enhanceMenu').replace(' ›', '')}</Text>
              <Text style={styles.modalSubtitle}>
                {t('category.selectEnhancePresetForImages', { count: 1 })}
              </Text>
            </View>

            {/* 预设列表 */}
            <ScrollView style={styles.categoryList}>
              {Object.entries(enhancePresets)
                .sort(([, a], [, b]) => (a?.sortOrder || 0) - (b?.sortOrder || 0))
                .map(([presetId, preset]) => {
                  const displayName = preset.name || presetId;
                  return (
                    <TouchableOpacity
                      key={presetId}
                      style={styles.categoryItem}
                      onPress={() => {
                        handleEnhancePresetPress(presetId);
                        closeEnhanceModal();
                      }}
                    >
                      <Text style={styles.categoryIcon}>{preset.icon || '✨'}</Text>
                      <Text style={styles.categoryName}>{displayName}</Text>
                    </TouchableOpacity>
                  );
                })}
            </ScrollView>

            {/* 取消按钮 */}
            <TouchableOpacity
              style={styles.modalCancelButton}
              onPress={closeEnhanceModal}
            >
              <Text style={styles.modalCancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  };

  /**
   * 渲染底部操作栏
   */
  const renderActions = () => {
    return (
      <View style={styles.actionsBar}>
        {/* 暂存/移出按钮 */}
        {!isInStagingBox ? (
          <TouchableOpacity style={styles.actionButton} onPress={handleStaging}>
            <Text style={styles.actionIcon}>📦</Text>
            <Text style={styles.actionLabel}>{t('imagePreview.stage')}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.actionButton} onPress={handleRemoveFromStagingBox}>
            <Text style={styles.actionIcon}>📤</Text>
            <Text style={styles.actionLabel}>{t('imagePreview.remove')}</Text>
          </TouchableOpacity>
        )}
        
        {/* 删除按钮（所有分类都显示） */}
        <TouchableOpacity style={styles.actionButton} onPress={handleDelete}>
          <Text style={styles.actionIcon}>🗑️</Text>
          <Text style={styles.actionLabel}>{t('common.delete')}</Text>
        </TouchableOpacity>
        
        {/* 照片创玩按钮（所有分类都显示） */}
        <TouchableOpacity style={styles.actionButton} onPress={openEnhanceModal}>
          <Text style={styles.actionIcon}>✨</Text>
          <Text style={styles.actionLabel}>{t('imagePreview.enhance')}</Text>
        </TouchableOpacity>

        {/* 🆕 滤镜修图（jimp 本地处理，离线） */}
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => displayUri && navigation.navigate('FilterEditor', { imageUri: displayUri })}>
          <Text style={styles.actionIcon}>🎨</Text>
          <Text style={styles.actionLabel}>滤镜</Text>
        </TouchableOpacity>
        
        {/* 分类按钮 */}
        <TouchableOpacity style={styles.actionButton} onPress={openCategoryModal}>
          <Text style={styles.actionIcon}>🏷️</Text>
          <Text style={styles.actionLabel}>{t('imagePreview.category')}</Text>
        </TouchableOpacity>
        
        {/* 分享按钮 */}
        <TouchableOpacity style={styles.actionButton} onPress={handleShare}>
          <Text style={styles.actionIcon}>📤</Text>
          <Text style={styles.actionLabel}>{t('category.share')}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  /**
   * 渲染分类选择器 Modal
   */
  const renderCategoryModal = () => {
    if (!configService || !configService.isConfigLoaded()) {
      return null;
    }
    
    const categories = configService.getAllCategoriesWithUI();
    if (!Array.isArray(categories)) {
      return null;
    }
    
    const currentLang = i18n.language || 'zh';
    const language = currentLang === 'en' ? 'english' : 'chinese';

    return (
      <Modal
        visible={showCategoryModal}
        transparent={true}
        animationType="slide"
        onRequestClose={closeCategoryModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            {/* 标题栏 */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('imagePreview.selectCategory')}</Text>
              <Text style={styles.modalSubtitle}>
                {t('category.moveImagesTo', { count: 1 })}
              </Text>
            </View>

            {/* 分类列表 */}
            <ScrollView style={styles.categoryList}>
              {categories.map((cat) => {
                const categoryName = configService.getCategoryDisplayName(cat.id, language) || 
                                   (currentLang === 'en' ? (cat.english || cat.chinese) : (cat.chinese || cat.english)) ||
                                   cat.id;
                const isSelected = currentImage?.category === cat.id;
                
                return (
                  <TouchableOpacity
                    key={cat.id}
                    style={styles.categoryItem}
                    onPress={() => handleCategoryChange(cat.id)}
                  >
                    <Text style={styles.categoryIcon}>{cat.icon || '🏷️'}</Text>
                    <Text style={[
                      styles.categoryName,
                      isSelected && styles.selectedCategoryText
                    ]}>{categoryName}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* 取消按钮 */}
            <TouchableOpacity
              style={styles.modalCancelButton}
              onPress={closeCategoryModal}
            >
              <Text style={styles.modalCancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  };

  /**
   * 渲染导航箭头（已移除）
   * 现代移动端设计趋势：完全移除导航按钮，使用纯手势操作
   * 用户可以通过左右滑动来切换图片，更符合现代APP的设计理念
   */
  const renderNavigationArrows = () => {
    // 完全移除导航按钮，使用手势操作
    return null;
  };

  // ==================== 主渲染 ====================

  return (
    <SafeAreaView style={styles.container}>
      {/* 顶部导航栏 */}
      {renderHeader()}

      {/* 主图片区域 */}
      <View style={styles.imageContainer}>
        <FlatList
          ref={flatListRef}
          data={allImagesState}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item, index) => item.id || `image-${index}`}
          getItemLayout={(data, index) => ({
            length: SCREEN_WIDTH,
            offset: SCREEN_WIDTH * index,
            index,
          })}
          onMomentumScrollEnd={(e) => {
            const offsetX = e.nativeEvent.contentOffset.x;
            const index = Math.round(offsetX / SCREEN_WIDTH);
            if (index !== currentImageIndex) {
              setCurrentImageIndex(index);
            }
          }}
          renderItem={({ item, index }) => {
            const itemUri = resolveImageUri(item);
            const isCurrentPage = index === currentImageIndex;
            const showZoomable = isCurrentPage && !!itemUri;
            return (
              <View style={styles.imagePage}>
                <View style={styles.imagePageClip}>
                {itemUri ? (
                  showZoomable ? (
                    <View style={styles.imageWrap} {...panResponder.panHandlers}>
                      <Animated.View style={[styles.imageWrap, zoomableStyle]}>
                        <Image
                          source={{ uri: itemUri }}
                          style={styles.image}
                          resizeMode="contain"
                          onError={(e) => {
                            logger.error(`❌ 图片[${index}]加载失败: ${e.nativeEvent.error}`);
                          }}
                        />
                      </Animated.View>
                    </View>
                  ) : (
                    <Image
                      source={{ uri: itemUri }}
                      style={styles.image}
                      resizeMode="contain"
                      onError={(e) => {
                        logger.error(`❌ 图片[${index}]加载失败: ${e.nativeEvent.error}`);
                      }}
                    />
                  )
                ) : (
                  <View style={[styles.image, styles.imagePlaceholder]}>
                    <Text style={styles.placeholderText}>{t('imagePreview.imageNotFound')}</Text>
                  </View>
                )}
                </View>
            </View>
            );
          }}
        />

        {/* 导航箭头 */}
        {renderNavigationArrows()}
        </View>

      {/* 图片信息面板 */}
      {renderImageInfo()}

      {/* 底部操作栏 */}
      {renderActions()}

      {/* 增强预设模态框 */}
      {renderEnhanceModal()}

      {/* 分类选择器模态框 */}
      {renderCategoryModal()}

      {toastMessage ? (
        <Toast message={toastMessage} onDone={() => setToastMessage(null)} placement="screenCenter" />
      ) : null}
    </SafeAreaView>
  );
};

// ==================== 样式 ====================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  
  // 头部
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    backgroundColor: 'rgba(28, 28, 30, 0.9)',
  },
  headerButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerIcon: {
    fontSize: 24,
    color: '#FFFFFF',
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  headerCategory: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 2,
  },
  
  // 图片区域
  imageContainer: {
    flex: 1,
    position: 'relative',
  },
  imagePage: {
    width: SCREEN_WIDTH,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imagePageClip: {
    width: SCREEN_WIDTH,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  imageWrap: {
    width: SCREEN_WIDTH,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: SCREEN_WIDTH,
    height: '100%',
  },
  imagePlaceholder: {
    width: SCREEN_WIDTH,
    height: '100%',
    backgroundColor: '#1C1C1E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    color: '#8E8E93',
    fontSize: 14,
  },
  
  // 导航箭头样式已移除 - 使用纯手势操作
  
  // 信息面板
  infoPanel: {
    position: 'absolute',
    bottom: 80,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(28, 28, 30, 0.95)',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: SCREEN_HEIGHT * 0.6,
  },
  infoPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#3A3A3C',
  },
  infoPanelTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  infoPanelClose: {
    fontSize: 20,
    color: '#8E8E93',
  },
  infoContent: {
    padding: 16,
  },
  infoRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#3A3A3C',
  },
  infoLabel: {
    width: 80,
    fontSize: 14,
    color: '#8E8E93',
  },
  infoValue: {
    flex: 1,
    fontSize: 14,
    color: '#FFFFFF',
  },
  
  // 检测结果样式
  detectionSection: {
    marginTop: 8,
    paddingLeft: 80,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#3A3A3C',
  },
  detectionTitle: {
    fontSize: 13,
    color: '#8E8E93',
    marginBottom: 4,
  },
  detectionItem: {
    paddingVertical: 2,
  },
  detectionText: {
    fontSize: 13,
    color: '#FFFFFF',
  },
  detectionMore: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 4,
    fontStyle: 'italic',
  },
  
  // 操作栏
  actionsBar: {
    position: 'relative',
    flexDirection: 'row',
    backgroundColor: 'rgba(28, 28, 30, 0.9)',
    paddingVertical: 12,
    paddingHorizontal: 16,
    justifyContent: 'space-around',
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    padding: 8,
  },
  actionIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  actionLabel: {
    fontSize: 12,
    color: '#FFFFFF',
  },
  
  // Modal 样式
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#1C1C1E',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
  },
  modalHeader: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#3A3A3C',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#8E8E93',
  },
  categoryList: {
    maxHeight: 400,
  },
  categoryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2C2C2E',
  },
  categoryIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  categoryName: {
    fontSize: 16,
    color: '#FFFFFF',
    flex: 1,
  },
  selectedCategoryText: {
    color: '#007AFF',
    fontWeight: '600',
  },
  modalCancelButton: {
    padding: 16,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#3A3A3C',
  },
  modalCancelText: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '500',
  },
});

export default ImagePreviewScreen;
