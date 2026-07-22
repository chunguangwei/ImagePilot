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
  useWindowDimensions,
  ActivityIndicator,
  Share,
  FlatList,
  Modal,
} from 'react-native';
import { SafeAreaView, Platform, PermissionsAndroid, Alert, RNFS, NativeModules } from '../../adapters/WebAdapters';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { useIosColors } from '../../ui/ios/theme';
import { sortCategoryList, formatDuration } from '../../components/shared/categoryUI';
import ClassifyProgressPill from '../../components/shared/ClassifyProgressPill';
import VIcon from '../../components/shared/VIcon';
import { logger, getUri, getLocalPath } from '../../adapters/WebAdapters';
import { getColorNameTranslation, getOrientationNameTranslation, getCameraSettingsCategoryTranslation } from '../../i18n';
import { getClipModel, DEFAULT_CLIP_MODEL } from '../../services/classify/clipModels';
import { isClassifierModelDownloaded } from '../../services/classify/classifierModelSource';

// 整库分类「升级到 clip」引导用的模型信息（端侧速度/精度最佳平衡；VLM 太慢耗电不适合整库）。
const CLIP_UPSELL = getClipModel(DEFAULT_CLIP_MODEL) || { filename: 'mobileclip2_s2_fp32_image_encoder.onnx', sizeMB: 147 };

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

/** 城市卡片（styles 由 HomeScreen 透传，因为 styles 已经改成 createStyles(c) 工厂模式）
 *  React.memo：props 浅比较；同一 locationId/count/latestImageUri 时跳过重渲染。
 *  注意：styles 对象由 createStyles(c) 工厂在主题切换时新建，主题切换会触发整列卡片重渲染（预期）。
 */
const CityCard = React.memo(function CityCard({ locationId, count, latestImageUri, onPress, styles }) {
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
      </View>
      <View style={styles.categoryCountBadge}>
        <Text style={styles.categoryCountText}>{count}</Text>
      </View>
    </TouchableOpacity>
  );
});

/** 按时间卡片（与 CityCard 同结构：缩略图 + 覆盖层文案 + 数量） */
const TimeCard = React.memo(function TimeCard({ timeKey, label, count, recentImages, onPress, styles }) {
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
      </View>
      <View style={styles.categoryCountBadge}>
        <Text style={styles.categoryCountText}>{count}</Text>
      </View>
    </TouchableOpacity>
  );
});

/** 分类卡片（与 CityCard/TimeCard 同模式：module-level + React.memo + styles 透传）
 *  P2 性能改造：原 renderCategoryCard 是闭包，9~10 张卡片会随 HomeScreen 任意 state 变化全量重建。
 *  抽到 module-level + memo 后，props 浅比较未变即跳过 rerender（典型可避免 8~9 次冗余重建）。
 *  注意：依赖的 navigation / handleAIClassifyNA / 显示名 / SCREEN_WIDTH / SkeuomorphicCamera
 *  全部走 props 注入，避免闭包"看似不变实则每次重建"。
 */
const CategoryCard = React.memo(function CategoryCard({
  id, count, color, recentImages, displayName, isNACategory,
  styles, onPressById, onLongPressNAById, screenWidth, naClassifyLabel,
}) {
  // 用 useCallback 把 id 绑入闭包；父级传 stable onPressById/onLongPressNAById 时这两个回调引用稳定，
  // 配合 React.memo 的浅比较即可避免冗余重建。
  const handlePress = useCallback(() => {
    if (onPressById) onPressById(id);
  }, [id, onPressById]);
  // 长按任意目录卡 → 对该目录内容跑 AI 分类（本地/云端），范围只限该目录（替代原「开始分类」按钮）
  const handleLongPress = useCallback(() => {
    if (onLongPressNAById) onLongPressNAById(id);
  }, [id, onLongPressNAById]);
  // 「待分类视频」NA_video：有视频时显示最近一帧（不突兀），空态用摄像机图标；右上角播放角标标明视频桶。
  const isVideoCategory = id === 'NA_video';
  return (
    <TouchableOpacity style={styles.categoryCard} onPress={handlePress} onLongPress={handleLongPress}>
      {(recentImages && recentImages.length > 0) ? (
        <Image
          source={{ uri: getUri(recentImages[0]) || recentImages[0]?.uri }}
          style={styles.thumbnail}
          resizeMode="cover"
        />
      ) : isVideoCategory ? (
        <View style={[styles.thumbnail, { backgroundColor: color, alignItems: 'center', justifyContent: 'center' }]}>
          {HomeIonicons
            ? <HomeIonicons name="videocam" size={Math.round((screenWidth - 28) / 4 * 0.5)} color="rgba(255,255,255,0.92)" />
            : <SkeuomorphicCamera size={Math.round((screenWidth - 28) / 4 * 0.52)} tint="rgba(255,255,255,0.92)" />}
        </View>
      ) : (
        <View style={[styles.thumbnail, { backgroundColor: color, alignItems: 'center', justifyContent: 'center' }]}>
          <SkeuomorphicCamera size={Math.round((screenWidth - 28) / 4 * 0.52)} tint="rgba(255,255,255,0.92)" />
        </View>
      )}
      <View style={styles.categoryOverlay}>
        <Text style={styles.categoryName} numberOfLines={1}>{displayName}</Text>
      </View>
      <View style={styles.categoryCountBadge}>
        <Text style={styles.categoryCountText}>{count}</Text>
      </View>
      {isVideoCategory && (
        <View style={styles.videoCatBadge} pointerEvents="none">
          <VIcon name="play" size={11} emoji="▶" style={{ marginLeft: 1 }} />
        </View>
      )}
      {/* 「开始分类」按钮已移除：统一改为长按目录卡触发 AI 分类（范围限该目录） */}
    </TouchableOpacity>
  );
});

// iOS 风格图标（字体已打包）；异常时回退 emoji
let HomeIonicons = null;
try { HomeIonicons = require('react-native-vector-icons/Ionicons').default; } catch (_) { HomeIonicons = null; }

/**
 * 区块标题色块图标 —— iOS Settings/Mail/Photos 的标准做法：
 *   24×24 的圆角彩色方块 + 内嵌白色 SF 风格线性图标。
 *
 * 配色策略（见 SECTION_TINTS）：
 *   - 主要三段（按时间 / 按内容 / 按城市）— 鲜艳系统色（orange/blue/green），互相区分
 *   - 次要段（相似 / 属性 / 拍参 / 最近 / 更多过滤）— 灰或冷紫，让主次层级一眼分得清
 *
 * 注：以前是 inline 单色 Ionicon 嵌在 <Text> 里；现在改成 View（带背景色），
 *     必须从 <Text> 中移出来作为 sectionTitleContainer 的兄弟节点（否则 Android 渲染异常）。
 */
const SectionIcon = ({ name, emoji, tint = '#007AFF' }) => (
  <View style={{
    width: 24, height: 24, borderRadius: 6,
    backgroundColor: tint,
    alignItems: 'center', justifyContent: 'center',
  }}>
    {HomeIonicons
      ? <HomeIonicons name={name} size={14} color="#FFFFFF" />
      : <Text style={{ fontSize: 14, lineHeight: 16 }}>{emoji}</Text>}
  </View>
);

/** 区块色块配色 —— iOS 系统色，呼应 SF Symbols 默认调板 */
const SECTION_TINTS = {
  time: '#FF9500',         // systemOrange — 时间/近期
  content: '#007AFF',      // systemBlue — 内容/标签（品牌主色）
  city: '#34C759',         // systemGreen — 地点/地图
  similarity: '#AF52DE',   // systemPurple — 分组/去重
  attributes: '#8E8E93',   // systemGray — 工具类
  shooting: '#FF2D55',     // systemPink — 拍摄参数/相机
  recent: '#5AC8FA',       // systemTeal — 新发现
  more: '#8E8E93',         // systemGray — 工具
};

// 每个 app 会话只在启动时静默检查一次更新（避免重复弹窗）
let _launchUpdateChecked = false;

const HomeScreen = ({ navigation }) => {
  const { t, i18n } = useTranslation('common');
  const c = useIosColors();
  const insets = useSafeAreaInsets();
  // 工厂模式：把颜色 token 注入到 StyleSheet，使整页跟随 light/dark 主题切换
  // 折叠屏：窗口宽度变化（折叠↔展开）时把宽度传进 createStyles → 网格样式实时重算，图标/卡片自适应。
  const { width: winW } = useWindowDimensions();
  const styles = React.useMemo(() => createStyles(c, winW), [c, winW]);

  // 整库扫描完成后，引导仍用基础档(basic)的用户升级到 clip（端侧最佳平衡）。
  // 条件：从没提示过 + 当前 basic + clip 未下载。一次性、可忽略、永不重复打扰。
  const [showClipUpsell, setShowClipUpsell] = useState(false);
  const maybeShowClipUpsell = useCallback(async () => {
    try {
      const s = await UnifiedDataService.readSettings();
      if (s?.clipUpsellShown) return;                                   // 提示过 → 不再提
      if ((s?.classifierModelTier || 'basic') !== 'basic') return;      // 已升级 → 不提
      if (await isClassifierModelDownloaded(CLIP_UPSELL.filename)) return; // clip 已下载 → 不提
      setShowClipUpsell(true);
    } catch (_) { /* 读设置失败 → 不打扰 */ }
  }, []);
  const closeClipUpsell = useCallback(async (goUpgrade) => {
    setShowClipUpsell(false);
    try {
      const s = await UnifiedDataService.readSettings();
      await UnifiedDataService.writeSettings({ ...(s || {}), clipUpsellShown: true }); // 标记已提示，永不再弹
    } catch (_) {}
    if (goUpgrade && navigation) navigation.navigate('Settings', { autoUpgradeClip: true });
  }, [navigation]);

  // 主题动态色叠加到 StyleSheet 上（部分组件保留 inline 覆盖以便简化合并）
  const dynSection = { backgroundColor: c.card };
  const dynSectionTitle = { color: c.label };

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
  const [memories, setMemories] = useState([]); // 回忆/那年今天（历年同月同日；节日/旅行已迁「时刻」Tab）
  const [isRefreshingRecent, setIsRefreshingRecent] = useState(false); // 「重新检测」按钮 loading 态
  const [showAllRecent, setShowAllRecent] = useState(false); // 最新发现照片：折叠(12)/展开(全部)
  
  // 扫描状态
  const [isScanning, setIsScanning] = useState(false);
  const [isSimilarityDetecting, setIsSimilarityDetecting] = useState(false); // 相似度检测状态
  
  // 消息提示（空字符串 = 首扫前，不渲染 banner，避免占空高度）
  const [globalMessage, setGlobalMessage] = useState('');
  
  // 防抖定时器引用（用于避免频繁刷新数据）
  const loadDataDebounceTimerRef = useRef(null);
  // 当前进行中的扫描/分类服务实例 —— 供 FAB 上的「停止」按钮调用 requestStop()（保留已分类、剩余下次续扫）
  const scanServiceRef = useRef(null);
  // 存储最新的 loadAllData 函数引用（用于防抖函数）
  const loadAllDataRef = useRef(null);
  
  // 隐藏空分类设置（默认隐藏空分类）
  const [hideEmptyCategories, setHideEmptyCategories] = useState(true);

  // 「更多筛选」（按属性 + 按拍摄参数）默认折叠，减少首屏视觉噪声
  const [advancedExpanded, setAdvancedExpanded] = useState(false);

  // 是否已完成至少一次扫描（用于"相似照片" / "按城市" 等无意义空态的条件渲染）
  const [hasScanned, setHasScanned] = useState(false);

  // ==================== 初始化加载 ====================
  useEffect(() => {
    initializeData();
    loadLastScanTime();
    loadHideEmptyCategoriesSetting();

    // 调试：检查当前权限状态
    checkCurrentPermissionStatus();

    // iOS 增量监听：PhotoKit 观察者收到变化 → 落 DB + 刷新 UI
    // 仅在 iOS 跑，且 GalleryScannerService 提供了对应方法时
    let iosIncrementalScanner = null;
    if (Platform.OS === 'ios') {
      try {
        iosIncrementalScanner = new GalleryScannerService();
        if (typeof iosIncrementalScanner.startIncrementalSync === 'function') {
          iosIncrementalScanner.startIncrementalSync(async () => {
            try {
              await GlobalImageCache.refreshCache();
            } catch (_) { /* 静默 */ }
            // 重新拉首页数据
            try { await loadAllData(); } catch (_) { /* 静默 */ }
          });
        }
      } catch (_) { /* 启不来就跳过，不影响主流程 */ }
    }

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
      if (iosIncrementalScanner && typeof iosIncrementalScanner.stopIncrementalSync === 'function') {
        try { iosIncrementalScanner.stopIncrementalSync(); } catch (_) { /* 静默 */ }
      }
    };
    // 该 effect 故意只在挂载时跑一次（初始化数据 + 注册 i18n/iOS 增量监听 + 启动时静默查更新）；
    // 不能把 loadAllData/loadCategories 等列入依赖，否则会把启动初始化重复跑、把更新弹窗反复弹。
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO,
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
      // 该回调只随 loading/isScanning 变化重建；loadAllData/loadLastScanTime 是组件作用域内函数，
      // 列入依赖会让 useCallback 每次渲染都新建，反而触发 useFocusEffect 频繁重订阅。
      // eslint-disable-next-line react-hooks/exhaustive-deps
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
   *
   * P2 性能改造（方案 B）：原本 setTimeout 内 fire 12 个独立 loadX()，
   * 每个 loadX 都在自己的微任务里 await 后 setState → 12 次独立 rerender 雪崩。
   * 改为：在一个 async 函数内 Promise.all 拉数据（纯 fetch，不 setState），
   * 然后同步连发 13 个 setX —— React 18 auto-batch 会把同一同步任务内的 setState
   * 合并成 1 次 rerender（13→1）。
   */
  const loadAllData = async () => {
    try {
      // 并行加载核心数据
      await Promise.all([
        loadCategories(),
        loadRecentImages(),
        (async () => loadMemories())(),

      ]);

      // 延迟加载次要数据（第二优先级）：先 Promise.all 拿原始数据，再一次性 setState 批处理
      setTimeout(async () => {
        try {
          const cache = GlobalImageCache.getCache();
          const cityCounts = cache.cityCounts || {};
          const allImages = cache.allImages || [];

          // 1) 并行拉取（不 setState，只取数据）
          const [
            timeCountsData,
            similarityGroupsData,
            colorCountsData,
            directoryCountsData,
            formatCountsData,
            resolutionCountsData,
            orientationCountsData,
            isoCountsData,
            apertureCountsData,
            shutterCountsData,
            focalLengthCountsData,
          ] = await Promise.all([
            UnifiedDataService.readTimeCounts().catch((e) => { logger.error('❌ 加载按时间数据失败:', e); return {}; }),
            UnifiedDataService.getSimilarityGroupsStats().catch((e) => { logger.error('❌ 加载相似组失败:', e); return []; }),
            UnifiedDataService.readColorCounts().catch((e) => { logger.error('❌ 加载颜色分类失败:', e); return {}; }),
            UnifiedDataService.readDirectoryCounts().catch((e) => { logger.error('❌ 加载目录分类失败:', e); return {}; }),
            UnifiedDataService.readFormatCounts().catch((e) => { logger.error('❌ 加载格式分类失败:', e); return {}; }),
            UnifiedDataService.readResolutionCounts().catch((e) => { logger.error('❌ 加载分辨率分类失败:', e); return {}; }),
            UnifiedDataService.readOrientationCounts().catch((e) => { logger.error('❌ 加载方向分类失败:', e); return {}; }),
            UnifiedDataService.readISOCounts().catch((e) => { logger.error('❌ 加载ISO分类失败:', e); return {}; }),
            UnifiedDataService.readApertureCounts().catch((e) => { logger.error('❌ 加载光圈分类失败:', e); return {}; }),
            UnifiedDataService.readShutterCounts().catch((e) => { logger.error('❌ 加载快门分类失败:', e); return {}; }),
            UnifiedDataService.readFocalLengthCounts().catch((e) => { logger.error('❌ 加载焦距分类失败:', e); return {}; }),
          ]);

          // 2) 时间桶代表图 + 城市列表（依赖前一步结果，独立加载）
          const timeKeysWithCount = Object.entries(timeCountsData || {}).filter(([, c]) => c > 0).map(([k]) => k);
          const timeRecentImagesMap = {};
          await Promise.all(timeKeysWithCount.map(async (timeKey) => {
            try {
              const images = await UnifiedDataService.readRecentImagesByTimeRange(timeKey, 1);
              timeRecentImagesMap[timeKey] = images;
            } catch (e) {
              logger.error(`加载时间桶 ${timeKey} 代表图失败:`, e);
              timeRecentImagesMap[timeKey] = [];
            }
          }));

          const cityList = Object.keys(cityCounts).map((locationId) => {
            const cityImages = allImages
              .filter((img) => img.city === locationId)
              .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            const latestImage = cityImages.length > 0 ? cityImages[0] : null;
            return {
              locationId,
              count: cityCounts[locationId],
              latestTs: latestImage ? (latestImage.timestamp || 0) : 0,
              latestImageUri: latestImage ? getUri(latestImage) : null,
            };
          });
          cityList.sort((a, b) => b.count - a.count);

          // 3) 同步连发所有 setState —— React 18 auto-batch 合并为 1 次 rerender
          setTimeCounts(timeCountsData || {});
          setTimeRecentImages(timeRecentImagesMap);
          setCities(cityList);
          setSimilarityGroups(similarityGroupsData || []);
          setColorCounts(colorCountsData);
          setDirectoryCounts(directoryCountsData);
          setFormatCounts(formatCountsData);
          setResolutionCounts(resolutionCountsData);
          setOrientationCounts(orientationCountsData);
          setISOCounts(isoCountsData);
          setApertureCounts(apertureCountsData);
          setShutterCounts(shutterCountsData);
          setFocalLengthCounts(focalLengthCountsData);
        } catch (e) {
          logger.error('❌ 加载次要数据失败:', e);
        }
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

      // 终态排序：「其他」倒数第二、「待分类」末位（自定义分类自然落在它们之前）
      setCategories(sortCategoryList(categoryWithImages));
    } catch (error) {
      logger.error('❌ 加载分类列表失败:', error);
    }
  };

  // [P3 cleanup] 删除 12 个 dead loadX 函数（loadTimeData / loadCities / loadColors /
  // loadDirectories / loadFormats / loadResolutions / loadOrientations / loadISO /
  // loadAperture / loadShutter / loadFocalLength / loadSimilarityGroups）。
  // P2 已将 loadAllData 重写为单 async 内联编排（Promise.all + setState 批处理），
  // 这些独立函数 0 引用，约 175 行；如需历史实现见 git blame。

  /**
   * 加载新发现的照片（从上次扫描之后新发现的照片）
   */
  const loadRecentImages = async () => {
    try {
      // 改为调用 readNewDiscoveredImages 获取从上次扫描之后新发现的照片（取多一些用于展开）
      const result = await UnifiedDataService.readNewDiscoveredImages(100);
      setRecentImages(result.images || []);
      // 兜底模式(isFallback)下 total 为全库数量，徽标只展示实际呈现的最近照片数，避免显示巨大数字
      setRecentImagesTotal(result.isFallback ? (result.images?.length || 0) : (result.total || 0));
    } catch (error) {
      logger.error('❌ 加载新发现照片失败:', error);
      setRecentImages([]);
      setRecentImagesTotal(0);
    }
  };

  /**
   * 回忆/那年今天：取历年「同月同日」拍的照片/视频（takenAt），按时间倒序。
   * 纯内存过滤（毫秒级），无 DB 改动。
   */
  const loadMemories = () => {
    try {
      const all = GlobalImageCache.getCache().allImages || [];
      const now = new Date();
      const m = now.getMonth(); const d = now.getDate(); const y = now.getFullYear();
      const out = [];
      for (const img of all) {
        const ts = (img && (img.takenAt || img.timestamp)) || 0;
        if (!ts || ts <= 0) continue;
        const dt = new Date(ts);
        if (dt.getMonth() === m && dt.getDate() === d && dt.getFullYear() < y) {
          out.push({ ...img, memoryYear: dt.getFullYear() });
        }
      }
      out.sort((a, b) => ((b.takenAt || b.timestamp) || 0) - ((a.takenAt || a.timestamp) || 0));
      setMemories(out.slice(0, 30));   // 上限 30，横滑展示足够
    } catch (e) {
      logger.debug('回忆加载失败:', e?.message || e);
      setMemories([]);
    }
  };

  /**
   * 刷新新发现照片 ——「重新检测」按钮入口。
   *
   * 之前无任何视觉反馈：tap → 静默 fetch → 用户「感觉没反应」。
   * 现在用 isRefreshingRecent 状态做象征性 loading（按钮 ActivityIndicator 或换文字），
   * 至少 300ms 给手感（即使本地查询很快），不弹任何 toast——没新照片就空着没新照片。
   */
  const refreshNewDiscoveredImages = useCallback(async () => {
    if (isRefreshingRecent) return;
    setIsRefreshingRecent(true);
    const startedAt = Date.now();
    try {
      const result = await UnifiedDataService.readNewDiscoveredImages(100);
      setRecentImages(result.images || []);
      setRecentImagesTotal(result.isFallback ? (result.images?.length || 0) : (result.total || 0));
    } catch (error) {
      logger.error('刷新新发现照片失败:', error);
    } finally {
      // 至少 300ms 的"检测感"——读 SQL 太快用户感觉不到动作
      const elapsed = Date.now() - startedAt;
      if (elapsed < 300) await new Promise((r) => setTimeout(r, 300 - elapsed));
      setIsRefreshingRecent(false);
    }
  }, [isRefreshingRecent]);

  /**
   * 启动相似度检测
   */
  const runSimilarityDetection = useCallback(async (mode = 'full') => {
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
      await galleryScannerService.similarityDetectionPhase({ mode });
      
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
   * 「重新检测」按钮：弹窗让用户选择「增量检测（仅新增照片，快）」或「全部检测」。
   */
  const handleStartSimilarityDetection = useCallback(() => {
    if (isScanning) {
      Alert.alert(t('common.tip'), t('home.scanAlreadyInProgress'));
      return;
    }
    Alert.alert(
      t('home.similarityScanModeTitle', { defaultValue: '相似照片检测' }),
      t('home.similarityScanModeMessage', { defaultValue: '照片较多时，增量检测只比对新增照片，速度更快；全部检测会重新比对全部照片。' }),
      [
        { text: t('home.similarityScanIncremental', { defaultValue: '增量检测（仅新增）' }), onPress: () => runSimilarityDetection('incremental') },
        { text: t('home.similarityScanFull', { defaultValue: '全部检测' }), onPress: () => runSimilarityDetection('full') },
        { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
      ],
    );
  }, [isScanning, runSimilarityDetection, t]);

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
   * 启动 EXIF 拍参提取（iOS 专用）—— Android 在扫描阶段已经一并提取，无需此入口。
   * iOS PHAsset 不暴露拍参，需走 PhotoKitModule.fetchAssetsExif 单独提一遍。
   */
  const handleStartExifEnrichment = useCallback(async () => {
    if (isScanning) {
      Alert.alert(t('common.tip'), t('home.scanAlreadyInProgress'));
      return;
    }
    try {
      logger.debug('开始 EXIF 拍参提取');
      setIsScanning(true);
      if (typeof window !== 'undefined') { window.isScanning = true; }
      setGlobalMessage(t('home.exifEnrichmentInProgress'));

      const wakeLockAcquired = await WakeLockService.acquire(30 * 60 * 1000);
      if (wakeLockAcquired) logger.info('🔋 已获取唤醒锁（EXIF 提取期间防休眠）');

      const galleryScannerService = new GalleryScannerService();
      await galleryScannerService.initialize();
      galleryScannerService.onProgress = (progress) => {
        if (!progress) return;
        const message = progress.simpleMessage || progress.message || t('home.exifEnrichmentInProgress');
        setGlobalMessage(message);
        if (progress.shouldRefresh) {
          setTimeout(async () => {
            try { await loadAllData(); } catch (e) { logger.error('❌ 刷新页面数据失败:', e); }
          }, 0);
        }
      };
      await galleryScannerService.enrichExifInfo();
      // 提完一次性刷数据
      await loadAllData();
    } catch (error) {
      logger.error('EXIF 提取失败:', error);
      setGlobalMessage(t('home.exifEnrichmentFailed', { error: error.message }));
      Alert.alert(t('home.exifEnrichmentFailed', { error: '' }), error.message);
    } finally {
      await WakeLockService.release();
      setIsScanning(false);
      if (typeof window !== 'undefined') { window.isScanning = false; }
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
      
      // 是否扫描过：用于决定"相似照片/按城市"等无意义空态是否渲染
      setHasScanned(!!(settings && settings.lastScanTime));

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
        // 首扫前：清空消息，banner 不渲染（避免占空高度）
        if (!preserveCurrentMessage) {
          setGlobalMessage('');
        }
      }
    } catch (error) {
      logger.error('加载最近扫描时间失败:', error);
      // 失败也清空，让 banner 不占位
      if (!preserveCurrentMessage) {
        setGlobalMessage('');
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
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO, // 视频读取（待分类视频）
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
              onPress: async () => {
                // 优先直接跳系统设置 → 本 app 详情页；Linking.openSettings 在
                // Android/iOS 都可用，失败再回退到文本指引
                try {
                  const { Linking: RNLinking } = require('react-native');
                  await RNLinking.openSettings();
                  return;
                } catch (_) { /* 走兜底 */ }
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
  // categoryId 为空 = 旧行为（NA+NA_video 全量）；传入则只分类该目录的内容（长按目录卡触发）
  const handleAIClassifyNA = async (categoryId = null) => {
    // 检查是否正在扫描中
    if (isScanning) {
      Alert.alert(t('common.tip'), t('home.scanAlreadyInProgress'));
      return;
    }

    // 从缓存获取数量：指定目录只数该目录；否则待分类全量（图片 NA + 视频 NA_video）
    const cache = GlobalImageCache.getCache();
    const categoryCounts = cache.categoryCounts || {};
    const naCount = categoryId
      ? (categoryCounts[categoryId] || 0)
      : (categoryCounts['NA'] || 0) + (categoryCounts['NA_video'] || 0);
    if (naCount === 0) {
      Alert.alert(t('common.tip'), t('home.aiClassifyEmptyCategory', { defaultValue: '该目录暂无内容可分类' }));
      return;
    }

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
            onPress: async () => { await executeAIClassify({ forceLocal: true, naCount, categoryId }); },
          },
          {
            text: t('home.aiClassifyUseCloud'),
            style: 'default',
            onPress: async () => { await executeAIClassify({ forceLocal: false, naCount, categoryId }); },
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
            onPress: async () => { await executeAIClassify({ forceLocal: true, naCount, categoryId }); },
          },
        ],
      );
    }
  };

  /**
   * 执行AI分类（确认后执行）
   */
  // 弹出"大模型失败→改用离线模型"兜底确认框
  const promptLocalFallback = (message, categoryId = null) => {
    Alert.alert(
      t('home.aiClassifyLLMFailTitle'),
      message,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          style: 'default',
          onPress: async () => { await executeAIClassify({ forceLocal: true, categoryId }); },
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
      scanServiceRef.current = galleryScannerService;   // 暴露给「停止」按钮

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
      
      // 启动分类（按内容）。forceLocal=true 走设备端离线模型，否则走配置的在线大模型。
      // 指定 categoryId（长按目录卡）→ 只取该目录的记录传入，分类范围限定在该目录。
      let imagesToClassify = null;
      if (opts.categoryId) {
        try {
          imagesToClassify = await UnifiedDataService.readImagesByCategory(opts.categoryId);
        } catch (e) {
          logger.warn('读取目录记录失败:', e?.message || e);
          imagesToClassify = [];
        }
        if (!imagesToClassify || imagesToClassify.length === 0) {
          setIsScanning(false);
          if (typeof window !== 'undefined') window.isScanning = false;
          setGlobalMessage('');
          Alert.alert(t('common.tip'), t('home.aiClassifyEmptyCategory', { defaultValue: '该目录暂无内容可分类' }));
          return;
        }
      }
      const result = await galleryScannerService.aiImageClassifyByContent(new Date(), imagesToClassify, { forceLocal });

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
        promptLocalFallback(t('home.aiClassifyLLMFailMessage', { count: failedCount }), opts.categoryId);
      }
    } catch (error) {
      logger.error('❌ AI分类失败:', error);
      setGlobalMessage(t('home.aiClassificationFailed', { error: error.message }));
      if (!forceLocal) {
        // 在线大模型分类整体出错 → 提示改用离线模型兜底
        promptLocalFallback(t('home.aiClassifyLLMFailMessageGeneric', { error: error.message || '' }), opts.categoryId);
      } else {
        // 离线模型路径失败：若像首次下载/网络问题，给更友好的可重试提示（审核网络差也不至于看不懂）
        const msg = String(error?.message || '');
        const looksLikeDownload = /E_DOWNLOAD|E_NO_MODEL|Network|network|timeout|timed out|ENOTFOUND|ECONN|offline|HTTP\s*\d/i.test(msg);
        Alert.alert(
          t('home.aiClassificationFailed', { error: '' }),
          looksLikeDownload ? t('home.modelDownloadNeedNetwork') : msg
        );
      }
    } finally {
      // 释放唤醒锁
      await WakeLockService.release();
      setIsScanning(false);
      scanServiceRef.current = null;
      // 🔥 清除全局变量
      if (typeof window !== 'undefined') {
        window.isScanning = false;
      }
    }
  };

  /**
   * 停止进行中的 AI 分类（大模型逐张分类太慢时）。
   * 调 requestStop()：已分类的（每张已落库）保留并刷新归位，剩余待分类图下次扫描自动续。
   */
  const handleStopScan = () => {
    try {
      if (scanServiceRef.current && typeof scanServiceRef.current.requestStop === 'function') {
        scanServiceRef.current.requestStop();
        setGlobalMessage(t('home.scanStopping', { defaultValue: '正在停止，已分类的会保留…' }));
      }
    } catch (e) {
      logger.warn('停止分类失败:', e?.message || e);
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

      // 整库扫描完成 → 视情况一次性引导升级 clip（端侧最佳平衡，分类更准）
      await maybeShowClipUpsell();
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
   * 分类卡片点击：navigation 在 RN 中引用稳定（StackNavigator 缓存），useCallback 安全。
   */
  const handleCategoryPressById = useCallback((categoryId) => {
    try {
      if (!categoryId || !navigation) {
        logger.warn('❌ 分类数据无效或导航对象为空:', { categoryId, navigation: !!navigation });
        return;
      }
      logger.debug('📁 点击分类卡片:', categoryId);
      navigation.navigate('Category', {
        filterType: 'category',
        filterValue: categoryId,
        fromScreen: 'Home',
      });
    } catch (error) {
      logger.error('❌ 分类卡片点击失败:', error);
    }
  }, [navigation]);

  // handleAIClassifyNA 是普通 async 函数（每次 render 都重建），用 ref 桥接以保证回调引用稳定。
  const handleAIClassifyNARef = useRef(null);
  handleAIClassifyNARef.current = handleAIClassifyNA;
  const handleCategoryLongPressNAById = useCallback((categoryId) => {
    // 长按任意目录卡 → 对该目录跑 AI 分类（范围限该目录：NA 只分图片、NA_video 只分视频、
    // 其它目录=对已分类内容重新分类）
    logger.debug(`🤖 长按目录卡 ${categoryId}，启动AI分类`);
    const fn = handleAIClassifyNARef.current;
    if (typeof fn === 'function') fn(categoryId);
  }, []);

  /**
   * 渲染分类卡片：转用 module-level CategoryCard (React.memo)，传 stable 回调以触发浅比较跳过。
   */
  const renderCategoryCard = (category) => (
    <CategoryCard
      key={category.id}
      id={category.id}
      count={category.count}
      color={category.color}
      recentImages={category.recentImages}
      displayName={getCategoryDisplayName(category.id)}
      isNACategory={category.id === 'NA' || category.id === 'NA_video'}  // 待分类视频也给「开始分类」（抽帧自动分类）
      styles={styles}
      screenWidth={winW}
      onPressById={handleCategoryPressById}
      onLongPressNAById={handleCategoryLongPressNAById}
      naClassifyLabel={t('home.startClassifyBtn')}
    />
  );

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
      <View style={[styles.section, dynSection]}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleContainer}>
            <SectionIcon name="calendar-outline" emoji="📅" tint={SECTION_TINTS.time} />
            <Text style={[styles.sectionTitle, dynSectionTitle, styles.sectionTitleInline]}>{t('home.byTime')}</Text>
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
              styles={styles}
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
      <View style={[styles.section, dynSection]}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleColumn}>
            <View style={styles.sectionTitleRow}>
              <SectionIcon name="pricetags-outline" emoji="🏷️" tint={SECTION_TINTS.content} />
              <Text style={[styles.sectionTitle, dynSectionTitle, styles.sectionTitleInline]}>{t('home.byContent')}</Text>
            </View>
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
   * 首扫之前：若数据为空，整段不渲染（连标题都不出来），避免无意义空态占位。
   * 扫完后即使为空也继续展示 CTA，引导用户启动相似度检测。
   */
  const renderSimilarityGroupsSection = () => {
    const hasGroups = similarityGroups && similarityGroups.length > 0;
    if (!hasScanned && !hasGroups) return null;
    return (
      <View style={[styles.section, dynSection]}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleContainer}>
            <SectionIcon name="copy-outline" emoji="🔗" tint={SECTION_TINTS.similarity} />
            <Text style={[styles.sectionTitle, dynSectionTitle, styles.sectionTitleInline]}>{t('home.similarPhotos')}</Text>
          </View>
          <View style={styles.headerButtonsContainer}>
            {/* 重复照片清理入口：字节级相同的多份拷贝，一键释放存储（与"相似照片"互补，始终可达） */}
            <TouchableOpacity
              style={styles.toggleButton}
              onPress={() => navigation && navigation.navigate('Duplicates')}
              activeOpacity={0.7}
            >
              <Text style={styles.toggleButtonText}>{t('home.duplicatesEntry', { defaultValue: '重复清理' })}</Text>
            </TouchableOpacity>

          {similarityGroups && similarityGroups.length > 0 && (
            <>
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
            </>
          )}
          </View>
        </View>
        
        {similarityGroups && similarityGroups.length > 0 ? (
          // 统一用缩略图网格：每组取组内最新一张作代表图，比纯文字「相似组·N」更易辨认。
          // 折叠显示前 8 组，展开显示全部。
          <View style={styles.categoriesGrid}>
            {(showAllSimilarityGroups ? similarityGroups : similarityGroups.slice(0, 8)).map(renderSimilarityGroupCard)}
          </View>
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
      <View style={[styles.section, dynSection]}>
        <View style={[styles.sectionTitleRow, { paddingHorizontal: 16, marginBottom: 12 }]}>
          <SectionIcon name="list-outline" emoji="📋" tint={SECTION_TINTS.attributes} />
          <Text style={[styles.sectionTitle, dynSectionTitle, styles.sectionTitleInline]}>{t('home.byAttributes')}</Text>
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
      styles={styles}
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
    const hasAny = hasISO || hasAperture || hasShutter || hasFocalLength;

    // iOS 特例：扫描时不自动提 EXIF（PHAsset 不暴露拍参，需读原图字节），所以扫完后这 4
    // 个 counts 都是空。Android 扫描内联了 EXIF，counts 直接有数。
    // → iOS 上 hasScanned && 空 → 显示 section 头 + CTA「提取拍摄参数」让用户触发。
    const isIos = Platform.OS === 'ios';
    if (!hasAny && !(isIos && hasScanned)) return null;

    return (
      <View style={[styles.section, dynSection]}>
        <View style={[styles.sectionTitleRow, { paddingHorizontal: 16, marginBottom: 12 }]}>
          <SectionIcon name="aperture-outline" emoji="📸" tint={SECTION_TINTS.shooting} />
          <Text style={[styles.sectionTitle, dynSectionTitle, styles.sectionTitleInline]}>{t('home.byShootingParams')}</Text>
        </View>
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
          {/* iOS 空态 CTA：拍参数据需要额外的「读原图 EXIF」阶段，提示用户触发 */}
          {!hasAny && isIos && hasScanned && (
            <View style={styles.emptyState}>
              {HomeIonicons ? <HomeIonicons name="aperture-outline" size={48} color="#C7C7CC" style={{ marginBottom: 12 }} /> : <Text style={styles.emptyStateIcon}>📸</Text>}
              <Text style={styles.emptyStateText}>{t('home.exifEmptyTitle')}</Text>
              <Text style={styles.emptyStateSubtext}>{t('home.exifEmptyHint')}</Text>
              <TouchableOpacity
                style={[
                  styles.startSimilarityButton,
                  isScanning && styles.startSimilarityButtonDisabled,
                ]}
                onPress={handleStartExifEnrichment}
                disabled={isScanning}
              >
                <Text style={[
                  styles.startSimilarityButtonText,
                  isScanning && styles.startSimilarityButtonTextDisabled,
                ]}>
                  {isScanning ? t('home.exifEnrichmentInProgress') : t('home.exifStartAction')}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    );
  };

  /**
   * 渲染按城市区（与"按内容"保持一致：4列网格布局）
   * 首扫之前：若没有任何城市，整段不渲染（连标题都不出来）。
   * 扫完后即使为空也继续展示 CTA，引导用户启动定位补全。
   */
  const renderCitiesSection = () => {
    const hasCities = cities && cities.length > 0;
    if (!hasScanned && !hasCities) return null;
    // 展开：按照片数量降序（看整体分布）；折叠：按「最近去过」降序（尽量让最新城市出现在首屏）
    const byCount = hasCities
      ? [...cities].sort((a, b) => (b.count || 0) - (a.count || 0))
      : [];
    const byRecency = hasCities
      ? [...cities].sort((a, b) => ((b.latestTs || 0) - (a.latestTs || 0)) || ((b.count || 0) - (a.count || 0)))
      : [];
    // 折叠区容量：满一屏（8 个）时用「查看更多」进入完整列表
    const COLLAPSED_LIMIT = 8;
    const sortedCities = byCount;
    const displayCities = showAllCities ? byCount : byRecency.slice(0, COLLAPSED_LIMIT);

    return (
      <View style={[styles.section, dynSection]}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleContainer}>
            <SectionIcon name="location-outline" emoji="🏙️" tint={SECTION_TINTS.city} />
            <Text style={[styles.sectionTitle, dynSectionTitle, styles.sectionTitleInline]}>{t('home.byCity')}</Text>
          </View>
          {cities && cities.length > 0 && (
            <View style={styles.headerButtonsContainer}>
              <TouchableOpacity 
                style={[
                  styles.toggleButton,
                  isScanning && styles.toggleButtonDisabled
                ]}
                onPress={handleScan}
                disabled={isScanning}
              >
                <Text style={[
                  styles.toggleButtonText,
                  isScanning && styles.toggleButtonTextDisabled
                ]}>{t('home.recheck')}</Text>
              </TouchableOpacity>
              {sortedCities.length > COLLAPSED_LIMIT && !showAllCities && (
                <TouchableOpacity
                  style={styles.toggleButton}
                  onPress={() => setShowAllCities(true)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.toggleButtonText}>{`${t('home.showMore')} (${sortedCities.length - COLLAPSED_LIMIT})`}</Text>
                </TouchableOpacity>
              )}
              {showAllCities && sortedCities.length > COLLAPSED_LIMIT && (
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
              onPress={handleScan}
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
      <View style={[styles.section, dynSection]}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleContainer}>
            <SectionIcon name="images-outline" emoji="📸" tint={SECTION_TINTS.recent} />
            <Text style={[styles.sectionTitle, dynSectionTitle, styles.sectionTitleInline]}>{t('home.recentDiscoveredPhotos')}</Text>
          </View>
          <View style={styles.headerButtonsContainer}>
            {recentImages.length > 12 && (
              <TouchableOpacity
                style={styles.toggleButton}
                onPress={() => setShowAllRecent(!showAllRecent)}
                activeOpacity={0.7}
              >
                <Text style={styles.toggleButtonText}>
                  {showAllRecent ? t('home.showLess') : t('home.showMore')}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.toggleButton, isRefreshingRecent && styles.toggleButtonDisabled]}
              onPress={refreshNewDiscoveredImages}
              disabled={isRefreshingRecent}
            >
              {isRefreshingRecent
                ? <ActivityIndicator size="small" color={c.accent} />
                : <Text style={styles.toggleButtonText}>{t('home.recheck')}</Text>}
            </TouchableOpacity>
          </View>
        </View>

        {recentImages.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={{ marginBottom: 10 }}><SkeuomorphicCamera size={60} scheme="onLight" /></View>
            <Text style={styles.emptyStateText}>{t('home.noNewPhotos')}</Text>
            <Text style={styles.emptyStateSubtext}>{t('home.clickScanButtonToStart')}</Text>
          </View>
        ) : (
          <>
            <View style={styles.recentGrid}>
              {(showAllRecent ? recentImages : recentImages.slice(0, 12)).map((image, index) => {
                const directoryName = getDirectoryName(image);

                return (
                  <TouchableOpacity
                    key={image.id || image.uri || index}
                    style={styles.recentGridItem}
                    activeOpacity={0.8}
                    onPress={() => {
                      if (!navigation) return;
                      navigation.navigate('ImagePreview', {
                        image,
                        allImages: recentImages,
                        currentIndex: showAllRecent ? index : recentImages.findIndex(img => img.id === image.id),
                        fromScreen: 'Home',
                      });
                    }}
                  >
                    <Image
                      source={{ uri: getUri(image) || image?.uri }}
                      style={styles.recentGridImage}
                      resizeMode="cover"
                    />
                    {String(image?.mimeType || '').startsWith('video/') && (
                      <View style={[styles.videoCatBadge, formatDuration(image?.duration) ? styles.videoCatBadgeWide : null]} pointerEvents="none">
                        <VIcon name="play" size={10} emoji="▶" />
                        {formatDuration(image?.duration) ? <Text style={styles.videoCatBadgeIcon}> {formatDuration(image?.duration)}</Text> : null}
                      </View>
                    )}
                    <View style={styles.categoryOverlay}>
                      <Text style={styles.categoryName} numberOfLines={1}>
                        {directoryName}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}
      </View>
    );
  };

  /**
   * 回忆/那年今天：横滑卡片，年份角标；点进预览（回忆集合内左右滑）。无回忆不渲染。
   */
  const renderMemoriesSection = () => {
    if (!memories || memories.length === 0) return null;
    return (
      <View style={[styles.section, dynSection]}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleContainer}>
            <SectionIcon name="calendar-outline" emoji="🕰️" tint="#AF52DE" />
            <Text style={[styles.sectionTitle, dynSectionTitle, styles.sectionTitleInline]}>
              {t('home.memoriesTitle', { defaultValue: '那年今天' })}
            </Text>
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{memories.length}</Text>
            </View>
          </View>
          {/* 幻灯片放映（视频自动跳过） */}
          <TouchableOpacity
            style={styles.toggleButton}
            onPress={() => navigation && navigation.navigate('Slideshow', { images: memories, title: t('home.memoriesTitle', { defaultValue: '那年今天' }) })}
            activeOpacity={0.7}
          >
            <Text style={styles.toggleButtonText}>{t('home.slideshowBtn', { defaultValue: '▶ 放映' })}</Text>
          </TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 2 }}>
          {memories.map((img, idx) => (
            <TouchableOpacity
              key={img.id || idx}
              style={styles.memoryItem}
              activeOpacity={0.85}
              onPress={() => navigation && navigation.navigate('ImagePreview', {
                image: img, allImages: memories, currentIndex: idx, fromScreen: 'Home',
              })}
            >
              <Image source={{ uri: getUri(img) || img?.uri }} style={styles.memoryImage} resizeMode="cover" />
              <View style={styles.memoryYearBadge} pointerEvents="none">
                <Text style={styles.memoryYearText}>{img.memoryYear}</Text>
              </View>
              {String(img?.mimeType || '').startsWith('video/') && (
                <View style={styles.memoryPlayBadge} pointerEvents="none">
                  <VIcon name="play" size={11} emoji="▶" style={{ marginLeft: 1 }} />
                </View>
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  };

  /**
   * 渲染FAB扫描按钮
   */
  const renderFAB = () => (
    <>
      {/* 扫描按钮：bottom = 16(常规边距) + 安全区底距 + 49(底部 Tab 栏) */}
      <TouchableOpacity
        style={[styles.fab, { bottom: 16 + insets.bottom + 49 }]}
        onPress={isScanning ? handleStopScan : handleScan}
        activeOpacity={0.8}
      >
        {isScanning ? (
          // 扫描/分类中：外圈 spinner 一直转 + 中间「停止」方块。点击停止 → 已分类的保留并归位，
          // 剩余待分类图下次扫描自动续（见 GalleryScannerService.requestStop）。
          <View style={{ alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color="#FFFFFF" size="small" />
            <View style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
              {HomeIonicons ? <HomeIonicons name="stop" size={13} color="#FFFFFF" /> : <Text style={{ color: '#FFFFFF', fontSize: 11 }}>■</Text>}
            </View>
          </View>
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
    <SafeAreaView style={[styles.container, { backgroundColor: c.groupedBg }]}>
      {/* 顶部导航栏 */}
      <View style={[styles.header, { backgroundColor: c.card, borderBottomColor: c.separator }]}>
        <Pressable
          onLongPress={handleExportLogs}
          style={styles.headerTitleContainer}
        >
          <Text style={[styles.headerTitle, { color: c.label }]}>{t('app.name')}</Text>
        </Pressable>
        {/* 扫描/分类状态：进行中转圈、有消息时 ⓘ，点开看完整消息（替代原第二行消息横幅） */}
        {(isScanning || globalMessage) ? (
          <TouchableOpacity
            onPress={() => Alert.alert(t('home.statusTitle', { defaultValue: '扫描状态' }), globalMessage || t('home.scanningShort', { defaultValue: '处理中…' }))}
            style={styles.headerSearchBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {isScanning
              ? <ActivityIndicator size="small" color={c.accent} />
              : (HomeIonicons ? <HomeIonicons name="information-circle-outline" size={21} color={c.secondaryLabel} /> : <Text style={{ fontSize: 18 }}>ⓘ</Text>)}
          </TouchableOpacity>
        ) : null}
        {/* 相册报告（年报统计）入口 */}
        <TouchableOpacity
          onPress={() => navigation.navigate('Stats')}
          style={styles.headerSearchBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {HomeIonicons ? <HomeIonicons name="stats-chart-outline" size={21} color={c.label} /> : <Text style={{ fontSize: 19 }}>📊</Text>}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => navigation.navigate('Search')}
          style={styles.headerSearchBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {HomeIonicons ? <HomeIonicons name="search" size={22} color={c.label} /> : <Text style={{ fontSize: 20 }}>🔍</Text>}
        </TouchableOpacity>
      </View>

      {/* 扫描消息条已收进 header 状态小按钮（信息量太大占一整行）；点 header 转圈/ⓘ 可看完整消息 */}

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
        {/* 首扫前欢迎卡（从未扫过 + 无任何数据）：保留主 CTA + FAB 提示双入口。
            之前一度去掉了 CTA 按钮（用户觉得跟 FAB 重复），但数据清空场景下没显式按钮
            体验不顺手——已恢复，与 FAB 同动作 handleScan，两者都能用。 */}
        {(!hasScanned && recentImagesTotal === 0 && categories.every((cat) => (cat.count || 0) === 0)) ? (
          <View style={styles.welcomeCard}>
            <Text style={styles.welcomeTitle}>{t('home.welcomeTitle')}</Text>
            <Text style={styles.welcomeSub}>{t('home.welcomeSub')}</Text>
            <TouchableOpacity
              style={styles.welcomeBtn}
              onPress={handleScan}
              activeOpacity={0.8}
              accessibilityRole="button"
            >
              <Text style={styles.welcomeBtnText}>{t('home.welcomeAction')}</Text>
            </TouchableOpacity>
            <Text style={styles.welcomeHint}>{t('home.welcomeHint')}</Text>
          </View>
        ) : null}
        {renderMemoriesSection()}
        {renderTimeSection()}
        {renderCategoriesSection()}
        {renderCitiesSection()}
        {renderSimilarityGroupsSection()}
        {(() => {
          // 「按属性」+「按拍摄参数」默认折叠为「更多筛选」一行；点击展开。
          // 内部两段在数据为空时各自 return null，因此若全空则整个折叠区也不渲染（避免空 section）。
          const attributesNode = renderAttributesSection();
          const shootingNode = renderShootingParamsSection();
          if (!attributesNode && !shootingNode) return null;
          return (
            <>
              <View style={[styles.section, dynSection]}>
                <TouchableOpacity
                  style={[styles.sectionHeader, { marginBottom: 0 }]}
                  onPress={() => setAdvancedExpanded((v) => !v)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: advancedExpanded }}
                >
                  <View style={styles.sectionTitleContainer}>
                    <SectionIcon name="options-outline" emoji="🔧" tint={SECTION_TINTS.more} />
                    <Text style={[styles.sectionTitle, dynSectionTitle, styles.sectionTitleInline, { marginTop: 0, marginBottom: 0 }]}>
                      {t('home.moreFilters')}
                    </Text>
                  </View>
                  <Text style={[styles.sectionTitle, dynSectionTitle, { marginTop: 0, marginBottom: 0 }]}>
                    {advancedExpanded ? '▾' : '›'}
                  </Text>
                </TouchableOpacity>
              </View>
              {advancedExpanded ? (
                <>
                  {attributesNode}
                  {shootingNode}
                </>
              ) : null}
            </>
          );
        })()}
        {renderRecentPhotos()}
      </ScrollView>

      {/* FAB扫描按钮 */}
      {renderFAB()}

      {/* 多选 AI 分类全局进度胶囊（跨页面存活；放 FAB 上方避开） */}
      <ClassifyProgressPill bottom={150 + insets.bottom} />

      {/* 整库扫描后「升级 clip」一次性引导卡（底部滑出、可忽略、永不重复） */}
      <Modal visible={showClipUpsell} transparent animationType="slide" onRequestClose={() => closeClipUpsell(false)}>
        <Pressable style={styles.clipUpsellOverlay} onPress={() => closeClipUpsell(false)}>
          <Pressable style={styles.clipUpsellCard} onPress={() => {}}>
            <Text style={styles.clipUpsellEmoji}>✨</Text>
            <Text style={styles.clipUpsellTitle}>{t('home.clipUpsell.title')}</Text>
            <Text style={styles.clipUpsellBody}>{t('home.clipUpsell.body', { size: CLIP_UPSELL.sizeMB })}</Text>
            <View style={styles.clipUpsellBtns}>
              <TouchableOpacity style={styles.clipUpsellLater} onPress={() => closeClipUpsell(false)} activeOpacity={0.7}>
                <Text style={styles.clipUpsellLaterText}>{t('home.clipUpsell.later')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.clipUpsellUpgrade} onPress={() => closeClipUpsell(true)} activeOpacity={0.85}>
                <Text style={styles.clipUpsellUpgradeText}>{t('home.clipUpsell.upgrade')}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
};

// ==================== 样式 ====================

// 工厂模式：把颜色 token c 注入到 StyleSheet，使整页跟随系统 light/dark 主题切换。
// 布局（margin/padding/width/height/borderRadius/fontSize/fontWeight）一律不动，
// 只把硬编码颜色替换成 c.xxx；纯白覆盖文字 / rgba 半透明 / 阴影色保留不变。
// 死样式已删除（similarityCard 系列 / citiesList 系列 / scanProgress* / sectionTitleRow / sectionMore / badge / moreButton / moreButtonText / moreGroupsHint 等）。
const createStyles = (c, winW = SCREEN_WIDTH) => StyleSheet.create({
  // 「升级 clip」引导卡
  clipUpsellOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  clipUpsellCard: { backgroundColor: c.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 22, paddingTop: 18, paddingBottom: 30 },
  clipUpsellEmoji: { fontSize: 30, marginBottom: 6 },
  clipUpsellTitle: { fontSize: 19, fontWeight: '700', color: c.label, marginBottom: 8 },
  clipUpsellBody: { fontSize: 14.5, lineHeight: 21, color: c.secondaryLabel, marginBottom: 20 },
  clipUpsellBtns: { flexDirection: 'row', gap: 12 },
  clipUpsellLater: { flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: c.fill, alignItems: 'center' },
  clipUpsellLaterText: { fontSize: 16, fontWeight: '600', color: c.label },
  clipUpsellUpgrade: { flex: 1.4, paddingVertical: 13, borderRadius: 12, backgroundColor: c.accent, alignItems: 'center' },
  clipUpsellUpgradeText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  container: {
    flex: 1,
    backgroundColor: c.groupedBg,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: c.tertiaryLabel,
  },
  header: {
    height: 56,
    backgroundColor: c.card,
    borderBottomWidth: 1,
    borderBottomColor: c.separator,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  headerTitleContainer: {
    // 让标题可以长按
  },
  headerSearchBtn: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: c.label,
  },
  // 消息提示区样式
  messageBanner: {
    padding: 12,
    paddingTop: 8,
    paddingBottom: 8,
  },
  messageText: {
    fontSize: 12,
    color: c.secondaryLabel,
    textAlign: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100, // 为FAB留出空间
  },

  // 首扫前欢迎卡（仅在 hasScanned===false 且全空时渲染；引导用户点 FAB 之外的扫描入口）
  welcomeCard: {
    backgroundColor: c.card,
    marginTop: 12,
    marginHorizontal: 16,
    paddingVertical: 24,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
  },
  welcomeTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: c.label,
    marginBottom: 8,
    textAlign: 'center',
  },
  welcomeSub: {
    fontSize: 14,
    color: c.secondaryLabel,
    marginBottom: 20,
    textAlign: 'center',
    lineHeight: 20,
  },
  welcomeBtn: {
    backgroundColor: c.accent,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  welcomeBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  // FAB 提示作为次要 CTA，跟在主按钮下方
  welcomeHint: {
    fontSize: 12,
    color: c.tertiaryLabel,
    textAlign: 'center',
    marginTop: 10,
  },

  // 区块样式（iOS 分组：白底全宽 + 组间留白；保持全宽以兼容网格宽度计算）
  section: {
    backgroundColor: c.card,
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
    fontSize: 20,
    fontWeight: '700',
    marginTop: 24,
    marginBottom: 8,
    color: c.label,
    // 注意：当 sectionTitle 在 sectionHeader 内部时，不需要额外的 padding
    // 当单独使用时，需要通过内联样式添加 paddingHorizontal: 16
  },
  // 用在 SectionIcon 旁边时，清掉 marginTop/marginBottom 让色块和文字按行居中对齐
  // （SectionIcon 是 24×24 View；不清边距文字会被推下去出现 baseline 错位）
  sectionTitleInline: {
    marginTop: 0,
    marginBottom: 0,
  },
  // 当区块标题没有外层 sectionTitleContainer/Column 时用这个：色块 + 标题的横排
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitleColumn: {
    flexDirection: 'column',
    gap: 2,
    flex: 1,
    flexShrink: 1,
    minWidth: 0, // 允许收缩，避免英文长文本时按钮溢出屏幕
  },
  sectionHint: {
    fontSize: 12,
    color: c.secondaryLabel,
    fontWeight: '400',
    marginBottom: 12,
  },
  countBadge: {
    backgroundColor: c.accent,
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
    backgroundColor: c.fillTertiary,
    borderRadius: 12,
    minHeight: 24, // 确保最小高度一致
  },
  toggleButtonNoShrink: {
    flexShrink: 0, // 防止按钮被压缩，空间不足时换行
  },
  toggleButtonDisabled: {
    backgroundColor: c.fillSecondary,
    opacity: 0.5,
  },
  toggleButtonText: {
    fontSize: 11,
    color: c.secondaryLabel,
    fontWeight: '500',
  },
  toggleButtonTextDisabled: {
    opacity: 0.5,
  },

  // 分类卡片（4列网格布局）
  categoriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 8,
    gap: 4,
  },
  categoryCard: {
    width: (winW - 16 - 12) / 4, // 4列: 总宽度 - 左右padding(8*2) - gap(4*3)（winW 响应式 → 折叠屏自适应）
    aspectRatio: 1, // 正方形
    borderRadius: 12, // iOS 风格更圆润
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: c.fillTertiary,
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
  // 覆盖在缩略图上的半透明黑底 + 白字，light/dark 都用同一套（与图片自身对比）
  // ▶ 放右下角（名称栏正上方）：顶部留给「开始分类」按钮，互不遮挡
  videoCatBadge: {
    position: 'absolute',
    right: 6,
    bottom: 30,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.55)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 有时长时变药丸：▶ 0:32
  videoCatBadgeWide: {
    width: undefined,
    paddingHorizontal: 6,
  },
  // 回忆/那年今天（横滑卡片）
  memoryItem: {
    width: 108,
    height: 144,
    borderRadius: 10,
    overflow: 'hidden',
    marginRight: 8,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  memoryImage: { width: '100%', height: '100%' },
  memoryYearBadge: {
    position: 'absolute',
    left: 6,
    top: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  memoryYearText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  memoryPlayBadge: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoCatBadgeIcon: {
    color: '#FFFFFF',
    fontSize: 11,
    marginLeft: 1,
  },
  categoryOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.42)',
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  categoryName: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: -0.1,
    color: 'rgba(255, 255, 255, 0.96)',
  },
  categoryCountBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 24,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  categoryCountText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#000',
    fontVariant: ['tabular-nums'],
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
    backgroundColor: c.fillTertiary,
    borderRadius: 8,
    gap: 6,
    width: (winW - 16 * 2 - 8 * 4) / 5,
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
    color: c.label,
    fontWeight: '500',
  },
  colorChipCount: {
    fontSize: 11,
    fontWeight: 'bold',
    color: c.secondaryLabel,
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
    color: c.tertiaryLabel,
    paddingHorizontal: 4,
  },
  attributeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: c.separator,
    borderRadius: 8,
    backgroundColor: c.groupedBg,
  },
  attributeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: c.fillTertiary,
    borderRadius: 8,
    gap: 6,
  },
  attributeChipName: {
    fontSize: 11,
    color: c.label,
    fontWeight: '500',
    maxWidth: 100,
  },
  attributeChipCount: {
    fontSize: 11,
    fontWeight: 'bold',
    color: c.secondaryLabel,
  },

  // 最近照片网格
  recentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 4,
  },
  recentGridItem: {
    width: (winW - 40) / 3, // 3列布局
    height: (winW - 40) / 3,
    position: 'relative', // 添加相对定位，用于覆盖层
  },
  recentGridImage: {
    width: '100%',
    height: '100%',
    borderRadius: 4,
  },

  // 扫描浮窗提示样式（贴近扫描按钮）
  scanTipContainer: {
    position: 'absolute',
    right: 16,
    bottom: 144, // 比按钮高出一些
    maxWidth: winW - 80,
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

  // FAB按钮（bottom 由组件内 insets 动态注入，不在此处声明）
  fab: {
    position: 'absolute',
    right: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: c.accent,
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
    color: c.secondaryLabel,
    marginBottom: 6,
    textAlign: 'center',
  },
  emptyStateSubtext: {
    fontSize: 13,
    color: c.tertiaryLabel,
    textAlign: 'center',
    lineHeight: 18,
  },
  // 开始相似度检测按钮样式
  startSimilarityButton: {
    backgroundColor: c.accent,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    marginTop: 16,
    alignSelf: 'center',
    shadowColor: c.accent,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  startSimilarityButtonDisabled: {
    backgroundColor: c.fillSecondary,
    shadowColor: c.fillSecondary,
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
    color: c.tertiaryLabel,
  },
  // 待分类卡片：显式「开始分类」按钮（替代隐蔽长按）—— 顶部蓝色条，醒目可点。
});

export default HomeScreen;
