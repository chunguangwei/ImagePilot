/**
 * ImagePilot - 移动端图片预览页
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
  useWindowDimensions,
  FlatList,
  ScrollView,
  Modal,
  Share,
  NativeModules,
  Animated,
  Platform,
  Pressable,
  StatusBar,
  TextInput,
  KeyboardAvoidingView,
} from 'react-native';
import { PinchGestureHandler, PanGestureHandler, State } from 'react-native-gesture-handler';
import { useTranslation } from 'react-i18next';
import { BlurView } from '@react-native-community/blur';
import { getDefaultPresets, getColorNameTranslation, getOrientationNameTranslation, getCameraSettingsCategoryTranslation } from '../../i18n';

// chrome 背景层渲染策略：
//   iOS  — 用 UIVisualEffectView（BlurView absoluteFill 当背景，TouchableOpacity 是
//          Animated.View 的普通子节点接 touch；曾经用 createAnimatedComponent(BlurView)
//          直接包，子 view 的 touch 被 UIVisualEffectView 吃，所以现在改了结构）。
//   Android — BlurView 4.x 在 Android 上的实现极其不稳定：StyleSheet.absoluteFill
//             与 row flex 同框时容易触发 measure 死循环或子节点位置错乱（用户实测：
//             actionsBar 内容在 chrome 顶部重复显示+图片整片"灰蒙蒙"）。
//             所以 Android 直接走纯色半透明 backgroundColor 兜底——视觉上略逊于
//             iOS 磨砂，但稳定性是第一位。
const CHROME_BG_DARK = 'rgba(28, 28, 30, 0.92)'; // Android 兜底底色（接近 iOS dark blur tint）
const USE_BLUR_VIEW = Platform.OS === 'ios';
function ChromeBackdrop() {
  if (!USE_BLUR_VIEW) return null; // Android：父级 Animated.View 已经有 backgroundColor 兜底
  return (
    <BlurView
      blurType="dark"
      blurAmount={20}
      reducedTransparencyFallbackColor="#1C1C1E"
      style={StyleSheet.absoluteFill}
    />
  );
}
import { LOCAL_EXTRA_PRESETS } from '../../services/enhance/localEnhance';
import { presetIcon, ACTION_ICONS } from '../../ui/ios/presetIcons';
import { SafeAreaView, Alert } from '../../adapters/WebAdapters';
import Toast from '../../components/shared/Toast';
import UnifiedDataService from '../../services/UnifiedDataService';
import WeChatAuthService from '../../services/WeChatAuthService';
import configService from '../../services/ConfigService';
import cityLocationService from '../../services/CityLocationService';
import { sortCategoryList, getCategoryIconMeta } from '../../components/shared/categoryUI';
import { Icon } from '../../adapters/WebAdapters';
import { logger, getUri, getLocalPath } from '../../adapters/WebAdapters';
import Haptics from '../../utils/haptics';
import { useIosColors } from '../../ui/ios/theme';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
// iOS 单色图标（字体已打包）；异常时回退 emoji。
let PvIonicons = null;
try { PvIonicons = require('react-native-vector-icons/Ionicons').default; } catch (_) { PvIonicons = null; }
/** 最小缩放 = 刚开始显示的比例，缩小到此为止 */
const MIN_SCALE = 1;
const MAX_SCALE = 4;

const clampScale = (v) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, v));

const ImagePreviewScreen = ({ route, navigation }) => {
  const { t, i18n } = useTranslation('common');
  const cTheme = useIosColors();
  // 主题感知样式：跟随 light/dark 切换；createStyles(cTheme) 由 useMemo 缓存
  const styles = React.useMemo(() => createStyles(cTheme), [cTheme]);
  // 实时视口宽度（折叠屏/旋转/分屏会变，不能用模块级静态 SCREEN_WIDTH，否则分页宽度与屏幕不符→图片只显示一半/不居中）
  const { width: viewportW } = useWindowDimensions();

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
  // 底部操作栏实测高度：信息面板(infoPanel)的 bottom 跟随它，避免「分类」等最后一行被操作栏
  // 遮挡（操作栏含图标+标签+padding 实际 80~95px，不同机型/字号会变，写死必踩坑）。
  const [actionsBarHeight, setActionsBarHeight] = useState(90);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [descEditorVisible, setDescEditorVisible] = useState(false); // AI 描述人工编辑浮层
  const [descDraft, setDescDraft] = useState('');
  const [showEnhancePresets, setShowEnhancePresets] = useState(false);
  const [enhancePresets, setEnhancePresets] = useState({});
  const flatListRef = useRef(null);
  const [isInStagingBox, setIsInStagingBox] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);
  const isNavigatingBackRef = useRef(false); // 防止递归循环的标志
  const [locationDetail, setLocationDetail] = useState(null); // 位置详细信息
  // P1：iOS Photos 风格沉浸式 chrome（顶部 header + 底部 actionsBar）的显隐切换
  // 用 Animated.timing 做 200ms 渐隐渐显；pointerEvents 同步隐藏避免误触
  const [chromeVisible, setChromeVisible] = useState(true);
  const chromeOpacityAnim = useRef(new Animated.Value(1)).current;
  const toggleChrome = useCallback(() => {
    setChromeVisible((v) => {
      const next = !v;
      Animated.timing(chromeOpacityAnim, {
        toValue: next ? 1 : 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
      return next;
    });
  }, [chromeOpacityAnim]);
  // 用户自定义分类（重新分类弹窗也需要展示自定义分类，并为其取主题图标）
  const [customCategoryList, setCustomCategoryList] = useState([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const settings = (await UnifiedDataService.readSettings()) || {};
        const raw = settings?.aiProvider?.customCategories;
        const list = Array.isArray(raw) ? raw.filter((c) => c && c.id && c.name) : [];
        if (alive) setCustomCategoryList(list);
      } catch (_) { /* 读不到就当无自定义分类 */ }
    })();
    return () => { alive = false; };
  }, []);

  // 手势缩放/平移（react-native-gesture-handler + RN Animated，不依赖 Reanimated）。
  // 旧实现用 JS PanResponder，嵌在横向 pagingEnabled 的 FlatList 里：iOS 上原生
  // ScrollView 的 pan 手势会抢走双指事件，导致「双指完全没反应」（用户实测）。
  // 改用 GestureHandler 的 Pinch/Pan，二者与底层 ScrollView 原生共存，双指能正常触发。
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const translateXAnim = useRef(new Animated.Value(0)).current;
  const translateYAnim = useRef(new Animated.Value(0)).current;
  const savedScaleRef = useRef(1);
  const savedTranslateXRef = useRef(0);
  const savedTranslateYRef = useRef(0);
  const lastScaleRef = useRef(1);
  const pinchRef = useRef(null);
  const panRef = useRef(null);
  // 放大后（scale>1）才允许单指平移并禁用 FlatList 横向翻页，避免两者抢手势
  const [zoomed, setZoomed] = useState(false);

  const resetZoom = useCallback(() => {
    scaleAnim.setValue(1);
    translateXAnim.setValue(0);
    translateYAnim.setValue(0);
    savedScaleRef.current = 1;
    savedTranslateXRef.current = 0;
    savedTranslateYRef.current = 0;
    lastScaleRef.current = 1;
    setZoomed(false);
  }, [scaleAnim, translateXAnim, translateYAnim]);

  useEffect(() => {
    // 切换图片时复位缩放/平移状态
    resetZoom();
  }, [currentImageIndex, resetZoom]);

  const onPinchGestureEvent = useCallback((e) => {
    const next = clampScale(savedScaleRef.current * e.nativeEvent.scale);
    lastScaleRef.current = next;
    scaleAnim.setValue(next);
  }, [scaleAnim]);

  const onPinchStateChange = useCallback((e) => {
    const { oldState } = e.nativeEvent;
    if (oldState === State.ACTIVE) {
      const finalScale = clampScale(lastScaleRef.current);
      savedScaleRef.current = finalScale;
      if (finalScale <= 1) {
        // 缩回原始大小：归零平移并恢复翻页
        savedScaleRef.current = 1;
        lastScaleRef.current = 1;
        scaleAnim.setValue(1);
        translateXAnim.setValue(0);
        translateYAnim.setValue(0);
        savedTranslateXRef.current = 0;
        savedTranslateYRef.current = 0;
        setZoomed(false);
      } else {
        setZoomed(true);
      }
    }
  }, [scaleAnim, translateXAnim, translateYAnim]);

  const onPanGestureEvent = useCallback((e) => {
    if (savedScaleRef.current > 1) {
      translateXAnim.setValue(savedTranslateXRef.current + e.nativeEvent.translationX);
      translateYAnim.setValue(savedTranslateYRef.current + e.nativeEvent.translationY);
    }
  }, [translateXAnim, translateYAnim]);

  const onPanStateChange = useCallback((e) => {
    if (e.nativeEvent.oldState === State.ACTIVE && savedScaleRef.current > 1) {
      savedTranslateXRef.current += e.nativeEvent.translationX;
      savedTranslateYRef.current += e.nativeEvent.translationY;
    }
  }, []);

  const zoomableStyle = useMemo(() => ({
    transform: [
      { scale: scaleAnim },
      { translateX: translateXAnim },
      { translateY: translateYAnim },
    ],
  }), [scaleAnim, translateXAnim, translateYAnim]);

  // 使用 getUri 统一获取图片 URI
  // iOS ph:// 由原生 PhotoKitImageLoader 直接渲染（透明），无需 JS 侧再做转换
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
      { width: currentImage?.width, height: currentImage?.height } : null);
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

  // 调试：标题来源参数（合并以前散落在 renderHeader switch 里每帧都打的多条日志）
  React.useEffect(() => {
    logger.debug('📋 ImagePreview 标题参数:', {
      filterType: finalFilterType,
      filterValue: finalFilterValue,
      fromScreen,
    });
  }, [finalFilterType, finalFilterValue, fromScreen]);

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
    // 自定义分类优先：用组件内已加载的 customCategoryList（始终最新），命中即用其名称
    const custom = customCategoryList.find((c) => c.id === categoryId);
    if (custom) return custom.name;
    const language = i18n.language === 'en' ? 'english' : 'chinese';
    const name = configService?.getCategoryDisplayName?.(categoryId, language);
    if (name && name !== categoryId) return name;
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

    // 当直接 unlink 失败（Android 11+ 删除别的应用创建的媒体需要系统授权 /
    // iOS 全部走 PhotoKit）时，拉起原生确认对话框；用户同意后系统物理删除，
    // 这里再把 app DB 里的残留记录清掉（不然列表会出现"删了还在"的鬼影直到下次扫描），
    // 最后才提示"已删除"——只有 systemDelete + DB clean 都走通才算真成功。
    const tryRequestDeleteThenFinalize = async () => {
      try {
        // iOS 分支：走 PhotoKitModule.deleteAssets([localIdentifier])
        // PHAssetChangeRequest 会让系统自动弹原生确认对话框，用户拒绝时 reject E_USER_CANCELLED
        if (Platform.OS === 'ios') {
          const { PhotoKitModule } = NativeModules;
          if (!PhotoKitModule || typeof PhotoKitModule.deleteAssets !== 'function') {
            Alert.alert(t('category.deleteFailedTitle') || t('common.error'), 'PhotoKitModule 不可用');
            return;
          }
          // iOS 端 currentImage.id 就是 PHAsset.localIdentifier（M2 那一步赋值的）
          await PhotoKitModule.deleteAssets([currentImage.id]);
          await UnifiedDataService.purgeDeletedImageRecords([currentImage.id]);
          Haptics.notification('warning');
          if (fromScreen === 'Home') {
            Alert.alert(t('common.success'), t('imagePreview.deleteSuccess') || t('category.deleteSuccess', { count: 1 }), [
              { text: t('common.confirm'), onPress: goBack },
            ]);
            return;
          }
          const reloadSuccess = await reloadImageListWithIndexAdjustment('删除');
          if (reloadSuccess) Alert.alert(t('common.success'), t('imagePreview.deleteSuccess') || t('category.deleteSuccess', { count: 1 }));
          return;
        }

        const { MediaStoreModule } = NativeModules;
        if (!MediaStoreModule || typeof MediaStoreModule.requestDeleteByPath !== 'function') {
          Alert.alert(t('category.deleteFailedTitle') || t('common.error'), t('category.deleteFailedMessage') || t('category.deleteFailed'));
          return;
        }
        // 从图片 URI 取真实文件路径（项目里的 URI 通常是 contentUri||filePath 形式）
        const rawUri = currentImage.uri || '';
        let filePath = (currentImage.path || rawUri.split('||')[1] || getLocalPath(rawUri) || '').replace(/^file:\/\//, '');
        if (!filePath) {
          Alert.alert(t('category.deleteFailedTitle') || t('common.error'), t('category.deleteFailedMessage') || t('category.deleteFailed'));
          return;
        }
        // 用户同意 → resolve(true)；用户拒绝 → reject('E_DENIED')；找不到 → reject('E_NOT_FOUND')
        await MediaStoreModule.requestDeleteByPath(filePath);
        // 系统已经物理删了文件 → 清 app DB 里的同 id 记录
        await UnifiedDataService.purgeDeletedImageRecords([currentImage.id]);
        if (fromScreen === 'Home') {
          Alert.alert(t('common.success'), t('imagePreview.deleteSuccess') || t('category.deleteSuccess', { count: 1 }), [
            { text: t('common.confirm'), onPress: goBack },
          ]);
          return;
        }
        const reloadSuccess = await reloadImageListWithIndexAdjustment('删除');
        if (reloadSuccess) Alert.alert(t('common.success'), t('imagePreview.deleteSuccess') || t('category.deleteSuccess', { count: 1 }));
      } catch (e) {
        const code = e && e.code;
        // 用户拒绝授权（Android E_DENIED / iOS E_USER_CANCELLED）→ 不弹错误，也不提示"已删除"
        if (code === 'E_DENIED' || code === 'E_USER_CANCELLED') return;
        logger.debug('授权删除失败:', e);
        Alert.alert(t('category.deleteFailedTitle') || t('common.error'), e?.message || (t('category.deleteFailedMessage') || t('category.deleteFailed')));
      }
    };

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
                // Android 11+ 删除别的应用创建的媒体需系统授权；走 MediaStore.createDeleteRequest 弹原生确认。
                logger.debug('删除失败，尝试系统授权流程:', result);
                await tryRequestDeleteThenFinalize();
              }
            } catch (error) {
              logger.debug('删除图片失败，尝试系统授权流程:', error);
              await tryRequestDeleteThenFinalize();
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
    if (!currentImage || !currentImage.id) {
      return; // P1：防御 currentImage 暂时为 null（异步加载中）
    }
    if (newCategory === currentImage?.category) {
      return; // 如果选择的是当前分类，不做任何操作
    }

    try {
      logger.debug('修改分类前检查currentImage:', {
        hasIdCard: !!currentImage?.idCardDetections,
        hasGeneral: !!currentImage?.generalDetections,
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
      Haptics.notification('success');

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
        // 添加 title 参数，让微信等分享目标显示"来自：ImagePilot"
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
      
      // 注入本地能力预设（离线、不依赖云端，不写入 settings）：背景移除/抠图等
      Object.entries(LOCAL_EXTRA_PRESETS).forEach(([id, meta]) => {
        processedPresets[id] = { ...meta, name: t(`imagePreview.localPresets.${id}`) };
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
      // 额度限制已停用：不再做额度检查 / 二次确认，直接执行增强
      closeEnhanceModal();
      const preset = enhancePresets?.[presetId];
      const presetName = preset?.name || presetId;
      // 需交互的本地能力走独立界面，不进 EnhanceResult 自动流程：
      //  - 物体消除(inpaint)：先涂抹蒙版；证件处理(document)：调四角做透视矫正
      const interactiveScreen = preset?.screen || (presetId === 'document' ? 'DocScan' : null);
      if (interactiveScreen) {
        const uri = resolveImageUri(currentImage);
        if (!currentImage || !currentImage.id || !uri) {
          Alert.alert(t('common.error'), t('imagePreview.imageInfoIncomplete'));
          return;
        }
        navigation.navigate(interactiveScreen, { imageUri: uri });
        return;
      }
      await performEnhance(presetId, presetName);
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
    const displayIndex = currentImageIndex + 1;
    const displayTotal = allImagesState.length;
    
    // 从 route.params 获取最新的参数（确保使用最新值）
    const currentParams = route.params || {};
    const currentFilterType = currentParams.filterType || finalFilterType;
    const currentFilterValue = currentParams.filterValue || finalFilterValue;
    
    // 如果是暂存箱，显示"暂存箱 (6/20)"格式
    if (currentFilterType === 'stagingBox') {
      return (
        // iOS：BlurView absoluteFill 当背景；Android：父级 backgroundColor 兜底，跳过 BlurView
        // （Android BlurView 4.x 与 absoluteFill + row flex 同框会拖崩布局，详见文件顶 ChromeBackdrop 注释）
        <Animated.View
          style={[styles.header, !USE_BLUR_VIEW && { backgroundColor: CHROME_BG_DARK }, { opacity: chromeOpacityAnim }]}
          pointerEvents={chromeVisible ? 'auto' : 'none'}
        >
          <ChromeBackdrop />
          <TouchableOpacity onPress={goBack} style={styles.headerButton}>
            <Text style={styles.headerIcon}>‹</Text>
          </TouchableOpacity>
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitle}>
              {t('category.stagingBox')} ({displayIndex} / {displayTotal})
            </Text>
          </View>
          <TouchableOpacity onPress={() => setShowInfo(!showInfo)} style={styles.headerButton}>
            {PvIonicons ? <PvIonicons name="information-circle-outline" size={26} color="#FFFFFF" /> : <Text style={styles.headerIcon}>ℹ️</Text>}
          </TouchableOpacity>
        </Animated.View>
      );
    }
    
    // 优先显示来源分类（城市、颜色、目录），而不是内容类别
    let displayName = '';
    const currentLang = i18n.language || 'zh';

    // 统一基于 filterType 判断标题显示（日志合并到 useEffect 里只在参数变化时打一次）
    if (currentFilterType) {
      switch (currentFilterType) {
        case 'city':
          displayName = currentFilterValue || t('category.city');
          break;
        case 'color':
          displayName = getColorNameTranslation(currentFilterValue, currentLang) || currentFilterValue || t('category.color');
          break;
        case 'directory':
          if (currentFilterValue) {
            const directoryName = currentFilterValue.split('/').pop() || currentFilterValue;
            displayName = truncateText(directoryName, 20);
          }
          break;
        case 'format':
          displayName = currentFilterValue || t('category.format');
          break;
        case 'resolution':
          displayName = currentFilterValue || t('category.resolution');
          break;
        case 'orientation':
          displayName = getOrientationNameTranslation(currentFilterValue, currentLang) || currentFilterValue || t('category.orientation');
          break;
        case 'iso':
          displayName = getCameraSettingsCategoryTranslation('iso', currentFilterValue, currentLang) || currentFilterValue || 'ISO';
          break;
        case 'aperture':
          displayName = getCameraSettingsCategoryTranslation('aperture', currentFilterValue, currentLang) || currentFilterValue || t('settings.apertureCategory');
          break;
        case 'shutter':
          displayName = getCameraSettingsCategoryTranslation('shutter', currentFilterValue, currentLang) || currentFilterValue || t('settings.shutterCategory');
          break;
        case 'focalLength':
          displayName = getCameraSettingsCategoryTranslation('focalLength', currentFilterValue, currentLang) || currentFilterValue || t('settings.focalLengthCategory');
          break;
        case 'similarityGroup':
          displayName = t('category.similarityGroup');
          break;
        case 'category':
          if (currentFilterValue) {
            const language = currentLang === 'en' ? 'english' : 'chinese';
            displayName = configService?.getCategoryDisplayName(currentFilterValue, language) ||
                         UnifiedDataService.getCategoryDisplayName(currentFilterValue) ||
                         currentFilterValue;
          }
          break;
        default:
          break;
      }
    }

    return (
      <Animated.View
        style={[styles.header, !USE_BLUR_VIEW && { backgroundColor: CHROME_BG_DARK }, { opacity: chromeOpacityAnim }]}
        pointerEvents={chromeVisible ? 'auto' : 'none'}
      >
        <ChromeBackdrop />
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
          {PvIonicons ? <PvIonicons name="information-circle-outline" size={26} color="#FFFFFF" /> : <Text style={styles.headerIcon}>ℹ️</Text>}
        </TouchableOpacity>
      </Animated.View>
    );
  };

  /**
   * 播放视频：iOS 系统播放器(PhotoKitModule)；安卓 ACTION_VIEW intent(MediaStoreModule)。
   * 与 CategoryScreen.playVideoRecord 同逻辑（iOS 记录 id 即 localIdentifier）。
   */
  const playVideoRecord = async (image) => {
    const id = image?.id || image?.localIdentifier;
    try {
      const pk = NativeModules && NativeModules.PhotoKitModule;
      if (pk && typeof pk.playVideo === 'function') { await pk.playVideo(id); return; }
      const ms = NativeModules && NativeModules.MediaStoreModule;
      if (ms && typeof ms.playVideo === 'function') { await ms.playVideo(image?.uri || id); return; }
    } catch (e) {
      logger.warn('播放视频失败:', e?.message || e);
    }
  };

  /**
   * 渲染图片信息（与 PC 端保持一致）
   */
  const renderImageInfo = () => {
    if (!showInfo) return null;
    if (!currentImage) return null;

    const imageDimensions = currentImage.imageDimensions;

  return (
      <View style={[styles.infoPanel, { bottom: actionsBarHeight }]}>
        <View style={styles.infoPanelHeader}>
          <Text style={styles.infoPanelTitle}>{t('imagePreview.fileInfo')}</Text>
          <TouchableOpacity onPress={() => setShowInfo(false)}>
            <Text style={styles.infoPanelClose}>✕</Text>
        </TouchableOpacity>
      </View>

        <ScrollView style={styles.infoContent} contentContainerStyle={styles.infoContentContainer}>
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

            // 防御：解析结果若不是对象（cameraSettings 是能 parse 成数字/字符串/null 的值，
            // 或本身是 null/数组外的原始值），归一为 {}。否则下方 `'iso' in cameraSettingsData`
            // 的 in 运算会抛 "right operand of 'in' is not an object"，Hermes 未捕获致 iOS 崩溃。
            if (cameraSettingsData === null || typeof cameraSettingsData !== 'object') {
              cameraSettingsData = {};
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

          {/* AI 描述信息 - 可人工编辑（改完立即可被搜索命中）；无描述也显示"添加"入口 */}
          {(() => {
            const realMsg = (currentImage.message && currentImage.message !== t('imagePreview.classificationComplete'))
              ? currentImage.message : '';
            return (
              <TouchableOpacity
                style={styles.infoRow}
                activeOpacity={0.6}
                onPress={() => { setDescDraft(realMsg); setDescEditorVisible(true); }}
              >
                <Text style={styles.infoLabel}>🤖 {t('imagePreview.aiDescription') || 'AI 描述'}:</Text>
                <Text style={[styles.infoValue, !realMsg && { color: cTheme.tertiaryLabel }]}>
                  {realMsg || (t('imagePreview.addDescription') || '点此添加描述（可被搜索）')}
                  <Text style={{ color: cTheme.tertiaryLabel }}>  ✏️</Text>
                </Text>
              </TouchableOpacity>
            );
          })()}

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
    // 同 categoryModal：RN iOS <Modal> 偶发不响应 hide，改 inline TouchableOpacity overlay
    if (!showEnhancePresets) return null;
    return (
      <TouchableOpacity
        activeOpacity={1}
        onPress={closeEnhanceModal}
        style={[styles.modalOverlay, { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }]}
      >
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={[styles.modalContainer, { backgroundColor: cTheme.card }]}>
          <View style={[styles.modalHeader, { borderBottomColor: cTheme.separator }]}>
            <Text style={[styles.modalTitle, { color: cTheme.label }]}>{t('category.enhanceMenu').replace(' ›', '')}</Text>
            <Text style={[styles.modalSubtitle, { color: cTheme.tertiaryLabel }]}>
              {t('category.selectEnhancePresetForImages', { count: 1 })}
            </Text>
          </View>

          <ScrollView style={styles.categoryList}>
            {Object.entries(enhancePresets)
              .sort(([, a], [, b]) => (a?.sortOrder || 0) - (b?.sortOrder || 0))
              .map(([presetId, preset]) => {
                const displayName = preset.name || presetId;
                return (
                  <TouchableOpacity
                    key={presetId}
                    style={[styles.categoryItem, { borderBottomColor: cTheme.separator }]}
                    onPress={() => {
                      handleEnhancePresetPress(presetId);
                      closeEnhanceModal();
                    }}
                  >
                    {PvIonicons
                      ? <PvIonicons name={presetIcon(presetId)} size={22} color={cTheme.accent} style={styles.categoryIcon} />
                      : <Text style={styles.categoryIcon}>{preset.icon || '✨'}</Text>}
                    <Text style={[styles.categoryName, { color: cTheme.label }]}>{displayName}</Text>
                  </TouchableOpacity>
                );
              })}
          </ScrollView>

          <TouchableOpacity
            style={[styles.modalCancelButton, { borderTopColor: cTheme.separator }]}
            onPress={closeEnhanceModal}
          >
            <Text style={styles.modalCancelText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  /**
   * 渲染底部操作栏
   */
  // 操作栏图标：优先 Ionicons（iOS 单色），回退 emoji。
  // 颜色固定白色 —— chrome 永远是深色 blur 底，cTheme.label 在 light mode 是黑色，
  // 黑底黑字会看不见（之前的 bug：iOS 真机用户反映"图标看不清"）。
  const actIcon = (key, emoji) => (PvIonicons
    ? <PvIonicons name={ACTION_ICONS[key]} size={24} color="#FFFFFF" style={styles.actionIcon} />
    : <Text style={styles.actionIcon}>{emoji}</Text>);

  const renderActions = () => {
    return (
      <Animated.View
        style={[styles.actionsBar, !USE_BLUR_VIEW && { backgroundColor: CHROME_BG_DARK }, { opacity: chromeOpacityAnim }]}
        pointerEvents={chromeVisible ? 'auto' : 'none'}
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          if (h > 0 && Math.abs(h - actionsBarHeight) > 1) setActionsBarHeight(h);
        }}
      >
        <ChromeBackdrop />
        {/* 暂存/移出按钮 */}
        {!isInStagingBox ? (
          <TouchableOpacity style={styles.actionButton} onPress={handleStaging}>
            {actIcon('stage', '📦')}
            <Text style={styles.actionLabel}>{t('imagePreview.stage')}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.actionButton} onPress={handleRemoveFromStagingBox}>
            {actIcon('remove', '📤')}
            <Text style={styles.actionLabel}>{t('imagePreview.remove')}</Text>
          </TouchableOpacity>
        )}

        {/* 删除按钮（所有分类都显示） */}
        <TouchableOpacity style={styles.actionButton} onPress={handleDelete}>
          {actIcon('delete', '🗑️')}
          <Text style={styles.actionLabel}>{t('common.delete')}</Text>
        </TouchableOpacity>

        {/* 照片创玩 / 滤镜：仅图片可用——视频（任何漏网入口进来的）隐藏，避免对 video uri 做图像处理 */}
        {!String(currentImage?.mimeType || '').startsWith('video/') && (
          <>
            <TouchableOpacity style={styles.actionButton} onPress={openEnhanceModal}>
              {actIcon('enhance', '✨')}
              <Text style={styles.actionLabel}>{t('imagePreview.enhance')}</Text>
            </TouchableOpacity>

            {/* 🆕 滤镜修图（jimp 本地处理，离线） */}
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => displayUri && navigation.navigate('FilterEditor', { imageUri: displayUri, image: currentImage })}>
              {actIcon('filter', '🎨')}
              <Text style={styles.actionLabel}>{t('imagePreview.filter')}</Text>
            </TouchableOpacity>

            {/* 🔎 以图搜图：按颜色特征找相似照片 */}
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => navigation.navigate('Search', { similarTo: currentImage })}>
              {actIcon('similar', '🔎')}
              <Text style={styles.actionLabel}>{t('imagePreview.findSimilar') || '找相似'}</Text>
            </TouchableOpacity>
          </>
        )}

        {/* 分类按钮 */}
        <TouchableOpacity style={styles.actionButton} onPress={openCategoryModal}>
          {actIcon('category', '🏷️')}
          <Text style={styles.actionLabel}>{t('imagePreview.category')}</Text>
        </TouchableOpacity>

        {/* 分享按钮 */}
        <TouchableOpacity style={styles.actionButton} onPress={handleShare}>
          {actIcon('share', '📤')}
          <Text style={styles.actionLabel}>{t('category.share')}</Text>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  /**
   * 渲染分类选择器 Modal
   */
  const renderCategoryModal = () => {
    if (!configService || !configService.isConfigLoaded()) {
      return null;
    }
    
    const builtIn = configService.getAllCategoriesWithUI();
    if (!Array.isArray(builtIn)) {
      return null;
    }

    const currentLang = i18n.language || 'zh';
    const language = currentLang === 'en' ? 'english' : 'chinese';
    // 合入自定义分类、再做终态排序（其他倒数第二、待分类末位）。
    // NA_video 排除：它与 NA 同显示名「待分类」，并列会选混；移到待分类时数据层会按
    // mimeType 自动路由（图→NA、视频→NA_video），选择器只需给一个「待分类」入口。
    const merged = [...builtIn].filter((c) => c.id !== 'NA_video');
    for (const c of customCategoryList) {
      if (merged.some((x) => x.id === c.id)) continue;
      merged.push({ id: c.id, chinese: c.name, english: c.name });
    }
    const categories = sortCategoryList(merged);

    // 同 PR #36：RN iOS <Modal> 在 visible:true→false 切换偶发不响应（native
    // UIVC 漏 hide command），改用 absolute fill inline overlay，setState(false)
    // 直接卸载组件，不走原生 modal 生命周期。
    if (!showCategoryModal) return null;
    return (
      <TouchableOpacity
        activeOpacity={1}
        onPress={closeCategoryModal}
        style={[styles.modalOverlay, { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }]}
      >
        {/* 内层 TouchableOpacity 拦截，不让点 sheet 内部冒泡到 backdrop 关闭 */}
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={[styles.modalContainer, { backgroundColor: cTheme.card }]}>
          <View style={[styles.modalHeader, { borderBottomColor: cTheme.separator }]}>
            <Text style={[styles.modalTitle, { color: cTheme.label }]}>{t('imagePreview.selectCategory')}</Text>
            <Text style={[styles.modalSubtitle, { color: cTheme.tertiaryLabel }]}>
              {t('category.moveImagesTo', { count: 1 })}
            </Text>
          </View>

          <ScrollView style={styles.categoryList}>
            {categories.map((cat) => {
              const categoryName = configService.getCategoryDisplayName(cat.id, language) ||
                                 (currentLang === 'en' ? (cat.english || cat.chinese) : (cat.chinese || cat.english)) ||
                                 cat.id;
              const isSelected = currentImage?.category === cat.id;
              const meta = getCategoryIconMeta(cat.id, customCategoryList);

              return (
                <TouchableOpacity
                  key={cat.id}
                  style={[styles.categoryItem, { borderBottomColor: cTheme.separator }]}
                  onPress={() => handleCategoryChange(cat.id)}
                >
                  <View style={[styles.categoryIconWrap, { backgroundColor: meta.color }]}>
                    <Icon name={meta.iconName} size={20} color="#FFFFFF" />
                  </View>
                  <Text style={[
                    styles.categoryName,
                    { color: cTheme.label },
                    isSelected && styles.selectedCategoryText
                  ]}>{categoryName}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <TouchableOpacity
            style={[styles.modalCancelButton, { borderTopColor: cTheme.separator }]}
            onPress={closeCategoryModal}
          >
            <Text style={styles.modalCancelText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  // ==================== 主渲染 ====================

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      {/* 顶部导航栏 */}
      {renderHeader()}

      {/* 主图片区域 */}
      <View style={styles.imageContainer}>
        <FlatList
          ref={flatListRef}
          data={allImagesState}
          extraData={viewportW}
          horizontal
          pagingEnabled
          scrollEnabled={!zoomed}
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item, index) => item.id || `image-${index}`}
          getItemLayout={(data, index) => ({
            length: viewportW,
            offset: viewportW * index,
            index,
          })}
          // P1：FlatList 性能调优（左右滑动看图场景）
          windowSize={3}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          removeClippedSubviews={true}
          onScrollToIndexFailed={({ index }) => {
            // 列表还未把目标行渲染出来时退避重试（windowSize=3 时 scrollToIndex 可能落空）
            setTimeout(() => flatListRef.current?.scrollToIndex({ index, animated: false }), 200);
          }}
          onMomentumScrollEnd={(e) => {
            const offsetX = e.nativeEvent.contentOffset.x;
            const index = Math.round(offsetX / viewportW);
            if (index !== currentImageIndex) {
              setCurrentImageIndex(index);
            }
          }}
          renderItem={({ item, index }) => {
            const itemUri = resolveImageUri(item);
            const isCurrentPage = index === currentImageIndex;
            const showZoomable = isCurrentPage && !!itemUri;
            return (
              // P1：Pressable 外层捕获 tap → 切换 chrome（不打断手势缩放：
              // Pinch/Pan GestureHandler 在内层，只有 2 指 / 已放大 1 指拖动 才会激活，
              // 单指轻触不触发手势，会冒泡到 Pressable）
              <Pressable
                style={[styles.imagePage, { width: viewportW }]}
                onPress={toggleChrome}
                android_ripple={null}
                android_disableSound={true}
              >
                <View style={[styles.imagePageClip, { width: viewportW }]}>
                {itemUri ? (
                  showZoomable ? (
                    <PinchGestureHandler
                      ref={pinchRef}
                      simultaneousHandlers={panRef}
                      onGestureEvent={onPinchGestureEvent}
                      onHandlerStateChange={onPinchStateChange}
                    >
                      <PanGestureHandler
                        ref={panRef}
                        simultaneousHandlers={pinchRef}
                        enabled={zoomed}
                        minPointers={1}
                        maxPointers={1}
                        avgTouches
                        onGestureEvent={onPanGestureEvent}
                        onHandlerStateChange={onPanStateChange}
                      >
                        <Animated.View style={[styles.imageWrap, { width: viewportW }, zoomableStyle]}>
                          <Image
                            source={{ uri: itemUri }}
                            style={[styles.image, { width: viewportW }]}
                            resizeMode="contain"
                            fadeDuration={0}
                            onError={(e) => {
                              logger.error(`❌ 图片[${index}]加载失败: ${e.nativeEvent.error}`);
                            }}
                          />
                        </Animated.View>
                      </PanGestureHandler>
                    </PinchGestureHandler>
                  ) : (
                    <Image
                      source={{ uri: itemUri }}
                      style={[styles.image, { width: viewportW }]}
                      resizeMode="contain"
                      onError={(e) => {
                        logger.error(`❌ 图片[${index}]加载失败: ${e.nativeEvent.error}`);
                      }}
                    />
                  )
                ) : (
                  <View style={[styles.image, styles.imagePlaceholder, { width: viewportW }]}>
                    <Text style={styles.placeholderText}>{t('imagePreview.imageNotFound')}</Text>
                  </View>
                )}
                </View>
                {/* 视频：海报帧上盖居中▶播放键（点▶进系统播放器；查看信息/改分类/编辑描述都在预览页完成） */}
                {String(item?.mimeType || '').startsWith('video/') && (
                  <TouchableOpacity
                    style={styles.videoPlayOverlay}
                    activeOpacity={0.8}
                    onPress={() => playVideoRecord(item)}
                  >
                    <Text style={styles.videoPlayOverlayIcon}>▶</Text>
                  </TouchableOpacity>
                )}
              </Pressable>
            );
          }}
        />
        </View>

      {/* 图片信息面板 */}
      {renderImageInfo()}

      {/* 底部操作栏 */}
      {renderActions()}

      {/* 增强预设模态框 */}
      {renderEnhanceModal()}

      {/* 分类选择器模态框 */}
      {renderCategoryModal()}

      {/* AI 描述编辑浮层（inline overlay，同 categoryModal 避开 RN iOS Modal 偶发不关 bug） */}
      {descEditorVisible && (
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setDescEditorVisible(false)}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, backgroundColor: 'rgba(0,0,0,0.45)' }}
        >
          {/* KAV 必须 flex:1 占满全屏，padding 行为才能把居中的卡片顶到键盘上方（同 CustomCategories 弹窗已验证方案） */}
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ flex: 1, justifyContent: 'center' }}
            pointerEvents="box-none"
          >
            <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ marginHorizontal: 24, borderRadius: 14, backgroundColor: cTheme.card, padding: 16 }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: cTheme.label, marginBottom: 10 }}>
                🤖 {t('imagePreview.editDescription') || '编辑 AI 描述'}
              </Text>
              <TextInput
                style={{ minHeight: 88, maxHeight: 180, borderWidth: StyleSheet.hairlineWidth, borderColor: cTheme.separator, borderRadius: 10, padding: 10, fontSize: 15, color: cTheme.label, textAlignVertical: 'top', backgroundColor: cTheme.groupedBg || 'rgba(120,120,128,0.08)' }}
                value={descDraft}
                onChangeText={setDescDraft}
                multiline
                autoFocus
                placeholder={t('imagePreview.descPlaceholder') || '写点描述，搜索时可按它找到这张图…'}
                placeholderTextColor={cTheme.tertiaryLabel}
              />
              <Text style={{ fontSize: 12, color: cTheme.tertiaryLabel, marginTop: 6 }}>
                {t('imagePreview.descSearchableTip') || '保存后可在「搜索」中按这段描述找到它'}
              </Text>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14, gap: 18 }}>
                <TouchableOpacity onPress={() => setDescEditorVisible(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={{ fontSize: 16, color: cTheme.secondaryLabel }}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={async () => {
                    const text = descDraft.trim();
                    const r = await UnifiedDataService.updateImageDescription(currentImage?.id, text);
                    if (r && r.success) {
                      setCurrentImage((prev) => ({ ...prev, message: text || null }));
                      setToastMessage(t('imagePreview.descSaved') || '描述已保存');
                    } else {
                      setToastMessage(t('imagePreview.descSaveFailed') || '保存失败');
                    }
                    setDescEditorVisible(false);
                  }}
                >
                  <Text style={{ fontSize: 16, fontWeight: '600', color: '#007AFF' }}>{t('common.save') || t('common.confirm')}</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        </TouchableOpacity>
      )}

      {toastMessage ? (
        <Toast message={toastMessage} onDone={() => setToastMessage(null)} placement="screenCenter" />
      ) : null}
    </SafeAreaView>
  );
};

// ==================== 样式 ====================
// 工厂模式：styles 跟随主题（light/dark）切换，与 HomeScreen / SettingsScreen 一致。
// 入参 c = useIosColors() 返回的调色板（lightColors 或 darkColors）。
//
// 颜色映射约定（与本项目 iOS 主题令牌对齐）：
//   #FFFFFF 卡背景 → c.card           #000000/#1C1C1E 主文 → c.label
//   #8E8E93 次要 → c.tertiaryLabel    #C6C6C8/#E5E5EA 分隔 → c.separator
//   #007AFF → c.accent                #EAF2FF → c.accentSoft   #FF3B30 → c.danger
// 保留不动：
//   - 顶部 header（rgba 半透明黑底，永远叠在图片上，文字写死白色更稳）
//   - imagePlaceholder（位于全黑图片画布内）
//   - container 背景 #000000（沉浸式照片画布）
//   - modalOverlay rgba(0,0,0,0.5)（背板）

const createStyles = (c) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000', // 沉浸式照片画布：永远黑底，与主题无关
  },

  // 头部：iOS Photos 风格磨砂玻璃 chrome（BlurView 提供半透明 + 模糊照片底）。
  // 文字/图标固定白色，与系统主题无关；BlurView 之前是 rgba(28,28,30,0.9) 兜底色。
  // 此处不再写 backgroundColor —— AnimatedBlurView 自身处理底色 + reducedTransparencyFallback。
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
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
    backgroundColor: '#1C1C1E', // 位于黑色图片画布内：占位永远深灰，与主题无关
    justifyContent: 'center',
    alignItems: 'center',
  },
  // 视频页居中▶播放键（盖在海报帧上；只占 64px 圆，不挡左右滑动）
  videoPlayOverlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginTop: -32,
    marginLeft: -32,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoPlayOverlayIcon: {
    color: '#FFFFFF',
    fontSize: 26,
    marginLeft: 4,   // ▶ 视觉居中微调
  },
  placeholderText: {
    color: '#8E8E93',
    fontSize: 14,
  },

  // 导航箭头样式已移除 - 使用纯手势操作

  // 信息面板（卡片表面）
  infoPanel: {
    position: 'absolute',
    bottom: 80,
    left: 0,
    right: 0,
    backgroundColor: c.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: SCREEN_HEIGHT * 0.72,
  },
  infoPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.separator,
  },
  infoPanelTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: c.label,
  },
  infoPanelClose: {
    fontSize: 20,
    color: c.tertiaryLabel,
  },
  infoContent: {
    padding: 16,
  },
  // 滚动内容底部留白：让「分类」等最后一行与面板圆角底边之间有呼吸空间，不被底部操作栏裁掉
  infoContentContainer: {
    paddingBottom: 28,
  },
  infoRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.separator,
  },
  infoLabel: {
    width: 80,
    fontSize: 14,
    color: c.tertiaryLabel,
  },
  infoValue: {
    flex: 1,
    fontSize: 14,
    color: c.label,
  },

  // 检测结果样式（iOS 风格：每条标签做成 accent-soft 胶囊，
  // 标题/「更多」用 width:100% 占满整行做换行，items 自然 flex-wrap）。
  detectionSection: {
    marginTop: 8,
    paddingLeft: 80,
    paddingRight: 16,
    paddingBottom: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.separator,
  },
  detectionTitle: {
    width: '100%',
    fontSize: 13,
    color: c.tertiaryLabel,
    marginBottom: 6,
  },
  detectionItem: {
    backgroundColor: c.accentSoft,
    borderRadius: 11,
    paddingHorizontal: 9,
    paddingVertical: 4,
    marginRight: 6,
    marginBottom: 6,
  },
  detectionText: {
    fontSize: 12,
    fontWeight: '600',
    color: c.accent,
    letterSpacing: -0.1,
    fontVariant: ['tabular-nums'],
  },
  detectionMore: {
    width: '100%',
    fontSize: 12,
    color: c.tertiaryLabel,
    marginTop: 2,
    fontStyle: 'italic',
  },

  // 操作栏：iOS Photos 磨砂玻璃 chrome；BlurView 自带半透明 + 模糊，不设 backgroundColor。
  // 顶部 hairline 保留（iOS toolbar 标志性分隔线），用半透明白以适配深色 blur 底。
  actionsBar: {
    position: 'relative',
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.15)',
    paddingTop: 10,
    paddingBottom: 16,
    paddingHorizontal: 8,
    justifyContent: 'space-around',
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  actionIcon: {
    fontSize: 23,
    marginBottom: 3,
  },
  // chrome 永远是深色 blur 底（即使 light mode）—— label 常驻白色保持对比
  actionLabel: {
    fontSize: 11,
    color: '#FFFFFF',
  },

  // Modal 样式
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)', // 半透明背板：保持不动
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: c.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
  },
  modalHeader: {
    padding: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.separator,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: c.label,
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    color: c.tertiaryLabel,
  },
  categoryList: {
    flexShrink: 1, // 在 modal 高度内自适应并可滚动，保证"取消"始终在列表下方不重叠
  },
  categoryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.separator,
  },
  categoryIcon: {
    fontSize: 22,
    marginRight: 10,
  },
  // 统一图标容器：圆形 + 主题色背景 + 白色字体图标（视觉一致，不再是 emoji）
  categoryIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  categoryName: {
    fontSize: 16,
    color: c.label,
    flex: 1,
  },
  selectedCategoryText: {
    color: c.accent,
    fontWeight: '600',
  },
  modalCancelButton: {
    padding: 16,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.separator,
  },
  modalCancelText: {
    fontSize: 16,
    color: c.accent,
    fontWeight: '500',
  },
});

export default ImagePreviewScreen;
