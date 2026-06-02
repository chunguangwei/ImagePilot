/**
 * ImagePilot - 移动端分类详情页（通用）
 * 
 * 支持4种形态：
 * 1. 普通分类页 (category参数)
 * 2. 暂存箱页 (category='stagingBox')
 * 3. 城市分类页 (city参数)
 * 4. 相似组详情页 (similarityGroupId参数)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  Share,
  Modal,
  ScrollView,
  NativeModules,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView, useFocusEffect, Alert } from '../../adapters/WebAdapters';
import { DeviceEventEmitter } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import UnifiedDataService from '../../services/UnifiedDataService';
import WeChatAuthService from '../../services/WeChatAuthService';
import GlobalImageCache from '../../services/GlobalImageCache';
import configService from '../../services/ConfigService';
import cityLocationService from '../../services/CityLocationService';
import { sortCategoryList, getCategoryIconMeta } from '../../components/shared/categoryUI';
import { Icon } from '../../adapters/WebAdapters';
import { logger, getUri } from '../../adapters/WebAdapters';

// iOS 单色图标（字体已打包）；异常时回退 emoji
let CatIonicons = null;
try { CatIonicons = require('react-native-vector-icons/Ionicons').default; } catch (_) { CatIonicons = null; }
import { ACTION_ICONS } from '../../ui/ios/presetIcons';
import { getColorNameTranslation, getOrientationNameTranslation, getCameraSettingsCategoryTranslation, getDefaultPresets } from '../../i18n';
import { useIosColors } from '../../ui/ios/theme';
import Haptics from '../../utils/haptics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// 时间轴网格（HIG iOS 相册 3 列；用 gap 公式统一边距/间隙）
const GRID_COLUMNS = 3;
const GRID_PADDING = 8;        // timelineContainer 左右 padding
const GRID_GAP = 2;            // 单元格之间 + 行之间 gap
const TIMELINE_ITEM_SIZE =
  (SCREEN_WIDTH - GRID_PADDING * 2 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;

/** 时间轴某日下的照片相关地点（异步解析 location_id 为显示名） */
const TimelineLocationLine = React.memo(({ imagesForDate }) => {
  const { i18n } = useTranslation('common');
  const c = useIosColors();
  const [locationNames, setLocationNames] = useState([]);
  const lang = i18n.language || 'zh';
  useEffect(() => {
    const cityIds = [...new Set((imagesForDate || []).map(img => img.city).filter(Boolean))];
    if (cityIds.length === 0) {
      setLocationNames([]);
      return;
    }
    let cancelled = false;
    Promise.all(cityIds.map(id => cityLocationService.getLocationName(id, lang).catch(() => id)))
      .then(names => {
        if (!cancelled) setLocationNames(names || []);
      });
    return () => { cancelled = true; };
  }, [imagesForDate, lang]);
  if (locationNames.length === 0) return null;
  return (
    <Text style={{ fontSize: 12, color: c.tertiaryLabel, marginTop: 2 }} numberOfLines={1}>
      {locationNames.join('、')}
    </Text>
  );
});

const CategoryScreen = ({ route, navigation }) => {
  const { t, i18n } = useTranslation('common');
  const c = useIosColors();
  const insets = useSafeAreaInsets();
  const styles = React.useMemo(() => createStyles(c), [c]);

  // ==================== 路由参数 ====================
  // 统一使用 filterType 和 filterValue，从旧参数推导（过渡期）
  const { filterType: propFilterType, filterValue: propFilterValue, fromScreen } = route.params || {};
  
  // 从旧参数推导 filterType 和 filterValue（向后兼容，但优先使用新参数）
  const { category, city, similarityGroupId, color } = route.params || {};
  let filterType = propFilterType;
  let filterValue = propFilterValue;
  
  // 如果没有新参数，从旧参数推导
  if (!filterType) {
    if (category === 'stagingBox') {
      filterType = 'stagingBox';
      filterValue = null;
    } else if (category) {
      filterType = 'category';
      filterValue = category;
    } else if (city) {
      filterType = 'city';
      filterValue = city;
    } else if (similarityGroupId) {
      filterType = 'similarityGroup';
      filterValue = similarityGroupId;
    } else if (color) {
      filterType = 'color';
      filterValue = color;
    }
  }
  
  // ==================== 状态管理 ====================
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // 多选模式
  const [selectionMode, setSelectionMode] = useState(false);
  const [showActionMenu, setShowActionMenu] = useState(false);
  
  // 选中数量状态
  const [selectedCount, setSelectedCount] = useState(0);
  
  // 分类选择器模态框
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [pendingImageIds, setPendingImageIds] = useState([]);
  
  // 操作进度相关状态
  const [showDeleteProgress, setShowDeleteProgress] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ filesDeleted: 0, filesFailed: 0, total: 0 });
  
  const [showUpdateProgress, setShowUpdateProgress] = useState(false);
  const [updateProgress, setUpdateProgress] = useState({ filesProcessed: 0, filesFailed: 0, total: 0 });
  const [updateOperationType, setUpdateOperationType] = useState(''); // 'changeCategory' 或 'moveToStaging'
  
  // 城市显示名称（根据语言设置）
  const [cityDisplayName, setCityDisplayName] = useState(null);

  // 时间轴分组
  const [groupedImages, setGroupedImages] = useState({});
  
  // 高亮图片（从 ImagePreview 返回时使用）
  const [highlightedImageId, setHighlightedImageId] = useState(null);
  const flatListRef = useRef(null);
  const hasProcessedReturnedImageIdRef = useRef(false); // 用于防止重复处理 returnedImageId
  
  // 暂存箱图片ID集合（用于快速检查图片是否在暂存箱中）
  const [stagingBoxImageIds, setStagingBoxImageIds] = useState(new Set());
  // 用户自定义分类（settings.aiProvider.customCategories，[{id,name,rule}]）
  // 标题显示与"改分类"选择器都需要合并自定义分类（configService 只含内置）
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
  
  // 照片创玩任务相关（任务提交已移到结果页，不再需要状态跟踪）

  // ==================== 页面类型判断 ====================
  // 统一基于 filterType 判断
  const pageType = filterType || null;
  const isStaging = filterType === 'stagingBox';

  // ==================== 页面形状配置 ====================
  // 所有 filterType 派生的"页面行为"集中在这里，避免 if-isStaging 散落 8 处。
  // - actionButtons / emptyState: 数据形态在这里定义，JSX 渲染时直接读
  // - requiresFilterValue: 校验规则（stagingBox 不需要 filterValue，其它都需要）
  // - trackStagingMembership: 是否同步 stagingBoxImageIds 集合（用于"已暂存"badge）
  // 注：computed 在 render 阶段，依赖 filterType / filterValue / t / navigation / route，
  //     这些每次都会重算成本可忽略；不放 useMemo 以保持可读性。
  const screenConfig = (() => {
    const requiresFilterValue = !isStaging;
    const trackStagingMembership = !isStaging;

    // 操作按钮：暂存箱有"移出"，其它有"暂存"，其余动作相同。
    // 用 iconKey 对齐 ACTION_ICONS（与 ImagePreview 底部栏同款单色 Ionicons），
    // emoji 留作 Ionicons 加载失败的兜底；之前的彩色边框已废弃——参考 iOS Photos
    // 多选工具栏：纯图标+文字，destructive(删除)用红，其余统一蓝主题色。
    const actionButtons = isStaging
      ? [
          { id: 'removeFromStaging', label: t('category.removeFromStagingLabel'), iconKey: 'remove', emoji: '➡️' },
          { id: 'delete', label: t('common.delete'), iconKey: 'delete', emoji: '🗑️', danger: true },
          { id: 'enhance', label: t('category.enhance'), iconKey: 'enhance', emoji: '✨' },
          { id: 'changeCategory', label: t('category.changeCategory'), iconKey: 'category', emoji: '🏷️' },
          { id: 'share', label: t('category.share'), iconKey: 'share', emoji: '📤' },
        ]
      : [
          { id: 'staging', label: t('category.staging'), iconKey: 'stage', emoji: '📦' },
          { id: 'delete', label: t('common.delete'), iconKey: 'delete', emoji: '🗑️', danger: true },
          { id: 'enhance', label: t('category.enhance'), iconKey: 'enhance', emoji: '✨' },
          { id: 'changeCategory', label: t('category.changeCategory'), iconKey: 'category', emoji: '📁' },
          { id: 'share', label: t('category.share'), iconKey: 'share', emoji: '📤' },
        ];

    // 空状态 CTA：返回 { title, actionLabel, onAction }，actionLabel 为 null 则不渲染按钮
    let emptyState = { title: t('category.noImages'), actionLabel: null, onAction: null };
    if (isStaging) {
      emptyState = {
        title: t('category.emptyCTAStagingTitle'),
        actionLabel: t('category.emptyCTAStagingAction'),
        onAction: () => {
          if (navigation.canGoBack()) navigation.goBack();
          else navigation.navigate('Home');
        },
      };
    } else if (filterType === 'category' && filterValue === 'NA') {
      const startSmartScan = route?.params?.startSmartScan;
      emptyState = {
        title: t('category.emptyCTAUnclassifiedTitle'),
        actionLabel: t('category.emptyCTAUnclassifiedAction'),
        onAction: () => {
          if (typeof startSmartScan === 'function') startSmartScan();
          else navigation.navigate('Home');
        },
      };
    }

    return { requiresFilterValue, trackStagingMembership, actionButtons, emptyState };
  })();

  // 照片创玩（增强方案）
  const [showEnhancePresets, setShowEnhancePresets] = useState(false);
  const [enhancePresets, setEnhancePresets] = useState({});

  /**
   * 截断过长的文本，添加省略号
   */
  const truncateText = (text, maxLength = 20) => {
    if (!text || typeof text !== 'string') return text;
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  /**
   * 缩写英文预设名称（用于移动端显示）
   */
  const abbreviatePresetName = (name) => {
    if (!name || typeof name !== 'string') return name;
    
    // 如果是中文，直接返回
    if (/[\u4e00-\u9fa5]/.test(name)) {
      return name;
    }
    
    // 英文缩写映射表
    const abbreviations = {
      'Portrait': 'Portrait',
      'Enhance': 'Enhance',
      'Color': 'Color',
      'Document': 'Doc',
      'Custom': 'Custom',
      'Photo Enhancement': 'Enhance',
      'ID Card': 'ID Card',
      'QR Code': 'QR Code',
    };
    
    // 如果匹配到缩写，直接返回
    if (abbreviations[name]) {
      return abbreviations[name];
    }
    
    // 如果名称太长（超过8个字符），截断
    if (name.length > 8) {
      return name.substring(0, 8) + '...';
    }
    
    return name;
  };

  /**
   * 获取页面标题（与 PC 端格式一致）
   */
  const getPageTitle = () => {
    // 🆕 添加空值检查
    const count = Array.isArray(images) ? images.length : 0;
    
    if (!filterType) {
      return t('category.imageList');
    }
    
    const currentLang = i18n.language || 'zh';
    const language = currentLang === 'en' ? 'english' : 'chinese';
    
    switch (filterType) {
      case 'similarityGroup':
        return t('category.similarityGroupWithCount', { count });
      case 'directory':
        if (filterValue) {
          // 提取目录名（最后一个路径段）
          const directoryName = filterValue.split('/').pop() || filterValue;
          // 截断过长的目录名
          const truncatedName = truncateText(directoryName, 20);
          return t('category.directoryWithCount', { name: truncatedName, count });
        }
        return t('category.directoryWithCount', { name: t('category.directory'), count });
      case 'city':
        return t('category.cityWithCount', { city: cityDisplayName || filterValue || t('category.city'), count });
      case 'color':
        return t('category.colorWithCount', { 
          color: getColorNameTranslation(filterValue, currentLang) || t('category.color'), 
          count 
        });
      case 'format':
        return t('category.formatWithCount', { format: filterValue || t('category.format'), count });
      case 'resolution':
        return t('category.resolutionWithCount', { resolution: filterValue || t('category.resolution'), count });
      case 'orientation':
        return t('category.orientationWithCount', { 
          orientation: getOrientationNameTranslation(filterValue, currentLang) || t('category.orientation'), 
          count 
        });
      case 'iso':
        return t('category.isoWithCount', { 
          iso: getCameraSettingsCategoryTranslation('iso', filterValue, currentLang) || filterValue || 'ISO', 
          count 
        });
      case 'aperture':
        return t('category.apertureWithCount', { 
          aperture: getCameraSettingsCategoryTranslation('aperture', filterValue, currentLang) || filterValue || t('settings.apertureCategory'), 
          count 
        });
      case 'shutter':
        return t('category.shutterWithCount', { 
          shutter: getCameraSettingsCategoryTranslation('shutter', filterValue, currentLang) || filterValue || t('settings.shutterCategory'), 
          count 
        });
      case 'focalLength':
        return t('category.focalLengthWithCount', { 
          focalLength: getCameraSettingsCategoryTranslation('focalLength', filterValue, currentLang) || filterValue || t('settings.focalLengthCategory'), 
          count 
        });
      case 'stagingBox':
        return t('category.stagingBoxWithCount', { count });
      case 'time':
        if (filterValue) {
          const timeLabel = /^\d{4}$/.test(filterValue) ? t('home.yearLabel', { year: filterValue }) : t(`home.${filterValue}`);
          return t('category.timeWithCount', { label: timeLabel, count });
        }
        return t('category.imageList');
      case 'category':
        if (filterValue) {
          // 先匹配自定义分类（configService 仅含内置）
          const custom = customCategoryList.find((c) => c.id === filterValue);
          const categoryName = custom?.name ||
                               configService?.getCategoryDisplayName(filterValue, language) ||
                               UnifiedDataService.getCategoryDisplayName(filterValue) ||
                               filterValue;
          return t('category.categoryWithCount', { category: categoryName, count });
        }
        return t('category.categoryWithCount', { category: t('category.category'), count });
      default:
        return t('category.imageList');
    }
  };

  // ==================== 选择模式相关函数 ====================
  
  // 计算选中数量的函数
  const calculateSelectedCount = async () => {
    try {
      if (!filterType) {
        return 0;
      }
      
      // 统一使用 UnifiedDataService.getSelectedImagesByFilter
      const selectedImages = await UnifiedDataService.getSelectedImagesByFilter(filterType, filterValue);
      return selectedImages.length;
    } catch (error) {
      logger.error('获取选中数量失败:', error);
      return 0;
    }
  };
  
  // 全选/取消全选（与 PC 端同步到 UnifiedDataService）
  const toggleSelectAll = async () => {
    // 实时获取当前状态，不依赖状态变量
    const currentSelectedCount = await calculateSelectedCount();
    
    if (currentSelectedCount === images.length && images.length > 0) {
      // 全部选中，则取消全选
      images.forEach(img => {
        try {
          UnifiedDataService.setImageSelection(img.id, false);
        } catch (error) {
          // 忽略已删除图片的错误
          logger.debug(`⚠️ 跳过已删除图片的选择操作: ${img.id}`);
        }
      });
    } else {
      // 否则全选当前页面的所有图片
      images.forEach(img => {
        try {
          UnifiedDataService.setImageSelection(img.id, true);
        } catch (error) {
          // 忽略已删除图片的错误
          logger.debug(`⚠️ 跳过已删除图片的选择操作: ${img.id}`);
        }
      });
    }
    
    // 更新选中数量
    const newCount = await calculateSelectedCount();
    setSelectedCount(newCount);
  };

  // 切换图片选择状态（直接使用 UnifiedDataService，与 PC 端一致）
  const toggleImageSelection = async (imageId) => {
    const isCurrentlySelected = UnifiedDataService.isImageSelected(imageId);
    UnifiedDataService.setImageSelection(imageId, !isCurrentlySelected);
    
    // 更新选中数量
    const newCount = await calculateSelectedCount();
    setSelectedCount(newCount);
  };

  // 进入选择模式
  const enterSelectionMode = () => {
    setSelectionMode(true);
  };


  // 批量修改分类
  const handleBatchChangeCategory = async (newCategory) => {
    // 实时获取选中数量，不依赖状态变量
    const currentSelectedCount = await calculateSelectedCount();
    if (currentSelectedCount === 0) return;
    
    try {
      // 从 UnifiedDataService 获取选中的图片ID
      const selectedImageIds = images
        .filter(img => UnifiedDataService.isImageSelected(img.id))
        .map(img => img.id);
      
      const targetCategoryName = UnifiedDataService.getCategoryDisplayName(newCategory);
      
      Alert.alert(
        t('category.confirmChangeCategoryTitle'),
        t('category.confirmChangeCategoryMessage', { count: selectedImageIds.length, category: targetCategoryName }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.confirm'),
            onPress: async () => {
              try {
                let processed = 0;
                for (const imageId of selectedImageIds) {
                  await UnifiedDataService.updateImagesCategory([imageId], newCategory);
                  processed++;
                }
                
                // 清除选中状态
                selectedImageIds.forEach(id => {
                  try {
                    UnifiedDataService.setImageSelection(id, false);
                  } catch (error) {
                    logger.debug(`⚠️ 跳过已删除图片的选择操作: ${id}`);
                  }
                });
                setSelectionMode(false);
                setShowActionMenu(false);
                
                // 刷新数据
                await loadImages();
              } catch (error) {
                logger.error('批量修改分类失败:', error);
                Alert.alert(t('settings.operationFailed'), t('category.changeCategoryError'));
              }
            },
          },
        ]
      );
    } catch (error) {
      logger.error('批量修改分类失败:', error);
      Alert.alert(t('common.error'), t('category.operationFailedMessage'));
    }
  };

  // ==================== 时间轴分组相关函数 ====================
  
  // 时间轴标题点击处理 - 全选/取消全选该时间段的所有图片（与 PC 端一致）
  const handleTimelineHeaderPress = async (imagesForDate) => {
    if (!selectionMode) {
      // 非选择模式下，进入选择模式并全选该组
      setSelectionMode(true);
      imagesForDate.forEach(img => {
        UnifiedDataService.setImageSelection(img.id, true);
      });
      const newCount = await calculateSelectedCount();
      setSelectedCount(newCount);
      return;
    }
    
    const imageIds = imagesForDate.map(img => img.id);
    
    // 检查该组是否全部选中
    const allSelectedInGroup = imageIds.every(id => 
      UnifiedDataService.isImageSelected(id)
    );
    
    if (allSelectedInGroup) {
      // 全部选中，则取消全选该组
      imageIds.forEach(id => {
        UnifiedDataService.setImageSelection(id, false);
      });
    } else {
      // 未全部选中，则全选该组
      imageIds.forEach(id => {
        UnifiedDataService.setImageSelection(id, true);
      });
    }
    
    // 更新选中数量
    const newCount = await calculateSelectedCount();
    setSelectedCount(newCount);
    
    // 检查是否还有选中的图片，如果没有则退出选择模式
    if (newCount === 0) {
      setSelectionMode(false);
    }
  };
  
  const getLocalDateKey = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // 按日期分组图片（与 PC 端字段对齐）
  const groupImagesByDate = (imageList) => {
    const groups = {};
    
    // 添加空值检查
    if (!Array.isArray(imageList) || imageList.length === 0) {
      return groups;
    }
    
    imageList.forEach((image) => {
      // 添加空值检查
      if (!image || typeof image !== 'object') {
        return;
      }
      
      // 优先使用拍摄时间（takenAt），如果没有则使用文件时间（timestamp）
      let date;
      if (image.takenAt) {
        date = new Date(image.takenAt);
      } else if (image.timestamp) {
        date = new Date(image.timestamp);
      } else if (image.createdAt) {
        date = new Date(image.createdAt);
      } else if (image.modifiedAt) {
        date = new Date(image.modifiedAt);
      } else {
        // 如果都没有，使用当前日期
        date = new Date();
      }
      
      // 使用本地日期键，避免 UTC 时区偏移导致跨天
      const dateKey = getLocalDateKey(date);
      
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(image);
    });
    
    return groups;
  };




  // 页面获得焦点时刷新数据（用于 Tab 切换和从其他页面返回）
  useFocusEffect(
    useCallback(() => {
      const initData = async () => {
        // 每次获得焦点时都刷新数据，确保数据同步
        await loadImages(); // 等待数据加载和状态更新完成
        
        // 重新计算选中数量 - 现在可以安全地使用最新的数据
        const newCount = await calculateSelectedCount();
        setSelectedCount(newCount);
        
        // 统一处理高亮逻辑
        const returnedImageId = route.params?.returnedImageId;
        
        // 先检查路由参数：如果 returnedImageId 为空，立即清除高亮并跳过后续逻辑
        if (!returnedImageId) {
          // 直接进入（如从底部导航栏或 HomeScreen）：立即清除之前的高亮
          setHighlightedImageId(null);
          // 重置标记
          hasProcessedReturnedImageIdRef.current = false;
          return; // 跳过后续的高亮设置逻辑
        }
        
        // 如果有 returnedImageId，检查是否已经处理过（防止重复触发）
        if (hasProcessedReturnedImageIdRef.current === returnedImageId) {
          return;
        }
        
        // 从 ImagePreview 返回：等待 1 秒后设置高亮（确保 images 状态已更新）
        setTimeout(() => {
          // 标记为已处理
          hasProcessedReturnedImageIdRef.current = returnedImageId;
          
          // 设置高亮（直接更新状态，不调用 navigation.setParams）
          setImages(currentImages => {
            const imageExists = currentImages.some(img => img.id === returnedImageId);
            if (imageExists) {
              setHighlightedImageId(returnedImageId);
            }
            return currentImages; // 不修改 images，只是读取
          });
          // 注意：不在这里清除 navigation 参数和 highligh，让高亮一直保持直到用户点击新照片
        }, 1000); // 等待 1 秒，确保 FlatList 完全渲染和测量
      };
      
      initData();
    }, [route.params?.returnedImageId])
  );

  // 监听数据变化，执行滚动和高亮操作
  useEffect(() => {
    if (Object.keys(groupedImages).length > 0 && highlightedImageId) {
      // 直接等待1秒，确保 FlatList 完全渲染和测量
      setTimeout(() => {
        scrollToHighlightedImage(highlightedImageId);
      }, 1000); // 直接等待1秒
      
      // 不再自动取消高亮，让图片一直保持高亮状态
    }
  }, [groupedImages, highlightedImageId]); // 依赖两个状态，确保数据和高亮都准备好

  // 滚动到高亮图片所在的日期组
  const scrollToHighlightedImage = (imageId) => {
    if (!imageId) {
      return;
    }
    
    if (!flatListRef.current || Object.keys(groupedImages).length === 0) {
      return;
    }
    
    // 查找图片所在的日期组索引
    const dateKeys = Object.keys(groupedImages);
    
    // 根据图片ID获取图片数据，然后根据时间找到日期组索引
    const targetImage = images.find(img => img.id === imageId);
    if (!targetImage) {
      // 清除无效的高亮ID
      setHighlightedImageId(null);
      return;
    }
    
    // 获取图片的时间，优先使用takenAt，没有则使用timestamp
    const imageTime = targetImage.takenAt || targetImage.timestamp;
    if (!imageTime) {
      return;
    }
    
    // 将时间转换为日期键格式
    const date = new Date(imageTime);
    const targetDateKey = getLocalDateKey(date);
    
    // 在日期组中找到对应的索引
    const targetDateIndex = dateKeys.indexOf(targetDateKey);
    
    if (targetDateIndex >= 0 && targetDateIndex < dateKeys.length) {
      // 直接滚动到目标日期组
      try {
        flatListRef.current.scrollToIndex({
          index: targetDateIndex,
          animated: true,
          viewPosition: 0.3, // 将目标组滚动到屏幕上方 30% 的位置
        });
      } catch (error) {
        // 简单回退：滚动到顶部
        flatListRef.current.scrollToOffset({ offset: 0, animated: true });
      }
    }
  };


  /**
   * 加载图片列表
   */
  const loadImages = async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      let filteredImages = [];
      
      if (!filterType) {
        logger.error('没有有效的上下文参数');
        filteredImages = [];
      } else {
        // 防御性检查：暂存箱以外的 filterType 都需要 filterValue（screenConfig 统一判断）
        if (screenConfig.requiresFilterValue) {
          if (!filterValue || (typeof filterValue === 'string' && filterValue.trim() === '')) {
            logger.warn(`filterType=${filterType} 需要 filterValue，但 filterValue 为空，返回空数组`);
            filteredImages = [];
            setImages([]);
            setGroupedImages({});
            setLoading(false);
            setRefreshing(false);
            return;
          }
        }
        
        // 统一使用 UnifiedDataService.readImagesByFilter
        filteredImages = await UnifiedDataService.readImagesByFilter(filterType, filterValue);
      }

      // 按时间排序
      filteredImages.sort((a, b) => {
        if (!a || !b) return 0;
        const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return timeB - timeA;
      });

      // 设置状态
      setLoading(false);
      setRefreshing(false);
      
      // 直接设置状态，同步执行
      setImages(filteredImages);

      // 同时设置分组图片
      if (filteredImages.length > 0) {
        const grouped = groupImagesByDate(filteredImages);
        setGroupedImages(grouped);
      } else {
        setGroupedImages({});
      }
      
      // 非暂存箱页面才需要"已暂存"badge 来源（screenConfig.trackStagingMembership 统一判断）
      if (screenConfig.trackStagingMembership) {
        try {
          const stagingBoxImages = await UnifiedDataService.getStagingBoxImages();
          const stagingBoxIds = new Set(stagingBoxImages.map(img => img.id));
          setStagingBoxImageIds(stagingBoxIds);
        } catch (error) {
          logger.error('❌ 加载暂存箱图片ID失败:', error);
          setStagingBoxImageIds(new Set());
        }
      } else {
        setStagingBoxImageIds(new Set());
      }
      
      // 检查选中状态
      let selectedCount = 0;
      for (const image of filteredImages) {
        if (image && image.id && UnifiedDataService.isImageSelected(image.id)) {
          selectedCount++;
        }
      }
      
      setSelectionMode(selectedCount > 0);
      
      logger.debug(`📸 加载图片: ${filteredImages.length}张`);
      
    } catch (error) {
      logger.error('❌ 加载图片失败:', error);
      Alert.alert(t('common.failed'), error.message);
      setLoading(false);
      setRefreshing(false);
    }
  };

  /**
   * 加载城市显示名称（根据语言设置）
   */
  useEffect(() => {
    const loadCityDisplayName = async () => {
      if (filterType === 'city' && filterValue) {
        const currentLanguage = i18n.language || 'zh';
        try {
          const displayName = await cityLocationService.getLocationName(filterValue, currentLanguage);
          setCityDisplayName(displayName || filterValue);
        } catch (error) {
          logger.error('❌ 加载城市显示名称失败:', error);
          setCityDisplayName(filterValue);
        }
      } else {
        setCityDisplayName(null);
      }
    };
    
    loadCityDisplayName();
  }, [filterType, filterValue, i18n.language]);

  /**
   * 下拉刷新
   */
  const onRefresh = async () => {
    // 只重新加载数据（从缓存读取），不重建缓存
    // 缓存只在数据真正变化时（扫描、删除）才重建
    await loadImages(true);
  };

  // ==================== 选择操作 ====================

  /**
   * 长按进入多选模式
   */
  const handleLongPress = (image) => {
    if (!selectionMode) {
      Haptics.impact('light'); // 进入多选 → 轻量触感
      setSelectionMode(true);
      UnifiedDataService.setImageSelection(image.id, true);
      setSelectedCount(calculateSelectedCount());
    }
  };

  /**
   * 点击选择/取消选择
   */
  const handlePress = async (image) => {
    if (!selectionMode) {
      // 普通模式：跳转到预览页
      // 注意：不需要在这里更新高亮，因为返回时会通过 returnedImageId 自动设置高亮
      const index = images.findIndex(img => img.id === image.id);
      
      // ✅ 使用 FlatList 懒加载，支持任意数量图片
      navigation.navigate('ImagePreview', {
        image: image,
        allImages: images,
        currentIndex: index,
        filterType,
        filterValue,
        fromScreen: pageType,
      });
    } else {
      // 选择模式：切换选中状态
      await toggleImageSelection(image.id);
      
      // 如果没有选中任何图片，退出选择模式
      const newCount = await calculateSelectedCount();
      if (newCount === 0) {
        setSelectionMode(false);
      }
    }
  };

  /**
   * 清除选中状态
   */
  const clearSelections = async () => {
    const selectedIds = await getSelectedImageIds();
    selectedIds.forEach(id => {
      UnifiedDataService.setImageSelection(id, false);
    });
    const newCount = await calculateSelectedCount();
    setSelectedCount(newCount);
  };

  /**
   * 退出选择模式（保持选中状态不变）
   */
  function exitSelectionMode() {
    setSelectionMode(false);
    setShowActionMenu(false);
    // 不改变任何选中状态，保持用户的选中结果
  }

  /**
   * 处理取消按钮点击
   * - 当有选中图片时：清除选中状态
   * - 当没有选中图片时：退出选择模式
   */
  const handleCancelPress = async () => {
    const currentSelectedCount = await calculateSelectedCount();
    if (currentSelectedCount > 0) {
      // 有选中图片时，清除选中状态
      await clearSelections();
    } else {
      // 没有选中图片时，退出选择模式
      exitSelectionMode();
    }
  };

  // ==================== 批量操作 ====================

  /**
   * 获取当前选中的图片ID列表
   */
  const getSelectedImageIds = async () => {
    try {
      if (!filterType) {
        return [];
      }
      
      // 统一使用 UnifiedDataService.getSelectedImagesByFilter
      const selectedImages = await UnifiedDataService.getSelectedImagesByFilter(filterType, filterValue);
      return selectedImages.map(img => img.id);
    } catch (error) {
      logger.error('获取选中图片ID失败:', error);
      return [];
    }
  };

  /**
   * 执行批量操作
   */
  const handleBatchAction = async (actionId) => {
    try {
      // 点击任意底部按钮时，自动收起“照片创玩”面板
      if (showEnhancePresets) {
        setShowEnhancePresets(false);
      }
      const selectedIds = await getSelectedImageIds();
      
      if (selectedIds.length === 0) {
        Alert.alert(t('common.tip'), t('category.pleaseSelectImages'));
        return;
      }

      switch (actionId) {
        case 'staging':
          await batchMoveToStaging(selectedIds);
          break;
        case 'removeFromStaging':
          await batchRemoveFromStagingBox(selectedIds);
          break;
        case 'changeCategory':
          await showCategorySelector(selectedIds);
          break;
        case 'delete':
          await batchDelete(selectedIds);
          break;
        case 'enhance':
          await openEnhancePanel();
          break;
        case 'share':
          await batchShare(selectedIds);
          break;
        default:
          Alert.alert(t('common.tip'), t('category.unknownOperation'));
          break;
      }
      
      // 注意：具体的操作函数内部会处理刷新和退出选择模式

    } catch (error) {
      logger.error('❌ 批量操作失败:', error);
      Alert.alert(t('settings.operationFailed'), error.message);
    }
  };

  // 打开照片创玩面板并加载增强方案
  const openEnhancePanel = async () => {
    try {
      // 切换展开/收起
      if (showEnhancePresets) {
        setShowEnhancePresets(false);
        return;
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
      Alert.alert(t('common.error'), t('category.loadEnhancePresetsFailed'));
    }
  };

  const closeEnhancePanel = () => {
    // 直接关闭面板（任务提交已在结果页处理，这里不需要额外逻辑）
    setShowEnhancePresets(false);
  };

  // 点击增强方案：数量与额度检查
  const handleEnhancePresetPress = async (presetId) => {
    try {
      const selectedIds = await getSelectedImageIds();
      const count = selectedIds.length;
      if (count === 0 || count > 9) {
        Alert.alert(t('common.tip'), t('category.enhanceCountLimitMessage'));
        return;
      }

      // 额度检查
      const credits = await WeChatAuthService.getCredits();
      if (!credits || typeof credits.remaining !== 'number') {
        Alert.alert(t('common.error'), t('category.getCreditsFailed'));
        return;
      }

      // 如果用户未关注公众号，跳过额度检查，直接执行增强
      if (credits.isFollowed === false) {
        try {
          setShowEnhancePresets(false);
          const presetName = (enhancePresets && enhancePresets[presetId] && enhancePresets[presetId].name) ? enhancePresets[presetId].name : presetId;
          await performEnhance(presetId, presetName, selectedIds);
        } catch (e) {
          logger.error('提交增强失败:', e);
          Alert.alert(t('common.error'), e.message || t('category.submitFailed'));
        }
        return;
      }

      // 已关注公众号，进行额度检查
      if (credits.remaining < count) {
        Alert.alert(
          t('common.tip'),
          t('category.insufficientCreditsMessageFollowWeChat', { remaining: credits.remaining, count })
        );
        return;
      }

      // 弹出二次确认：显示剩余额度与本次消耗额度
      Alert.alert(
        t('category.useCreditsConfirmTitle'),
        t('category.useCreditsConfirmMessage', { count, remaining: credits.remaining }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.confirm'),
            style: 'default',
            onPress: async () => {
              try {
                setShowEnhancePresets(false);
                const presetName = (enhancePresets && enhancePresets[presetId] && enhancePresets[presetId].name) ? enhancePresets[presetId].name : presetId;
                await performEnhance(presetId, presetName, selectedIds);
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

  // 执行增强（占位函数：后续可接入真正的提交逻辑）
  const performEnhance = async (presetId, presetDisplayName, imageIds) => {
    try {
      // 读取选中图片的最新URI（使用 getUri 获取正确的 URI）
      const selectedItems = [];
      for (const id of imageIds) {
        const img = await UnifiedDataService.readImageById(id);
        if (img) {
          const uri = getUri(img);
          if (uri) {
            selectedItems.push({ id: img.id, uri: uri });
          } else {
            logger.warn(`⚠️ 无法获取图片 URI: ${id}`);
          }
        }
      }
      const uris = selectedItems.map((img) => img.uri);

      // 直接导航到结果页，任务提交和轮询在结果页中处理
      if (typeof navigation !== 'undefined') {
        navigation.navigate('EnhanceResult', {
          presetName: presetDisplayName,
          presetId: presetId, // 传递预设ID，结果页会自动提交任务
          selected: selectedItems,
          results: {}, // 不传结果，让结果页自动提交
          initialIndex: 0,
        });
      }
    } catch (error) {
      logger.error('导航到结果页失败:', error);
      Alert.alert(t('common.error'), error.message || t('settings.operationFailed'));
    }
  };

  /**
   * 显示分类选择器模态框（批量修改分类）
   */
  const showCategorySelector = async (imageIds) => {
    setPendingImageIds(imageIds);
    setShowCategoryModal(true);
  };

  /**
   * 关闭分类选择器
   */
  const closeCategoryModal = () => {
    setShowCategoryModal(false);
    setPendingImageIds([]);
  };

  /**
   * 选择分类
   */
  const selectCategory = (categoryId) => {
    closeCategoryModal();
    batchChangeCategory(pendingImageIds, categoryId);
  };

  /**
   * 批量修改分类
   *
   * 健壮性：updateImagesCategory 在某些数据规模下偶发不返回（DB SQL 实际已成功落库
   * 但 cache rebuild / updateStats 链路某步未 resolve），导致"正在修改 X 张"弹窗
   * 卡死、用户必须杀 app 才能脱离。
   * 这里加三层保险：
   *   1) try/finally 保证 setShowUpdateProgress(false) 一定执行
   *   2) Promise.race + 30s 超时兜底；超时后日志会告诉用户"DB 已写，UI 缓存可能滞后"
   *   3) 各步加 logger.debug 标记，下次卡时能定位到 step.X 之间的具体行
   */
  const batchChangeCategory = async (imageIds, newCategory) => {
    let stage = 'init';
    // Modal 最小显示时长：实测 DB+cache 全跑完只要 35ms，但 RN iOS Modal 在
    // fade-in 动画中途收到 visible=false 会忽略 hide → 卡死。让 modal 至少显示
    // 500ms 兜底，等 fade-in 完成后再 hide
    const modalShownAt = Date.now();
    const MIN_MODAL_MS = 500;

    try {
      logger.debug(`[batchChangeCategory] start ids=${imageIds.length} -> ${newCategory}`);
      const categoryName = UnifiedDataService.getCategoryDisplayName(newCategory);

      // 1. 先更新UI（立即响应用户操作）
      stage = 'optimistic-ui';
      imageIds.forEach(id => {
        UnifiedDataService.setImageSelection(id, false);
      });
      setImages(prevImages => {
        const newImages = prevImages.filter(img => !imageIds.includes(img.id));
        if (newImages.length > 0) {
          const grouped = groupImagesByDate(newImages);
          setGroupedImages(grouped);
        } else {
          setGroupedImages({});
        }
        return newImages;
      });
      setSelectionMode(false);

      // 2. 显示进度提示
      stage = 'show-modal';
      setShowUpdateProgress(true);
      setUpdateOperationType('changeCategory');
      setUpdateProgress({ filesProcessed: imageIds.length, filesFailed: 0, total: imageIds.length });

      // 3. 执行数据库操作；30s 超时兜底
      stage = 'db-update';
      logger.debug('[batchChangeCategory] step 3: updateImagesCategory…');
      const result = await Promise.race([
        UnifiedDataService.updateImagesCategory(imageIds, newCategory, 'manual'),
        new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT_30S')), 30000)),
      ]);
      logger.debug(`[batchChangeCategory] step 3 done: processed=${result?.processed} errors=${result?.errors?.length || 0}`);

      // 4. 更新失败数量（如果有）
      stage = 'update-progress-final';
      setUpdateProgress({ filesProcessed: result.processed, filesFailed: result.errors?.length || 0, total: imageIds.length });
      if (!result.success) {
        logger.warn('⚠️ 批量更新分类部分失败:', result.errors);
      }
    } catch (error) {
      if (error?.message === 'TIMEOUT_30S') {
        logger.error(`❌ [batchChangeCategory] 超时 30s（stage=${stage}）— DB 通常已落库，UI 缓存可能滞后`);
        Alert.alert(t('settings.operationFailed') || '操作失败', '修改超时；分类大概率已写入，请下拉刷新页面或重启 app 验证');
      } else {
        logger.error(`❌ 批量修改分类失败（stage=${stage}）:`, error);
        Alert.alert(t('settings.operationFailed'), error?.message || String(error));
      }
    } finally {
      // 兜底关 modal —— 等 fade-in 动画走完再 hide，否则 iOS Modal 会忽略 hide
      const elapsed = Date.now() - modalShownAt;
      const wait = elapsed >= MIN_MODAL_MS ? 0 : (MIN_MODAL_MS - elapsed);
      logger.debug(`[batchChangeCategory] finally: scheduling hide in ${wait}ms`);
      setTimeout(() => {
        logger.debug('[batchChangeCategory] CALLING setShowUpdateProgress(false) now');
        setShowUpdateProgress(false);
      }, wait);
    }
  };

  /**
   * 批量分享文件
   */
  const batchShare = async (imageIds) => {
    try {
      if (imageIds.length === 0) {
        Alert.alert(t('common.tip'), t('category.pleaseSelectImages'));
        return;
      }

      if (imageIds.length > 9) {
        Alert.alert(
          t('common.tip'),
          t('category.shareLimitMessage', { count: imageIds.length })
        );
        return;
      }
      
      const selectedImages = images.filter(img => imageIds.includes(img.id));
      if (selectedImages.length === 0) {
        Alert.alert(t('common.error'), t('category.noSelectedImagesFound'));
        return;
      }

      try {
        // 使用 getUri 获取正确的 URI
        const urls = selectedImages.map(img => {
          const uri = getUri(img);
          if (!uri) {
            logger.warn(`⚠️ 无法获取图片 URI: ${img.id}`);
          }
          return uri;
        }).filter(uri => uri != null); // 过滤掉无效的 URI
        
        if (urls.length === 0) {
          Alert.alert(t('common.error'), t('category.cannotGetImageUri'));
          return;
        }
        
        // 优先尝试使用原生模块分享（支持单张和多张）
        const { MultiImageShareModule } = NativeModules;
        if (MultiImageShareModule && MultiImageShareModule.shareMultipleImages) {
          // 使用原生模块分享（支持单张和多张）
          await MultiImageShareModule.shareMultipleImages(urls);
          if (urls.length > 1) {
            Alert.alert(t('category.shareSuccess'), t('category.sharedImagesCount', { count: urls.length }));
          }
        } else {
          // 原生模块不可用，使用React Native Share
          if (urls.length === 1) {
            // 单张图片：只传url，不传message（避免被当作文本分享）
            // 添加 title 参数，让微信等分享目标显示"来自：ImagePilot"
            const result = await Share.share({
              url: urls[0],
              title: t('app.name'),
            });
            
            if (result.action === Share.sharedAction) {
              // 分享成功
            }
          } else {
            // 多张图片：使用urls参数（不传message）
            // 添加 title 参数，让微信等分享目标显示"来自：ImagePilot"
            const result = await Share.share({
              urls: urls,
              title: t('app.name'),
            });
            
            if (result.action === Share.sharedAction) {
              Alert.alert(t('category.shareSuccess'), t('category.sharedImagesCount', { count: urls.length }));
            }
          }
        }
      } catch (error) {
        logger.error('❌ 分享失败:', error);
        Alert.alert(t('category.shareFailed'), t('category.shareFailedMessage'));
      }
    } catch (error) {
      logger.error('❌ 分享操作失败:', error);
      Alert.alert(t('settings.operationFailed'), t('category.shareError'));
    }
  };

  /**
   * 批量放入暂存箱
   */
  const batchMoveToStaging = async (imageIds) => {
    Alert.alert(
      t('category.confirmStagingTitle'),
      t('category.confirmStagingMessage', { count: imageIds.length }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('category.mark'),
          onPress: async () => {
            try {
              // 1. 清除选中状态（图片保留在当前分类中）
              imageIds.forEach(id => {
                UnifiedDataService.setImageSelection(id, false);
              });
              setSelectionMode(false);
              
              // 2. 显示进度提示
              setShowUpdateProgress(true);
              setUpdateOperationType('moveToStaging');
              setUpdateProgress({ filesProcessed: imageIds.length, filesFailed: 0, total: imageIds.length });
              
              // 3. 🆕 使用 UnifiedDataService.addToStagingBox 添加到暂存箱
              // 注意：addToStagingBox 内部已经会刷新缓存，不需要再次刷新
              const result = await UnifiedDataService.addToStagingBox(imageIds);
              
              // 4. 更新失败数量（如果有）
              setUpdateProgress({ 
                filesProcessed: result.added || imageIds.length, 
                filesFailed: result.errors?.length || 0, 
                total: imageIds.length 
              });
              
              // 5. 更新暂存箱图片ID集合（用于显示"已暂存"标签）
              if (screenConfig.trackStagingMembership) {
                setStagingBoxImageIds(prev => {
                  const newSet = new Set(prev);
                  imageIds.forEach(id => newSet.add(id));
                  return newSet;
                });
              }
              
              // 6. 关闭进度提示
              setShowUpdateProgress(false);
              } catch (error) {
                logger.error('❌ 批量暂存失败:', error);
                setShowUpdateProgress(false);
                Alert.alert(t('settings.operationFailed'), t('category.stagingError'));
              }
          },
        },
      ]
    );
  };

  /**
   * 批量从暂存箱移除
   */
  const batchRemoveFromStagingBox = async (imageIds) => {
    Alert.alert(
      t('category.confirmRemoveFromStagingTitle'),
      t('category.confirmRemoveFromStagingMessage', { count: imageIds.length }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('category.removeFromStagingLabel2'),
          onPress: async () => {
            try {
              // 1. 清除选中状态（图片保留在当前分类中）
              imageIds.forEach(id => {
                UnifiedDataService.setImageSelection(id, false);
              });
              setSelectionMode(false);
              
              // 2. 显示进度提示
              setShowUpdateProgress(true);
              setUpdateOperationType('removeFromStaging');
              setUpdateProgress({ filesProcessed: imageIds.length, filesFailed: 0, total: imageIds.length });
              
              // 3. 使用 UnifiedDataService.removeFromStagingBox 从暂存箱移除
              const result = await UnifiedDataService.removeFromStagingBox(imageIds);
              
              // 4. 更新失败数量（如果有）
              setUpdateProgress({ 
                filesProcessed: result.removed || imageIds.length, 
                filesFailed: result.errors?.length || 0, 
                total: imageIds.length 
              });
              
              // 5. 更新暂存箱图片ID集合（用于显示"已暂存"标签）
              if (screenConfig.trackStagingMembership) {
                setStagingBoxImageIds(prev => {
                  const newSet = new Set(prev);
                  imageIds.forEach(id => newSet.delete(id));
                  return newSet;
                });
              }
              
              // 6. 关闭进度提示
              setShowUpdateProgress(false);
              
              // 7. 刷新图片列表（因为图片已从暂存箱移除）
              await loadImages();
            } catch (error) {
              logger.error('❌ 批量从暂存箱移除失败:', error);
              setShowUpdateProgress(false);
              Alert.alert(t('settings.operationFailed'), t('category.removeFromStagingError'));
            }
          },
        },
      ]
    );
  };

  /**
   * 批量删除（所有分类都支持）
   */
  const batchDelete = async (imageIds) => {
    Alert.alert(
      t('category.confirmDeleteTitle'),
      t('category.confirmDeleteMessage', { count: imageIds.length }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('category.deleteLabel'),
          style: 'destructive',
          onPress: async () => {
            try {
              // 1. 显示进度提示
              setShowDeleteProgress(true);
              setDeleteProgress({ filesDeleted: 0, filesFailed: 0, total: imageIds.length });
              
              // 2. 执行删除操作
              const result = await UnifiedDataService.writeDeleteImages(imageIds, (progress) => {
                logger.debug(`删除进度: ${progress.filesDeleted}/${progress.total}`);
                setDeleteProgress(progress);
              });
              
              // 3. 根据删除结果更新UI
              if (result) {
                // 只有真正删除成功的图片才从UI中移除
                const successfulImageIds = result.successfulImageIds || [];
                const failedImageIds = result.failedImageIds || [];
                
                // 清除选中状态
                imageIds.forEach(id => {
                  try {
                    UnifiedDataService.setImageSelection(id, false);
                  } catch (error) {
                    logger.debug(`⚠️ 跳过已删除图片的选择操作: ${id}`);
                  }
                });
                
                // 只从UI中移除成功删除的图片
                if (successfulImageIds.length > 0) {
                  setImages(prevImages => {
                    const newImages = prevImages.filter(img => !successfulImageIds.includes(img.id));
                    
                    // 同时更新分组图片
                    if (newImages.length > 0) {
                      const grouped = groupImagesByDate(newImages);
                      setGroupedImages(grouped);
                    } else {
                      setGroupedImages({});
                    }
                    
                    return newImages;
                  });
                }
                
                setSelectionMode(false);
                
                // 显示删除结果（只有失败时才显示弹窗）
                if (result.filesFailed > 0 || !result.success) {
                  Alert.alert(
                    t('category.deleteComplete'), 
                    t('category.deletePartialSuccessMessage', { deleted: result.filesDeleted || 0, failed: result.filesFailed || imageIds.length }),
                    [
                      { text: t('common.gotIt'), style: 'default' }
                    ]
                  );
                }
                // 全部成功时不显示弹窗，静默完成
              } else {
                // result 为 null，说明删除操作根本没有返回结果
                Alert.alert(
                  t('category.deleteFailedTitle'), 
                  t('category.deleteFailedMessage')
                );
              }
              
              // 4. 关闭进度提示
              setShowDeleteProgress(false);
            } catch (error) {
              // 删除失败通常是权限问题，属于正常情况，使用 debug 级别
              logger.debug('批量删除失败（可能是权限问题）:', error);
              setShowDeleteProgress(false);
              
              // 检查是否是权限相关的错误
              const errorMessage = error?.message || '';
              if (errorMessage.includes('权限') || errorMessage.includes('删除失败')) {
                Alert.alert(
                  t('category.deleteFailedTitle'), 
                  t('category.deleteFailedMessage')
                );
              } else {
                Alert.alert(t('settings.operationFailed'), t('category.deleteError'));
              }
            }
          },
        },
      ]
    );
  };



  // ==================== 渲染函数 ====================

  /**
   * 渲染顶部操作栏
   */
  const renderTopBar = () => {
    if (!selectionMode) return null;

    // 使用状态中的选中数量

    return (
      <View style={styles.selectionBar}>
        <TouchableOpacity onPress={handleCancelPress}>
          <Text style={styles.selectionCancel}>{t('category.cancelSelection')}</Text>
          </TouchableOpacity>
          <Text style={styles.selectionCount}>
          {t('category.selectedCount', { selected: selectedCount, total: images.length })}
          </Text>
        <TouchableOpacity onPress={toggleSelectAll}>
          <Text style={styles.selectionAll}>
            {selectedCount === images.length && images.length > 0 ? t('common.deselectAll') : t('common.selectAll')}
          </Text>
        </TouchableOpacity>
        </View>
    );
  };

  /**
   * 渲染底部操作栏 —— iOS Photos 风格的多选工具栏：
   * 纯 Ionicons 单色 + 文字，不再用彩色 emoji + 彩色边框（之前的 5 个圆角彩色矩形
   * 视觉上与 app 整体风格脱节，用户反馈"不太符合整体设计风格"）。
   * destructive(删除) 用 c.danger 红，其余统一 c.accent 蓝。
   */
  const renderBottomBar = () => {
    if (!selectionMode || selectedCount === 0) return null;

    const actions = screenConfig.actionButtons;

    return (
      <View style={[styles.actionBar, { paddingBottom: 8 + insets.bottom }]}>
        {actions.map(action => {
          const tint = action.danger ? c.danger : c.accent;
          const iconName = ACTION_ICONS[action.iconKey] || null;
          return (
            <TouchableOpacity
              key={action.id}
              style={styles.actionButton}
              onPress={() => handleBatchAction(action.id)}
              activeOpacity={0.6}
            >
              {CatIonicons && iconName
                ? <CatIonicons name={iconName} size={24} color={tint} style={styles.actionIcon} />
                : <Text style={[styles.actionIcon, { color: tint }]}>{action.emoji}</Text>}
              <Text
                style={[styles.actionLabel, { color: tint }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.85}
              >
                {action.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  /**
   * 关闭增强预设模态框
   */
  const closeEnhanceModal = () => {
    setShowEnhancePresets(false);
  };

  /**
   * 渲染增强预设模态框（与Category Modal一致）
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
                {selectedCount > 0 
                  ? t('category.selectEnhancePresetForImages', { count: selectedCount })
                  : t('category.selectEnhancePreset')}
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
   * 渲染空状态（数据来自 screenConfig.emptyState）
   */
  const renderEmpty = () => {
    const { title, actionLabel, onAction } = screenConfig.emptyState;
    return (
      <View style={styles.emptyContainer}>
        {CatIonicons
          ? <CatIonicons name="file-tray-outline" size={64} color={c.tertiaryLabel} style={{ marginBottom: 16 }} />
          : <Text style={styles.emptyIcon}>📭</Text>}
        <Text style={styles.emptyText}>{title}</Text>
        {actionLabel && (
          <TouchableOpacity
            style={[styles.emptyCTAButton, { backgroundColor: c.accent }]}
            onPress={onAction}
            activeOpacity={0.85}
          >
            <Text style={styles.emptyCTAButtonText}>{actionLabel}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  /**
   * 渲染时间轴视图
   */
  const renderTimeline = () => {
    if (Object.keys(groupedImages).length === 0) {
      return renderEmpty();
    }

    return (
      <FlatList
        ref={flatListRef}
        data={Object.keys(groupedImages)}
        keyExtractor={(dateKey) => dateKey}
        windowSize={5}
        initialNumToRender={3}
        maxToRenderPerBatch={3}
        removeClippedSubviews={true}
        onScrollToIndexFailed={(info) => {
          // 智能回退方案
          if (info.index >= 0 && info.index < Object.keys(groupedImages).length) {
            // 如果目标索引有效，尝试滚动到接近的位置
            const safeIndex = Math.min(info.index, Object.keys(groupedImages).length - 1);
            
            setTimeout(() => {
              try {
                flatListRef.current?.scrollToIndex({
                  index: safeIndex,
                  animated: true,
                  viewPosition: 0.5,
                });
              } catch (retryError) {
                flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
              }
            }, 200);
          } else {
            // 如果索引无效，滚动到顶部
            setTimeout(() => {
              flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
            }, 100);
          }
        }}
        renderItem={({ item: dateKey }) => {
          const imagesForDate = groupedImages[dateKey];
          // 使用 UnifiedDataService 直接查询选中状态（与 PC 端一致）
          const selectedCountInGroup = imagesForDate.filter(img => {
            // 🆕 添加空值检查
            if (!img || !img.id) {
              console.warn('⚠️ 时间轴中发现无效的图片对象:', img);
              return false;
            }
            return UnifiedDataService.isImageSelected(img.id);
          }).length;
          const someSelected = selectedCountInGroup > 0;
          
          return (
            <View style={styles.timelineSection}>
              <TouchableOpacity 
                style={styles.timelineHeader}
                onPress={() => handleTimelineHeaderPress(imagesForDate)}
                activeOpacity={0.7}
              >
                <View style={styles.timelineHeaderContent}>
                  <View style={styles.timelineHeaderLeft}>
                    <Text style={styles.timelineDate}>{dateKey}</Text>
                    <TimelineLocationLine imagesForDate={imagesForDate} />
                  </View>
                  <Text style={styles.timelineCount}>
                    ({t('category.photosCount', { count: imagesForDate.length })}{someSelected && ` · ${t('category.selectedCount', { selected: selectedCountInGroup, total: imagesForDate.length })}`})
                  </Text>
                </View>
                {someSelected && selectionMode && (
                  <View style={styles.timelineSelectionIndicator}>
                    <Text style={styles.timelineSelectionIndicatorText}>
                      {selectedCountInGroup === imagesForDate.length ? t('category.allSelected') : t('category.partiallySelected')}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            <View style={styles.timelineGrid}>
              {groupedImages[dateKey].map((image, index) => {
                // 🆕 添加空值检查
                if (!image || !image.id) {
                  console.warn('⚠️ 时间轴渲染中发现无效的图片对象:', image);
                  return null;
                }
                
                // 使用 getUri 获取正确的 URI
                const imageUri = getUri(image);
                if (!imageUri) {
                  console.warn('⚠️ 时间轴渲染中无法获取图片 URI:', image.id);
                  return null;
                }
                
                // 检查是否应该高亮
                const isHighlighted = highlightedImageId === image.id;
                
                // 检查图片是否在暂存箱中（只在非暂存箱页面显示标签）
                const isImageInStagingBox = !isStaging && stagingBoxImageIds.has(image.id);
                
                return (
                  <TouchableOpacity
                    key={image.id}
                    style={[
                      styles.timelineItem,
                      UnifiedDataService.isImageSelected(image.id) && styles.timelineItemSelected,
                      isHighlighted && styles.timelineItemHighlighted
                    ]}
                    onPress={() => {
                      if (selectionMode) {
                        toggleImageSelection(image.id);
                      } else {
                        // 注意：不需要在这里更新高亮，因为返回时会通过 returnedImageId 自动设置高亮
                        const allImages = Object.values(groupedImages).flat();
                        const currentIndex = allImages.findIndex(img => img.id === image.id);
                        navigation.navigate('ImagePreview', {
                          image: image,
                          allImages: allImages,
                          currentIndex: currentIndex,
                          filterType,
                          filterValue,
                          fromScreen: pageType,
                        });
                      }
                    }}
                    onLongPress={() => {
                      if (!selectionMode) {
                        Haptics.impact('light'); // 进入多选 → 轻量触感
                        enterSelectionMode();
                        toggleImageSelection(image.id);
                      }
                    }}
                  >
                    <Image
                      source={{ uri: imageUri }}
                      style={styles.timelineImage}
                      resizeMode="cover"
                    />
                    {selectionMode && (
                      <View style={[
                        styles.timelineSelectionOverlay,
                        UnifiedDataService.isImageSelected(image.id) && styles.timelineSelectionOverlaySelected
                      ]}>
                        <Text style={styles.timelineSelectionText}>
                          {UnifiedDataService.isImageSelected(image.id) ? '✓' : ''}
                        </Text>
                    </View>
                    )}
                    {/* 已暂存标签（只在非暂存箱分类中显示） */}
                    {isImageInStagingBox && (
                      <View style={styles.stagingBoxBadge}>
                        <Text style={styles.stagingBoxBadgeText}>{t('category.staged')}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
              </View>
            </View>
          );
        }}
        contentContainerStyle={styles.timelineContainer}
        refreshing={refreshing}
        onRefresh={onRefresh}
        ListEmptyComponent={renderEmpty}
      />
    );
  };

  /**
   * 渲染分类选择器模态框
   */
  const renderCategoryModal = () => {
    // 🆕 添加空值检查
    if (!configService || !configService.isConfigLoaded()) {
      console.warn('⚠️ configService 未加载，跳过分类模态框渲染');
      return null;
    }
    
    const categories = configService.getAllCategoriesWithUI();
    // 🆕 添加空值检查
    if (!Array.isArray(categories)) {
      console.warn('⚠️ getAllCategoriesWithUI 返回非数组数据:', categories);
      return null;
    }
    
    const availableCategoriesRaw = categories.filter(cat => {
      // 🆕 添加空值检查
      if (!cat || typeof cat !== 'object') {
        console.warn('⚠️ 发现无效的分类对象:', cat);
        return false;
      }
      // 注意：暂存箱不是分类，不会出现在 getAllCategoriesWithUI() 返回的列表中，所以不需要过滤
      return true;
    });
    // 合并自定义分类（chinese/english 都用 name；图标由 getCategoryIconMeta 走 customCategoryList 解析）
    for (const c of customCategoryList) {
      if (availableCategoriesRaw.some((x) => x.id === c.id)) continue;
      availableCategoriesRaw.push({ id: c.id, chinese: c.name, english: c.name });
    }
    // 终态排序：「其他」倒数第二、「待分类」末位
    const availableCategories = sortCategoryList(availableCategoriesRaw);

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
              <Text style={styles.modalTitle}>{t('category.selectCategoryTitle')}</Text>
              <Text style={styles.modalSubtitle}>
                {t('category.moveImagesTo', { count: pendingImageIds.length })}
              </Text>
          </View>

            {/* 分类列表（统一图标主题：MaterialIcons + 圆形彩色背景） */}
            <ScrollView style={styles.categoryList}>
              {availableCategories.map((cat) => {
                // 根据当前语言动态选择分类名称（与 PC 端一致）
                const currentLang = i18n.language || 'zh';
                const categoryName = currentLang === 'en'
                  ? (cat.english || cat.chinese)
                  : (cat.chinese || cat.english);
                const meta = getCategoryIconMeta(cat.id, customCategoryList);

                return (
                  <TouchableOpacity
                    key={cat.id}
                    style={styles.categoryItem}
                    onPress={() => selectCategory(cat.id)}
                  >
                    <View style={[styles.categoryIconWrap, { backgroundColor: meta.color }]}>
                      <Icon name={meta.iconName} size={20} color="#FFFFFF" />
                    </View>
                    <Text style={styles.categoryName}>{categoryName}</Text>
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

  // ==================== 主渲染 ====================

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.groupedBg }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={c.accent} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.groupedBg }]}>
      {/* 顶部导航栏 */}
      <View style={[styles.header, { backgroundColor: c.card, borderBottomColor: c.separator, borderBottomWidth: 0.5 }]}>
        <TouchableOpacity onPress={() => {
          if (navigation.canGoBack()) {
            navigation.goBack();
          } else {
            // 如果没有历史记录，导航到主页面
            navigation.navigate('Home');
          }
        }} style={styles.backButton}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: c.label }]}>{getPageTitle()}</Text>
        {/* 右上角 选择/完成 入口（与长按等价） */}
        <TouchableOpacity
          style={styles.headerRight}
          onPress={() => {
            if (selectionMode) {
              exitSelectionMode();
            } else {
              Haptics.selection();
              enterSelectionMode();
            }
          }}
        >
          <Text style={[styles.headerRightText, { color: c.accent }]} numberOfLines={1}>
            {selectionMode ? t('category.done') : t('category.select')}
          </Text>
        </TouchableOpacity>
          </View>

      {/* 选择模式操作栏 */}
      {renderTopBar()}

      {/* 时间轴视图 */}
      {renderTimeline()}

      {/* 底部操作栏 */}
      {renderBottomBar()}

      {/* 增强预设模态框 */}
      {renderEnhanceModal()}

      {/* 分类选择器模态框 */}
      {renderCategoryModal()}
      
      {/* 删除进度弹窗 */}
      <Modal
        visible={showDeleteProgress}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowDeleteProgress(false)}>
        <View style={styles.progressModalOverlay}>
          <View style={styles.progressModalContent}>
            <Text style={styles.progressModalTitle}>{t('category.deletingImages')}</Text>
            <Text style={styles.progressModalText}>
              {t('category.deletedCount', { deleted: deleteProgress.filesDeleted, total: deleteProgress.total })}
            </Text>
            {deleteProgress.filesFailed > 0 && (
              <Text style={styles.progressModalError}>
                {t('category.failedCount', { failed: deleteProgress.filesFailed })}
              </Text>
            )}
            <View style={styles.progressBar}>
              <View 
                style={[
                  styles.progressBarFill, 
                  { width: `${(deleteProgress.filesDeleted / deleteProgress.total) * 100}%` }
                ]} 
              />
            </View>
          </View>
        </View>
      </Modal>
      
      {/* 更新进度弹窗 */}
      {/* 更新进度浮层：放弃 RN <Modal>，改用 absolute View overlay
          —— RN iOS Modal 在 visible=true → false 切换时偶发卡死（即使 animationType=none
          且 visible 已写 false），native UIView 不响应隐藏请求。inline overlay 完全靠
          React 渲染树，setShowUpdateProgress(false) 一定卸载。 */}
      {showUpdateProgress && (
        <View style={styles.progressModalOverlayInline} pointerEvents="auto">
          <View style={styles.progressModalContent}>
            <Text style={styles.progressModalTitle}>
              {updateOperationType === 'changeCategory'
                ? t('category.changingCategory', { count: updateProgress.total })
                : updateOperationType === 'moveToStaging'
                ? t('category.movingToStaging', { count: updateProgress.total })
                : updateOperationType === 'removeFromStaging'
                ? t('category.removingFromStaging', { count: updateProgress.total })
                : t('category.processingImages')
              }
            </Text>
            {updateProgress.filesFailed > 0 && (
              <Text style={styles.progressModalError}>
                {t('category.failedCount', { failed: updateProgress.filesFailed })}
              </Text>
            )}
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressBarFill,
                  { width: '100%' }
                ]}
              />
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
};

// ==================== 样式 ====================

const createStyles = (c) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.groupedBg,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    height: 56,
    backgroundColor: c.card,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backIcon: {
    fontSize: 32,
    color: c.accent,
    fontWeight: 'bold',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: c.label,
    textAlign: 'center',
  },
  headerRight: {
    minWidth: 56,
    height: 40,
    paddingHorizontal: 8,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  headerRightText: {
    fontSize: 16,
    fontWeight: '500',
  },

  // 选择栏
  selectionBar: {
    height: 44,
    backgroundColor: c.card,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: c.separator,
  },
  selectionCancel: {
    fontSize: 16,
    color: c.accent,
  },
  selectionCount: {
     fontSize: 16,
    color: c.label,
     fontWeight: '600',
  },
  selectionAll: {
     fontSize: 16,
    color: c.accent,
  },

  // 多选工具栏（底部 paddingBottom 由调用处加 safe-area insets）
  // —— 风格对齐 iOS Photos：纯图标+文字，无边框、无背景色块，整体跟 app 其它栏一致。
  actionBar: {
    flexDirection: 'row',
    backgroundColor: c.card,
    paddingTop: 10,
    paddingHorizontal: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.separator,
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  actionIcon: {
    fontSize: 22, // emoji 兜底字号；Ionicons 在 JSX 里固定 size=24
    marginBottom: 3,
  },
  actionLabel: {
    fontSize: 11,
    fontWeight: '500',
  },

  // 空状态
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 16,
    color: c.tertiaryLabel,
  },
  emptyCTAButton: {
    marginTop: 20,
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 22,
  },
  emptyCTAButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },

  // 时间轴样式
   timelineContainer: {
     padding: GRID_PADDING,
   },
  timelineSection: {
    marginBottom: 20,
   },
  timelineHeader: {
     flexDirection: 'row',
     alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  timelineHeaderContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  timelineHeaderLeft: {
    flex: 1,
  },
  timelineDate: {
    fontSize: 15,
     fontWeight: '600',
    color: c.label,
  },
  timelineCount: {
    fontSize: 13,
    color: c.tertiaryLabel,
    marginLeft: 6,
  },
  timelineSelectionIndicator: {
    backgroundColor: c.accent,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  timelineSelectionIndicatorText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  timelineGrid: {
     flexDirection: 'row',
     flexWrap: 'wrap',
     justifyContent: 'flex-start',
     gap: GRID_GAP, // RN 0.71+ 原生支持；同时控制列间距 + 行间距
   },
  timelineItem: {
    width: TIMELINE_ITEM_SIZE,  // 3 列：(SCREEN_WIDTH - padding*2 - gap*(COLS-1)) / COLS
    height: TIMELINE_ITEM_SIZE, // 正方形
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  timelineItemSelected: {
    borderWidth: 3,
    borderColor: c.accent,
  },
  timelineItemHighlighted: {
    borderWidth: 3,
    borderColor: '#FFD700',
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
    elevation: 8,
  },
  timelineImage: {
    width: '100%',
    height: '100%',
  },
  timelineSelectionOverlay: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: c.accent,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  timelineSelectionText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  stagingBoxBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: '#E07B00', // 较 #FF9500 更深，深色背景下对比度更好
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  stagingBoxBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },

  // 分类选择器模态框样式
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: c.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
  },
  modalHeader: {
    padding: 20,
    borderBottomWidth: 1,
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
    maxHeight: 400,
  },
  categoryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: c.separator,
  },
  categoryIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  // 统一图标容器：圆形 + 主题色背景 + 白色字体图标（视觉一致，不再是 emoji）
  categoryIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  categoryName: {
    fontSize: 16,
    color: c.label,
    flex: 1,
  },
  modalCancelButton: {
    padding: 16,
     alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: c.separator,
  },
  modalCancelText: {
    fontSize: 16,
    color: c.accent,
    fontWeight: '500',
  },

  // 删除进度弹窗样式
  progressModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // inline 版本：absolute fill 屏幕，跟 Modal overlay 同样视觉
  progressModalOverlayInline: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
    elevation: 999,
  },
  progressModalContent: {
    backgroundColor: c.card,
    borderRadius: 12,
    padding: 24,
    minWidth: 280,
    alignItems: 'center',
  },
  progressModalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: c.label,
    marginBottom: 12,
  },
  progressModalText: {
    fontSize: 16,
    color: c.label,
    marginBottom: 8,
  },
  progressModalError: {
    fontSize: 14,
    color: c.danger,
    marginBottom: 16,
  },
  progressBar: {
    width: '100%',
    height: 4,
    backgroundColor: c.separator,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: c.accent,
    borderRadius: 2,
  },
});

export default CategoryScreen;

