import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Dimensions,
  Image,
  Animated,
} from 'react-native';
import UnifiedDataService from '../../services/UnifiedDataService';
import GalleryScannerService from '../../services/GalleryScannerService';
import WeChatAuthService from '../../services/WeChatAuthService';
import configService from '../../services/ConfigService';
import cityLocationService from '../../services/CityLocationService';
import RecentImagesGrid from '../../components/shared/RecentImagesGrid';
import { logger, getUri, Alert, SafeAreaView } from '../../adapters/WebAdapters';
import { getColorNameTranslation, getOrientationNameTranslation, getCameraSettingsCategoryTranslation } from '../../i18n';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
// 与后端 model_client.BACKGROUND_COLORS 一致，10 种固定颜色
const BACKGROUND_COLORS = [
  '橙色', '蓝色', '红色', '绿色', '紫色',
  '粉色', '黄色', '灰色', '黑色', '白色'
];
const COLOR_NAME_TO_HEX = {
  '橙色': '#FF9800', '蓝色': '#2196F3', '红色': '#F44336', '绿色': '#4CAF50',
  '紫色': '#9C27B0', '粉色': '#E91E63', '黄色': '#FFEB3B', '灰色': '#9E9E9E',
  '黑色': '#212121', '白色': '#FFFFFF',
  'Orange': '#FF9800', 'Blue': '#2196F3', 'Red': '#F44336', 'Green': '#4CAF50',
  'Purple': '#9C27B0', 'Pink': '#E91E63', 'Yellow': '#FFEB3B', 'Gray': '#9E9E9E',
  'Black': '#212121', 'White': '#FFFFFF',
};

const HomeScreen = () => {
  const { t, i18n } = useTranslation('common');
  
  // 页面状态管理
  const [currentScreen, setCurrentScreen] = useState('Home');
  const [screenProps, setScreenProps] = useState({});
  const [loadedScreens, setLoadedScreens] = useState({});
  
  // 数据状态
  const [recentImages, setRecentImages] = useState([]);
  const [recentImagesTotal, setRecentImagesTotal] = useState(0); // 新发现照片的总数
  const [categoryCounts, setCategoryCounts] = useState({});
  const [timeCounts, setTimeCounts] = useState({});
  const [timeRecentImages, setTimeRecentImages] = useState({});
  const [cityCounts, setCityCounts] = useState({});
  const [colorCounts, setColorCounts] = useState({});
  const [directoryCounts, setDirectoryCounts] = useState({});
  const [formatCounts, setFormatCounts] = useState({});
  const [resolutionCounts, setResolutionCounts] = useState({});
  const [orientationCounts, setOrientationCounts] = useState({});
  const [isoCounts, setISOCounts] = useState({});
  const [apertureCounts, setApertureCounts] = useState({});
  const [shutterCounts, setShutterCounts] = useState({});
  const [focalLengthCounts, setFocalLengthCounts] = useState({});
  const [categoryRecentImages, setCategoryRecentImages] = useState({});
  const [cityRecentImages, setCityRecentImages] = useState({});
  const [similarityGroups, setSimilarityGroups] = useState([]);
  const [showAllSimilarityGroups, setShowAllSimilarityGroups] = useState(false);
  const [stagingBoxCount, setStagingBoxCount] = useState(0);
  // 隐藏空分类设置（默认隐藏空分类）
  const [hideEmptyCategories, setHideEmptyCategories] = useState(true);
  const [globalMessage, setGlobalMessage] = useState(''); // 初始化为空字符串，稍后通过 useEffect 设置
  const [showScanTip, setShowScanTip] = useState(false);
  const [lastScanTime, setLastScanTime] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [categoryDataChanged, setCategoryDataChanged] = useState(true);
  const [totalImagesCount, setTotalImagesCount] = useState(0);
  const [isScanning, setIsScanning] = useState(false);
  const [isSimilarityDetecting, setIsSimilarityDetecting] = useState(false); // 相似度检测状态
  const rotationValue = useRef(new Animated.Value(0)).current;
  
  // 使用 ref 存储设置值，避免异步状态更新问题
  const hideEmptyCategoriesRef = useRef(hideEmptyCategories);
  
  // 数据加载函数（异步读取，但无loading状态）
  const loadData = useCallback(async () => {
    try {
      logger.debug('HomeScreen 开始加载数据...');
      
      // 并行加载所有数据
      const [recentImagesResult, categoryCountsData, timeCountsData, cityCountsData, colorCountsData, directoryCountsData, formatCountsData, resolutionCountsData, orientationCountsData, isoCountsData, apertureCountsData, shutterCountsData, focalLengthCountsData, similarityGroupsData, settings, allImages, stagingBoxCountData] = await Promise.all([
        UnifiedDataService.readNewDiscoveredImages(12),
        UnifiedDataService.readCategoryCounts(),
        UnifiedDataService.readTimeCounts(),
        UnifiedDataService.readCityCounts(),
        UnifiedDataService.readColorCounts(),
        UnifiedDataService.readDirectoryCounts(),
        UnifiedDataService.readFormatCounts(),
        UnifiedDataService.readResolutionCounts(),
        UnifiedDataService.readOrientationCounts(),
        UnifiedDataService.readISOCounts(),
        UnifiedDataService.readApertureCounts(),
        UnifiedDataService.readShutterCounts(),
        UnifiedDataService.readFocalLengthCounts(),
        UnifiedDataService.getSimilarityGroupsStats(),
        UnifiedDataService.readSettings(),
        UnifiedDataService.readAllImages(),
        UnifiedDataService.getStagingBoxCount()
      ]);
      
      // 加载各分类的最近图片（只在有图片时加载）
      const categoryImagesMap = {};
      if (Object.keys(categoryCountsData).length > 0) {
        const categoryIds = UnifiedDataService.getAllCategoryIds();
        const categoryImagesPromises = categoryIds.map(async (categoryId) => {
          try {
            const images = await UnifiedDataService.readRecentImagesByCategory(categoryId, 1);
            return { categoryId, images };
          } catch (error) {
            logger.error(`加载分类 ${categoryId} 最近图片失败:`, error);
            return { categoryId, images: [] };
          }
        });
        
        const categoryImagesResults = await Promise.all(categoryImagesPromises);
        categoryImagesResults.forEach(({ categoryId, images }) => {
          categoryImagesMap[categoryId] = images;
        });
      } else {
        logger.debug('没有分类数据，跳过加载分类最近图片');
      }
      
      // 加载所有城市的最近图片（确保所有城市卡片都能显示缩略图）
      const allCityIds = Object.keys(cityCountsData);
      const cityImagesPromises = allCityIds.map(async (cityName) => {
        try {
          const images = await UnifiedDataService.readRecentImagesByCity(cityName, 1);
          return { cityName, images };
        } catch (error) {
          logger.error(`加载城市 ${cityName} 最近图片失败:`, error);
          return { cityName, images: [] };
        }
      });
      
      const cityImagesResults = await Promise.all(cityImagesPromises);
      const cityImagesMap = {};
      cityImagesResults.forEach(({ cityName, images }) => {
        cityImagesMap[cityName] = images;
      });
      
      // 加载按时间各桶的最近图片（用于时间卡片缩略图）
      const timeKeysWithCount = Object.entries(timeCountsData || {}).filter(([, c]) => c > 0).map(([k]) => k);
      const timeImagesPromises = timeKeysWithCount.map(async (timeKey) => {
        try {
          const images = await UnifiedDataService.readRecentImagesByTimeRange(timeKey, 1);
          return { timeKey, images };
        } catch (error) {
          logger.error(`加载时间桶 ${timeKey} 最近图片失败:`, error);
          return { timeKey, images: [] };
        }
      });
      const timeImagesResults = await Promise.all(timeImagesPromises);
      const timeImagesMap = {};
      timeImagesResults.forEach(({ timeKey, images }) => {
        timeImagesMap[timeKey] = images;
      });
      
      // 处理新发现照片的结果（包含总数和图片列表）
      const recentImagesData = recentImagesResult.images || [];
      const recentImagesTotalCount = recentImagesResult.total || 0;
      
      // 更新状态
      logger.debug('准备更新状态 - 分类统计:', categoryCountsData);
      logger.debug('准备更新状态 - 最近图片数量:', recentImagesData.length);
      logger.debug('准备更新状态 - 相似照片组数量:', similarityGroupsData.length);
      setRecentImages(recentImagesData);
      setRecentImagesTotal(recentImagesTotalCount);
      setCategoryCounts(categoryCountsData);
      setTimeCounts(timeCountsData || {});
      setTimeRecentImages(timeImagesMap);
      setCityCounts(cityCountsData);
      setColorCounts(colorCountsData);
      setDirectoryCounts(directoryCountsData);
      setFormatCounts(formatCountsData);
      setResolutionCounts(resolutionCountsData);
      setOrientationCounts(orientationCountsData);
      setISOCounts(isoCountsData);
      setApertureCounts(apertureCountsData);
      setShutterCounts(shutterCountsData);
      setFocalLengthCounts(focalLengthCountsData);
      setStagingBoxCount(stagingBoxCountData);
      setSimilarityGroups(similarityGroupsData);
      setCategoryRecentImages(categoryImagesMap);
      setCityRecentImages(cityImagesMap);
      // 如果设置未定义，默认为 true（隐藏空分类）
      // 只有当用户明确设置为 false 时才显示空分类
      const shouldHide = settings.hideEmptyCategories !== false;
      setHideEmptyCategories(shouldHide);
      hideEmptyCategoriesRef.current = shouldHide;
      
      const totalCount = Array.isArray(allImages) ? allImages.length : 0;
      setTotalImagesCount(totalCount);
      
      logger.debug('HomeScreen 数据加载完成, 图片总数:', totalCount);
      logger.debug('allImages 类型:', typeof allImages, 'isArray:', Array.isArray(allImages));
      
    } catch (error) {
      logger.error('HomeScreen 数据加载失败:', error);
    }
  }, []);

  // 使用 useMemo 稳定 recentImages 引用，避免不必要的重新渲染
  const stableRecentImages = useMemo(() => recentImages, [recentImages]);
  
  // 监听 hideEmptyCategories 变化，同步更新 ref
  useEffect(() => {
    hideEmptyCategoriesRef.current = hideEmptyCategories;
    logger.debug('更新 hideEmptyCategoriesRef.current:', hideEmptyCategories);
  }, [hideEmptyCategories]);
  
  // 初始化数据加载
  useEffect(() => {
    loadData();
  }, []);
  
  // 页面重新挂载时重新加载数据（通过页面切换实现）
  // 不再监听缓存变化，每次挂载都重新建立快照

  // 动态加载页面组件
  const loadScreenComponent = useCallback(async (screenName) => {
    setLoadedScreens(prev => {
      if (prev[screenName]) {
        return prev;
      }
      return prev;
    });

    try {
      let ScreenComponent;
      switch (screenName) {
        case 'Category':
          ScreenComponent = (await import('./CategoryScreen.desktop')).default;
          break;
        case 'ImagePreview':
          ScreenComponent = (await import('./ImagePreviewScreen.desktop')).default;
          break;
        case 'Settings':
          ScreenComponent = (await import('./SettingsScreen.desktop')).default;
          break;
        case 'AIModelConfig':
          ScreenComponent = (await import('./AIModelConfigScreen.desktop')).default;
          break;
        case 'Search':
          ScreenComponent = (await import('./SearchScreen.desktop')).default;
          break;
        case 'Stats':
          ScreenComponent = (await import('./StatsScreen.desktop')).default;
          break;
        case 'Moments':
          ScreenComponent = (await import('./MomentsScreen.desktop')).default;
          break;
        case 'Duplicates':
          ScreenComponent = (await import('./DuplicatesScreen.desktop')).default;
          break;
        case 'Backup':
          ScreenComponent = (await import('./BackupRestoreScreen.desktop')).default;
          break;
        default:
          return null;
      }

      setLoadedScreens(prev => ({
        ...prev,
        [screenName]: ScreenComponent
      }));

      return ScreenComponent;
    } catch (error) {
      logger.error(`加载页面失败 ${screenName}:`, error);
      return null;
    }
  }, []);

  // 处理扫描进度更新 - 添加防抖
  const handleScanProgress = useCallback((progress) => {
    logger.debug('HomeScreen 收到扫描进度更新:', progress);
    
    // 如果开始扫描，立即切换到扫描模式
    if (progress.stage === 'started' || progress.stage === 'scanning' || progress.stage === 'processing' ||
        progress.stage === 'directory_scanning' || progress.stage === 'file_comparison' ||
        progress.stage === 'screenshot_detection' || progress.stage === 'cache_checking' ||
        progress.stage === 'remote_inference' || progress.stage === 'local_inference' ||
        progress.stage === 'removing_files' ||
        progress.stage === 'similarity_detection' || progress.stage === 'location_enrichment') {
      setIsScanning(true);
    }
    
    // 扫描完成时切换回正常模式
    if (progress.stage === 'completed') {
      setIsScanning(false);
      logger.debug('扫描完成，切换到正常模式');
      // 只有在shouldRefresh为true时才重新加载数据
      if (progress.shouldRefresh) {
        loadData();
      }
      // 显示扫描完成时间
      loadLastScanTime();
    }
    
    // 位置信息补全阶段：如果shouldRefresh为true，刷新数据
    if (progress.stage === 'location_enrichment' && progress.shouldRefresh) {
      setTimeout(() => {
        loadData();
      }, 0);
    }
    
    // 防抖：只在消息真正变化时更新
    setGlobalMessage(prevMessage => {
      const newMessage = progress.message || t('home.processing');
      if (prevMessage !== newMessage) {
        return newMessage;
      }
      return prevMessage;
    });
  }, [loadData]);

  // 监听自定义事件（由 IPCListenerService 发送）
  useEffect(() => {
    const handleNavigateToSettings = (event) => {
      logger.debug('收到导航到设置页面事件:', event.detail);
      setCurrentScreen('Settings');
      setScreenProps({});
    };

    const handleScanProgressEvent = (event) => {
      logger.debug('收到扫描进度事件:', event.detail);
      handleScanProgress(event.detail);
    };

    const handleDataCleared = () => {
      logger.debug('收到数据清空事件，立即刷新数据');
      loadData();
    };

    const handleDataRefreshed = () => {
      logger.debug('收到数据刷新事件，立即刷新数据');
      loadData();
    };

    const handleSettingsUpdated = (event) => {
      logger.debug('收到设置更新事件，重新加载数据');
      // 重新加载数据以应用所有设置
      loadData();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('navigate-to-settings', handleNavigateToSettings);
      window.addEventListener('scanProgress', handleScanProgressEvent);
      window.addEventListener('dataCleared', handleDataCleared);
      window.addEventListener('dataRefreshed', handleDataRefreshed);
      window.addEventListener('settingsUpdated', handleSettingsUpdated);
      
      return () => {
        window.removeEventListener('navigate-to-settings', handleNavigateToSettings);
        window.removeEventListener('scanProgress', handleScanProgressEvent);
        window.removeEventListener('dataCleared', handleDataCleared);
        window.removeEventListener('dataRefreshed', handleDataRefreshed);
        window.removeEventListener('settingsUpdated', handleSettingsUpdated);
      };
    }
  }, [handleScanProgress, loadData]);

  // 页面切换时加载对应组件
  useEffect(() => {
    if (currentScreen !== 'Home') {
      loadScreenComponent(currentScreen);
    }
  }, [currentScreen, loadScreenComponent]);

  // 处理目录点击
  // 🆕 统一的过滤处理函数
  const handleFilterPress = (filterType, filterValue) => {
    logger.debug(`点击${filterType}:`, filterValue);
    setCurrentScreen('Category');
    setScreenProps(prev => ({
      ...prev,
      filterType,
      filterValue,
      currentImageId: null,
      currentPage: null,
      viewMode: null
    }));
  };

  // 执行 AI 分类的实际逻辑
  const executeAIClassify = useCallback(async () => {
    try {
      logger.debug('开始对 NA 分类图片进行 AI 分类');
      
      // 设置扫描状态
      setIsScanning(true);
      // 🔥 设置全局变量，供设置页面检查扫描状态
      if (typeof window !== 'undefined') {
        window.isScanning = true;
      }
      setGlobalMessage(t('home.initScanning'));
      
      // 创建 GalleryScannerService 实例
      const galleryScannerService = new GalleryScannerService();
      
      // 设置进度回调，复用现有的进度更新机制
      galleryScannerService.onProgress = (progress) => {
        logger.debug('AI分类进度:', progress);
        handleScanProgress(progress);
        
        // 检查是否需要刷新页面
        if (progress.shouldRefresh) {
          logger.debug('🔄 收到刷新标记，主动刷新页面数据...');
          setTimeout(async () => {
            try {
              await loadData();
            } catch (error) {
              logger.error('❌ 刷新失败:', error);
            }
          }, 0);
        }
      };
      
      // 记录扫描开始时间
      const scanStartTime = new Date().toISOString();
      
      // 调用 AI 分类方法（不传 imagesToClassify，让它读取所有 NA 图片）
      await galleryScannerService.aiImageClassifyByContent(scanStartTime, null);
      
      logger.debug('AI 分类完成');
      
      // 刷新数据
      await loadData();
      
    } catch (error) {
      logger.error('AI 分类失败:', error);
      setGlobalMessage(t('home.scanFailed', { error: error.message }));
    } finally {
      setIsScanning(false);
      // 🔥 清除全局变量
      if (typeof window !== 'undefined') {
        window.isScanning = false;
      }
    }
  }, [handleScanProgress, loadData, t]);

  // 启动相似度检测
  const handleStartSimilarityDetection = useCallback(async () => {
    // 检查是否正在扫描
    if (isScanning) {
      logger.debug('正在扫描中，跳过相似度检测请求');
      return;
    }

    try {
      logger.debug('开始相似度检测');
      
      // 设置扫描状态
      setIsScanning(true);
      // 🔥 设置全局变量，供设置页面检查扫描状态
      if (typeof window !== 'undefined') {
        window.isScanning = true;
      }
      setIsSimilarityDetecting(true); // 设置相似度检测状态
      setGlobalMessage(t('home.similarityDetectionInProgress'));
      
      // 创建 GalleryScannerService 实例，复用其相似度检测逻辑
      const galleryScannerService = new GalleryScannerService();
      await galleryScannerService.initialize();
      
      // 设置进度回调，复用 handleScanProgress
      galleryScannerService.onProgress = (progress) => {
        logger.debug('相似度检测进度:', progress);
        handleScanProgress(progress);
      };
      
      // 设置扫描开始时间（用于增量检测）
      galleryScannerService.scanStartTimestamp = new Date();
      
      // 直接调用 similarityDetectionPhase，它会使用内部的 sendProgressMessage
      await galleryScannerService.similarityDetectionPhase();
      
      // 获取相似组统计以显示完成消息
      const similarityGroupsStats = await UnifiedDataService.getSimilarityGroupsStats();
      const groupsCount = similarityGroupsStats ? similarityGroupsStats.length : 0;
      
      logger.debug(`相似度检测完成: 发现${groupsCount}个相似组`);
      setGlobalMessage(t('home.similarityDetectionCompleted', { count: groupsCount }));
      
      // 刷新数据以显示新的相似组
      await loadData();
      
    } catch (error) {
      logger.error('相似度检测失败:', error);
      setGlobalMessage(t('home.similarityDetectionFailed', { error: error.message }));
    } finally {
      setIsScanning(false);
      setIsSimilarityDetecting(false); // 清除相似度检测状态
      // 🔥 清除全局变量
      if (typeof window !== 'undefined') {
        window.isScanning = false;
      }
    }
  }, [isScanning, loadData, t, handleScanProgress]);

  // 启动位置信息补全
  const handleStartLocationEnrichment = useCallback(async () => {
    // 检查是否正在扫描
    if (isScanning) {
      logger.debug('正在扫描中，跳过位置信息补全请求');
      return;
    }

    try {
      logger.debug('开始位置信息补全');
      
      // 设置扫描状态
      setIsScanning(true);
      // 🔥 设置全局变量，供设置页面检查扫描状态
      if (typeof window !== 'undefined') {
        window.isScanning = true;
      }
      setGlobalMessage(t('home.locationEnrichmentInProgress'));
      
      // 创建 GalleryScannerService 实例
      const galleryScannerService = new GalleryScannerService();
      await galleryScannerService.initialize();
      
      // 设置进度回调，复用 handleScanProgress
      galleryScannerService.onProgress = (progress) => {
        logger.debug('位置信息补全进度:', progress);
        handleScanProgress(progress);
      };
      
      // 调用位置信息补全方法
      await galleryScannerService.enrichLocationInfo();
      
      // 获取城市统计以显示完成消息
      const cityCountsData = await UnifiedDataService.readCityCounts();
      const citiesCount = Object.keys(cityCountsData).length;
      
      logger.debug(`位置信息补全完成: 发现${citiesCount}个城市`);
      setGlobalMessage(t('home.locationEnrichmentCompleted', { count: citiesCount }));
      
      // 刷新数据以显示新的城市数据
      await loadData();
      
    } catch (error) {
      logger.error('位置信息补全失败:', error);
      setGlobalMessage(t('home.locationEnrichmentFailed', { error: error.message }));
    } finally {
      setIsScanning(false);
      // 🔥 清除全局变量
      if (typeof window !== 'undefined') {
        window.isScanning = false;
      }
    }
  }, [isScanning, loadData, t, handleScanProgress]);

  // 处理 NA 分类的 AI 分类（右键点击触发）
  const handleNACategoryAIClassify = useCallback(() => {
    // 检查是否正在扫描
    if (isScanning) {
      logger.debug('正在扫描中，跳过 AI 分类请求');
      return;
    }

    // 获取待分类照片数量
    const naCount = categoryCounts['NA'] || categoryCounts.NA || 0;

    // 显示确认对话框
    Alert.alert(
      t('home.aiClassifyConfirmTitle'),
      t('home.aiClassifyConfirmMessage', { count: naCount }),
      [
        {
          text: t('common.cancel'),
          style: 'cancel',
          onPress: () => {
            logger.debug('用户取消 AI 分类');
          }
        },
        {
          text: t('common.confirm'),
          style: 'default',
          onPress: () => {
            logger.debug('用户确认开始 AI 分类');
            executeAIClassify();
          }
        }
      ]
    );
  }, [isScanning, executeAIClassify, t, categoryCounts]);

  // 处理图片点击 - 直接通过URL参数传递图片ID和上下文信息
  const handleImagePress = useCallback((image, fromScreen, additionalProps = {}) => {
    logger.debug('点击图片，接收到的参数:', image, '额外属性:', additionalProps);
    
    // 处理不同的参数格式
    let imageId;
    if (typeof image === 'string') {
      imageId = image;
    } else if (image && image.id) {
      imageId = image.id;
    } else {
      logger.error('无效的图片参数:', image);
      return;
    }
    
    logger.debug('提取的图片ID:', imageId);
    // 进入 ImagePreview 时重置强制刷新标志
    setCategoryDataChanged(false);
    
    // 统一使用 filterType 和 filterValue
    const filterType = additionalProps.filterType || null;
    const filterValue = additionalProps.filterValue || null;
    
    // 设置screenProps，包含上下文信息
    setScreenProps(prev => ({
      ...prev,
      filterType,
      filterValue,
      currentImageId: null // 清除之前的currentImageId
    }));
    
    // 直接设置URL参数，不依赖screenProps
    const urlParams = new URLSearchParams();
    urlParams.set('imageId', imageId);
    
    // 🆕 保存 filterType 和 filterValue 到URL参数
    if (filterType) {
      urlParams.set('filterType', filterType);
    }
    if (filterValue) {
      urlParams.set('filterValue', filterValue);
    }
    
    // 向后兼容：保存旧参数（如果存在）
    if (additionalProps.category) {
      urlParams.set('category', additionalProps.category);
    }
    if (additionalProps.city) {
      urlParams.set('city', additionalProps.city);
    }
    if (additionalProps.similarityGroupId) {
      urlParams.set('similarityGroupId', additionalProps.similarityGroupId);
    }
    if (additionalProps.currentPage !== undefined && additionalProps.currentPage !== null) {
      urlParams.set('currentPage', additionalProps.currentPage.toString());
    }
    // 🔥 新增：保存 itemsPerPage 到 URL 参数
    if (additionalProps.itemsPerPage !== undefined && additionalProps.itemsPerPage !== null) {
      urlParams.set('itemsPerPage', additionalProps.itemsPerPage.toString());
    }
    if (additionalProps.viewMode) {
      urlParams.set('viewMode', additionalProps.viewMode);
    }
    
    // 更新浏览器URL
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', `?${urlParams.toString()}`);
    }
    
    setCurrentScreen('ImagePreview');
    logger.debug('设置URL参数，imageId:', imageId, 'filterType:', filterType, 'filterValue:', filterValue);
  }, []);

  // 兼容性包装函数（保持向后兼容）
  const handleDirectoryPress = (directory) => handleFilterPress('directory', directory);
  const handleCategoryPress = (category) => handleFilterPress('category', category);
  const handleColorPress = (color) => handleFilterPress('color', color);
  const handleCityPress = (city) => handleFilterPress('city', city);
  const handleFormatPress = (format) => handleFilterPress('format', format);
  const handleResolutionPress = (resolution) => handleFilterPress('resolution', resolution);
  const handleOrientationPress = (orientation) => handleFilterPress('orientation', orientation);
  const handleISOPress = (isoCategory) => handleFilterPress('iso', isoCategory);
  const handleAperturePress = (apertureCategory) => handleFilterPress('aperture', apertureCategory);
  const handleShutterPress = (shutterCategory) => handleFilterPress('shutter', shutterCategory);
  const handleFocalLengthPress = (focalLengthCategory) => handleFilterPress('focalLength', focalLengthCategory);

  // 处理刷新
  const onRefresh = useCallback(async () => {
    logger.debug('HomeScreen 开始刷新数据');
    
    // 如果正在扫描，不执行刷新
    if (isScanning) {
      logger.debug('正在扫描中，跳过刷新');
      return;
    }
    
    // 移除setRefreshing(true)，避免UI闪烁
    try {
      // 只重新加载数据（从缓存读取），不重建缓存
      // 缓存只在数据真正变化时（扫描、删除）才重建
      await loadData();
    } catch (error) {
      logger.error('刷新数据失败:', error);
    }
    // 移除setRefreshing(false)
  }, [loadData, isScanning]);


  // 更新全局提示信息
  const updateGlobalMessage = useCallback((message) => {
    setGlobalMessage(message);
  }, []);

  // 启动智能扫描
  const startSmartScan = useCallback(async () => {
    try {
      logger.debug('HomeScreen 启动智能扫描');
      
      // 先检查是否正在扫描
      if (isScanning) {
        logger.debug('扫描正在进行中，跳过新的扫描请求');
        return;
      }
      
      // 查询会员状态
      let compareLimitOption = null;
      try {
        const { isMember } = await WeChatAuthService.getMembershipStatus();
        if (!isMember) {
          // 非会员提示与限制：在扫描按钮附近显示浮窗提示
          setShowScanTip(true);
          setTimeout(() => setShowScanTip(false), 4000);
          compareLimitOption = { compareLimit: 100 };
        }
      } catch (e) {
        // 查询失败按非会员策略处理，但不阻断扫描
        logger.debug('会员状态查询失败，按非会员处理:', e?.message || e);
        setShowScanTip(true);
        setTimeout(() => setShowScanTip(false), 4000);
        compareLimitOption = { compareLimit: 100 };
      }

      // 立即设置扫描状态
      setIsScanning(true);
      // 🔥 设置全局变量，供设置页面检查扫描状态
      if (typeof window !== 'undefined') {
        window.isScanning = true;
      }
      setGlobalMessage(t('home.initScanning'));
      
      logger.debug('扫描状态已设置，切换到正常显示模式');
      
      // 调用GalleryScannerService的扫描接口
      const galleryScannerService = new GalleryScannerService();
      await galleryScannerService.scanGalleryWithProgress((progress) => {
        logger.debug('扫描进度:', progress);
        // 更新进度
        handleScanProgress(progress);
        
        // 🆕 检查是否需要刷新页面
        if (progress.shouldRefresh) {
          logger.debug('🔄 收到刷新标记，主动刷新页面数据...');
          // 异步刷新，不阻塞扫描进度
          setTimeout(async () => {
            try {
              await loadData();
            } catch (error) {
              logger.error('❌ 定期刷新失败:', error);
            }
          }, 0);
        }
      }, compareLimitOption);
      
      logger.debug('智能扫描完成');
      setIsScanning(false);
      // 🔥 清除全局变量
      if (typeof window !== 'undefined') {
        window.isScanning = false;
      }
    } catch (error) {
      // 🔥 如果是"扫描已在进行中"的错误，静默处理，不显示错误提示
      if (error.message && error.message.includes(t('home.scanAlreadyInProgress'))) {
        logger.info('ℹ️ 扫描已在进行中，跳过新扫描请求');
        setIsScanning(false); // 重置状态
        // 🔥 清除全局变量
        if (typeof window !== 'undefined') {
          window.isScanning = false;
        }
        return; // 静默返回，不显示错误
      }
      
      logger.error('智能扫描失败:', error);
      setGlobalMessage(t('home.scanFailed', { error: error.message }));
      setIsScanning(false); // 扫描失败时也要重置状态
      // 🔥 清除全局变量
      if (typeof window !== 'undefined') {
        window.isScanning = false;
      }
      throw error;
    }
  }, [handleScanProgress, isScanning, loadData]);

  // 刷新新发现照片
  const refreshNewDiscoveredImages = useCallback(async () => {
    try {
      const result = await UnifiedDataService.readNewDiscoveredImages(12);
      setRecentImages(result.images || []);
      setRecentImagesTotal(result.total || 0);
    } catch (error) {
      logger.error('刷新新发现照片失败:', error);
    }
  }, []);

  // 开始旋转动画
  const startRotation = useCallback(() => {
    rotationValue.setValue(0);
    Animated.loop(
      Animated.timing(rotationValue, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: false, // 在web环境下可能需要设置为false
      })
    ).start();
  }, [rotationValue]);

  // 停止旋转动画
  const stopRotation = useCallback(() => {
    rotationValue.stopAnimation();
    rotationValue.setValue(0);
  }, [rotationValue]);

  // 监听扫描状态变化，控制动画
  useEffect(() => {
    if (isScanning) {
      logger.debug('开始旋转动画');
      startRotation();
    } else {
      logger.debug('停止旋转动画');
      stopRotation();
    }
  }, [isScanning, startRotation, stopRotation]);

  // 加载最近扫描时间
  const loadLastScanTime = async () => {
    try {
      const settings = await UnifiedDataService.readSettings();
      if (settings && settings.lastScanTime) {
        setLastScanTime(settings.lastScanTime);
        // 统一时间格式：月-日 时：分：秒（中文和英文都一样）
        const date = new Date(settings.lastScanTime);
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hour = String(date.getHours()).padStart(2, '0');
        const minute = String(date.getMinutes()).padStart(2, '0');
        const second = String(date.getSeconds()).padStart(2, '0');
        const formattedTime = `${month}-${day} ${hour}:${minute}:${second}`;
        
        // 从缓存获取统计信息，避免触发缓存更新
        const cache = UnifiedDataService.imageCache.getCache();
        const images = cache.allImages || [];
        const totalImages = images.length;
        let totalSize = 0;
        for (const image of images) {
          if (image.size && typeof image.size === 'number') {
            totalSize += image.size;
          }
        }
        
        const formattedSize = formatFileSize(totalSize);
        
        // 添加耗时信息显示
        let durationText = '';
        if (settings.lastScanDurationSeconds) {
          if (settings.lastScanDurationMinutes >= 1) {
            durationText = ` | ${t('home.duration')}: ${settings.lastScanDurationMinutes}${t('home.minutes')}`;
          } else {
            durationText = ` | ${t('home.duration')}: ${settings.lastScanDurationSeconds}${t('home.seconds')}`;
          }
        }
        
        setGlobalMessage(t('home.lastScanInfo', { time: formattedTime, count: totalImages, size: formattedSize, duration: durationText }));
      } else {
        setGlobalMessage(t('home.ready'));
      }
    } catch (error) {
      logger.error('加载最近扫描时间失败:', error);
      setGlobalMessage(t('home.ready'));
    }
  };


  // 格式化文件大小（使用 i18n）
  const formatFileSize = (bytes) => {
    if (bytes === 0) return `0 ${t('home.fileSizeUnits.B')}`;
    const k = 1024;
    const sizeUnits = [
      t('home.fileSizeUnits.B'),
      t('home.fileSizeUnits.KB'),
      t('home.fileSizeUnits.MB'),
      t('home.fileSizeUnits.GB'),
      t('home.fileSizeUnits.TB')
    ];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizeUnits[i];
  };

  // 组件挂载时加载最近扫描时间和统计信息，并初始化 globalMessage
  useEffect(() => {
    setGlobalMessage(t('home.ready'));
    loadLastScanTime();
  }, [t]);

  // 渲染首页内容的函数
  const renderHomeContent = () => {
    logger.debug('hideEmptyCategoriesRef.current:', hideEmptyCategoriesRef.current);
    logger.debug('当前分类统计状态:', categoryCounts);
    logger.debug('当前最近图片数量:', recentImages.length);
    
    return (
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{ paddingTop: 40 }} // 为固定的消息提示区域留出空间
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* 搜索入口 */}
        <View style={styles.statsEntrySection}>
          <TouchableOpacity
            style={styles.statsEntryButton}
            onPress={() => {
              setCurrentScreen('Search');
              setScreenProps({});
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.statsEntryIcon}>🔍</Text>
            <Text style={styles.statsEntryText}>{t('search.title', { defaultValue: '搜索' })}</Text>
            <Text style={styles.statsEntryArrow}>›</Text>
          </TouchableOpacity>
          {/* 相册报告入口 */}
          <TouchableOpacity
            style={[styles.statsEntryButton, { marginTop: 10 }]}
            onPress={() => {
              setCurrentScreen('Stats');
              setScreenProps({});
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.statsEntryIcon}>📊</Text>
            <Text style={styles.statsEntryText}>{t('stats.title')}</Text>
            <Text style={styles.statsEntryArrow}>›</Text>
          </TouchableOpacity>
          {/* 回忆入口 */}
          <TouchableOpacity
            style={[styles.statsEntryButton, { marginTop: 10 }]}
            onPress={() => {
              setCurrentScreen('Moments');
              setScreenProps({});
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.statsEntryIcon}>🕰️</Text>
            <Text style={styles.statsEntryText}>{t('moments.title', { defaultValue: '回忆' })}</Text>
            <Text style={styles.statsEntryArrow}>›</Text>
          </TouchableOpacity>
          {/* 重复清理入口 */}
          <TouchableOpacity
            style={[styles.statsEntryButton, { marginTop: 10 }]}
            onPress={() => {
              setCurrentScreen('Duplicates');
              setScreenProps({});
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.statsEntryIcon}>🧹</Text>
            <Text style={styles.statsEntryText}>{t('duplicates.title', { defaultValue: '重复清理' })}</Text>
            <Text style={styles.statsEntryArrow}>›</Text>
          </TouchableOpacity>
          {/* 备份还原入口 */}
          <TouchableOpacity
            style={[styles.statsEntryButton, { marginTop: 10 }]}
            onPress={() => {
              setCurrentScreen('Backup');
              setScreenProps({});
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.statsEntryIcon}>📦</Text>
            <Text style={styles.statsEntryText}>{t('backupRestore.title', { defaultValue: '备份与还原' })}</Text>
            <Text style={styles.statsEntryArrow}>›</Text>
          </TouchableOpacity>
        </View>

        {/* 按时间（图片卡片，在按内容之前） */}
        {(() => {
          const nowYear = new Date().getFullYear();
          const timeOrder = ['thisWeek', 'thisMonth', 'thisYear', 'lastYear', 'yearBeforeLast', String(nowYear - 3), String(nowYear - 4), 'past'];
          const timeKeysToShow = timeOrder.filter((k) => (timeCounts || {})[k] > 0);
          if (timeKeysToShow.length === 0) return null;
          const getTimeLabel = (key) => {
            if (/^\d{4}$/.test(key)) return t('home.yearLabel', { year: key });
            return t(`home.${key}`);
          };
          return (
            <View style={styles.categoriesSection}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>📅 {t('home.byTime')}</Text>
              </View>
              <View style={styles.categoriesContainer}>
                {timeKeysToShow.map((timeKey) => (
                  <TimeCard
                    key={timeKey}
                    timeKey={timeKey}
                    label={getTimeLabel(timeKey)}
                    count={timeCounts[timeKey] || 0}
                    recentImages={timeRecentImages[timeKey] || []}
                    onPress={(key) => handleFilterPress('time', key)}
                  />
                ))}
              </View>
            </View>
          );
        })()}
        {/* 分类卡片 */}
        <View style={styles.categoriesSection}>
          <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>🏷️ {t('home.byContent')}</Text>
            <TouchableOpacity
              style={styles.toggleButton}
              onPress={async () => {
                try {
                  logger.debug('切换隐藏空分类设置');
                  // 读取当前设置
                  const settings = await UnifiedDataService.readSettings();
                  // 切换设置
                  settings.hideEmptyCategories = !settings.hideEmptyCategories;
                  // 保存设置
                  await UnifiedDataService.writeSettings(settings);
                  // 重新加载数据以应用新设置
                  await loadData();
                  logger.debug('隐藏空分类设置已更新:', settings.hideEmptyCategories);
                } catch (error) {
                  logger.error('切换隐藏空分类设置失败:', error);
                }
              }}
            >
              <Text style={styles.toggleButtonText}>
                {hideEmptyCategories ? t('home.showEmptyCategories') : t('home.hideEmptyCategories')}
              </Text>
            </TouchableOpacity>
          </View>
          <View style={styles.categoriesContainer}>
            {(() => {
              if (!configService || !configService.isConfigLoaded()) {
                return <Text>{t('home.configServiceNotInitialized')}</Text>;
              }
              const categories = configService.getAllCategoriesWithUI().map(category => {
                // 根据当前语言动态选择分类名称
                const currentLang = i18n.language || 'zh';
                const categoryName = currentLang === 'en' 
                  ? (category.english || category.chinese) 
                  : (category.chinese || category.english);
                
                return {
                  id: category.id,
                  name: categoryName,
                  icon: '📷', // 默认图标
                  color: '#607D8B' // 默认颜色
                };
              });
              
              const visibleCategories = categories.filter(category => {
                const count = categoryCounts[category.id] || 0;
                // PC端显示暂存箱，移动端不显示（移动端有专门的底部导航入口）
                // 这里PC端需要显示暂存箱，所以不过滤
                
                // 如果开启了隐藏空分类且该分类数量为0，则不显示
                if (hideEmptyCategoriesRef.current && count === 0) {
                  return false;
                }
                return true;
              });
              
              // 如果没有可见的分类，显示空数据提示
              if (visibleCategories.length === 0) {
                return (
                  <View style={styles.emptyState}>
                    <Text style={styles.emptyStateIcon}>📷</Text>
                    <Text style={styles.emptyStateText}>{t('category.noImages')}</Text>
                    <Text style={styles.emptyStateSubtext}>{t('home.scanOrAdjustSettings')}</Text>
                  </View>
                );
              }
              
              // 渲染可见的分类 + 颜色芯片（颜色在内容卡片下方）
              const filteredColors = BACKGROUND_COLORS.filter((color) => (colorCounts[color] || 0) > 0)
                .sort((a, b) => (colorCounts[b] || 0) - (colorCounts[a] || 0));
              
              return (
                <View style={{ flexDirection: 'column', width: '100%' }}>
                  <View style={styles.categoriesContainer}>
                    {visibleCategories.map(category => {
                      const count = categoryCounts[category.id] || 0;
                      const recentImages = categoryRecentImages[category.id] || [];
                      return (
                        <CategoryCard
                          key={category.id}
                          category={category}
                          count={count}
                          recentImages={recentImages}
                          onPress={handleCategoryPress}
                          onRightClick={category.id === 'NA' ? handleNACategoryAIClassify : undefined}
                        />
                      );
                    })}
                  </View>
                  {filteredColors.length > 0 && (
                    <View style={[styles.colorChipsContainer, { marginTop: visibleCategories.length > 0 ? 12 : 0 }]}>
                      {filteredColors.map((color) => {
                        const count = colorCounts[color] || 0;
                        const hex = COLOR_NAME_TO_HEX[color] || '#9E9E9E';
                        return (
                          <TouchableOpacity
                            key={color}
                            style={styles.colorChip}
                            onPress={() => handleColorPress(color)}
                          >
                            <View style={[styles.colorChipSwatch, { backgroundColor: hex }]} />
                            <Text style={styles.colorChipName} numberOfLines={1}>{getColorNameTranslation(color, i18n.language)}</Text>
                            <Text style={styles.colorChipCount}>{count}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })()}
          </View>
        </View>

        {/* 城市分类卡片 */}
        {(
          <View style={styles.categoriesSection}>
            <View style={styles.recentSectionHeader}>
              <View style={styles.sectionTitleContainer}>
                <Text style={styles.sectionTitle}>🏙️ {t('home.byCity')}</Text>
              </View>
              {cityCounts && Object.keys(cityCounts).length > 0 && (
                <TouchableOpacity
                  style={[
                    styles.toggleButton,
                    isScanning && styles.refreshButtonDisabled
                  ]}
                  onPress={handleStartLocationEnrichment}
                  disabled={isScanning}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.toggleButtonText,
                    isScanning && styles.refreshButtonTextDisabled
                  ]}>{t('home.recheck')}</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.categoriesContainer}>
              {cityCounts && Object.keys(cityCounts).length > 0 ? (
                Object.entries(cityCounts)
                  .sort(([,a], [,b]) => b - a)
                  .map(([city, count]) => {
                    const recentImages = cityRecentImages[city] || [];
                    return (
                      <CityCard
                        key={city}
                        city={city}
                        count={count}
                        recentImages={recentImages}
                        onPress={handleCityPress}
                      />
                    );
                  })
              ) : (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyStateIcon}>🏙️</Text>
                  <Text style={styles.emptyStateText}>{t('home.noCityData')}</Text>
                  <Text style={styles.emptyStateSubtext}>{t('home.startLocationEnrichmentHint')}</Text>
                  <TouchableOpacity
                    style={[
                      styles.startSimilarityButton,
                      isScanning && styles.startSimilarityButtonDisabled
                    ]}
                    onPress={handleStartLocationEnrichment}
                    disabled={isScanning}
                  >
                    <Text style={[
                      styles.startSimilarityButtonText,
                      isScanning && styles.startSimilarityButtonTextDisabled
                    ]}>
                      {t('home.startLocationEnrichment')}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        )}

        {/* 相似照片板块 - 位于城市下方 */}
        {(
          <View style={styles.categoriesSection}>
            <View style={styles.recentSectionHeader}>
              <View style={styles.sectionTitleContainer}>
                <Text style={styles.sectionTitle}>🔗 {t('home.similarPhotos')}</Text>
              </View>
              {similarityGroups && similarityGroups.length > 0 && (
                <View style={styles.headerButtonsContainer}>
                  <TouchableOpacity
                    style={[styles.toggleButton, isScanning && styles.refreshButtonDisabled]}
                    onPress={handleStartSimilarityDetection}
                    disabled={isScanning}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.toggleButtonText, isScanning && styles.refreshButtonTextDisabled]}>{t('home.recheck')}</Text>
                  </TouchableOpacity>
                  {similarityGroups.length > 8 && !showAllSimilarityGroups && (
                    <TouchableOpacity style={styles.toggleButton} onPress={() => setShowAllSimilarityGroups(true)} activeOpacity={0.7}>
                      <Text style={styles.toggleButtonText}>{t('home.showMore')}</Text>
                    </TouchableOpacity>
                  )}
                  {showAllSimilarityGroups && similarityGroups.length > 8 && (
                    <TouchableOpacity style={styles.toggleButton} onPress={() => setShowAllSimilarityGroups(false)} activeOpacity={0.7}>
                      <Text style={styles.toggleButtonText}>{t('home.showLess')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
            <View style={styles.categoriesContainer}>
              {similarityGroups && similarityGroups.length > 0 ? (
                showAllSimilarityGroups ? (
                  <View style={styles.attributesContainer}>
                    <View style={styles.attributeRow}>
                      {similarityGroups.map((group) => (
                        <TouchableOpacity
                          key={group.groupId}
                          style={styles.attributeChip}
                          onPress={() => handleFilterPress('similarityGroup', group.groupId)}
                        >
                          <Text style={styles.attributeChipName} numberOfLines={1}>
                            {t('home.similarityGroupChip', { count: group.imageCount || 0 })}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                ) : (
                  similarityGroups.slice(0, 8).map((group) => (
                    <SimilarityCard
                      key={group.groupId}
                      group={group}
                      onPress={() => handleFilterPress('similarityGroup', group.groupId)}
                    />
                  ))
                )
              ) : (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyStateIcon}>🔗</Text>
                  <Text style={styles.emptyStateText}>
                    {isSimilarityDetecting ? t('home.similarityDetectionInProgress') : t('home.noSimilarityGroups')}
                  </Text>
                  {!isSimilarityDetecting && (
                    <Text style={styles.emptyStateSubtext}>{t('home.startSimilarityDetectionHint')}</Text>
                  )}
                  <TouchableOpacity
                    style={[styles.startSimilarityButton, (isScanning || isSimilarityDetecting) && styles.startSimilarityButtonDisabled]}
                    onPress={handleStartSimilarityDetection}
                    disabled={isScanning || isSimilarityDetecting}
                  >
                    <Text style={[styles.startSimilarityButtonText, (isScanning || isSimilarityDetecting) && styles.startSimilarityButtonTextDisabled]}>
                      {isSimilarityDetecting ? t('home.similarityDetectionInProgress') : t('home.startSimilarityDetection')}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        )}

        {/* 按属性（合并存储/格式/分辨率/方向，芯片样式无缩略图） */}
        {(() => {
          const dirItems = Object.entries(directoryCounts || {}).filter(([d]) => d && typeof d === 'string' && d.trim() && d !== 'null' && d !== 'undefined').sort(([,a], [,b]) => b - a);
          const formatItems = Object.entries(formatCounts || {}).filter(([f]) => f && typeof f === 'string' && f.trim() && f !== 'null' && f !== 'UNKNOWN').sort(([,a], [,b]) => b - a);
          const resolutionItems = Object.entries(resolutionCounts || {}).filter(([r]) => r && typeof r === 'string' && r.trim() && r !== 'null' && r !== 'UNKNOWN').sort(([,a], [,b]) => b - a);
          const orientationItems = Object.entries(orientationCounts || {}).filter(([o]) => o && typeof o === 'string' && o.trim() && o !== 'null' && o !== 'UNKNOWN').sort(([,a], [,b]) => b - a);
          const hasDir = dirItems.length > 0;
          const hasFormat = formatItems.length > 0;
          const hasResolution = resolutionItems.length > 0;
          const hasOrientation = orientationItems.length > 0;
          if (!hasDir && !hasFormat && !hasResolution && !hasOrientation) return null;
          const renderAttributeChip = (filterType, filterValue, displayName, count) => (
            <TouchableOpacity key={`${filterType}-${filterValue}`} style={styles.attributeChip} onPress={() => handleFilterPress(filterType, filterValue)}>
              <Text style={styles.attributeChipName} numberOfLines={1}>{displayName}</Text>
              <Text style={styles.attributeChipCount}>{count}</Text>
            </TouchableOpacity>
          );
          return (
            <View style={styles.categoriesSection}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>📋 {t('home.byAttributes')}</Text>
              </View>
              <View style={styles.attributesContainer}>
                {hasDir && (
                  <View style={styles.attributeSubBlock}>
                    <Text style={styles.attributeSubLabel}>{t('home.byStorage')}</Text>
                    <View style={styles.attributeRow}>
                      {dirItems.map(([directory]) => {
                        const count = directoryCounts[directory] || 0;
                        const displayName = directory.split('/').pop() || directory;
                        return renderAttributeChip('directory', directory, displayName, count);
                      })}
                    </View>
                  </View>
                )}
                {hasFormat && (
                  <View style={styles.attributeSubBlock}>
                    <Text style={styles.attributeSubLabel}>{t('home.byFormat')}</Text>
                    <View style={styles.attributeRow}>
                      {formatItems.map(([format]) => renderAttributeChip('format', format, format, (formatCounts || {})[format] || 0))}
                    </View>
                  </View>
                )}
                {hasResolution && (
                  <View style={styles.attributeSubBlock}>
                    <Text style={styles.attributeSubLabel}>{t('home.byResolution')}</Text>
                    <View style={styles.attributeRow}>
                      {resolutionItems.map(([resolution]) => renderAttributeChip('resolution', resolution, resolution, (resolutionCounts || {})[resolution] || 0))}
                    </View>
                  </View>
                )}
                {hasOrientation && (
                  <View style={styles.attributeSubBlock}>
                    <Text style={styles.attributeSubLabel}>{t('home.byOrientation')}</Text>
                    <View style={styles.attributeRow}>
                      {orientationItems.map(([orientation]) => renderAttributeChip('orientation', orientation, getOrientationNameTranslation(orientation, i18n.language || 'zh'), (orientationCounts || {})[orientation] || 0))}
                    </View>
                  </View>
                )}
              </View>
            </View>
          );
        })()}

        {/* 按拍摄参数（合并 ISO/光圈/快门/焦距，芯片样式无缩略图） */}
        {(() => {
          const currentLang = i18n.language || 'zh';
          const isoItems = Object.entries(isoCounts || {}).filter(([i]) => i && typeof i === 'string' && i.trim() && i !== 'null' && i !== 'UNKNOWN').sort(([,a], [,b]) => b - a);
          const apertureItems = Object.entries(apertureCounts || {}).filter(([k]) => k && typeof k === 'string' && k.trim() && k !== 'null' && k !== 'UNKNOWN').sort(([,a], [,b]) => b - a);
          const shutterItems = Object.entries(shutterCounts || {}).filter(([k]) => k && typeof k === 'string' && k.trim() && k !== 'null' && k !== 'UNKNOWN').sort(([,a], [,b]) => b - a);
          const focalLengthItems = Object.entries(focalLengthCounts || {}).filter(([f]) => f && typeof f === 'string' && f.trim() && f !== 'null' && f !== 'UNKNOWN').sort(([,a], [,b]) => b - a);
          const hasISO = isoItems.length > 0;
          const hasAperture = apertureItems.length > 0;
          const hasShutter = shutterItems.length > 0;
          const hasFocalLength = focalLengthItems.length > 0;
          if (!hasISO && !hasAperture && !hasShutter && !hasFocalLength) return null;
          const renderAttrChip = (filterType, filterValue, displayName, count) => (
            <TouchableOpacity key={`${filterType}-${filterValue}`} style={styles.attributeChip} onPress={() => handleFilterPress(filterType, filterValue)}>
              <Text style={styles.attributeChipName} numberOfLines={1}>{displayName}</Text>
              <Text style={styles.attributeChipCount}>{count}</Text>
            </TouchableOpacity>
          );
          return (
            <View style={styles.categoriesSection}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>📸 {t('home.byShootingParams')}</Text>
              </View>
              <View style={styles.attributesContainer}>
                {hasISO && (
                  <View style={styles.attributeSubBlock}>
                    <Text style={styles.attributeSubLabel}>{t('home.byISO')}</Text>
                    <View style={styles.attributeRow}>{isoItems.map(([iso]) => renderAttrChip('iso', iso, getCameraSettingsCategoryTranslation('iso', iso, currentLang) || iso, (isoCounts || {})[iso] || 0))}</View>
                  </View>
                )}
                {hasAperture && (
                  <View style={styles.attributeSubBlock}>
                    <Text style={styles.attributeSubLabel}>{t('home.byAperture')}</Text>
                    <View style={styles.attributeRow}>{apertureItems.map(([aperture]) => renderAttrChip('aperture', aperture, getCameraSettingsCategoryTranslation('aperture', aperture, currentLang) || aperture, (apertureCounts || {})[aperture] || 0))}</View>
                  </View>
                )}
                {hasShutter && (
                  <View style={styles.attributeSubBlock}>
                    <Text style={styles.attributeSubLabel}>{t('home.byShutter')}</Text>
                    <View style={styles.attributeRow}>{shutterItems.map(([shutter]) => renderAttrChip('shutter', shutter, getCameraSettingsCategoryTranslation('shutter', shutter, currentLang) || shutter, (shutterCounts || {})[shutter] || 0))}</View>
                  </View>
                )}
                {hasFocalLength && (
                  <View style={styles.attributeSubBlock}>
                    <Text style={styles.attributeSubLabel}>{t('home.byFocalLength')}</Text>
                    <View style={styles.attributeRow}>{focalLengthItems.map(([focalLength]) => renderAttrChip('focalLength', focalLength, getCameraSettingsCategoryTranslation('focalLength', focalLength, currentLang) || focalLength, (focalLengthCounts || {})[focalLength] || 0))}</View>
                  </View>
                )}
              </View>
            </View>
          );
        })()}

        {/* 最新发现照片 */}
        {(
          <View style={styles.recentSection}>
            <View style={styles.recentSectionHeader}>
              <View style={styles.sectionTitleContainer}>
                <Text style={styles.sectionTitle}>📸 {t('home.recentDiscoveredPhotos')}</Text>
                {recentImagesTotal > 0 && (
                  <View style={styles.countBadge}>
                    <Text style={styles.countBadgeText}>{recentImagesTotal}</Text>
                  </View>
                )}
              </View>
              <TouchableOpacity
                style={styles.refreshButton}
                onPress={refreshNewDiscoveredImages}
                activeOpacity={0.7}
              >
                <Text style={styles.refreshButtonText}>🔄</Text>
              </TouchableOpacity>
            </View>
            <RecentImagesGrid 
              images={stableRecentImages} 
              onImagePress={null}
            />
          </View>
        )}
      </ScrollView>
    );
  };

  // 渲染所有页面的函数
  const renderAllScreens = useMemo(() => {
    
    const CategoryScreen = loadedScreens.Category;
    const ImagePreviewScreen = loadedScreens.ImagePreview;
    const SettingsScreen = loadedScreens.Settings;
    const AIModelConfigScreen = loadedScreens.AIModelConfig;
    const SearchScreen = loadedScreens.Search;
    const StatsScreen = loadedScreens.Stats;
    const MomentsScreen = loadedScreens.Moments;
    const DuplicatesScreen = loadedScreens.Duplicates;
    const BackupScreen = loadedScreens.Backup;

    return (
      <SafeAreaView style={styles.container}>
        {/* 自定义标题栏；macOS 上不显示左侧图标和标题，只留设置与暂存箱 */}
        <View style={styles.customTitleBar}>
          <View style={styles.titleBarLeft}>
            {typeof process !== 'undefined' && process.platform !== 'darwin' && (
              <>
                <Image 
                  source={{ uri: './icon.png' }}
                  style={styles.titleBarIcon}
                  resizeMode="contain"
                />
                <Text style={styles.titleBarTitle}>{t('app.name')}</Text>
              </>
            )}
          </View>
          <View style={styles.titleBarRight}>
            {/* 相册报告按钮 */}
            <TouchableOpacity
              style={styles.titleBarStagingButton}
              onPress={() => {
                setCurrentScreen('Stats');
                setScreenProps({});
              }}
            >
              <Text style={styles.titleBarStagingIcon}>📊</Text>
            </TouchableOpacity>

            {/* 暂存箱按钮 */}
            <TouchableOpacity
              style={styles.titleBarStagingButton}
              onPress={() => {
                handleFilterPress('stagingBox', null);
              }}
            >
              <Text style={styles.titleBarStagingIcon}>📦</Text>
              {stagingBoxCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{stagingBoxCount > 99 ? '99+' : stagingBoxCount}</Text>
                </View>
              )}
            </TouchableOpacity>
            
            {/* 设置按钮 */}
            <TouchableOpacity 
              style={styles.titleBarSettingsButton}
              onPress={() => {
                logger.debug('标题栏设置按钮被点击');
                setCurrentScreen('Settings');
                setScreenProps({});
              }}
            >
              <Text style={styles.titleBarSettingsIcon}>⚙️</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 根据当前屏幕渲染对应页面 */}
        {currentScreen === 'Home' && (
          <View style={styles.screenContainer}>
            {/* 消息提示区 */}
            <View style={styles.scanProgressBanner}>
              <Text style={styles.scanProgressMessage}>
                {globalMessage}
              </Text>
            </View>
            {/* 主内容区域 */}
            {renderHomeContent()}
            
            {/* FAB扫描按钮 - 只在Home页面显示 */}
            <TouchableOpacity 
              style={styles.fabButton}
              onPress={startSmartScan}
              disabled={isScanning}
            >
              <Animated.View
                style={{
                  transform: [{
                    rotate: rotationValue.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0deg', '360deg'],
                    })
                  }]
                }}
              >
                <Text style={styles.fabButtonText}>⟳</Text>
              </Animated.View>
            </TouchableOpacity>
            {showScanTip && (
              <View style={styles.scanTipContainer}>
                <Text style={styles.scanTipText}>{t('home.scanTip')}</Text>
              </View>
            )}
          </View>
        )}
        
        {currentScreen === 'Category' && (
          <View style={styles.screenContainer}>
            {CategoryScreen ? (
                <CategoryScreen 
                  {...screenProps} 
                  forceRefresh={categoryDataChanged}
                  onDataChange={() => setCategoryDataChanged(true)}
                  onBack={async () => {
                    setCurrentScreen('Home');
                    logger.debug('从分类页面返回，重新加载数据');
                    await loadData();
                  }}
                  navigation={{
                    onImagePress: (image, fromScreen, contextProps) => {
                      // 直接使用CategoryScreen传递的参数，不要使用screenProps
                      handleImagePress(image, fromScreen, contextProps);
                    }
                  }}
                />
            ) : (
              <View style={styles.loadingContainer}>
                <Text style={styles.loadingText}>正在加载分类页面...</Text>
              </View>
            )}
          </View>
        )}
        
        {currentScreen === 'ImagePreview' && (
          <View style={styles.screenContainer}>
            {ImagePreviewScreen ? (
              <ImagePreviewScreen 
                onDataChange={() => setCategoryDataChanged(true)}
                onBack={async (returnedImageId) => {
                  logger.debug('ImagePreview 返回按钮被点击，返回的图片ID:', returnedImageId);
                  
                  // 从URL参数获取图片ID
                  const urlParams = new URLSearchParams(window.location.search);
                  const imageId = returnedImageId || urlParams.get('imageId');
                  const filterType = urlParams.get('filterType');
                  const filterValue = urlParams.get('filterValue');
                  const savedCurrentPage = urlParams.get('currentPage');
                  const savedItemsPerPage = urlParams.get('itemsPerPage'); // 🔥 新增：读取 itemsPerPage
                  const savedViewMode = urlParams.get('viewMode');
                  
                  // 🆕 根据 filterType 判断是否从 CategoryScreen 返回
                  if (filterType && filterType !== 'Home') {
                    logger.debug('从分类页面返回', { 
                      imageId, 
                      currentPage: savedCurrentPage,
                      itemsPerPage: savedItemsPerPage, // 🔥 新增：记录 itemsPerPage
                      viewMode: savedViewMode,
                      filterType,
                      filterValue
                    });
                    
                    setCurrentScreen('Category');
                    
                    // 恢复上下文信息到screenProps
                    setScreenProps(prev => ({
                      ...prev,
                      filterType,
                      filterValue,
                      currentImageId: imageId || null,
                      currentPage: savedCurrentPage ? parseInt(savedCurrentPage, 10) : null,
                      itemsPerPage: savedItemsPerPage ? parseInt(savedItemsPerPage, 10) : null, // 🔥 新增：恢复 itemsPerPage
                      viewMode: savedViewMode || null
                    }));
                  } else {
                    logger.debug('从首页返回');
                    setCurrentScreen('Home');
                    logger.debug('从图片预览返回，重新加载数据');
                    await loadData();
                  }
                }}
                // 🆕 统一传递 filterType 和 filterValue
                filterType={screenProps.filterType}
                filterValue={screenProps.filterValue}
              />
            ) : <View style={styles.loadingContainer}><Text>{t('home.loadingPreview')}</Text></View>}
          </View>
        )}
        
        {currentScreen === 'Settings' && (
          <View style={styles.screenContainer}>
            {SettingsScreen ? (
              <SettingsScreen
                {...screenProps}
                navigation={{
                  goBack: async () => {
                    setCurrentScreen('Home');
                    logger.debug('从设置页面返回，重新加载数据');
                    await loadData();
                  },
                  navigate: (name) => {
                    setCurrentScreen(name);
                    setScreenProps({});
                  }
                }}
                onScanProgress={handleScanProgress}
                isScanning={isScanning}
              />
            ) : <View style={styles.loadingContainer}><Text>{t('home.loadingSettings')}</Text></View>}
          </View>
        )}

        {currentScreen === 'AIModelConfig' && (
          <View style={styles.screenContainer}>
            {AIModelConfigScreen ? (
              <AIModelConfigScreen
                navigation={{ goBack: () => setCurrentScreen('Settings') }}
              />
            ) : <View style={styles.loadingContainer}><Text>{t('home.loading') || '加载中…'}</Text></View>}
          </View>
        )}

        {currentScreen === 'Search' && (
          <View style={styles.screenContainer}>
            {SearchScreen ? (
              <SearchScreen
                onBack={async () => {
                  setCurrentScreen('Home');
                  await loadData();
                }}
              />
            ) : <View style={styles.loadingContainer}><Text>{t('home.loading') || '加载中…'}</Text></View>}
          </View>
        )}

        {currentScreen === 'Stats' && (
          <View style={styles.screenContainer}>
            {StatsScreen ? (
              <StatsScreen
                onBack={async () => {
                  setCurrentScreen('Home');
                  await loadData();
                }}
              />
            ) : <View style={styles.loadingContainer}><Text>{t('home.loading') || '加载中…'}</Text></View>}
          </View>
        )}

        {currentScreen === 'Moments' && (
          <View style={styles.screenContainer}>
            {MomentsScreen ? (
              <MomentsScreen
                onBack={async () => {
                  setCurrentScreen('Home');
                  await loadData();
                }}
              />
            ) : <View style={styles.loadingContainer}><Text>{t('home.loading') || '加载中…'}</Text></View>}
          </View>
        )}

        {currentScreen === 'Duplicates' && (
          <View style={styles.screenContainer}>
            {DuplicatesScreen ? (
              <DuplicatesScreen
                onBack={async () => {
                  setCurrentScreen('Home');
                  await loadData();
                }}
              />
            ) : <View style={styles.loadingContainer}><Text>{t('home.loading') || '加载中…'}</Text></View>}
          </View>
        )}

        {currentScreen === 'Backup' && (
          <View style={styles.screenContainer}>
            {BackupScreen ? (
              <BackupScreen
                onBack={async () => {
                  setCurrentScreen('Home');
                  await loadData();
                }}
              />
            ) : <View style={styles.loadingContainer}><Text>{t('home.loading') || '加载中…'}</Text></View>}
          </View>
        )}
      </SafeAreaView>
    );
  }, [loadedScreens, currentScreen, screenProps, globalMessage, handleScanProgress, startSmartScan, hideEmptyCategories, categoryCounts, recentImages, categoryRecentImages, cityCounts, cityRecentImages, colorCounts, similarityGroups, showAllSimilarityGroups, totalImagesCount, isScanning, isSimilarityDetecting, refreshing, onRefresh, rotationValue, t, handleNACategoryAIClassify, executeAIClassify, handleStartSimilarityDetection, handleStartLocationEnrichment]);

  logger.debug('HomeScreen 状态初始化完成:', { 
    currentScreen, 
    recentImages: recentImages?.length || 0, 
    categoryCounts: Object.keys(categoryCounts).length,
    hideEmptyCategories,
    hideEmptyCategoriesRef: hideEmptyCategoriesRef.current
  });

  // 主要的返回语句
  return renderAllScreens;
};

// 渲染分类卡片组件
const CategoryCard = React.memo(({ category, count, recentImages, onPress, onRightClick }) => {
  const { t, i18n } = useTranslation('common');
  
  // 稳定化图片源对象，避免不必要的重新渲染
  const imageSource = useMemo(() => {
    if (recentImages.length === 0) return null;
    const imageUri = getUri(recentImages[0]);
    return imageUri ? { uri: imageUri } : null;
  }, [recentImages[0]]);

  // 🆕 处理 category 可能是对象（有 id 属性）或字符串（直接是值）的情况
  const categoryValue = typeof category === 'object' && category !== null ? category.id : category;
  
  // 根据当前语言动态选择分类名称
  const getCategoryDisplayName = () => {
    if (typeof category === 'object' && category !== null) {
      // 如果已经有 name 字段（已经根据语言处理过），直接使用
      if (category.name) {
        return category.name;
      }
      // 否则根据当前语言动态选择
      const currentLang = i18n.language || 'zh';
      return currentLang === 'en' 
        ? (category.english || category.chinese) 
        : (category.chinese || category.english);
    }
    return category;
  };

  // 处理右键点击事件 - 阻止默认右键菜单
  const handleContextMenu = (event) => {
    logger.debug(`handleContextMenu 被调用: categoryValue=${categoryValue}, hasOnRightClick=${!!onRightClick}`);
    event.preventDefault(); // 阻止默认的右键菜单
    event.stopPropagation();
    
    // 检查是否为 NA 分类
    if (categoryValue === 'NA' && onRightClick) {
      logger.debug(`通过 onContextMenu 调用onRightClick: ${categoryValue}`);
      // 使用 setTimeout 延迟调用，避免 Alert 阻塞事件处理
      setTimeout(() => {
        onRightClick();
      }, 0);
    }
  };

  // 处理鼠标按下事件（用于右键点击检测）
  const handleMouseDown = (event) => {
    logger.debug(`handleMouseDown 被调用: button=${event.button}, categoryValue=${categoryValue}, hasOnRightClick=${!!onRightClick}`);
    
    // 右键点击（button === 2）
    if (event.button === 2) {
      logger.debug(`鼠标右键按下: ${categoryValue}`);
      event.preventDefault(); // 阻止默认右键菜单
      event.stopPropagation();
      
      // 检查是否为 NA 分类
      if (categoryValue === 'NA' && onRightClick) {
        logger.debug(`调用onRightClick: ${categoryValue}`);
        // 使用 setTimeout 延迟调用，避免 Alert 阻塞事件处理
        setTimeout(() => {
          onRightClick();
        }, 0);
      } else {
        logger.debug(`跳过右键点击处理: categoryValue=${categoryValue}, hasOnRightClick=${!!onRightClick}`);
      }
    }
  };

  return (
    <TouchableOpacity
      style={styles.categoryCard}
      onPress={() => onPress(categoryValue)}
      onContextMenu={handleContextMenu}
      onMouseDown={handleMouseDown}
    >
      {/* 缩略图占满整个卡片 */}
      {imageSource ? (
        <Image
          source={imageSource}
          style={styles.thumbnail}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.thumbnail, { backgroundColor: (typeof category === 'object' && category?.color) || '#607D8B' }]}>
          <Text style={styles.emptyThumbnailText}>📷</Text>
        </View>
      )}
      
      {/* 覆盖层显示分类信息 */}
      <View style={styles.categoryOverlay}>
        <Text style={styles.categoryName}>
          {getCategoryDisplayName()}
        </Text>
        <Text style={styles.categoryCount}>{count}</Text>
      </View>
      
      {/* NA分类右键提示 */}
      {categoryValue === 'NA' && count > 0 && (
        <View style={styles.naCategoryHint}>
          <Text style={styles.naCategoryHintText}>🖱️ {t('home.naCategoryRightClickHint')}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
});

// 渲染目录卡片组件
const DirectoryCard = React.memo(({ directory, directoryName, count, recentImages, onPress }) => {
  // 稳定化图片源对象，避免不必要的重新渲染
  const imageSource = useMemo(() => {
    if (recentImages.length === 0) return null;
    const imageUri = getUri(recentImages[0]);
    return imageUri ? { uri: imageUri } : null;
  }, [recentImages[0]]);

  return (
    <TouchableOpacity
      style={styles.categoryCard}
      onPress={() => onPress(directory)}
    >
      {/* 缩略图占满整个卡片 */}
      {imageSource ? (
        <Image
          source={imageSource}
          style={styles.thumbnail}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.thumbnail, { backgroundColor: '#9E9E9E' }]}>
          <Text style={styles.emptyThumbnailText}>📁</Text>
        </View>
      )}
      
      {/* 覆盖层显示目录信息 */}
      <View style={styles.categoryOverlay}>
        <Text style={styles.categoryName} numberOfLines={1}>{directoryName}</Text>
        <Text style={styles.categoryCount}>{count}</Text>
      </View>
    </TouchableOpacity>
  );
});

// 渲染颜色卡片组件
const ColorCard = React.memo(({ color, count, recentImages, onPress }) => {
  const { i18n } = useTranslation('common');
  
  // 稳定化图片源对象，避免不必要的重新渲染
  const imageSource = useMemo(() => {
    if (recentImages.length === 0) return null;
    const imageUri = getUri(recentImages[0]);
    return imageUri ? { uri: imageUri } : null;
  }, [recentImages[0]]);

  // 根据当前语言获取颜色名称的翻译
  const displayColorName = useMemo(() => {
    return getColorNameTranslation(color, i18n.language);
  }, [color, i18n.language]);

  return (
    <TouchableOpacity
      style={styles.categoryCard}
      onPress={() => onPress(color)}
    >
      {/* 缩略图占满整个卡片 */}
      {imageSource ? (
        <Image
          source={imageSource}
          style={styles.thumbnail}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.thumbnail, { backgroundColor: color || '#9E9E9E' }]}>
          <Text style={styles.emptyThumbnailText}>🎨</Text>
        </View>
      )}
      
      {/* 覆盖层显示颜色信息 */}
      <View style={styles.categoryOverlay}>
        <Text style={styles.categoryName}>{displayColorName}</Text>
        <Text style={styles.categoryCount}>{count}</Text>
      </View>
    </TouchableOpacity>
  );
});

// 按时间卡片组件（与 CityCard 同结构）
const TimeCard = ({ timeKey, label, count, recentImages, onPress }) => {
  const imageSource = useMemo(() => {
    if (!recentImages || recentImages.length === 0) return null;
    const imageUri = getUri(recentImages[0]);
    return imageUri ? { uri: imageUri } : null;
  }, [recentImages]);

  return (
    <TouchableOpacity style={styles.categoryCard} onPress={() => onPress(timeKey)}>
      {imageSource ? (
        <Image source={imageSource} style={styles.thumbnail} resizeMode="cover" />
      ) : (
        <View style={[styles.thumbnail, { backgroundColor: '#5C6BC0' }]}>
          <Text style={styles.emptyThumbnailText}>📅</Text>
        </View>
      )}
      <View style={styles.categoryOverlay}>
        <Text style={styles.categoryName}>{label}</Text>
        <Text style={styles.categoryCount}>{count}</Text>
      </View>
    </TouchableOpacity>
  );
};

// 渲染城市卡片组件
const CityCard = ({ city, count, recentImages, onPress }) => {
  const { i18n } = useTranslation('common');
  const [cityName, setCityName] = useState(city); // 默认显示 location_id，加载后显示名称
  
  // 稳定化图片源对象，避免不必要的重新渲染
  const imageSource = useMemo(() => {
    if (recentImages.length === 0) return null;
    const imageUri = getUri(recentImages[0]);
    return imageUri ? { uri: imageUri } : null;
  }, [recentImages[0]]);

  // 获取当前语言，使用 useMemo 确保语言变化时重新计算
  const currentLanguage = useMemo(() => i18n.language || 'zh', [i18n.language]);

  // 根据当前语言和 location_id 获取位置名称
  useEffect(() => {
    const loadCityName = async () => {
      if (!city || typeof city !== 'string') {
        return;
      }
      
      try {
        logger.debug('CityCard 加载城市名称:', { city, currentLanguage });
        const name = await cityLocationService.getLocationName(city, currentLanguage);
        if (name) {
          logger.debug('CityCard 获取到城市名称:', { city, name, language: currentLanguage });
          setCityName(name);
        } else {
          // 如果获取失败，保持显示 location_id
          logger.debug('CityCard 未获取到城市名称，使用 location_id:', city);
          setCityName(city);
        }
      } catch (error) {
        logger.error('获取城市名称失败:', { city, error });
        // 出错时保持显示 location_id
        setCityName(city);
      }
    };
    
    loadCityName();
  }, [city, currentLanguage]);

  return (
    <TouchableOpacity
      style={styles.categoryCard}
      onPress={() => onPress(city)}
    >
      {/* 缩略图占满整个卡片 */}
      {imageSource ? (
        <Image
          source={imageSource}
          style={styles.thumbnail}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.thumbnail, { backgroundColor: '#FF5722' }]}>
          <Text style={styles.emptyThumbnailText}>🏙️</Text>
        </View>
      )}
      
      {/* 覆盖层显示城市信息 */}
      <View style={styles.categoryOverlay}>
        <Text style={styles.categoryName}>{cityName}</Text>
        <Text style={styles.categoryCount}>{count}</Text>
      </View>
    </TouchableOpacity>
  );
};

// 渲染相似照片卡片组件
const SimilarityCard = React.memo(({ group, onPress }) => {
  const { t } = useTranslation('common');
  // 稳定化图片源对象，避免不必要的重新渲染
  const imageSource = useMemo(() => {
    if (!group.latestImageUri) return null;
    const imageUri = getUri(group.latestImageUri);
    return imageUri ? { uri: imageUri } : null;
  }, [group.latestImageUri]);

  return (
    <TouchableOpacity
      style={styles.categoryCard}
      onPress={() => onPress(group)}
    >
      {/* 缩略图占满整个卡片 */}
      {imageSource ? (
        <Image
          source={imageSource}
          style={styles.thumbnail}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.thumbnail, { backgroundColor: '#9C27B0' }]}>
          <Text style={styles.emptyThumbnailText}>🔗</Text>
        </View>
      )}
      
      {/* 覆盖层显示相似照片信息 */}
      <View style={styles.categoryOverlay}>
        <Text style={styles.categoryName}>{t('category.similarityGroup')}</Text>
        <Text style={styles.categoryCount}>{group.imageCount}</Text>
      </View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    paddingTop: 60, // 为 titleBarOverlay 留出空间
  },
  screenContainer: {
    flex: 1,
    height: '100%', // 明确设置高度
  },
  scrollView: {
    flex: 1,
  },
  // 相册报告入口
  statsEntrySection: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  statsEntryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  statsEntryIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  statsEntryText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  statsEntryArrow: {
    fontSize: 22,
    color: '#C7C7CC',
    fontWeight: '600',
  },
  // 混合模式自定义标题栏样式
  customTitleBar: {
    position: 'fixed', // 使用 fixed 定位，相对于视口固定
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#2f3241', // 恢复背景色，与 titleBarOverlay 一致
    height: 60,
    paddingRight: 160, // 为系统控制按钮和设置按钮留出空间
    zIndex: 1000,
  },
  titleBarLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  titleBarIcon: {
    width: 32, // 使用32x32px图标，更清晰
    height: 32,
    marginRight: 12,
  },
  titleBarTitle: {
    fontSize: 16, // 增大字体
    fontWeight: '600',
    color: '#74b1be',
    lineHeight: 22,
  },
  titleBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  titleBarSettingsButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(116, 177, 190, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  titleBarSettingsIcon: {
    fontSize: 16,
    color: '#74b1be',
  },
  titleBarStagingButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(116, 177, 190, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    position: 'relative',
  },
  titleBarStagingIcon: {
    fontSize: 16,
    color: '#74b1be',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#FF5722',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#2f3241',
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  // 扫描进度提示区样式
  scanProgressBanner: {
    position: 'fixed',
    top: 60, // 标题栏高度
    left: 0,
    right: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    padding: 8,
    borderRadius: 0,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    zIndex: 999,
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
  },
  scanningBanner: {
    backgroundColor: 'transparent',
  },
  scanProgressMessage: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    fontWeight: 'normal',
  },
  progressBar: {
    height: 6,
    backgroundColor: '#e0e0e0',
    borderRadius: 3,
    marginVertical: 8,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#2196F3',
    borderRadius: 3,
  },
  stageProgress: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginTop: 4,
  },
  scanStats: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  statText: {
    fontSize: 12,
    color: '#666',
    marginHorizontal: 8,
    marginVertical: 2,
  },
  // 分类区域样式
  categoriesSection: {
    marginBottom: 24,
    paddingHorizontal: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  countBadge: {
    backgroundColor: '#007AFF',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  toggleButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#f0f0f0',
    borderRadius: 16,
  },
  toggleButtonText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
  },
  recentSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  refreshButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#f0f0f0',
    borderRadius: 16,
    marginLeft: 8,
    minWidth: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  refreshButtonDisabled: {
    backgroundColor: '#e0e0e0',
    opacity: 0.5,
  },
  refreshButtonText: {
    fontSize: 16,
    lineHeight: 16,
  },
  refreshButtonTextDisabled: {
    opacity: 0.5,
  },
  headerButtonsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  moreButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#f0f0f0',
    borderRadius: 16,
    minWidth: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  moreButtonText: {
    fontSize: 20,
    lineHeight: 20,
    color: '#666',
  },
  moreGroupsHint: {
    width: '100%',
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreGroupsHintText: {
    fontSize: 13,
    color: '#8E8E93',
    textAlign: 'center',
  },
  categoriesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    gap: 12,
  },
  categoryCard: {
    width: 140, // 固定宽度，比最近照片稍大
    height: 140, // 固定高度，正方形
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    overflow: 'hidden',
    position: 'relative',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  categoryOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    padding: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  categoryName: {
    fontSize: 12,
    fontWeight: 'bold',
    color: 'white',
    flex: 1,
  },
  categoryCount: {
    fontSize: 14,
    fontWeight: 'bold',
    color: 'white',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  // NA分类右键提示样式
  naCategoryHint: {
    position: 'absolute',
    top: 8,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 122, 255, 0.9)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  naCategoryHintText: {
    fontSize: 11,
    color: 'white',
    fontWeight: '600',
  },
  emptyThumbnailText: {
    fontSize: 32,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
    lineHeight: 140,
  },
  emptyMessage: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    fontStyle: 'italic',
    padding: 20,
  },
  // 最近照片区域样式
  recentSection: {
    marginBottom: 24,
    paddingHorizontal: 16,
  },
  // 加载容器样式
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
    marginTop: 20,
  },
  // 空数据提示样式
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 20,
    minHeight: 120,
  },
  emptyStateIcon: {
    fontSize: 48,
    marginBottom: 8,
    opacity: 0.6,
  },
  emptyStateText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
    marginBottom: 4,
    textAlign: 'center',
  },
  emptyStateSubtext: {
    fontSize: 13,
    color: '#999',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 0,
  },
  // FAB按钮样式
  fabButton: {
    position: 'fixed',
    bottom: 80,
    right: 16,
    width: 56,
    height: 56,
    backgroundColor: '#007AFF',
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    zIndex: 9999,
  },
  fabButtonText: {
    fontSize: 24,
    color: '#fff',
  },
  // 扫描浮窗提示样式（贴近扫描按钮）
  scanTipContainer: {
    position: 'fixed',
    bottom: 144, // 比按钮高出约64px
    right: 16,
    maxWidth: 320,
    backgroundColor: 'rgba(0,0,0,0.8)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    zIndex: 10000,
  },
  scanTipText: {
    fontSize: 12,
    color: '#fff',
    lineHeight: 18,
  },
  // 开始相似度检测按钮样式
  startSimilarityButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    marginTop: 16,
    alignSelf: 'center',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  startSimilarityButtonDisabled: {
    backgroundColor: '#CCCCCC',
    shadowColor: '#CCCCCC',
    shadowOpacity: 0.2,
    opacity: 0.6,
  },
  startSimilarityButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
  },
  startSimilarityButtonTextDisabled: {
    color: '#999999',
  },
  // 颜色芯片、按属性、按拍摄参数
  colorChipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 8,
  },
  colorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    gap: 6,
  },
  colorChipSwatch: {
    width: 14,
    height: 14,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
  },
  colorChipName: {
    flex: 1,
    fontSize: 12,
    color: '#333',
    fontWeight: '500',
  },
  colorChipCount: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#666',
  },
  attributesContainer: {
    paddingHorizontal: 16,
    gap: 12,
    alignSelf: 'stretch',
    width: '100%',
  },
  attributeSubBlock: {
    gap: 6,
  },
  attributeSubLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8E8E93',
    paddingHorizontal: 4,
  },
  attributeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    borderRadius: 8,
    backgroundColor: '#FAFAFA',
  },
  attributeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    gap: 6,
  },
  attributeChipName: {
    fontSize: 12,
    color: '#333',
    fontWeight: '500',
    maxWidth: 120,
  },
  attributeChipCount: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#666',
  },
});

export default HomeScreen;