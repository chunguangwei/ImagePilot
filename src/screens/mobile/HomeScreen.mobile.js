/**
 * ImagePilot - 移动端首页
 * 
 * 功能（与PC端保持一致）：
 * 1. 消息提示区（显示扫描进度或最近扫描信息）
 * 2. 按内容分类浏览
 * 3. 相似图片分组
 * 4. 按城市分类
 * 5. 最近照片
 * 6. FAB扫描按钮
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Image,
  RefreshControl,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  Share,
  FlatList,
} from 'react-native';
import { SafeAreaView, Platform, PermissionsAndroid, Alert, RNFS, NativeModules } from '../../adapters/WebAdapters';
import WeChatAuthService from '../../services/WeChatAuthService';
import { useFocusEffect } from '@react-navigation/native';
import UnifiedDataService from '../../services/UnifiedDataService';
import GlobalImageCache from '../../services/GlobalImageCache';
import configService from '../../services/ConfigService';
import aiProviderConfigService from '../../services/llm/adapters/UnifiedDataConfigService';
import GalleryScannerService from '../../services/GalleryScannerService';
import WakeLockService from '../../services/WakeLockService';
import * as UpdateService from '../../services/UpdateService';
import cityLocationService from '../../services/CityLocationService';
import SkeuomorphicCamera from '../../ui/ios/SkeuomorphicCamera';
import { logger, getUri, getLocalPath } from '../../adapters/WebAdapters';
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

/** 城市卡片（与 PC 端一致：根据 locationId + i18n.language 自行获取显示名称） */
const CityCard = ({ locationId, count, latestImageUri, onPress }) => {
  const { i18n } = useTranslation('common');
  const [cityName, setCityName] = useState(locationId);
  const currentLanguage = useMemo(() => i18n.language || 'zh', [i18n.language]);

  useEffect(() => {
    if (!locationId || typeof locationId !== 'string') return;
    cityLocationService.getLocationName(locationId, currentLanguage).then((name) => {
      setCityName(name || locationId);
    }).catch(() => setCityName(locationId));
  }, [locationId, currentLanguage]);

  return (
    <TouchableOpacity style={styles.categoryCard} onPress={onPress}>
      {latestImageUri ? (
        <Image source={{ uri: latestImageUri }} style={styles.thumbnail} resizeMode="cover" />
      ) : (
        <View style={[styles.thumbnail, { backgroundColor: '#FF9800' }]}>
          <Text style={styles.emptyThumbnailText}>📍</Text>
        </View>
      )}
      <View style={styles.categoryOverlay}>
        <Text style={styles.categoryName}>{cityName}</Text>
        <Text style={styles.categoryCount}>{count}</Text>
      </View>
    </TouchableOpacity>
  );
};

/** 按时间卡片（与 CityCard 同结构：缩略图 + 覆盖层文案 + 数量） */
const TimeCard = ({ timeKey, label, count, recentImages, onPress }) => {
  const imageUri = (recentImages && recentImages.length > 0 && getUri(recentImages[0])) || null;
  return (
    <TouchableOpacity style={styles.categoryCard} onPress={() => onPress && onPress(timeKey)}>
      {imageUri ? (
        <Image source={{ uri: imageUri }} style={styles.thumbnail} resizeMode="cover" />
      ) : (
        <View style={[styles.thumbnail, { backgroundColor: '#5C6BC0' }]}>
          <Text style={styles.emptyThumbnailText}>📅</Text>
        </View>
      )}
      <View style={styles.categoryOverlay}>
        <Text style={styles.categoryName} numberOfLines={1}>{label}</Text>
        <Text style={styles.categoryCount}>{count}</Text>
      </View>
    </TouchableOpacity>
  );
};

// iOS 风格图标（字体已打包）；异常时回退 emoji
let HomeIonicons = null;
try { HomeIonicons = require('react-native-vector-icons/Ionicons').default; } catch (_) { HomeIonicons = null; }
// 区块标题前缀图标：iOS 单色线性（蓝），无 Ionicons 时回退 emoji。可内嵌于 <Text>。
const SectionIcon = ({ name, emoji }) => (HomeIonicons
  ? <HomeIonicons name={name} size={16} color="#007AFF" />
  : <Text>{emoji}</Text>);

// 每个 app 会话只在启动时静默检查一次更新（避免重复弹窗）
let _launchUpdateChecked = false;

const HomeScreen = ({ navigation }) => {
  const { t, i18n } = useTranslation('common');
  
  // ==================== 状态管理 ====================
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  
  // 分类数据
  const [categories, setCategories] = useState([]);
  // 用户自定义分类（settings.aiProvider.customCategories；云端 LLM 才会真正归类到此）
  const [customCategoryList, setCustomCategoryList] = useState([]);
  
  // 按时间数据（时间桶数量 + 各桶代表图）
  const [timeCounts, setTimeCounts] = useState({});
  const [timeRecentImages, setTimeRecentImages] = useState({});
  
  // 城市数据
  const [cities, setCities] = useState([]);
  
  // 相似组数据
  const [similarityGroups, setSimilarityGroups] = useState([]);
  const [showAllSimilarityGroups, setShowAllSimilarityGroups] = useState(false);
  const [showAllCities, setShowAllCities] = useState(false);
  
  // 颜色分类数据（按颜色区不再加载缩略图，仅用色块+数量展示）
  const [colorCounts, setColorCounts] = useState({});
  
  // 目录/格式/分辨率/方向（合并为按属性区，无缩略图）
  const [directoryCounts, setDirectoryCounts] = useState({});
  const [formatCounts, setFormatCounts] = useState({});
  const [resolutionCounts, setResolutionCounts] = useState({});
  const [orientationCounts, setOrientationCounts] = useState({});
  
  // ISO/光圈/快门/焦距（合并为按拍摄参数区，无缩略图）
  const [isoCounts, setISOCounts] = useState({});
  const [apertureCounts, setApertureCounts] = useState({});
  const [shutterCounts, setShutterCounts] = useState({});
  const [focalLengthCounts, setFocalLengthCounts] = useState({});
  
  // 最近照片
  const [recentImages, setRecentImages] = useState([]);
  const [recentImagesTotal, setRecentImagesTotal] = useState(0); // 新发现照片的总数
  
  // 扫描状态
  const [isScanning, setIsScanning] = useState(false);
  const [isSimilarityDetecting, setIsSimilarityDetecting] = useState(false); // 相似度检测状态
  
  // 消息提示
  const [globalMessage, setGlobalMessage] = useState(t('home.ready'));
  
  // 防抖定时器引用（用于避免频繁刷新数据）
  const loadDataDebounceTimerRef = useRef(null);
  // 存储最新的 loadAllData 函数引用（用于防抖函数）
  const loadAllDataRef = useRef(null);
  
  // 隐藏空分类设置（默认隐藏空分类）
  const [hideEmptyCategories, setHideEmptyCategories] = useState(true);

  // ==================== 初始化加载 ====================
  useEffect(() => {
    initializeData();
    loadLastScanTime();
    loadHideEmptyCategoriesSetting();
    
    // 调试：检查当前权限状态
    checkCurrentPermissionStatus();

    // 启动时静默检查 GitHub 更新（每会话一次；失败不打扰，有新版才弹一次）
    if (!_launchUpdateChecked) {
      _launchUpdateChecked = true;
      UpdateService.checkForUpdate()
        .then((info) => {
          if (info && info.hasUpdate) {
            Alert.alert(
              t('settings.updateFoundTitle', { version: info.latestVersion }),
              t('settings.updateFoundMessage', { version: info.latestVersion }),
              [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('settings.updateNow'),
                  style: 'default',
                  onPress: async () => {
                    if (!info.apkUrl) { UpdateService.openDownload(info); return; }
                    try {
                      setGlobalMessage(t('home.updateDownloading', { pct: 0 }));
                      await UpdateService.downloadAndInstall(info.apkUrl, (p) =>
                        setGlobalMessage(t('home.updateDownloading', { pct: Math.round(p * 100) })),
                      );
                      setGlobalMessage('');
                    } catch (e) {
                      setGlobalMessage('');
                      if (e && e.code === 'E_NEED_PERMISSION') {
                        Alert.alert(t('settings.installPermTitle'), t('settings.installPermMessage'));
                      } else {
                        UpdateService.openDownload(info); // 下载/安装失败 → 兜底浏览器
                      }
                    }
                  },
                },
              ],
            );
          }
        })
        .catch(() => {});
    }

    // 监听语言变化，重新加载分类数据（城市名称由 CityCard 根据 i18n.language 自行获取）
    const handleLanguageChange = () => {
      logger.debug('🌐 语言已切换，重新加载分类数据...');
      loadCategories();
    };
    
    let languageSubscription = null;
    if (i18n && i18n.on) {
      languageSubscription = i18n.on('languageChanged', handleLanguageChange);
    }
    
    return () => {
      if (languageSubscription && i18n && i18n.off) {
        i18n.off('languageChanged', handleLanguageChange);
      }
    };
  }, []);

  /**
   * 检查当前权限状态（调试用）
   */
  const checkCurrentPermissionStatus = async () => {
    if (Platform.OS !== 'android') {
      return;
    }

    try {
      logger.debug('🔍 检查当前权限状态...');
      
      let permissions = [];
      if (Platform.Version >= 33) {
        permissions = [
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
          PermissionsAndroid.PERMISSIONS.ACCESS_MEDIA_LOCATION,
        ];
      } else {
        permissions = [
          PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
          PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
          PermissionsAndroid.PERMISSIONS.ACCESS_MEDIA_LOCATION,
        ];
      }

      const checkResults = await Promise.all(
        permissions.map(p => PermissionsAndroid.check(p))
      );

      logger.debug('📋 当前权限状态:', {
        permissions,
        results: checkResults,
        allGranted: checkResults.every(result => result === true)
      });
    } catch (error) {
      logger.error('❌ 检查权限状态失败:', error);
    }
  };
  
  // 监听页面焦点，当从其他页面返回时刷新数据
  useFocusEffect(
    useCallback(() => {
      // 页面获得焦点时，刷新数据（避免初次加载时重复刷新）
      // 如果正在扫描，不要刷新（避免覆盖扫描进度消息）
      if (!loading && !isScanning) {
        logger.debug('🔄 首页获得焦点，刷新数据...');
        // 重新加载数据（hideEmptyCategories 状态在内存中，不需要重新加载）
        loadAllData();
        loadLastScanTime();
      }
    }, [loading, isScanning])
  );
  
  /**
   * 加载"隐藏空分类"设置
   * 默认隐藏空分类（true），只有用户主动设置为显示空分类时才是 false
   */
  const loadHideEmptyCategoriesSetting = async () => {
    try {
      const settings = await UnifiedDataService.readSettings();
      // 如果设置未定义，默认为 true（隐藏空分类）
      // 只有当用户明确设置为 false 时才显示空分类
      // 确保值是布尔类型，防止字符串等其他类型
      let shouldHide = true; // 默认值
      if (settings.hideEmptyCategories !== undefined && settings.hideEmptyCategories !== null) {
        if (typeof settings.hideEmptyCategories === 'boolean') {
          shouldHide = settings.hideEmptyCategories;
        } else if (typeof settings.hideEmptyCategories === 'string') {
          // 处理字符串类型（可能是从旧版本迁移过来的）
          shouldHide = settings.hideEmptyCategories !== 'false';
        } else {
          // 其他类型，转换为布尔值
          shouldHide = Boolean(settings.hideEmptyCategories);
        }
      }
      setHideEmptyCategories(shouldHide);
      logger.debug('加载隐藏空分类设置:', { value: settings.hideEmptyCategories, shouldHide });
    } catch (error) {
      logger.error('加载隐藏空分类设置失败:', error);
      // 出错时默认隐藏空分类
      setHideEmptyCategories(true);
    }
  };

  /**
   * 当 hideEmptyCategories 改变时，不需要重新加载分类
   * 因为过滤逻辑在渲染时进行，只需要触发重新渲染即可
   */


  /**
   * 初始化数据加载
   */
  const initializeData = async () => {
    try {
      setLoading(true);
      
      // ConfigService 和 UnifiedDataService 已在 App.js 启动时初始化
      // 这里直接加载数据即可
      await loadAllData();
      
    } catch (error) {
      logger.error('❌ 首页初始化失败:', error);
      Alert.alert(t('home.initializationFailed'), error.message);
    } finally {
      setLoading(false);
    }
  };

  /**
   * 加载所有数据（第一优先级：立即加载）
   */
  const loadAllData = async () => {
    try {
      // 并行加载核心数据
      await Promise.all([
        loadCategories(),
        loadRecentImages(),
      ]);
      
      // 延迟加载次要数据（第二优先级）
      setTimeout(() => {
        loadTimeData();
        loadCities();
        loadSimilarityGroups();
        loadColors();
        loadDirectories();
        loadFormats();
        loadResolutions();
        loadOrientations();
        loadISO();
        loadAperture();
        loadShutter();
        loadFocalLength();
        }, 100);
        
          } catch (error) {
      logger.error('❌ 加载数据失败:', error);
      throw error;
    }
  };
  
  // 更新 loadAllData 的引用
  loadAllDataRef.current = loadAllData;

  /**
   * 防抖版本的 loadAllData（避免频繁刷新）
   * 在 AI 分类过程中使用，避免短时间内多次刷新
   */
  const loadAllDataDebounced = useCallback(async () => {
    // 清除之前的定时器
    if (loadDataDebounceTimerRef.current) {
      clearTimeout(loadDataDebounceTimerRef.current);
      loadDataDebounceTimerRef.current = null;
    }
    
    // 设置新的定时器，500ms 内只执行最后一次调用
    loadDataDebounceTimerRef.current = setTimeout(async () => {
      try {
        logger.debug('🔄 执行防抖后的数据刷新');
        // 使用 ref 中的最新函数引用
        if (loadAllDataRef.current) {
          await loadAllDataRef.current();
        }
      } catch (error) {
        logger.error('❌ 防抖刷新数据失败:', error);
      } finally {
        loadDataDebounceTimerRef.current = null;
      }
    }, 500);
  }, []);


  /**
   * 加载分类列表（按配置文件顺序）
   */
  const loadCategories = async () => {
    try {
      const cache = GlobalImageCache.getCache();
      const categoryCounts = cache.categoryCounts || {};
      
      // 获取所有分类配置（按配置文件中的显示顺序）
      const allCategories = configService.getAllCategoriesWithUI();
      
      // 根据当前语言动态选择分类名称
      const currentLang = i18n.language || 'zh';
      
      // 构建所有分类列表（不过滤，保留所有分类）
      // 注意：过滤逻辑在渲染时进行，使用 hideEmptyCategories 状态
      const categoryList = allCategories.map(categoryConfig => {
        // 根据当前语言动态选择分类名称（与PC端保持一致）
        const categoryName = currentLang === 'en'
          ? (categoryConfig.english || categoryConfig.chinese || categoryConfig.id)
          : (categoryConfig.chinese || categoryConfig.english || categoryConfig.id);

        return {
          id: categoryConfig.id,
          name: categoryName,
          count: categoryCounts[categoryConfig.id] || 0,
          color: categoryConfig.color || '#666666',
          recentImages: [], // 稍后加载
        };
      });

      // 追加用户自定义分类（A 方案：仅云端 LLM 会真正归类到此；
      // 即使 count=0 也展示，便于用户确认配置已生效——空态由 hideEmptyCategories 控制）
      let customList = [];
      try {
        const settings = (await UnifiedDataService.readSettings()) || {};
        const raw = settings?.aiProvider?.customCategories;
        customList = Array.isArray(raw) ? raw.filter((c) => c && c.id && c.name) : [];
      } catch (e) {
        logger.warn('读取自定义分类失败:', e?.message || e);
      }
      setCustomCategoryList(customList);
      for (const c of customList) {
        categoryList.push({
          id: c.id,
          name: c.name,
          count: categoryCounts[c.id] || 0,
          color: '#5856D6', // iOS purple，与内置色系区分
          recentImages: [],
        });
      }
      
      // 并行加载每个分类的最近一张照片（只加载有照片的分类）
      const categoryWithImagesPromises = categoryList.map(async (category) => {
        if (category.count === 0) {
          // 空分类不需要加载照片
          return category;
        }
        
        try {
          const recentImages = await UnifiedDataService.readRecentImagesByCategory(category.id, 1);
          return {
            ...category,
            recentImages: recentImages || []
          };
        } catch (error) {
          logger.error(`加载分类 ${category.id} 最近照片失败:`, error);
          return {
            ...category,
            recentImages: []
          };
        }
      });
      
      const categoryWithImages = await Promise.all(categoryWithImagesPromises);
      
      setCategories(categoryWithImages);
    } catch (error) {
      logger.error('❌ 加载分类列表失败:', error);
    }
  };

  /**
   * 加载按时间分类数据（时间桶数量 + 各桶代表图，用于按时间卡片）
   */
  const loadTimeData = async () => {
    try {
      const counts = await UnifiedDataService.readTimeCounts();
      setTimeCounts(counts || {});
      const keysWithCount = Object.entries(counts || {}).filter(([, c]) => c > 0).map(([k]) => k);
      const map = {};
      await Promise.all(keysWithCount.map(async (timeKey) => {
        try {
          const images = await UnifiedDataService.readRecentImagesByTimeRange(timeKey, 1);
          map[timeKey] = images;
        } catch (e) {
          logger.error(`加载时间桶 ${timeKey} 代表图失败:`, e);
          map[timeKey] = [];
        }
      }));
      setTimeRecentImages(map);
    } catch (error) {
      logger.error('❌ 加载按时间数据失败:', error);
    }
  };

  /**
   * 加载城市列表（仅 locationId、count、latestImageUri）
   * 城市显示名称由 CityCard 组件根据 i18n.language 自行获取（与 PC 端一致）
   */
  const loadCities = async () => {
    try {
      const cache = GlobalImageCache.getCache();
      const cityCounts = cache.cityCounts || {};
      const allImages = cache.allImages || [];
      
      const cityList = Object.keys(cityCounts).map((locationId) => {
        const cityImages = allImages
          .filter(img => img.city === locationId)
          .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        const latestImage = cityImages.length > 0 ? cityImages[0] : null;
        return {
          locationId,
          count: cityCounts[locationId],
          latestImageUri: latestImage ? getUri(latestImage) : null,
        };
      });
      cityList.sort((a, b) => b.count - a.count);
      setCities(cityList);
      
    } catch (error) {
      logger.error('❌ 加载城市列表失败:', error);
    }
  };

  /**
   * 加载颜色分类数据
   */
  const loadColors = async () => {
    try {
      const colorCountsData = await UnifiedDataService.readColorCounts();
      setColorCounts(colorCountsData);
    } catch (error) {
      logger.error('❌ 加载颜色分类失败:', error);
    }
  };

  /**
   * 加载目录分类数据（按属性区无缩略图，仅加载数量）
   */
  const loadDirectories = async () => {
    try {
      const data = await UnifiedDataService.readDirectoryCounts();
      setDirectoryCounts(data);
    } catch (error) {
      logger.error('❌ 加载目录分类失败:', error);
    }
  };

  /**
   * 加载格式分类数据（按属性区无缩略图，仅加载数量）
   */
  const loadFormats = async () => {
    try {
      const data = await UnifiedDataService.readFormatCounts();
      setFormatCounts(data);
    } catch (error) {
      logger.error('❌ 加载格式分类失败:', error);
    }
  };

  /**
   * 加载分辨率分类数据（按属性区无缩略图，仅加载数量）
   */
  const loadResolutions = async () => {
    try {
      const data = await UnifiedDataService.readResolutionCounts();
      setResolutionCounts(data);
    } catch (error) {
      logger.error('❌ 加载分辨率分类失败:', error);
    }
  };

  /**
   * 加载方向分类数据（按属性区无缩略图，仅加载数量）
   */
  const loadOrientations = async () => {
    try {
      const data = await UnifiedDataService.readOrientationCounts();
      setOrientationCounts(data);
    } catch (error) {
      logger.error('❌ 加载方向分类失败:', error);
    }
  };

  /**
   * 加载ISO分类数据（按拍摄参数区无缩略图，仅加载数量）
   */
  const loadISO = async () => {
    try {
      const data = await UnifiedDataService.readISOCounts();
      setISOCounts(data);
    } catch (error) {
      logger.error('❌ 加载ISO分类失败:', error);
    }
  };

  /**
   * 加载光圈分类数据（按拍摄参数区无缩略图，仅加载数量）
   */
  const loadAperture = async () => {
    try {
      const data = await UnifiedDataService.readApertureCounts();
      setApertureCounts(data);
    } catch (error) {
      logger.error('❌ 加载光圈分类失败:', error);
    }
  };

  /**
   * 加载快门分类数据（按拍摄参数区无缩略图，仅加载数量）
   */
  const loadShutter = async () => {
    try {
      const data = await UnifiedDataService.readShutterCounts();
      setShutterCounts(data);
    } catch (error) {
      logger.error('❌ 加载快门分类失败:', error);
    }
  };

  /**
   * 加载焦距分类数据（按拍摄参数区无缩略图，仅加载数量）
   */
  const loadFocalLength = async () => {
    try {
      const data = await UnifiedDataService.readFocalLengthCounts();
      setFocalLengthCounts(data);
    } catch (error) {
      logger.error('❌ 加载焦距分类失败:', error);
    }
  };

  /**
   * 加载相似组
   */
  const loadSimilarityGroups = async () => {
    try {
      // 使用 PC 端相同的方法获取相似组统计（与 PC 端保持一致）
      // 加载所有相似组，而不是只加载前8个，这样才能正确显示MORE按钮
      const allGroups = await UnifiedDataService.getSimilarityGroupsStats();
      setSimilarityGroups(allGroups || []);
      
      
    } catch (error) {
      logger.error('❌ 加载相似组失败:', error);
    }
  };

  /**
   * 加载新发现的照片（从上次扫描之后新发现的照片）
   */
  const loadRecentImages = async () => {
    try {
      // 改为调用 readNewDiscoveredImages 获取从上次扫描之后新发现的照片
      const result = await UnifiedDataService.readNewDiscoveredImages(12);
      setRecentImages(result.images || []);
      setRecentImagesTotal(result.total || 0);
    } catch (error) {
      logger.error('❌ 加载新发现照片失败:', error);
      setRecentImages([]);
      setRecentImagesTotal(0);
    }
  };

  /**
   * 刷新新发现照片
   */
  const refreshNewDiscoveredImages = useCallback(async () => {
    try {
      const result = await UnifiedDataService.readNewDiscoveredImages(12);
      setRecentImages(result.images || []);
      setRecentImagesTotal(result.total || 0);
    } catch (error) {
      logger.error('刷新新发现照片失败:', error);
    }
  }, []);

  /**
   * 启动相似度检测
   */
  const handleStartSimilarityDetection = useCallback(async () => {
    // 检查是否正在扫描
    if (isScanning) {
      logger.debug('正在扫描中，跳过相似度检测请求');
      Alert.alert(t('common.tip'), t('home.scanAlreadyInProgress'));
      return;
    }

    // 🔥 在函数作用域声明，确保 finally 块中可以访问
    let galleryScannerService = null;
    
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
      
      // 使用唤醒锁防止手机休眠影响检测性能
      const wakeLockAcquired = await WakeLockService.acquire(30 * 60 * 1000); // 30分钟超时
      if (wakeLockAcquired) {
        logger.info('🔋 已获取唤醒锁，防止手机休眠影响相似度检测性能');
      }
      
      // 创建 GalleryScannerService 实例，复用其相似度检测逻辑
      galleryScannerService = new GalleryScannerService();
      await galleryScannerService.initialize();
      
      // 设置进度回调
      galleryScannerService.onProgress = (progress) => {
        logger.debug('相似度检测进度:', progress);
        if (progress) {
          const message = progress.simpleMessage || progress.message || t('home.similarityDetectionInProgress');
          setGlobalMessage(message);
          
          // 检查是否需要刷新页面数据
          if (progress.shouldRefresh) {
            setTimeout(async () => {
              try {
                await loadAllData();
              } catch (error) {
                logger.error('❌ 刷新页面数据失败:', error);
              }
            }, 0);
          }
        }
      };
      
      // 设置扫描开始时间（用于增量检测）
      galleryScannerService.scanStartTimestamp = new Date();
      
      // 🔥 设置 GalleryScannerService 的扫描状态，确保状态一致性
      galleryScannerService.isScanning = true;
      
      // 直接调用 similarityDetectionPhase，它会使用内部的 sendProgressMessage
      await galleryScannerService.similarityDetectionPhase();
      
      // 获取相似组统计以显示完成消息
      const similarityGroupsStats = await UnifiedDataService.getSimilarityGroupsStats();
      const groupsCount = similarityGroupsStats ? similarityGroupsStats.length : 0;
      
      logger.debug(`相似度检测完成: 发现${groupsCount}个相似组`);
      setGlobalMessage(t('home.similarityDetectionCompleted', { count: groupsCount }));
      
      // 刷新数据以显示新的相似组
      await loadAllData();
      
    } catch (error) {
      logger.error('相似度检测失败:', error);
      setGlobalMessage(t('home.similarityDetectionFailed', { error: error.message }));
      Alert.alert(t('home.similarityDetectionFailed', { error: '' }), error.message);
    } finally {
      // 释放唤醒锁
      await WakeLockService.release();
      setIsScanning(false);
      setIsSimilarityDetecting(false); // 清除相似度检测状态
      // 🔥 清除全局变量
      if (typeof window !== 'undefined') {
        window.isScanning = false;
      }
      // 🔥 清除 GalleryScannerService 的扫描状态
      if (galleryScannerService) {
        galleryScannerService.isScanning = false;
      }
    }
  }, [isScanning, loadAllData, t]);

  /**
   * 启动位置信息补全
   */
  const handleStartLocationEnrichment = useCallback(async () => {
    // 检查是否正在扫描
    if (isScanning) {
      logger.debug('正在扫描中，跳过位置信息补全请求');
      Alert.alert(t('common.tip'), t('home.scanAlreadyInProgress'));
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
      
      // 使用唤醒锁防止手机休眠影响处理性能
      const wakeLockAcquired = await WakeLockService.acquire(30 * 60 * 1000); // 30分钟超时
      if (wakeLockAcquired) {
        logger.info('🔋 已获取唤醒锁，防止手机休眠影响位置信息补全性能');
      }
      
      // 创建 GalleryScannerService 实例
      const galleryScannerService = new GalleryScannerService();
      await galleryScannerService.initialize();
      
      // 设置进度回调
      galleryScannerService.onProgress = (progress) => {
        logger.debug('位置信息补全进度:', progress);
        if (progress) {
          const message = progress.simpleMessage || progress.message || t('home.locationEnrichmentInProgress');
          setGlobalMessage(message);
          
          // 检查是否需要刷新页面数据
          if (progress.shouldRefresh) {
            setTimeout(async () => {
              try {
                await loadAllData();
              } catch (error) {
                logger.error('❌ 刷新页面数据失败:', error);
              }
            }, 0);
          }
        }
      };
      
      // 调用位置信息补全方法（进度消息会通过 onProgress 回调处理，包括缓存刷新和数据加载）
      await galleryScannerService.enrichLocationInfo();
      
    } catch (error) {
      logger.error('位置信息补全失败:', error);
      setGlobalMessage(t('home.locationEnrichmentFailed', { error: error.message }));
      Alert.alert(t('home.locationEnrichmentFailed', { error: '' }), error.message);
    } finally {
      // 释放唤醒锁
      await WakeLockService.release();
      setIsScanning(false);
      // 🔥 清除全局变量
      if (typeof window !== 'undefined') {
        window.isScanning = false;
      }
    }
  }, [isScanning, loadAllData, t]);

  /**
   * 加载最近扫描时间和信息
   */
  const loadLastScanTime = async (preserveCurrentMessage = false) => {
    try {
      const settings = await UnifiedDataService.readSettings();
      logger.debug('🔍 检查扫描完成信息:', {
        hasLastScanTime: !!settings?.lastScanTime,
        lastScanTime: settings?.lastScanTime,
        lastScanDuration: settings?.lastScanDurationSeconds
      });
      
      if (settings && settings.lastScanTime) {
        // 统一时间格式：月-日 时：分：秒（中文和英文都一样）
        const date = new Date(settings.lastScanTime);
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hour = String(date.getHours()).padStart(2, '0');
        const minute = String(date.getMinutes()).padStart(2, '0');
        const second = String(date.getSeconds()).padStart(2, '0');
        const formattedTime = `${month}-${day} ${hour}:${minute}:${second}`;
        
        // 从缓存获取统计信息
        const cache = GlobalImageCache.getCache();
        const images = cache.allImages || [];
        const totalImages = images.length;
        let totalSize = 0;
        for (const image of images) {
          if (image.size && typeof image.size === 'number') {
            totalSize += image.size;
          }
        }
        
        const formattedSize = formatFileSize(totalSize);
        
        // 添加耗时信息
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
        logger.debug('⚠️ 没有扫描完成记录');
        // 如果 preserveCurrentMessage 为 true，不更新消息，保持当前消息
        if (!preserveCurrentMessage) {
          setGlobalMessage('图片分类应用已就绪');
        }
      }
    } catch (error) {
      logger.error('加载最近扫描时间失败:', error);
      // 如果 preserveCurrentMessage 为 true，不更新消息，保持当前消息
      if (!preserveCurrentMessage) {
        setGlobalMessage('图片分类应用已就绪');
      }
      throw error; // 重新抛出错误，让调用方知道失败了
    }
  };

  /**
   * 格式化文件大小
   */
  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  /**
   * 切换"隐藏空分类"设置
   */
  const toggleHideEmptyCategories = async () => {
    try {
      // 切换状态（同步更新，立即生效）
      const newValue = !hideEmptyCategories;
      setHideEmptyCategories(newValue);
      
      // 异步保存到设置（不阻塞UI）
      const settings = await UnifiedDataService.readSettings();
      settings.hideEmptyCategories = newValue;
      await UnifiedDataService.writeSettings(settings);
      
      logger.debug('隐藏空分类设置已更新:', newValue);
    } catch (error) {
      logger.error('切换隐藏空分类设置失败:', error);
      // 如果保存失败，恢复原状态
      setHideEmptyCategories(hideEmptyCategories);
    }
  };

  /**
   * 下拉刷新
   */
  const onRefresh = useCallback(async () => {
    // 如果正在扫描，不执行刷新
    if (isScanning) {
      logger.debug('🔄 正在扫描中，跳过下拉刷新');
      setRefreshing(false);
      return;
    }
    
    setRefreshing(true);
    try {
      // 只重新加载数据（从缓存读取），不重建缓存
      // 缓存只在数据真正变化时（扫描、删除）才重建
      // 注意：hideEmptyCategories 状态已经在内存中，不需要重新加载
      await loadAllData();
      
      // 显式重新加载新发现照片（确保刷新时重新查询 MediaStore）
      await loadRecentImages();
      
      // 重新加载扫描信息（如果失败则保持当前消息不变）
      await loadLastScanTime(true); // 传入 true，失败时保持当前消息
    } catch (error) {
      logger.error('❌ 刷新失败:', error);
      Alert.alert(t('home.refreshFailed'), error.message);
    } finally {
      setRefreshing(false);
    }
  }, [isScanning]);

  // 扫描按钮浮窗提示（非会员限制说明）
  const [showScanTip, setShowScanTip] = useState(false);

  /**
   * 检查并请求所有需要的权限（一次性请求）
   * Android 13+: 媒体访问权限、位置权限、通知权限
   * Android 12-: 存储权限、位置权限
   */
  const checkAndRequestPermissions = async () => {
    if (Platform.OS !== 'android') {
      return true; // iOS 权限在 Info.plist 中配置
    }

    try {
      logger.debug('📋 检查相册访问权限、位置权限和通知权限...');
      logger.debug(`📱 Android 版本: API ${Platform.Version}`);
      
      // 根据 Android 版本请求不同的权限
      let permissions = [];
      
      if (Platform.Version >= 33) {
        // Android 13+ (API 33+): 使用新的媒体权限 + 通知权限
        logger.debug('📋 Android 13+，请求新的媒体权限和通知权限');
        permissions = [
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
          PermissionsAndroid.PERMISSIONS.ACCESS_MEDIA_LOCATION, // 读取照片GPS信息
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS, // 通知权限（用于前台服务）
        ];
      } else {
        // Android 12 及以下: 使用旧的存储权限（不需要通知权限，因为 Android 12 及以下不需要）
        logger.debug('📋 Android 12-，请求旧的存储权限');
        permissions = [
          PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
          PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
          PermissionsAndroid.PERMISSIONS.ACCESS_MEDIA_LOCATION, // 读取照片GPS信息
        ];
      }

      logger.debug('📋 需要检查的权限:', permissions);

      // 🔥 改进：只检查必需权限，ACCESS_MEDIA_LOCATION 是可选的
      // 必需权限：Android 13+ 需要 READ_MEDIA_IMAGES，Android 12- 需要 READ_EXTERNAL_STORAGE
      const requiredPermissions = Platform.Version >= 33
        ? [PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES]
        : [PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE];

      // 检查权限状态
      const checkResults = await Promise.all(
        permissions.map(p => PermissionsAndroid.check(p))
      );

      logger.debug('📋 权限检查结果:', checkResults);
      
      const requiredPermissionIndices = requiredPermissions.map(p => permissions.indexOf(p));
      const allRequiredGranted = requiredPermissionIndices.every(
        index => checkResults[index] === true
      );

      if (allRequiredGranted) {
        // 检查可选权限（ACCESS_MEDIA_LOCATION）的状态
        const mediaLocationIndex = permissions.indexOf(PermissionsAndroid.PERMISSIONS.ACCESS_MEDIA_LOCATION);
        if (mediaLocationIndex >= 0 && !checkResults[mediaLocationIndex]) {
          logger.debug('⚠️ ACCESS_MEDIA_LOCATION 权限未授予，将无法读取照片GPS信息，但不影响扫描功能');
        }
        logger.debug('✅ 必需权限已授权，可以开始扫描');
        return true;
      }

      // 请求权限（一次性请求所有需要的权限）
      logger.debug('📋 开始一次性请求所有权限...');
      const grantResults = await PermissionsAndroid.requestMultiple(permissions);
      
      logger.debug('📋 权限请求结果:', grantResults);
      
      const allRequiredGrantedAfterRequest = requiredPermissions.every(
        permission => grantResults[permission] === PermissionsAndroid.RESULTS.GRANTED
      );

      if (allRequiredGrantedAfterRequest) {
        // 检查可选权限（ACCESS_MEDIA_LOCATION）的状态
        const mediaLocationPermission = grantResults[PermissionsAndroid.PERMISSIONS.ACCESS_MEDIA_LOCATION];
        if (mediaLocationPermission !== PermissionsAndroid.RESULTS.GRANTED) {
          logger.debug('⚠️ ACCESS_MEDIA_LOCATION 权限未授予，将无法读取照片GPS信息，但不影响扫描功能');
        }
        logger.debug('✅ 必需权限已授权，可以开始扫描');
        return true;
      } else {
        logger.warn('⚠️ 必需权限被拒绝');
        const permissionText = Platform.Version >= 33 
          ? t('home.permissionRequiredAndroid13')
          : t('home.permissionRequiredAndroid12');
        Alert.alert(
          t('home.permissionInsufficient'),
          permissionText,
          [
            { text: t('common.cancel'), style: 'cancel' },
            { 
              text: t('home.goToSettings'), 
              onPress: () => {
                // TODO: 打开应用设置页面
                const settingText = Platform.Version >= 33
                  ? t('home.permissionSettingGuideAndroid13')
                  : t('home.permissionSettingGuideAndroid12');
                Alert.alert(t('settings.tip'), settingText);
              }
            }
          ]
        );
        return false;
      }
    } catch (error) {
      logger.error('❌ 权限检查失败:', error);
      return false;
    }
  };

  /**
   * 处理NA分类的AI分类（长按待分类卡片时触发）
   */
  const handleAIClassifyNA = async () => {
    // 检查是否正在扫描中
    if (isScanning) {
      Alert.alert(t('common.tip'), t('home.scanAlreadyInProgress'));
      return;
    }

    // 从缓存获取待分类照片数量
    const cache = GlobalImageCache.getCache();
    const categoryCounts = cache.categoryCounts || {};
    const naCount = categoryCounts['NA'] || categoryCounts.NA || 0;

    // 判断是否已配置在线大模型（active 非 local-onnx 即视为已配置）
    let isLLMConfigured = false;
    try {
      const aiCfg = await aiProviderConfigService.getAIProviderConfig();
      isLLMConfigured = !!(aiCfg && aiCfg.active && aiCfg.active !== 'local-onnx');
    } catch (e) {
      logger.debug('读取 AI 模型配置失败，按未配置处理:', e?.message || e);
      isLLMConfigured = false;
    }

    if (isLLMConfigured) {
      // 已配置云端：同时提供「云端」与「离线」两个执行按钮——
      // 飞行模式/网差时，用户可直接走离线，不必先等云端 60s 超时再触发兜底。
      Alert.alert(
        t('home.aiClassifyConfirmTitle'),
        t('home.aiClassifyConfirmMessage', { count: naCount }),
        [
          { text: t('common.cancel'), style: 'cancel', onPress: () => logger.debug('用户取消分类') },
          {
            text: t('home.aiClassifyUseLocal'),
            style: 'default',
            onPress: async () => { await executeAIClassify({ forceLocal: true, naCount }); },
          },
          {
            text: t('home.aiClassifyUseCloud'),
            style: 'default',
            onPress: async () => { await executeAIClassify({ forceLocal: false, naCount }); },
          },
        ],
      );
    } else {
      // 未配置云端 → 直接走离线
      Alert.alert(
        t('home.aiClassifyOfflineTitle'),
        t('home.aiClassifyOfflineMessage', { count: naCount }),
        [
          { text: t('common.cancel'), style: 'cancel', onPress: () => logger.debug('用户取消分类') },
          {
            text: t('common.confirm'),
            style: 'default',
            onPress: async () => { await executeAIClassify({ forceLocal: true, naCount }); },
          },
        ],
      );
    }
  };

  /**
   * 执行AI分类（确认后执行）
   */
  // 弹出"大模型失败→改用离线模型"兜底确认框
  const promptLocalFallback = (message) => {
    Alert.alert(
      t('home.aiClassifyLLMFailTitle'),
      message,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          style: 'default',
          onPress: async () => { await executeAIClassify({ forceLocal: true }); },
        },
      ],
    );
  };

  const executeAIClassify = async (opts = {}) => {
    const forceLocal = !!opts.forceLocal; // true=离线模型；false=配置的在线大模型
    try {
      // 先检查并请求权限
      const hasPermission = await checkAndRequestPermissions();
      if (!hasPermission) {
        logger.warn('⚠️ 没有相册访问权限，取消AI分类');
        return;
      }

      setIsScanning(true);
      // 🔥 设置全局变量，供设置页面检查扫描状态
      if (typeof window !== 'undefined') {
        window.isScanning = true;
      }
      setGlobalMessage(t('home.aiClassificationInProgress'));
      logger.debug('🤖 开始AI分类（按内容分类）...');
      
      // 使用唤醒锁防止手机休眠影响分类性能
      const wakeLockAcquired = await WakeLockService.acquire(30 * 60 * 1000); // 30分钟超时
      if (wakeLockAcquired) {
        logger.info('🔋 已获取唤醒锁，防止手机休眠影响分类性能');
      }
      
      const galleryScannerService = new GalleryScannerService();
      
      // 初始化服务
      await galleryScannerService.initialize();
      
      // 🔥 先设置进度回调（必须在调用aiImageClassifyByContent之前设置）
      galleryScannerService.onProgress = (progress) => {
        if (progress) {
          const message = progress.simpleMessage || progress.message || t('home.aiClassificationInProgress');
          setGlobalMessage(message);
          
          // 检查是否需要刷新页面数据（使用防抖版本，避免频繁刷新）
          if (progress.shouldRefresh) {
            loadAllDataDebounced();
          }
        }
      };
      
      // 启动分类（按内容）。forceLocal=true 走设备端离线模型，否则走配置的在线大模型
      const result = await galleryScannerService.aiImageClassifyByContent(new Date(), null, { forceLocal });

      logger.debug('✅ AI分类完成');
      setGlobalMessage(t('home.aiClassificationComplete'));

      // 分类完成后，清除防抖定时器并立即刷新数据（避免与进度回调中的刷新重复）
      if (loadDataDebounceTimerRef.current) {
        clearTimeout(loadDataDebounceTimerRef.current);
        loadDataDebounceTimerRef.current = null;
      }
      // 等待一小段时间，确保进度回调中的刷新已完成
      await new Promise(resolve => setTimeout(resolve, 600));
      // 执行最终刷新
      await loadAllData();

      // 兜底：在线大模型分类有失败（仍有图片待分类）→ 提示改用离线模型
      const failedCount = result && typeof result.failedCount === 'number' ? result.failedCount : 0;
      if (!forceLocal && failedCount > 0) {
        logger.warn(`⚠️ 大模型分类仍有 ${failedCount} 张失败，提示离线兜底`);
        promptLocalFallback(t('home.aiClassifyLLMFailMessage', { count: failedCount }));
      }
    } catch (error) {
      logger.error('❌ AI分类失败:', error);
      setGlobalMessage(t('home.aiClassificationFailed', { error: error.message }));
      if (!forceLocal) {
        // 在线大模型分类整体出错 → 提示改用离线模型兜底
        promptLocalFallback(t('home.aiClassifyLLMFailMessageGeneric', { error: error.message || '' }));
      } else {
        Alert.alert(t('home.aiClassificationFailed', { error: '' }), error.message);
      }
    } finally {
      // 释放唤醒锁
      await WakeLockService.release();
      setIsScanning(false);
      // 🔥 清除全局变量
      if (typeof window !== 'undefined') {
        window.isScanning = false;
      }
    }
  };

  /**
   * 触发扫描
   */
  const handleScan = async () => {
    try {
      // 先检查并请求权限
      const hasPermission = await checkAndRequestPermissions();
      if (!hasPermission) {
        logger.warn('⚠️ 没有相册访问权限，取消扫描');
        return;
      }

      // 查询会员状态，非会员提示并限制比较数量
      let compareLimitOption = null;
      try {
        const { isMember } = await WeChatAuthService.getMembershipStatus();
        if (!isMember) {
          setShowScanTip(true);
          setTimeout(() => setShowScanTip(false), 4000);
          compareLimitOption = { compareLimit: 100 };
        }
      } catch (e) {
        logger.debug('会员状态查询失败，按非会员处理:', e?.message || e);
        setShowScanTip(true);
        setTimeout(() => setShowScanTip(false), 4000);
        compareLimitOption = { compareLimit: 100 };
      }

      setIsScanning(true);
      // 🔥 设置全局变量，供设置页面检查扫描状态
      if (typeof window !== 'undefined') {
        window.isScanning = true;
      }
      setGlobalMessage(t('common.initializing'));
      logger.debug('🔍 开始扫描相册...');
      
      // 使用唤醒锁防止手机休眠影响扫描性能
      const wakeLockAcquired = await WakeLockService.acquire(30 * 60 * 1000); // 30分钟超时
      if (wakeLockAcquired) {
        logger.info('🔋 已获取唤醒锁，防止手机休眠影响扫描性能');
      }
      
      const galleryScannerService = new GalleryScannerService();
      
      // 🆕 检查使用的扫描版本
      const scanVersion = galleryScannerService.getScanVersion();
      const isNativeScan = galleryScannerService.isUsingNativeScan();
      logger.info(`📱 扫描服务版本: ${scanVersion}`);
      logger.info(`📱 是否使用原生扫描: ${isNativeScan ? '是 ✅' : '否 ❌'}`);
      
      // 初始化服务
      await galleryScannerService.initialize();
      
      // 开始扫描，显示进度（使用和PC端一致的进度消息）
      await galleryScannerService.scanGalleryWithProgress((progress) => {
        // progress已经包含了simpleMessage字段，这是PC端格式化后的消息
        if (progress) {
          const message = progress.simpleMessage || progress.message || '处理中...';
          setGlobalMessage(message);
          
          // 🆕 检查是否需要刷新页面数据（缓存重建已在 processProgressData 中完成）
          if (progress.shouldRefresh) {
            // 使用 setTimeout 确保状态更新不被阻塞
            setTimeout(async () => {
              try {
                // 只刷新页面数据，不重建缓存（缓存重建已在 processProgressData 中完成）
                await loadAllData();
              } catch (error) {
                logger.error('❌ 刷新页面数据失败:', error);
              }
            }, 0);
          }
        }
      }, compareLimitOption);
      
      logger.debug('✅ 扫描完成');
      setGlobalMessage(t('home.scanCompleteRefreshing'));
      
      // 扫描完成后刷新数据
      await onRefresh();
      
      // 加载最近扫描信息
      await loadLastScanTime();
    } catch (error) {
      // 🔥 如果是"扫描已在进行中"的错误，静默处理，不显示错误提示
      if (error.message && error.message.includes(t('home.scanAlreadyInProgress'))) {
        logger.info('ℹ️ 扫描已在进行中，跳过新扫描请求');
        return; // 静默返回，不显示错误
      }
      
      logger.error('❌ 扫描失败:', error);
      setGlobalMessage(t('home.scanFailed', { error: error.message }));
      Alert.alert(t('home.scanFailed', { error: '' }), error.message);
    } finally {
      // 释放唤醒锁
      await WakeLockService.release();
      setIsScanning(false);
      // 🔥 清除全局变量
      if (typeof window !== 'undefined') {
        window.isScanning = false;
      }
    }
  };

  /**
   * 导出日志
   */
  const handleExportLogs = useCallback(async () => {
    try {
      logger.info('开始导出日志...');
      
      // 获取 JS 层日志
      const jsLogs = logger.getAllLogs();
      const jsLogCount = logger.getLogCount();
      
      // 获取原生层日志
      let nativeLogs = [];
      let nativeLogCount = 0;
      let nativeFileLogContent = '';
      let nativeFileLogPath = '';
      
      try {
        const { NativeLogExportModule } = NativeModules;
        if (NativeLogExportModule && NativeLogExportModule.exportNativeLogs) {
          const nativeLogData = await NativeLogExportModule.exportNativeLogs();
          nativeLogs = nativeLogData.memoryLogs || [];
          nativeLogCount = nativeLogData.memoryLogCount || 0;
          nativeFileLogContent = nativeLogData.fileLogContent || '';
          nativeFileLogPath = nativeLogData.fileLogPath || '';
        }
      } catch (nativeLogError) {
        logger.warn('获取原生日志失败:', nativeLogError);
      }
      
      const totalLogCount = jsLogCount + nativeLogCount;
      
      if (totalLogCount === 0) {
        Alert.alert(t('common.tip'), '暂无日志可导出');
        return;
      }

      // 合并日志内容
      const allLogs = [
        '=== ImagePilot日志导出 ===',
        `导出时间: ${new Date().toLocaleString('zh-CN')}`,
        `JS日志条数: ${jsLogCount}`,
        `原生日志条数: ${nativeLogCount}`,
        `总日志条数: ${totalLogCount}`,
        `平台: ${Platform.OS} ${Platform.Version || ''}`,
        '',
        '=== JS层日志 ===',
        '',
        jsLogs || '暂无JS日志',
        '',
        '=== 原生层内存日志 ===',
        '',
        nativeLogs.length > 0 ? nativeLogs.join('\n') : '暂无原生内存日志',
        '',
      ];
      
      // 添加文件日志（只有一个文件）
      if (nativeFileLogContent) {
        allLogs.push('=== 原生层文件日志 ===');
        if (nativeFileLogPath) {
          allLogs.push(`文件路径: ${nativeFileLogPath}`);
        }
        allLogs.push('');
        allLogs.push(nativeFileLogContent);
        allLogs.push('');
      }
      
      const appInfo = allLogs.join('\n');

      // 在开始时获取并验证路径
      const cacheDir = RNFS.CachesDirectoryPath;
      if (!cacheDir) {
        throw new Error('无法获取缓存目录路径');
      }
      
      // 确保目录存在
      const dirExists = await RNFS.exists(cacheDir);
      if (!dirExists) {
        try {
          await RNFS.mkdir(cacheDir);
          // 验证目录是否真的创建成功
          const verifyDirExists = await RNFS.exists(cacheDir);
          if (!verifyDirExists) {
            throw new Error('创建缓存目录失败');
          }
        } catch (mkdirError) {
          logger.error('创建缓存目录失败:', mkdirError);
          throw new Error(`创建缓存目录失败: ${mkdirError.message}`);
        }
      }

      // 创建日志文件
      const fileName = `xintu_logs_${Date.now()}.txt`;
      const filePath = `${cacheDir}/${fileName}`;

      // 写入文件
      // 添加 UTF-8 BOM（\uFEFF）确保文本编辑器能正确识别编码，避免中文乱码
      const contentWithBOM = '\uFEFF' + appInfo;
      await RNFS.writeFile(filePath, contentWithBOM, 'utf8');
      
      // 验证文件是否真的写入了
      const fileExists = await RNFS.exists(filePath);
      if (!fileExists) {
        throw new Error('文件写入失败：文件不存在');
      }
      
      // 验证文件大小
      const fileStat = await RNFS.stat(filePath);
      if (fileStat.size === 0) {
        throw new Error('文件写入失败：文件大小为0');
      }
      
      logger.info(`日志文件已保存: ${filePath}, 大小: ${fileStat.size} 字节`);

      // 使用 FileProvider URI 分享文件
      try {
        const { MultiImageShareModule } = NativeModules;
        if (MultiImageShareModule && MultiImageShareModule.shareFile) {
          // 使用原生模块分享文件（使用 FileProvider URI）
          await MultiImageShareModule.shareFile(filePath, 'text/plain', 'ImagePilot日志');
          logger.info('✅ 日志文件分享成功');
          
          // 提示文件位置
          setTimeout(() => {
            Alert.alert(
              t('common.tip'),
              `日志文件已保存并分享:\n${filePath}\n\n文件大小: ${(appInfo.length / 1024).toFixed(2)} KB`
            );
          }, 500);
        } else {
          // 原生模块不可用，回退到文本分享
          await Share.share({
            message: appInfo.length > 10000 
              ? appInfo.substring(0, 10000) + '\n\n... (日志过长，已截断，完整日志已保存到文件)'
              : appInfo,
            title: 'ImagePilot日志',
          });
          
          setTimeout(() => {
            Alert.alert(
              t('common.tip'),
              `日志文件已保存到:\n${filePath}\n\n文件大小: ${(appInfo.length / 1024).toFixed(2)} KB\n\n您可以通过文件管理器访问此文件。`
            );
          }, 500);
        }
      } catch (shareError) {
        logger.error('分享日志失败:', shareError);
        // 如果分享失败，显示文件位置
        Alert.alert(
          t('common.tip'),
          `日志已保存到:\n${filePath}\n\n文件大小: ${(appInfo.length / 1024).toFixed(2)} KB\n\n您可以通过文件管理器访问此文件。`
        );
      }
    } catch (error) {
      logger.error('导出日志失败:', error);
      Alert.alert(t('common.error'), `导出日志失败: ${error.message}`);
    }
  }, [t]);

  // ==================== 渲染函数 ====================


  /**
   * 获取分类显示名称（根据当前语言动态获取）
   */
  const getCategoryDisplayName = useCallback((categoryId) => {
    // 优先匹配用户自定义分类（自定义只有一个 name 字段，无中英区分）
    const custom = customCategoryList.find((c) => c.id === categoryId);
    if (custom) return custom.name;

    if (!configService || !configService.isConfigLoaded()) {
      return categoryId;
    }

    const currentLang = i18n.language || 'zh';
    const categoryConfig = configService.getAllCategoriesWithUI().find(cat => cat.id === categoryId);

    if (categoryConfig) {
      return currentLang === 'en'
        ? (categoryConfig.english || categoryConfig.chinese || categoryId)
        : (categoryConfig.chinese || categoryConfig.english || categoryId);
    }

    // 如果找不到配置，尝试使用 configService 的方法
    try {
      const language = currentLang === 'en' ? 'english' : 'chinese';
      return configService.getCategoryDisplayName(categoryId, language) || categoryId;
    } catch (e) {
      return categoryId;
    }
  }, [i18n.language, customCategoryList]);

  /**
   * 渲染分类卡片（与PC端一致的设计）
   */
  const renderCategoryCard = (category) => {
    // 动态获取分类名称（根据当前语言）
    const categoryName = getCategoryDisplayName(category.id);
    
    // 检查是否为NA分类（待分类）
    const isNACategory = category.id === 'NA';
    
    return (
      <TouchableOpacity
        key={category.id}
        style={styles.categoryCard}
        onPress={() => {
          try {
            // 🆕 添加空值检查
            if (!category || !category.id || !navigation) {
              logger.warn('❌ 分类数据无效或导航对象为空:', { category, navigation: !!navigation });
              return;
            }
            
            logger.debug('📁 点击分类卡片:', category.id);
            // 注意：暂存箱不是分类，不会出现在分类列表中，所以这里不需要判断 stagingBox
            navigation.navigate('Category', {
              filterType: 'category',
              filterValue: category.id,
              fromScreen: 'Home',
            });
          } catch (error) {
            logger.error('❌ 分类卡片点击失败:', error);
          }
        }}
        onLongPress={() => {
          // 长按NA分类卡片时启动AI分类
          if (isNACategory) {
            logger.debug('🤖 长按待分类卡片，启动AI分类');
            handleAIClassifyNA();
          }
        }}
      >
        {/* 缩略图占满整个卡片 */}
        {category.recentImages && category.recentImages.length > 0 ? (
          <Image
            source={{ uri: getUri(category.recentImages[0]) || category.recentImages[0]?.uri }}
            style={styles.thumbnail}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.thumbnail, { backgroundColor: category.color, alignItems: 'center', justifyContent: 'center' }]}>
            <SkeuomorphicCamera size={Math.round((SCREEN_WIDTH - 28) / 4 * 0.52)} tint="rgba(255,255,255,0.92)" />
          </View>
        )}
        
        {/* 覆盖层显示分类信息 */}
        <View style={styles.categoryOverlay}>
          <Text style={styles.categoryName} numberOfLines={1}>{categoryName}</Text>
          <Text style={styles.categoryCount}>{category.count}</Text>
        </View>
        
        {/* NA分类长按提示 - 右上角徽章 */}
        {isNACategory && category.count > 0 && (
          <View style={styles.naCategoryBadge}>
            <Text style={styles.naCategoryBadgeText}>👆</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  /**
   * 渲染按时间区（图片卡片，与按城市一致，在按内容之前）
   */
  const renderTimeSection = () => {
    const nowYear = new Date().getFullYear();
    const timeOrder = ['thisWeek', 'thisMonth', 'thisYear', 'lastYear', 'yearBeforeLast', String(nowYear - 3), String(nowYear - 4), 'past'];
    const timeKeysToShow = timeOrder.filter((k) => (timeCounts || {})[k] > 0);
    if (timeKeysToShow.length === 0) return null;
    const getTimeLabel = (key) => {
      if (/^\d{4}$/.test(key)) return t('home.yearLabel', { year: key });
      return t(`home.${key}`);
    };
    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleContainer}>
            <Text style={styles.sectionTitle}><SectionIcon name="calendar-outline" emoji="📅" /> {t('home.byTime')}</Text>
          </View>
        </View>
        <View style={styles.categoriesGrid}>
          {timeKeysToShow.map((timeKey) => (
            <TimeCard
              key={timeKey}
              timeKey={timeKey}
              label={getTimeLabel(timeKey)}
              count={timeCounts[timeKey] || 0}
              recentImages={timeRecentImages[timeKey] || []}
              onPress={(key) => {
                if (!navigation) return;
                navigation.navigate('Category', {
                  filterType: 'time',
                  filterValue: key,
                  fromScreen: 'Home',
                });
              }}
            />
          ))}
        </View>
      </View>
    );
  };

  /**
   * 渲染按内容分类区（4列网格，含按颜色芯片合并展示）
   */
  const renderCategoriesSection = () => {
    // 在渲染时根据 hideEmptyCategories 状态过滤分类（只用一个变量）
    const filteredCategories = hideEmptyCategories 
      ? categories.filter(cat => cat.count > 0)
      : categories;
    
    const hasUnclassifiedPhotos = categories.some(cat => cat.id === 'NA' && cat.count > 0);
    const filteredColors = BACKGROUND_COLORS.filter((color) => (colorCounts[color] || 0) > 0)
      .sort((a, b) => (colorCounts[b] || 0) - (colorCounts[a] || 0));
    const hasContent = filteredCategories.length > 0 || filteredColors.length > 0;

    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleColumn}>
            <Text style={styles.sectionTitle}><SectionIcon name="pricetags-outline" emoji="🏷️" /> {t('home.byContent')}</Text>
            {hasUnclassifiedPhotos && (
              <Text style={styles.sectionHint}>{t('home.longPressUnclassifiedHint')}</Text>
            )}
          </View>
          <TouchableOpacity 
            style={[styles.toggleButton, styles.toggleButtonNoShrink]}
            onPress={toggleHideEmptyCategories}
          >
            <Text style={styles.toggleButtonText}>
              {hideEmptyCategories ? t('home.showEmptyCategories') : t('home.hideEmptyCategories')}
            </Text>
            </TouchableOpacity>
        </View>
        
        {!hasContent ? (
          <View style={styles.emptyState}>
            <View style={{ marginBottom: 10 }}><SkeuomorphicCamera size={60} scheme="onLight" /></View>
            <Text style={styles.emptyStateText}>{t('home.noCategoryImages')}</Text>
            <Text style={styles.emptyStateSubtext}>{t('home.scanOrAdjustSettings')}</Text>
          </View>
        ) : (
          <>
            {filteredCategories.length > 0 && (
              <View style={styles.categoriesGrid}>
                {filteredCategories.map(renderCategoryCard)}
              </View>
            )}
            {filteredColors.length > 0 && (
              <View style={[styles.colorChipsContainer, { marginTop: filteredCategories.length > 0 ? 12 : 0 }]}>
                {filteredColors.map((color) => renderColorChip(color))}
              </View>
            )}
          </>
        )}
      </View>
    );
  };

  /**
   * 渲染相似组芯片（展开更多时使用，无缩略图，格式：相似组 · 12）
   */
  const renderSimilarityGroupChip = (group) => (
    <TouchableOpacity
      key={group.groupId}
      style={styles.attributeChip}
      onPress={() => {
        try {
          if (!group?.groupId || !navigation) return;
          navigation.navigate('Category', {
            filterType: 'similarityGroup',
            filterValue: group.groupId,
            fromScreen: 'SimilarityGroup',
          });
        } catch (error) {
          logger.error('❌ 相似组芯片点击失败:', error);
        }
      }}
    >
      <Text style={styles.attributeChipName} numberOfLines={1}>
        {t('home.similarityGroupChip', { count: group.imageCount || 0 })}
      </Text>
    </TouchableOpacity>
  );

  /**
   * 渲染相似组卡片（与 PC 端保持一致：显示 1 张代表图片）
   */
  const renderSimilarityGroupCard = (group) => (
    <TouchableOpacity
      key={group.groupId}
      style={styles.categoryCard}
      onPress={() => {
        try {
          // 🆕 添加空值检查
          if (!group || !group.groupId || !navigation) {
            logger.warn('❌ 相似组数据无效或导航对象为空:', { group, navigation: !!navigation });
            return;
          }
          
          logger.debug('🔗 点击相似组卡片:', group.groupId);
          navigation.navigate('Category', {
            filterType: 'similarityGroup',
            filterValue: group.groupId,
            fromScreen: 'SimilarityGroup',
          });
        } catch (error) {
          logger.error('❌ 相似组卡片点击失败:', error);
        }
      }}
    >
      {/* 缩略图占满整个卡片 */}
      {group.latestImageUri ? (
        <Image
          source={{ uri: group.latestImageUri }}
          style={styles.thumbnail}
          resizeMode="cover"
          onError={(error) => {
            logger.error(`❌ 相似组缩略图加载失败:`, { 
              groupId: group.groupId, 
              latestImageUri: group.latestImageUri,
              error: error.nativeEvent?.error || error
            });
          }}
        />
      ) : (
        <View style={[styles.thumbnail, { backgroundColor: '#9C27B0' }]}>
          <Text style={styles.emptyThumbnailText}>🔗</Text>
        </View>
      )}
      
      {/* 覆盖层显示相似照片信息（与 PC 端一致）*/}
      <View style={styles.categoryOverlay}>
        <Text style={styles.categoryName}>{t('home.similarPhotos')}</Text>
        <Text style={styles.categoryCount}>{group.imageCount}</Text>
        </View>
    </TouchableOpacity>
  );

  /**
   * 渲染相似照片区（与"按内容"保持一致：4列网格布局）
   */
  const renderSimilarityGroupsSection = () => {
    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleContainer}>
            <Text style={styles.sectionTitle}><SectionIcon name="copy-outline" emoji="🔗" /> {t('home.similarPhotos')}</Text>
          </View>
          {similarityGroups && similarityGroups.length > 0 && (
            <View style={styles.headerButtonsContainer}>
              <TouchableOpacity 
                style={[
                  styles.toggleButton,
                  (isScanning || isSimilarityDetecting) && styles.toggleButtonDisabled
                ]}
                onPress={handleStartSimilarityDetection}
                disabled={isScanning || isSimilarityDetecting}
              >
                <Text style={[
                  styles.toggleButtonText,
                  (isScanning || isSimilarityDetecting) && styles.toggleButtonTextDisabled
                ]}>{t('home.recheck')}</Text>
              </TouchableOpacity>
              {similarityGroups.length > 8 && !showAllSimilarityGroups && (
                <TouchableOpacity
                  style={styles.toggleButton}
                  onPress={() => {
                    logger.debug('点击更多按钮，展开所有相似组，当前数量:', similarityGroups.length);
                    setShowAllSimilarityGroups(true);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.toggleButtonText}>{t('home.showMore')}</Text>
                </TouchableOpacity>
              )}
              {showAllSimilarityGroups && similarityGroups.length > 8 && (
                <TouchableOpacity
                  style={styles.toggleButton}
                  onPress={() => {
                    logger.debug('点击收起按钮，收起相似组');
                    setShowAllSimilarityGroups(false);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.toggleButtonText}>{t('home.showLess')}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
        
        {similarityGroups && similarityGroups.length > 0 ? (
          showAllSimilarityGroups ? (
            // 展开更多时使用芯片流式布局，无缩略图，可显示全部相似组
            <View style={[styles.attributesContainer, { paddingTop: 0 }]}>
              <View style={styles.attributeRow}>
                {similarityGroups.map(renderSimilarityGroupChip)}
              </View>
            </View>
          ) : (
            <View style={styles.categoriesGrid}>
              {similarityGroups.slice(0, 8).map(renderSimilarityGroupCard)}
            </View>
          )
        ) : (
          <View style={styles.emptyState}>
            {HomeIonicons ? <HomeIonicons name="copy-outline" size={48} color="#C7C7CC" style={{ marginBottom: 12 }} /> : <Text style={styles.emptyStateIcon}>🔗</Text>}
            <Text style={styles.emptyStateText}>
              {isSimilarityDetecting ? t('home.similarityDetectionInProgress') : t('home.noSimilarityGroups')}
            </Text>
            {!isSimilarityDetecting && (
              <Text style={styles.emptyStateSubtext}>{t('home.startSimilarityDetectionHint')}</Text>
            )}
            <TouchableOpacity
              style={[
                styles.startSimilarityButton,
                (isScanning || isSimilarityDetecting) && styles.startSimilarityButtonDisabled
              ]}
              onPress={handleStartSimilarityDetection}
              disabled={isScanning || isSimilarityDetecting}
            >
              <Text style={[
                styles.startSimilarityButtonText,
                (isScanning || isSimilarityDetecting) && styles.startSimilarityButtonTextDisabled
              ]}>
                {isSimilarityDetecting ? t('home.similarityDetectionInProgress') : t('home.startSimilarityDetection')}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  /**
   * 渲染颜色芯片（色块+名称+数量，无缩略图，提升性能）
   */
  const renderColorChip = (color) => {
    const count = colorCounts[color] || 0;
    const hex = COLOR_NAME_TO_HEX[color] || '#9E9E9E';
    
    return (
      <TouchableOpacity
        key={color}
        style={styles.colorChip}
        onPress={() => {
          try {
            if (!color || !navigation) {
              logger.warn('❌ 颜色数据无效或导航对象为空:', { color, navigation: !!navigation });
              return;
            }
            logger.debug('🎨 点击颜色芯片:', color);
            navigation.navigate('Category', {
              filterType: 'color',
              filterValue: color,
              fromScreen: 'Home',
            });
          } catch (error) {
            logger.error('❌ 颜色芯片点击失败:', error);
          }
        }}
      >
        <View style={[styles.colorChipSwatch, { backgroundColor: hex }]} />
        <Text style={styles.colorChipName} numberOfLines={1}>{getColorNameTranslation(color, i18n.language)}</Text>
        <Text style={styles.colorChipCount}>{count}</Text>
      </TouchableOpacity>
    );
  };

  /**
   * 渲染属性芯片（通用：名称+数量，无缩略图）
   */
  const renderAttributeChip = (filterType, filterValue, displayName, count) => (
    <TouchableOpacity
      key={`${filterType}-${filterValue}`}
      style={styles.attributeChip}
      onPress={() => {
        try {
          if (!filterValue || !navigation) return;
          navigation.navigate('Category', {
            filterType,
            filterValue,
            fromScreen: 'Home',
          });
        } catch (error) {
          logger.error(`❌ 属性芯片点击失败:`, error);
        }
      }}
    >
      <Text style={styles.attributeChipName} numberOfLines={1}>{displayName}</Text>
      <Text style={styles.attributeChipCount}>{count}</Text>
    </TouchableOpacity>
  );

  /**
   * 渲染按属性区（合并存储/格式/分辨率/方向，四行芯片，无缩略图无子标题）
   */
  const renderAttributesSection = () => {
    const dirItems = Object.entries(directoryCounts)
      .filter(([d]) => d && typeof d === 'string' && d.trim() && d !== 'null' && d !== 'undefined')
      .sort(([,a], [,b]) => b - a);
    const formatItems = Object.entries(formatCounts)
      .filter(([f]) => f && typeof f === 'string' && f.trim() && f !== 'null' && f !== 'UNKNOWN')
      .sort(([,a], [,b]) => b - a);
    const resolutionItems = Object.entries(resolutionCounts)
      .filter(([r]) => r && typeof r === 'string' && r.trim() && r !== 'null' && r !== 'UNKNOWN')
      .sort(([,a], [,b]) => b - a);
    const orientationItems = Object.entries(orientationCounts)
      .filter(([o]) => o && typeof o === 'string' && o.trim() && o !== 'null' && o !== 'UNKNOWN')
      .sort(([,a], [,b]) => b - a);

    const hasDir = dirItems.length > 0;
    const hasFormat = formatItems.length > 0;
    const hasResolution = resolutionItems.length > 0;
    const hasOrientation = orientationItems.length > 0;

    if (!hasDir && !hasFormat && !hasResolution && !hasOrientation) return null;

    return (
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { marginBottom: 12, paddingHorizontal: 16 }]}><SectionIcon name="list-outline" emoji="📋" /> {t('home.byAttributes')}</Text>
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
                {formatItems.map(([format]) => renderAttributeChip('format', format, format, formatCounts[format] || 0))}
              </View>
            </View>
          )}
          {hasResolution && (
            <View style={styles.attributeSubBlock}>
              <Text style={styles.attributeSubLabel}>{t('home.byResolution')}</Text>
              <View style={styles.attributeRow}>
                {resolutionItems.map(([resolution]) => renderAttributeChip('resolution', resolution, resolution, resolutionCounts[resolution] || 0))}
              </View>
            </View>
          )}
          {hasOrientation && (
            <View style={styles.attributeSubBlock}>
              <Text style={styles.attributeSubLabel}>{t('home.byOrientation')}</Text>
              <View style={styles.attributeRow}>
                {orientationItems.map(([orientation]) => renderAttributeChip('orientation', orientation, getOrientationNameTranslation(orientation, i18n.language), orientationCounts[orientation] || 0))}
              </View>
            </View>
          )}
        </View>
      </View>
    );
  };

  /**
   * 渲染城市卡片（与 PC 端一致：CityCard 根据 locationId + 语言自行获取显示名）
   */
  const renderCityCard = (city) => (
    <CityCard
      key={city.locationId}
      locationId={city.locationId}
      count={city.count}
      latestImageUri={city.latestImageUri}
      onPress={() => {
        if (!city?.locationId || !navigation) return;
        navigation.navigate('Category', {
          filterType: 'city',
          filterValue: city.locationId,
          fromScreen: 'Home',
        });
      }}
    />
  );

  /**
   * 渲染按拍摄参数区（合并 ISO/光圈/快门/焦距，四行芯片，样式与按属性一致）
   */
  const renderShootingParamsSection = () => {
    const currentLang = i18n.language || 'zh';
    const isoItems = Object.entries(isoCounts)
      .filter(([i]) => i && typeof i === 'string' && i.trim() && i !== 'null' && i !== 'UNKNOWN')
      .sort(([,a], [,b]) => b - a);
    const apertureItems = Object.entries(apertureCounts)
      .filter(([a]) => a && typeof a === 'string' && a.trim() && a !== 'null' && a !== 'UNKNOWN')
      .sort(([,a], [,b]) => b - a);
    const shutterItems = Object.entries(shutterCounts)
      .filter(([s]) => s && typeof s === 'string' && s.trim() && s !== 'null' && s !== 'UNKNOWN')
      .sort(([,a], [,b]) => b - a);
    const focalLengthItems = Object.entries(focalLengthCounts)
      .filter(([f]) => f && typeof f === 'string' && f.trim() && f !== 'null' && f !== 'UNKNOWN')
      .sort(([,a], [,b]) => b - a);

    const hasISO = isoItems.length > 0;
    const hasAperture = apertureItems.length > 0;
    const hasShutter = shutterItems.length > 0;
    const hasFocalLength = focalLengthItems.length > 0;

    if (!hasISO && !hasAperture && !hasShutter && !hasFocalLength) return null;

    return (
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { marginBottom: 12, paddingHorizontal: 16 }]}><SectionIcon name="aperture-outline" emoji="📸" /> {t('home.byShootingParams')}</Text>
        <View style={styles.attributesContainer}>
          {hasISO && (
            <View style={styles.attributeSubBlock}>
              <Text style={styles.attributeSubLabel}>{t('home.byISO')}</Text>
              <View style={styles.attributeRow}>
                {isoItems.map(([iso]) => renderAttributeChip('iso', iso, getCameraSettingsCategoryTranslation('iso', iso, currentLang) || iso, isoCounts[iso] || 0))}
              </View>
            </View>
          )}
          {hasAperture && (
            <View style={styles.attributeSubBlock}>
              <Text style={styles.attributeSubLabel}>{t('home.byAperture')}</Text>
              <View style={styles.attributeRow}>
                {apertureItems.map(([aperture]) => renderAttributeChip('aperture', aperture, getCameraSettingsCategoryTranslation('aperture', aperture, currentLang) || aperture, apertureCounts[aperture] || 0))}
              </View>
            </View>
          )}
          {hasShutter && (
            <View style={styles.attributeSubBlock}>
              <Text style={styles.attributeSubLabel}>{t('home.byShutter')}</Text>
              <View style={styles.attributeRow}>
                {shutterItems.map(([shutter]) => renderAttributeChip('shutter', shutter, getCameraSettingsCategoryTranslation('shutter', shutter, currentLang) || shutter, shutterCounts[shutter] || 0))}
              </View>
            </View>
          )}
          {hasFocalLength && (
            <View style={styles.attributeSubBlock}>
              <Text style={styles.attributeSubLabel}>{t('home.byFocalLength')}</Text>
              <View style={styles.attributeRow}>
                {focalLengthItems.map(([focalLength]) => renderAttributeChip('focalLength', focalLength, getCameraSettingsCategoryTranslation('focalLength', focalLength, currentLang) || focalLength, focalLengthCounts[focalLength] || 0))}
              </View>
            </View>
          )}
        </View>
      </View>
    );
  };

  /**
   * 渲染按城市区（与"按内容"保持一致：4列网格布局）
   */
  const renderCitiesSection = () => {
    // 按照片数量降序排列，显示最多的城市在前
    const sortedCities = cities && cities.length > 0
      ? [...cities].sort((a, b) => (b.count || 0) - (a.count || 0))
      : [];
    const displayCities = showAllCities ? sortedCities : sortedCities.slice(0, 8);
    
    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleContainer}>
            <Text style={styles.sectionTitle}><SectionIcon name="location-outline" emoji="🏙️" /> {t('home.byCity')}</Text>
          </View>
          {cities && cities.length > 0 && (
            <View style={styles.headerButtonsContainer}>
              <TouchableOpacity 
                style={[
                  styles.toggleButton,
                  isScanning && styles.toggleButtonDisabled
                ]}
                onPress={handleStartLocationEnrichment}
                disabled={isScanning}
              >
                <Text style={[
                  styles.toggleButtonText,
                  isScanning && styles.toggleButtonTextDisabled
                ]}>{t('home.recheck')}</Text>
              </TouchableOpacity>
              {sortedCities.length > 8 && !showAllCities && (
                <TouchableOpacity
                  style={styles.toggleButton}
                  onPress={() => setShowAllCities(true)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.toggleButtonText}>{t('home.showMore')}</Text>
                </TouchableOpacity>
              )}
              {showAllCities && sortedCities.length > 8 && (
                <TouchableOpacity
                  style={styles.toggleButton}
                  onPress={() => setShowAllCities(false)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.toggleButtonText}>{t('home.showLess')}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
        
        {cities && cities.length > 0 ? (
          <View style={styles.categoriesGrid}>
            {displayCities.map(renderCityCard)}
          </View>
        ) : (
          <View style={styles.emptyState}>
            {HomeIonicons ? <HomeIonicons name="location-outline" size={48} color="#C7C7CC" style={{ marginBottom: 12 }} /> : <Text style={styles.emptyStateIcon}>🏙️</Text>}
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
    );
  };

  /**
   * 渲染新发现的照片（从上次扫描之后新发现的照片）
   */
  const renderRecentPhotos = () => {
    // 从图片对象中提取目录名的辅助函数
    const getDirectoryName = (image) => {
      if (!image) return t('home.unknownDirectory');
      
      // 使用 getLocalPath 提取路径（支持 contentUri||path 格式）
      const path = getLocalPath(image);
      if (!path) {
        return t('home.unknownDirectory');
      }
      
      // 从路径中提取目录名（倒数第二级目录）
      // 例如：/storage/emulated/0/DCIM/Camera/IMG_001.jpg -> Camera
      // 或者：DCIM/Camera/IMG_001.jpg -> Camera
      const pathParts = path.split('/').filter(p => p && p.trim());
      if (pathParts.length >= 2) {
        // 取倒数第二级目录
        return pathParts[pathParts.length - 2];
      } else if (pathParts.length === 1) {
        return pathParts[0];
      }
      return t('home.unknownDirectory');
    };
    
    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleContainer}>
            <Text style={styles.sectionTitle}><SectionIcon name="images-outline" emoji="📸" /> {t('home.recentDiscoveredPhotos')}</Text>
            {recentImagesTotal > 0 && (
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{recentImagesTotal}</Text>
              </View>
            )}
          </View>
          <TouchableOpacity 
            style={styles.toggleButton}
            onPress={refreshNewDiscoveredImages}
          >
            <Text style={styles.toggleButtonText}>{t('home.recheck')}</Text>
          </TouchableOpacity>
        </View>
        
        {recentImages.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={{ marginBottom: 10 }}><SkeuomorphicCamera size={60} scheme="onLight" /></View>
            <Text style={styles.emptyStateText}>{t('home.noNewPhotos')}</Text>
            <Text style={styles.emptyStateSubtext}>{t('home.clickScanButtonToStart')}</Text>
          </View>
        ) : (
          <View style={styles.recentGrid}>
            {recentImages.map((image, index) => {
              const directoryName = getDirectoryName(image);
              
              return (
                <View
                  key={image.id || image.uri || index}
                  style={styles.recentGridItem}
                >
                  <Image
                    source={{ uri: getUri(image) || image?.uri }}
                    style={styles.recentGridImage}
                    resizeMode="cover"
                  />
                  {/* 目录标签覆盖层 */}
                  <View style={styles.categoryOverlay}>
                    <Text style={styles.categoryName} numberOfLines={1}>
                      {directoryName}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>
    );
  };

  /**
   * 渲染FAB扫描按钮
   */
  const renderFAB = () => (
    <>
      {/* 扫描按钮 */}
      <TouchableOpacity
        style={styles.fab}
        onPress={handleScan}
        disabled={isScanning}
      >
        {isScanning ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : HomeIonicons ? (
          <HomeIonicons name="sync" size={28} color="#FFFFFF" />
        ) : (
          <Text style={styles.fabIcon}>🔄</Text>
        )}
      </TouchableOpacity>
      {showScanTip && (
        <View style={styles.scanTipContainer}>
          <Text style={styles.scanTipText}>{t('home.scanTip')}</Text>
        </View>
      )}
    </>
  );

  // ==================== 主渲染 ====================

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>{t('common.loading')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* 顶部导航栏 */}
      <View style={styles.header}>
        <Pressable
          onLongPress={handleExportLogs}
          style={styles.headerTitleContainer}
        >
          <Text style={styles.headerTitle}>{t('app.name')}</Text>
        </Pressable>
      </View>

      {/* 消息提示区 */}
      <View style={styles.messageBanner}>
        <Text style={styles.messageText}>{globalMessage}</Text>
        </View>

      {/* 主内容区 */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl 
            refreshing={refreshing} 
            onRefresh={onRefresh}
            enabled={!isScanning}
          />
        }
      >
        {renderTimeSection()}
        {renderCategoriesSection()}
        {renderCitiesSection()}
        {renderSimilarityGroupsSection()}
        {renderAttributesSection()}
        {renderShootingParamsSection()}
        {renderRecentPhotos()}
      </ScrollView>

      {/* FAB扫描按钮 */}
      {renderFAB()}
    </SafeAreaView>
  );
};

// ==================== 样式 ====================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#8E8E93',
  },
  header: {
    height: 56,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  headerTitleContainer: {
    // 让标题可以长按
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000000',
  },
  // 消息提示区样式
  messageBanner: {
    padding: 12,
    paddingTop: 8,
    paddingBottom: 8,
  },
  messageText: {
    fontSize: 12,
    color: '#666666',
    textAlign: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100, // 为FAB留出空间
  },
  
  // 区块样式（iOS 分组：白底全宽 + 组间留白；保持全宽以兼容网格宽度计算）
  section: {
    backgroundColor: '#FFFFFF',
    marginTop: 12,
    paddingVertical: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 16, // 增加标题和卡片的间距
  },
  sectionTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    flexShrink: 1,
    minWidth: 0, // 允许 flex 子项收缩到小于内容宽度
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000000',
    // 注意：当 sectionTitle 在 sectionHeader 内部时，不需要额外的 padding
    // 当单独使用时，需要通过内联样式添加 paddingHorizontal: 16
  },
  sectionTitleColumn: {
    flexDirection: 'column',
    gap: 2,
    flex: 1,
    flexShrink: 1,
    minWidth: 0, // 允许收缩，避免英文长文本时按钮溢出屏幕
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: 6,
  },
  sectionHint: {
    fontSize: 12,
    color: '#666666',
    fontWeight: '400',
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
  headerButtonsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0, // 防止按钮容器被压缩
  },
  toggleButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#F0F0F0',
    borderRadius: 12,
    minHeight: 24, // 确保最小高度一致
  },
  toggleButtonNoShrink: {
    flexShrink: 0, // 防止按钮被压缩，空间不足时换行
  },
  toggleButtonDisabled: {
    backgroundColor: '#E0E0E0',
    opacity: 0.5,
  },
  toggleButtonText: {
    fontSize: 11,
    color: '#666666',
    fontWeight: '500',
  },
  moreButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#F0F0F0',
    borderRadius: 12,
    minWidth: 32,
    minHeight: 24, // 与 toggleButton 保持一致
    alignItems: 'center',
    justifyContent: 'center',
    display: 'flex', // 确保 flex 布局生效
  },
  moreButtonText: {
    fontSize: 16,
    lineHeight: 20, // 行高略大于字体大小，确保垂直居中
    color: '#666666',
    fontWeight: '500',
    textAlignVertical: 'center', // Android 垂直居中
    includeFontPadding: false, // Android 移除字体额外 padding
  },
  moreGroupsHint: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
  },
  moreGroupsHintText: {
    fontSize: 13,
    color: '#8E8E93',
    textAlign: 'center',
  },
  toggleButtonTextDisabled: {
    opacity: 0.5,
  },
  sectionMore: {
    fontSize: 14,
    color: '#007AFF',
  },
  
  badge: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF3B30',
  },
  
  // 分类卡片（4列网格布局）
  categoriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 8,
    gap: 4,
  },
  categoryCard: {
    width: (SCREEN_WIDTH - 16 - 12) / 4, // 4列: 总宽度 - 左右padding(8*2) - gap(4*3)
    aspectRatio: 1, // 正方形
    borderRadius: 12, // iOS 风格更圆润
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#E9E9EE',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',  // 垂直居中
    alignItems: 'center',      // 水平居中
  },
  emptyThumbnailText: {
    fontSize: 40,
    color: 'rgba(255, 255, 255, 0.85)',
  },
  // iOS 风格：底部细窄半透明条 + 系统字号；名称 semibold 96% 白，计数 regular 70% 白；
  // 去掉计数胶囊背景，靠透明度区分主次，更接近 Apple Photos 的标签呈现。
  categoryOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.42)',
    paddingHorizontal: 7,
    paddingVertical: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  categoryName: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: -0.1,
    color: 'rgba(255, 255, 255, 0.96)',
    flex: 1,
    marginRight: 4,
  },
  categoryCount: {
    fontSize: 11,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.72)',
    fontVariant: ['tabular-nums'],
  },
  
  // 颜色芯片（无缩略图，色块+名称+数量）
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
    width: (SCREEN_WIDTH - 16 * 2 - 8 * 4) / 5,
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
    fontSize: 11,
    color: '#333',
    fontWeight: '500',
  },
  colorChipCount: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#666',
  },
  
  // 按属性区（存储/格式/分辨率/方向）
  attributesContainer: {
    paddingHorizontal: 16,
    gap: 12,
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
    fontSize: 11,
    color: '#333',
    fontWeight: '500',
    maxWidth: 100,
  },
  attributeChipCount: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#666',
  },
  
  // 相似组卡片
  similarityCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    backgroundColor: '#F9F9F9',
    borderRadius: 8,
  },
  similarityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  similarityTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000000',
  },
  similaritySimilarity: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#AF52DE',
  },
  similarityThumbnails: {
    flexDirection: 'row',
    gap: 8,
  },
  similarityThumbnail: {
    width: 60,
    height: 60,
    borderRadius: 4,
    backgroundColor: '#E5E5EA',
  },
  similarityMore: {
    width: 60,
    height: 60,
    borderRadius: 4,
    backgroundColor: '#E5E5EA',
    justifyContent: 'center',
    alignItems: 'center',
  },
  similarityMoreText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#8E8E93',
  },
  
  // 城市列表
  citiesList: {
    paddingHorizontal: 16,
  },
  cityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  cityArrow: {
    fontSize: 18,
    color: '#8E8E93',
    marginRight: 8,
  },
  cityName: {
    flex: 1,
    fontSize: 16,
    color: '#000000',
  },
  cityCount: {
    fontSize: 14,
    color: '#8E8E93',
  },
  
  // 最近照片网格
  recentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 4,
  },
  recentGridItem: {
    width: (SCREEN_WIDTH - 40) / 3, // 3列布局
    height: (SCREEN_WIDTH - 40) / 3,
    position: 'relative', // 添加相对定位，用于覆盖层
  },
  recentGridImage: {
    width: '100%',
    height: '100%',
    borderRadius: 4,
  },
  
  // 扫描进度提示框
  scanProgressContainer: {
    position: 'absolute',
    right: 16,
    bottom: 150, // 在FAB按钮上方
    maxWidth: SCREEN_WIDTH - 80,
  },
  scanProgressBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
    borderWidth: 1,
    borderColor: 'rgba(0, 122, 255, 0.2)',
  },
  scanProgressSpinner: {
    marginRight: 10,
  },
  scanProgressText: {
    flex: 1,
    fontSize: 13,
    color: '#333',
    lineHeight: 18,
  },

  // 扫描浮窗提示样式（贴近扫描按钮）
  scanTipContainer: {
    position: 'absolute',
    right: 16,
    bottom: 144, // 比按钮高出一些
    maxWidth: SCREEN_WIDTH - 80,
    backgroundColor: 'rgba(0,0,0,0.85)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  scanTipText: {
    color: '#fff',
    fontSize: 12,
    lineHeight: 16,
  },
  
  // FAB按钮
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 80, // 避开底部Tab栏
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  fabIcon: {
    fontSize: 24,
  },
  
  // 空数据状态样式
  emptyState: {
    paddingVertical: 40,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  emptyStateIcon: {
    fontSize: 48,
    marginBottom: 12,
    opacity: 0.4,
  },
  emptyStateText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666666',
    marginBottom: 6,
    textAlign: 'center',
  },
  emptyStateSubtext: {
    fontSize: 13,
    color: '#999999',
    textAlign: 'center',
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
  // NA分类长按提示样式 - 右上角徽章
  naCategoryBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 122, 255, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
  naCategoryBadgeText: {
    fontSize: 10,
    color: '#FFFFFF',
  },
});

export default HomeScreen;
