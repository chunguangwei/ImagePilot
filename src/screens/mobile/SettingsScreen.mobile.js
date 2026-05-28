/**
 * ImagePilot - 移动端设置页
 * 
 * 功能（与PC端保持一致）：
 * 1. 分类操作（智能分类、清空相册信息）
 * 2. 应用信息（版本、构建版本、平台、存储类型、存储大小）
 */

import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Switch,
  ActivityIndicator,
  TextInput,
  Image,
  Modal,
  Linking,
  Platform,
} from 'react-native';
import { SafeAreaView, Alert, RNFS, AsyncStorage } from '../../adapters/WebAdapters';
import UnifiedDataService from '../../services/UnifiedDataService';
import GalleryScannerService from '../../services/GalleryScannerService';
import ImageStorageService from '../../services/ImageStorageService';
import WeChatAuthService from '../../services/WeChatAuthService';
import * as UpdateService from '../../services/UpdateService';
import DirectoryPicker from '../../components/DirectoryPicker.mobile';
import { logger } from '../../adapters/WebAdapters';
import { presetIcon } from '../../ui/ios/presetIcons';
import { SUPERRES_VARIANTS, ensureModel, isModelDownloaded, resolveSuperRes, deleteModel } from '../../services/enhance/modelSource';
import { BUILD_DATE, BUILD_VERSION, BUILD_VERSION_CODE } from '../../config/BuildInfo';

// iOS 单色图标（字体已打包）；异常时回退 emoji
let SetIonicons = null;
try { SetIonicons = require('react-native-vector-icons/Ionicons').default; } catch (_) { SetIonicons = null; }
import { changeLanguage, getCurrentLanguage, getDefaultPresets } from '../../i18n';

const SettingsScreen = ({ navigation, startSmartScan, onScanProgress }) => {
  const { t, i18n } = useTranslation('common');
  
  // ==================== 状态管理 ====================
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState({});
  const [currentLanguage, setCurrentLanguage] = useState(getCurrentLanguage());
  
  const [storageType, setStorageType] = useState(t('settings.detecting'));
  const [storageSize, setStorageSize] = useState(t('settings.calculating'));
  
  // 扫描路径设置
  const [galleryPaths, setGalleryPaths] = useState([]);
  
  // 目录选择器状态
  const [showDirectoryPicker, setShowDirectoryPicker] = useState(false);
  const [detectingDirectory, setDetectingDirectory] = useState(null);
  
  // 超分(AI增强)模型：小/大/自定义 + 按需下载
  const [srVariant, setSrVariant] = useState('small');
  const [srCustomUrl, setSrCustomUrl] = useState('');
  const [srDownloaded, setSrDownloaded] = useState(false);
  const [srDownloading, setSrDownloading] = useState(false);
  const [srProgress, setSrProgress] = useState(0);

  // AI增强预设相关状态
  const [aiEnhancePresets, setAiEnhancePresets] = useState({});
  const [editingPreset, setEditingPreset] = useState(null); // 当前编辑的预设
  const [showEditModal, setShowEditModal] = useState(false);
  
  // 微信授权相关状态
  const [wechatStatus, setWechatStatus] = useState('checking'); // checking, not_followed, followed_not_member, member
  const [qrCode, setQrCode] = useState('');
  const [credits, setCredits] = useState({ total: 0, used: 0, remaining: 0 });
  const [checkingFollow, setCheckingFollow] = useState(false);

  const pollIntervalRef = useRef(null); // 保存轮询ID

  // ==================== 初始化 ====================
  useEffect(() => {
    loadSettings();
    detectStorageInfo();
    checkMembershipStatus();
    
    // 组件卸载时清理轮询
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, []);

  // 监听语言变化，同步更新 currentLanguage 状态
  useEffect(() => {
    const updateLanguage = () => {
      const newLanguage = getCurrentLanguage();
      if (currentLanguage !== newLanguage) {
        setCurrentLanguage(newLanguage);
      }
    };
    
    // 初始化时设置
    updateLanguage();
    
    // 监听 i18n 语言变化事件（如果支持）
    if (i18n && i18n.on) {
      i18n.on('languageChanged', updateLanguage);
      return () => {
        i18n.off('languageChanged', updateLanguage);
      };
    }
  }, [i18n, currentLanguage]);

  /**
   * 加载设置
   */
  const loadSettings = async () => {
    try {
      setLoading(true);
      const savedSettings = await UnifiedDataService.readSettings();
      
      // 从统一设置中加载照片目录配置
      if (savedSettings.scanPaths && savedSettings.scanPaths.length > 0) {
        setGalleryPaths(savedSettings.scanPaths);
      } else {
        // 如果没有保存的路径，设置为空数组（移动端表示扫描整个设备）
        setGalleryPaths([]);
      }
      
      // 设置其他设置项
      setSettings(savedSettings);
      
      // 加载AI增强预设
      if (savedSettings.aiEnhancePresets) {
        setAiEnhancePresets(savedSettings.aiEnhancePresets);
      }

      // 超分模型选择
      const sr = savedSettings.superResModel || {};
      setSrVariant(sr.variant || 'small');
      setSrCustomUrl(sr.customUrl || '');
      try { const r = await resolveSuperRes(); setSrDownloaded(await isModelDownloaded(r.filename)); } catch (_) {}
      
      logger.debug('设置加载完成:', savedSettings);
    } catch (error) {
      logger.error('❌ 加载设置失败:', error);
      Alert.alert(t('common.error'), t('settings.loadingSettingsFailed'));
    } finally {
      setLoading(false);
    }
  };

  /**
   * 更新设置
   */
  const updateSetting = async (key, value) => {
    try {
      const newSettings = { ...settings, [key]: value };
      await UnifiedDataService.writeSettings(newSettings);
      setSettings(newSettings);
      
      // 通知首页设置已更新（使用多种方式确保兼容性）
      // 方式1: Web环境的CustomEvent
      if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
        window.dispatchEvent(new CustomEvent('settingsUpdated', { 
          detail: { key, value, settings: newSettings } 
        }));
      }
      
      // 方式2: React Native的DeviceEventEmitter（如果可用）
      try {
        const { DeviceEventEmitter } = require('react-native');
        if (DeviceEventEmitter && DeviceEventEmitter.emit) {
          DeviceEventEmitter.emit('settingsUpdated', { key, value, settings: newSettings });
        }
      } catch (e) {
        // DeviceEventEmitter不可用，忽略
      }
    } catch (error) {
      logger.error('保存设置失败:', error);
      Alert.alert(t('common.error'), t('settings.saveSettingsFailed'));
    }
  };

  /**
   * 保存照片目录配置
   */
  const saveGalleryPaths = async (paths) => {
    try {
      logger.debug('正在保存目录配置到统一设置:', paths);
      
      // 移动端允许空数组，表示扫描整个设备
      // 不需要验证路径不能为空数组
      
      // 通过UnifiedDataService保存到统一设置中
      const newSettings = { ...settings, scanPaths: paths };
      await UnifiedDataService.writeSettings(newSettings);
      logger.debug('目录配置已保存到统一设置');
      
      setGalleryPaths(paths);
      setSettings(newSettings);
      
    } catch (error) {
      logger.error('Failed to save gallery paths:', error);
      Alert.alert(t('common.error'), error.message || t('settings.saveDirectoryFailedMessage'));
    }
  };

  /**
   * 打开目录选择器
   */
  const openDirectoryPicker = () => {
    setShowDirectoryPicker(true);
  };

  /**
   * 关闭目录选择器
   */
  const closeDirectoryPicker = () => {
    setShowDirectoryPicker(false);
  };

  /**
   * 从目录选择器选择目录
   */
  const handleDirectorySelected = (selectedPath) => {
    if (selectedPath && !galleryPaths.includes(selectedPath)) {
      const updatedPaths = [...galleryPaths, selectedPath];
      saveGalleryPaths(updatedPaths);
    } else if (galleryPaths.includes(selectedPath)) {
      Alert.alert(t('settings.tip'), t('settings.directoryAlreadyExists'));
    }
  };

  /**
   * 删除路径
   */
  const removeGalleryPath = (pathToRemove) => {
    Alert.alert(
      t('settings.confirmDelete'),
      t('settings.confirmDeletePath', { path: pathToRemove }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            const updatedPaths = galleryPaths.filter(path => path !== pathToRemove);
            saveGalleryPaths(updatedPaths);
          }
        }
      ]
    );
  };

  /**
   * 获取目录类型
   */
  const getDirectoryType = (path) => {
    if (path.includes('WeiXin') || path.includes('WeChat')) return 'wechat';
    if (path.includes('QQ')) return 'qq';
    if (path.includes('DCIM/Camera')) return 'camera';
    if (path.includes('Screenshots')) return 'screenshots';
    return 'unknown';
  };

  /**
   * 智能检测目录（支持微信、QQ、相机、截图）
   */
  const smartDetectDirectory = async (type) => {
    // 定义多个可能的路径
    let candidatePaths = [];
    
    if (type === 'wechat') {
      candidatePaths = [
        '/storage/emulated/0/Tencent/MicroMsg',
        '/storage/emulated/0/Pictures/WeChat',
        '/storage/emulated/0/DCIM/WeChat'
      ];
    } else if (type === 'qq') {
      candidatePaths = [
        '/storage/emulated/0/Tencent/QQ_Images',
        '/storage/emulated/0/Tencent/QQ',
        '/storage/emulated/0/Tencent/MobileQQ/photo',
        '/storage/emulated/0/Tencent/MobileQQ/diskcache',
        '/storage/emulated/0/tencent/Tim_Images',
        '/storage/emulated/0/tencent/QQ_Images',
        '/storage/emulated/0/tencent/mobileqq/photo',
        '/storage/emulated/0/tencent/qq',
        '/storage/emulated/0/Android/data/com.tencent.mobileqq/files/Tencent/QQ_Images'
      ];
    } else if (type === 'camera') {
      candidatePaths = [
        '/storage/emulated/0/DCIM/Camera',
        '/storage/emulated/0/DCIM/100MEDIA',
        '/storage/emulated/0/Pictures'
      ];
    } else if (type === 'screenshots') {
      candidatePaths = [
        '/storage/emulated/0/DCIM/Screenshots',
        '/storage/emulated/0/Pictures/Screenshots',
        '/storage/emulated/0/Pictures/截图'
      ];
    }

    // 收集所有存在的路径
    const foundPaths = [];
    for (const basePath of candidatePaths) {
      try {
        logger.debug(`🔍 检测路径: ${basePath}`);
        const exists = await RNFS.exists(basePath);
        if (exists) {
          const typeName = type === 'wechat' ? t('settings.directorySettings.wechat') : type === 'qq' ? t('settings.directorySettings.qq') : type === 'camera' ? t('settings.directorySettings.camera') : t('settings.directorySettings.screenshots');
          logger.debug(`✅ 检测到${typeName}目录: ${basePath}`);
          foundPaths.push(basePath);
        } else {
          logger.debug(`❌ 路径不存在: ${basePath}`);
        }
      } catch (error) {
        logger.error(`❌ 检测路径异常: ${basePath}`, error);
      }
    }
    
    const typeName = type === 'wechat' ? t('settings.wechat') : type === 'qq' ? t('settings.qq') : type === 'camera' ? t('settings.camera') : t('settings.screenshots');
    if (foundPaths.length > 0) {
      logger.debug(`✅ 找到${foundPaths.length}个${typeName}目录: ${foundPaths.join(', ')}`);
    } else {
      logger.debug(`❌ 未找到${typeName}目录`);
    }
    return foundPaths;
  };

  /**
   * 检测并添加目录
   */
  const detectAndAddDirectory = async (pathOrType) => {
    try {
      // 判断是类型字符串还是路径字符串
      const dirType = pathOrType === 'wechat' || pathOrType === 'qq' || pathOrType === 'camera' || pathOrType === 'screenshots'
        ? pathOrType 
        : getDirectoryType(pathOrType);
      
      setDetectingDirectory(dirType);
      
      if (dirType === 'wechat' || dirType === 'qq' || dirType === 'camera' || dirType === 'screenshots') {
        // 使用智能检测，尝试多个路径
        const foundPaths = await smartDetectDirectory(dirType);
        
        if (foundPaths && foundPaths.length > 0) {
          // 过滤掉已存在的路径
          const newPaths = foundPaths.filter(path => !galleryPaths.includes(path));
          
          if (newPaths.length === 0) {
            Alert.alert(t('settings.tip'), t('settings.allDirectoriesExist'));
          } else {
            // 添加所有新路径
            const updatedPaths = [...galleryPaths, ...newPaths];
            await saveGalleryPaths(updatedPaths);
            
            const typeName = dirType === 'wechat' ? t('settings.wechat') : dirType === 'qq' ? t('settings.qq') : dirType === 'camera' ? t('settings.camera') : t('settings.screenshots');
            if (foundPaths.length > newPaths.length) {
              Alert.alert(t('common.success'), t('settings.addedDirectoriesWithExisting', { new: newPaths.length, type: typeName, total: foundPaths.length, existing: foundPaths.length - newPaths.length }));
            } else {
              Alert.alert(t('common.success'), t('settings.addedDirectories', { count: newPaths.length, type: typeName }));
            }
          }
        } else {
          const typeName = dirType === 'wechat' ? t('settings.wechat') : dirType === 'qq' ? t('settings.qq') : dirType === 'camera' ? t('settings.camera') : t('settings.screenshots');
          Alert.alert(t('common.failed'), t('settings.noDirectoriesFound', { type: typeName }));
        }
      } else {
        // 未知类型使用固定路径检测
        const exists = await RNFS.exists(pathOrType);
        
        if (exists) {
          if (galleryPaths.includes(pathOrType)) {
            Alert.alert(t('settings.tip'), t('settings.directoryAlreadyExists'));
          } else {
            const updatedPaths = [...galleryPaths, pathOrType];
            await saveGalleryPaths(updatedPaths);
            Alert.alert(t('common.success'), t('settings.directoryAddedSuccess'));
          }
        } else {
          Alert.alert(t('common.failed'), t('settings.directoryNotFound'));
        }
      }
    } catch (error) {
      logger.error('检测目录失败:', error);
      Alert.alert(t('common.error'), t('settings.detectionFailed'));
    } finally {
      setDetectingDirectory(null);
    }
  };

  /**
   * 格式化字节大小
   */
  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  /**
   * 获取AsyncStorage存储大小
   */
  const getAsyncStorageSize = async () => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      let totalSize = 0;
      
      for (const key of keys) {
        const value = await AsyncStorage.getItem(key);
        if (value) {
          // 如果 value 是对象，需要序列化为字符串来计算大小
          const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
          totalSize += valueStr.length;
        }
      }
      
      return totalSize;
    } catch (error) {
      logger.error('获取AsyncStorage大小失败:', error);
      return 0;
    }
  };

  /**
   * 获取SQLite数据库大小（通过查询数据估算）
   */
  const getSQLiteSize = async () => {
    try {
      const imageStorageService = new ImageStorageService();
      await imageStorageService.ensureInitialized();
      
      // 获取所有图片数据并计算大小
      const allImages = await UnifiedDataService.readAllImages();
      let totalSize = 0;
      
      // 计算图片数据大小
      if (allImages && allImages.length > 0) {
        totalSize += JSON.stringify(allImages).length;
      }
      
      // 尝试获取其他存储的数据大小
      try {
        const stats = await UnifiedDataService.readCategoryCounts();
        if (stats) totalSize += JSON.stringify(stats).length;
      } catch (e) {
        // 忽略错误
      }
      
      try {
        const settings = await UnifiedDataService.readSettings();
        if (settings) totalSize += JSON.stringify(settings).length;
      } catch (e) {
        // 忽略错误
      }
      
      return totalSize;
    } catch (error) {
      logger.error('获取SQLite大小失败:', error);
      return 0;
    }
  };

  /**
   * 检测存储信息
   */
  const detectStorageInfo = async () => {
    try {
      // 移动端使用 SQLite（通过 ImageStorageService）
      setStorageType('SQLite');
      
      // 移动端：优先尝试获取 SQLite 数据库大小，失败则使用 AsyncStorage
      try {
        const sqliteSize = await getSQLiteSize();
        if (sqliteSize > 0) {
          setStorageSize(formatBytes(sqliteSize));
        } else {
          // SQLite 大小为 0，尝试 AsyncStorage（可能是降级模式）
          const asyncStorageSize = await getAsyncStorageSize();
          setStorageSize(formatBytes(asyncStorageSize));
        }
      } catch (error) {
        // SQLite 获取失败，使用 AsyncStorage
        logger.debug('SQLite 大小获取失败，使用 AsyncStorage:', error);
        const asyncStorageSize = await getAsyncStorageSize();
        setStorageSize(formatBytes(asyncStorageSize));
      }
      
    } catch (error) {
      logger.error('❌ 检测存储信息失败:', error);
      setStorageType('未知');
      setStorageSize('未知');
    }
  };

  // ==================== 会员服务相关 ====================
  
  /**
   * 检查会员状态
   */
  const checkMembershipStatus = async () => {
    try {
      logger.debug('🔍 开始检查会员状态和关注状态...');
      // 统一使用 getCredits 接口获取会员状态和关注状态
      const creditsResult = await WeChatAuthService.getCredits();
      const { isFollowed, isMember } = creditsResult;
      
      if (isMember) {
        logger.debug('✅ 用户为会员');
        setWechatStatus('member');
        setCredits({
          total: creditsResult.total,
          used: creditsResult.used,
          remaining: creditsResult.remaining
        });
      } else if (isFollowed) {
        logger.debug('🔍 用户已关注但未付费');
        setWechatStatus('followed_not_member');
        setCredits({
          total: creditsResult.total,
          used: creditsResult.used,
          remaining: creditsResult.remaining
        });
        // 已关注但未付费时，不需要生成二维码，只启动轮询等待付费
        // 不调用 generateQrCode()，避免显示二维码
      } else {
        logger.debug('🔍 用户未关注公众号');
        setWechatStatus('not_followed');
        await generateQrCode();
      }
    } catch (error) {
      // 查询会员状态失败，使用debug日志（不输出error）
      logger.debug('查询会员状态失败:', error);
      setWechatStatus('not_followed');
      await generateQrCode();
    }
  };
  
  /**
   * 生成二维码
   */
  const generateQrCode = async () => {
    try {
      // 如果已有轮询在运行，先清理
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      
      setCheckingFollow(true);
      const { qrcode } = await WeChatAuthService.generateQrCode();
      setQrCode(qrcode);
      
      // 轮询会员状态和关注状态
      pollIntervalRef.current = setInterval(async () => {
        try {
          const creditsResult = await WeChatAuthService.getCredits();
          const { isFollowed, isMember } = creditsResult;
          
          if (isMember) {
            setWechatStatus('member');
            setCredits({
              total: creditsResult.total,
              used: creditsResult.used,
              remaining: creditsResult.remaining
            });
            // 防止重复弹窗
            if (!activationAlertShownRef.current) {
              activationAlertShownRef.current = true;
              // 确保使用最新的语言设置：从 i18n 实例获取最新的 t 函数
              // 因为 setInterval 回调可能捕获旧的闭包，需要显式获取当前语言
              const currentLang = i18n.language || 'zh';
              // 使用 i18n 实例的 t 函数，确保使用最新语言
              Alert.alert(i18n.t('common.success', { lng: currentLang }), i18n.t('settings.memberActivated', { lng: currentLang }));
            }
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            setCheckingFollow(false);
          } else if (isFollowed) {
            // 已关注但未付费，更新状态和额度，继续轮询等待付费
            setWechatStatus('followed_not_member');
            setCredits({
              total: creditsResult.total,
              used: creditsResult.used,
              remaining: creditsResult.remaining
            });
            // 继续轮询，不停止
          } else {
            // 未关注，更新状态，继续轮询等待关注
            setWechatStatus('not_followed');
            // 继续轮询，不停止
          }
        } catch (e) {
          logger.debug('⏳ 轮询会员状态中...');
        }
      }, 2000);
    } catch (error) {
      // 生成二维码失败，使用debug日志（不输出error和弹窗）
      logger.debug('生成二维码失败:', error);
      setCheckingFollow(false);
    }
  };
  
  const activationAlertShownRef = useRef(false);

  /**
   * 加载额度信息
   */
  const loadCredits = async () => {
    try {
      const creditsData = await WeChatAuthService.getCredits();
      setCredits({
        total: creditsData.total,
        used: creditsData.used,
        remaining: creditsData.remaining
      });
    } catch (error) {
      logger.error('加载额度失败:', error);
    }
  };
  
  /**
   * 点击二维码：保存二维码到相册，然后打开微信主界面
   * 注意：微信限制了直接打开扫一扫的功能，只能打开微信主界面，用户需要手动进入扫一扫
   */
  const openWeChatScan = async () => {
    if (!qrCode) {
      Alert.alert(t('settings.tip'), t('settings.qrCodeNotGenerated'));
      return;
    }

    try {
      logger.debug('🖼️ 开始保存二维码到相册...');
      
      // 先保存二维码到相册
      let saveResult = null;
      if (RNFS && typeof RNFS.saveImageToGallery === 'function') {
        try {
          const fileName = `微信二维码_${Date.now()}.png`;
          saveResult = await RNFS.saveImageToGallery(qrCode, fileName);
          logger.debug('✅ 二维码已保存到相册:', saveResult);
        } catch (saveError) {
          logger.error('❌ 保存二维码到相册失败:', saveError);
          // 即使保存失败，也继续尝试打开微信
        }
      } else {
        logger.warn('⚠️ RNFS.saveImageToGallery 方法不可用');
      }

      // 保存成功后，弹出提示
      if (saveResult) {
        Alert.alert(
          t('settings.saveSuccess'),
          t('settings.qrCodeSavedToAlbum'),
          [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('common.openWeChat'),
              style: 'default',
              onPress: async () => {
                await openWeChatApp();
              }
            }
          ]
        );
      } else {
        // 保存失败，直接尝试打开微信
        Alert.alert(
          t('settings.tip'),
          t('settings.qrCodeSaveFailed'),
          [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('common.openWeChat'),
              style: 'default',
              onPress: async () => {
                await openWeChatApp();
              }
            }
          ]
        );
      }
    } catch (error) {
      logger.error('❌ 操作失败:', error);
      Alert.alert(
        t('settings.tip'),
        t('settings.operationError'),
        [{ text: t('common.gotIt'), style: 'default' }]
      );
    }
  };

  /**
   * 打开微信应用
   */
  const openWeChatApp = async () => {
    try {
      logger.debug('📱 正在打开微信...');
      const weixinMain = 'weixin://';
      const supported = await Linking.canOpenURL(weixinMain);
      if (supported) {
        await Linking.openURL(weixinMain);
        logger.debug('✅ 已打开微信主界面');
        Alert.alert(
          t('settings.tip'),
          t('settings.openedWeChat'),
          [{ text: t('common.gotIt'), style: 'default' }]
        );
      } else {
        logger.warn('⚠️ 无法打开微信');
        Alert.alert(
          t('settings.tip'),
          t('settings.cannotOpenWeChat'),
          [{ text: t('common.gotIt'), style: 'default' }]
        );
      }
    } catch (error) {
      logger.error('❌ 打开微信失败:', error);
      Alert.alert(
        t('settings.tip'),
        t('settings.cannotOpenWeChatManual'),
        [{ text: t('common.gotIt'), style: 'default' }]
      );
    }
  };

  /**
   * 扫描二维码并打开链接（移动端暂不支持自动解析，直接使用保存和调起微信的方式）
   * 此函数保留用于兼容性，但移动端应该使用 openWeChatScan
   */
  const scanQrCodeAndOpen = async () => {
    // 移动端直接调用保存和调起微信的方法
    await openWeChatScan();
  };
  
  // ==================== AI增强预设管理 ====================
  
  /**
   * 打开编辑预设模态框
   */
  const openEditPreset = (presetId) => {
    const preset = aiEnhancePresets[presetId];
    if (preset) {
      // 获取当前语言的缺省预设，用于判断是否是缺省值
      const defaultPresets = getDefaultPresets(currentLanguage);
      const defaultPreset = defaultPresets[presetId];
      const zhDefaults = getDefaultPresets('zh');
      const enDefaults = getDefaultPresets('en');
      
      // 判断是否是缺省值
      const isDefaultName = defaultPreset && (
        preset.name === zhDefaults[presetId]?.name || 
        preset.name === enDefaults[presetId]?.name
      );
      const isDefaultDescription = defaultPreset && (
        preset.description === zhDefaults[presetId]?.description || 
        preset.description === enDefaults[presetId]?.description
      );
      const isDefaultPrompt = defaultPreset && (
        preset.prompt === zhDefaults[presetId]?.prompt || 
        preset.prompt === enDefaults[presetId]?.prompt
      );
      
      // 如果是缺省值，使用当前语言的翻译；否则使用用户修改的值
      const displayName = (defaultPreset && isDefaultName) ? defaultPreset.name : preset.name;
      const displayDescription = (defaultPreset && isDefaultDescription) ? defaultPreset.description : preset.description;
      const displayPrompt = (defaultPreset && isDefaultPrompt) ? defaultPreset.prompt : preset.prompt;
      
      setEditingPreset({
        id: presetId,
        name: displayName,
        icon: preset.icon,
        prompt: displayPrompt,
        description: displayDescription,
        enabled: preset.enabled,
        sortOrder: preset.sortOrder,
        // 保存原始值，用于判断是否修改过
        _originalName: preset.name,
        _originalDescription: preset.description,
        _originalPrompt: preset.prompt
      });
      setShowEditModal(true);
    }
  };
  
  /**
   * 保存编辑的预设
   */
  const saveEditedPreset = async () => {
    if (!editingPreset) return;
    
    try {
      // 获取缺省值用于判断
      const defaultPresets = getDefaultPresets(currentLanguage);
      const defaultPreset = defaultPresets[editingPreset.id];
      const zhDefaults = getDefaultPresets('zh');
      const enDefaults = getDefaultPresets('en');
      
      // 判断原始值是否是缺省值
      const wasDefaultName = editingPreset._originalName && (
        editingPreset._originalName === zhDefaults[editingPreset.id]?.name || 
        editingPreset._originalName === enDefaults[editingPreset.id]?.name
      );
      const wasDefaultDescription = editingPreset._originalDescription && (
        editingPreset._originalDescription === zhDefaults[editingPreset.id]?.description || 
        editingPreset._originalDescription === enDefaults[editingPreset.id]?.description
      );
      const wasDefaultPrompt = editingPreset._originalPrompt !== undefined && (
        editingPreset._originalPrompt === zhDefaults[editingPreset.id]?.prompt || 
        editingPreset._originalPrompt === enDefaults[editingPreset.id]?.prompt
      );
      
      // 判断用户是否修改了值
      const nameChanged = editingPreset.name !== editingPreset._originalName;
      const descriptionChanged = editingPreset.description !== editingPreset._originalDescription;
      const promptChanged = editingPreset.prompt !== editingPreset._originalPrompt;
      
      // 确定保存的值：
      // - 如果原始值是缺省值，且用户没有修改，保存当前语言的缺省值
      // - 如果用户修改了，保存用户修改的值
      const savedName = (wasDefaultName && !nameChanged && defaultPreset) 
        ? defaultPreset.name 
        : editingPreset.name;
      const savedDescription = (wasDefaultDescription && !descriptionChanged && defaultPreset) 
        ? defaultPreset.description 
        : editingPreset.description;
      const savedPrompt = (wasDefaultPrompt && !promptChanged && defaultPreset) 
        ? defaultPreset.prompt 
        : editingPreset.prompt;
      
      const updatedPresets = {
        ...aiEnhancePresets,
        [editingPreset.id]: {
          name: savedName,
          icon: editingPreset.icon,
          prompt: savedPrompt,
          description: savedDescription,
          enabled: editingPreset.enabled,
          sortOrder: editingPreset.sortOrder
        }
      };
      
      const newSettings = { ...settings, aiEnhancePresets: updatedPresets };
      await UnifiedDataService.writeSettings(newSettings);
      
      setAiEnhancePresets(updatedPresets);
      setSettings(newSettings);
      setShowEditModal(false);
      setEditingPreset(null);
      
      // 通知其他页面设置已更新（仅在 Web 环境支持 CustomEvent 时）
      if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
        window.dispatchEvent(new CustomEvent('settingsUpdated', { 
          detail: { key: 'aiEnhancePresets', value: updatedPresets, settings: newSettings } 
        }));
      }
      
      Alert.alert(t('common.success'), t('settings.presetSaved'));
    } catch (error) {
      logger.error('保存AI增强预设失败:', error);
      Alert.alert(t('common.error'), t('settings.savePresetFailed'));
    }
  };
  
  /**
   * 切换预设启用状态
   */
  const togglePresetEnabled = async (presetId) => {
    try {
      const updatedPresets = {
        ...aiEnhancePresets,
        [presetId]: {
          ...aiEnhancePresets[presetId],
          enabled: !aiEnhancePresets[presetId].enabled
        }
      };
      
      const newSettings = { ...settings, aiEnhancePresets: updatedPresets };
      await UnifiedDataService.writeSettings(newSettings);
      
      setAiEnhancePresets(updatedPresets);
      setSettings(newSettings);
      
      // 通知其他页面设置已更新（仅在 Web 环境支持 CustomEvent 时）
      if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
        window.dispatchEvent(new CustomEvent('settingsUpdated', { 
          detail: { key: 'aiEnhancePresets', value: updatedPresets, settings: newSettings } 
        }));
      }
    } catch (error) {
      logger.error('切换预设状态失败:', error);
      Alert.alert(t('common.error'), t('settings.operationFailed'));
    }
  };
  
  // ==================== 分类操作 ====================

  /**
   * 方案2：App 内下载并安装；无直链或失败时兜底浏览器。
   */
  const startUpdate = async (info) => {
    if (!info || !info.apkUrl) {
      UpdateService.openDownload(info);
      return;
    }
    Alert.alert(t('settings.downloadingTitle'), t('settings.downloadingMessage'));
    try {
      await UpdateService.downloadAndInstall(info.apkUrl, () => {});
      // 成功后系统安装器会自动弹出
    } catch (e) {
      if (e && e.code === 'E_NEED_PERMISSION') {
        Alert.alert(t('settings.installPermTitle'), t('settings.installPermMessage'));
      } else {
        Alert.alert(
          t('settings.updateFailedTitle'),
          t('settings.updateFailedMessage', { error: e?.message || String(e) }),
          [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('settings.openReleasesPage'), style: 'default', onPress: () => UpdateService.openReleasesPage() },
          ],
        );
      }
    }
  };

  /**
   * 检查更新（手动）：查 GitHub Releases，有新版引导下载
   */
  const handleCheckUpdate = async () => {
    try {
      const info = await UpdateService.checkForUpdate();
      if (info.hasUpdate) {
        const notes = info.notes ? `\n\n${String(info.notes).slice(0, 280)}` : '';
        Alert.alert(
          t('settings.updateFoundTitle', { version: info.latestVersion }),
          t('settings.updateFoundMessage', { version: info.latestVersion }) + notes,
          [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('settings.updateNow'), style: 'default', onPress: () => startUpdate(info) },
          ],
        );
      } else {
        Alert.alert(t('settings.alreadyLatest'), t('settings.currentVersionTip', { version: info.currentVersion }));
      }
    } catch (e) {
      // API 不可达（如网络/限流）→ 兜底：引导去 GitHub 发布页手动查看下载
      Alert.alert(
        t('settings.checkUpdateFailed'),
        t('settings.checkUpdateFailedMessage', { error: e?.message || String(e) }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('settings.openReleasesPage'), style: 'default', onPress: () => UpdateService.openReleasesPage() },
        ],
      );
    }
  };

  /**
   * 清空相册信息
   */
  const handleClearData = () => {
    // 先检查是否正在扫描（使用全局变量）
    if (window.isScanning) {
      Alert.alert(
        t('settings.operationTip'),
        t('settings.scanningInProgress'),
        [{ text: '确定', style: 'default' }]
      );
      return;
    }

    // 扫描未进行时才显示确认对话框
    Alert.alert(
      t('settings.clearPhotoInfo'),
      t('settings.confirmClearPhotoInfo'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.confirmClear'),
          style: 'destructive',
          onPress: async () => {
            try {
              await UnifiedDataService.clearAllData();
              Alert.alert(t('common.success'), t('settings.photoInfoCleared'));
              // 重新加载设置和存储信息
              await loadSettings();
              await detectStorageInfo();
            } catch (error) {
              logger.error('❌ 清空数据失败:', error);
              Alert.alert(t('common.failed'), error.message);
            }
          },
        },
      ]
    );
  };


  // ==================== 渲染函数 ====================

  /**
   * 渲染操作按钮
   */
  const renderActionButton = (icon, title, description, onPress, danger = false) => (
    <TouchableOpacity
      style={styles.actionButton}
      onPress={onPress}
      activeOpacity={0.6}
    >
      <View style={styles.actionButtonRow}>
        <View style={styles.actionButtonMain}>
          <Text style={[styles.actionButtonText, danger && styles.dangerText]}>
            {SetIonicons ? <SetIonicons name={icon} size={17} color={danger ? '#FF3B30' : '#007AFF'} /> : null} {title}
          </Text>
          <Text style={styles.actionButtonDescription}>{description}</Text>
        </View>
        {!danger ? <Text style={styles.actionChevron}>›</Text> : null}
      </View>
    </TouchableOpacity>
  );

  // ===== 超分(AI增强)模型：小/大/自定义 + 按需下载 =====
  const refreshSrStatus = async () => {
    try { const r = await resolveSuperRes(); setSrDownloaded(await isModelDownloaded(r.filename)); } catch (_) {}
  };
  const selectSrVariant = async (v) => {
    setSrVariant(v);
    await updateSetting('superResModel', { variant: v, customUrl: srCustomUrl });
    await refreshSrStatus();
  };
  const saveSrCustomUrl = async () => {
    const u = (srCustomUrl || '').trim();
    await updateSetting('superResModel', { variant: 'custom', customUrl: u });
    setSrVariant('custom');
    await refreshSrStatus();
  };
  const downloadSrModel = async () => {
    setSrDownloading(true); setSrProgress(0);
    try {
      const r = await resolveSuperRes();
      if (!r.url) { Alert.alert(t('common.tip') || '提示', '请先填写自定义模型链接'); return; }
      await deleteModel(r.filename).catch(() => {}); // 重新下载：先删旧
      await ensureModel(r.filename, r.url, (p) => setSrProgress(p));
      setSrDownloaded(true);
      Alert.alert(t('common.success') || '完成', '模型已下载，可用于 AI 增强');
    } catch (e) {
      Alert.alert('下载失败', (e?.message || String(e)).replace(/^E_\w+\s*/, ''));
    } finally { setSrDownloading(false); }
  };

  const renderSuperResModel = () => {
    const opts = [
      { key: 'small', label: SUPERRES_VARIANTS.small.label },
      { key: 'large', label: SUPERRES_VARIANTS.large.label },
      { key: 'custom', label: '自定义链接（.onnx）' },
    ];
    return (
      <View style={styles.actionButton}>
        <Text style={styles.actionButtonText}>
          {SetIonicons ? <SetIonicons name="color-wand-outline" size={17} color="#007AFF" /> : null} AI 增强模型（超分）
        </Text>
        <Text style={styles.actionButtonDescription}>模型按需下载（不占安装包）。大模型更清晰但更慢更大。</Text>
        {opts.map((o) => (
          <TouchableOpacity key={o.key} style={styles.srOptionRow} onPress={() => selectSrVariant(o.key)} activeOpacity={0.6}>
            {SetIonicons
              ? <SetIonicons name={srVariant === o.key ? 'radio-button-on' : 'radio-button-off'} size={20} color={srVariant === o.key ? '#007AFF' : '#C6C6C8'} />
              : <Text>{srVariant === o.key ? '●' : '○'}</Text>}
            <Text style={styles.srOptionLabel}>{o.label}</Text>
          </TouchableOpacity>
        ))}
        {srVariant === 'custom' && (
          <View style={styles.srCustomRow}>
            <TextInput
              style={styles.srInput}
              placeholder="https://.../model.onnx（输入/输出须与 Real-ESRGAN 一致）"
              placeholderTextColor="#8E8E93"
              value={srCustomUrl}
              onChangeText={setSrCustomUrl}
              autoCapitalize="none"
              onBlur={saveSrCustomUrl}
            />
          </View>
        )}
        <View style={styles.srStatusRow}>
          <Text style={styles.srStatusText}>{srDownloaded ? '✓ 已下载' : '未下载'}</Text>
          <TouchableOpacity
            style={[styles.srDownloadBtn, srDownloading && { opacity: 0.5 }]}
            disabled={srDownloading}
            onPress={downloadSrModel}>
            <Text style={styles.srDownloadBtnText}>
              {srDownloading ? `下载中 ${Math.round(srProgress * 100)}%` : (srDownloaded ? '重新下载' : '下载模型')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  /**
   * 渲染信息项
   */
  const renderInfoItem = (label, value) => (
    <View style={styles.infoItem}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );

  /**
   * 渲染语言选择项（应用信息部分）
   */
  const renderLanguageItem = () => (
    <View style={styles.infoItem}>
      <Text style={styles.infoLabel}>{t('settings.language')}</Text>
      <View style={styles.languageSelectorInline}>
        <TouchableOpacity
          style={[styles.languageButtonInline, currentLanguage === 'zh' && styles.languageButtonInlineActive]}
          onPress={async () => {
            try {
              await changeLanguage('zh');
              // 等待 changeLanguage 完成后再更新状态，确保同步
              const newLanguage = getCurrentLanguage();
              setCurrentLanguage(newLanguage);
              logger.debug('🌐 语言已切换到中文，当前语言:', newLanguage);
            } catch (error) {
              logger.error('❌ 切换语言失败:', error);
              Alert.alert(t('common.error'), t('settings.languageSwitchFailed') || '切换语言失败');
            }
          }}
        >
          <Text style={[styles.languageButtonTextInline, currentLanguage === 'zh' && styles.languageButtonTextInlineActive]}>
            {t('common.chinese')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.languageButtonInline, currentLanguage === 'en' && styles.languageButtonInlineActive]}
          onPress={async () => {
            try {
              await changeLanguage('en');
              // 等待 changeLanguage 完成后再更新状态，确保同步
              const newLanguage = getCurrentLanguage();
              setCurrentLanguage(newLanguage);
              logger.debug('🌐 语言已切换到英文，当前语言:', newLanguage);
            } catch (error) {
              logger.error('❌ 切换语言失败:', error);
              Alert.alert(t('common.error'), t('settings.languageSwitchFailed') || '切换语言失败');
            }
          }}
        >
          <Text style={[styles.languageButtonTextInline, currentLanguage === 'en' && styles.languageButtonTextInlineActive]}>
            {t('common.english')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  /**
   * 渲染分组标题
   */
  const renderSectionTitle = (title) => (
    <Text style={styles.sectionTitle}>{title}</Text>
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
        <Text style={styles.headerTitle}>{t('settings.title')}</Text>
      </View>

      {/* 设置列表 */}
      <ScrollView style={styles.scrollView}>
        {/* 智能分类 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.titleRow}>
              <Text style={styles.sectionTitle} numberOfLines={1} ellipsizeMode="tail">{SetIonicons ? <SetIonicons name="hardware-chip-outline" size={17} color="#007AFF" /> : null} {t('settings.smartClassification')}</Text>
            </View>
          </View>
          
          {renderActionButton(
            'trash-outline',
            t('settings.clearAlbumInfo'),
            t('settings.clearAlbumInfoDesc'),
            handleClearData,
            true
          )}

          {/* 🆕 AI 模型设置：配置个人 LLM API Key，启用云端在线分类 */}
          {renderActionButton(
            'cloud-outline',
            t('settings.aiModelConfig') || 'AI 模型设置（在线分类）',
            t('settings.aiModelConfigDesc') || '配置 OpenAI / Kimi 等大模型 API Key，启用云端在线分类',
            () => navigation.navigate('AIModelConfig'),
            false
          )}

          {/* 🆕 自定义分类：定义规则，云端大模型按规则归类 */}
          {renderActionButton(
            'pricetag-outline',
            '自定义分类',
            '定义你自己的分类规则，云端大模型按规则把图片归入',
            () => navigation.navigate('CustomCategories'),
            false
          )}

          {/* 🆕 检查更新：从 GitHub Releases 升级到客户端 */}
          {renderActionButton(
            'cloud-download-outline',
            t('settings.checkUpdate'),
            t('settings.checkUpdateDesc', { version: UpdateService.CURRENT_VERSION }),
            handleCheckUpdate,
            false
          )}

          {/* 超分(AI增强)模型：小/大/自定义 + 按需下载 */}
          {renderSuperResModel()}

          {/* 本地分类设置 - 与目录设置平级，使用actionButton样式 */}
          <View style={styles.actionButton}>
            <Text style={styles.actionButtonText}>{SetIonicons ? <SetIonicons name="phone-portrait-outline" size={17} color="#007AFF" /> : null} {t('settings.localClassification')}</Text>
            
            {/* 使用MobileNetV3分类 - 子区块 */}
            <View style={styles.switchItemCompact}>
              <View style={styles.switchItemCompactLeft}>
                <Text style={styles.switchLabelCompact} numberOfLines={1}>{SetIonicons ? <SetIonicons name="cube-outline" size={15} color="#007AFF" /> : null} {t('settings.enableMobileNetV3')}</Text>
                <Switch
                  value={settings.enableMobileNetV3Classification === true}
                  onValueChange={(value) => updateSetting('enableMobileNetV3Classification', value)}
                  trackColor={{ false: '#E5E5EA', true: '#34C759' }}
                  thumbColor="#FFFFFF"
                />
              </View>
              <Text style={styles.switchDescriptionCompact}>
                {t('settings.enableMobileNetV3Desc')}
              </Text>
            </View>

            {/* 相似度检测阈值 - 子区块 */}
            <View style={styles.switchItemCompact}>
              <Text style={styles.switchLabelCompact}>🔗 {t('settings.similarityThreshold')}</Text>
              <Text style={styles.switchDescriptionCompact}>
                {t('settings.similarityThresholdDesc')}
              </Text>
              <View style={styles.quickDirectoryRow}>
                {[0.8, 0.85, 0.9, 0.95].map((val) => {
                  let currentVal = (settings.similarityThreshold != null && settings.similarityThreshold >= 0 && settings.similarityThreshold <= 1)
                    ? settings.similarityThreshold
                    : 0.8;
                  if (currentVal < 0.8) currentVal = 0.8; // 最低 80%
                  const isSelected = Math.abs(currentVal - val) < 0.01;
                  return (
                    <TouchableOpacity
                      key={val}
                      style={[styles.quickDirectoryButton, isSelected && styles.quickDirectoryButtonDetecting]}
                      onPress={() => updateSetting('similarityThreshold', val)}
                    >
                      <Text style={styles.quickDirectoryButtonText}>{Math.round(val * 100)}%</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>
          
          {/* 目录设置 - 与"清空相册信息"区域对齐 */}
          <View style={styles.actionButton}>
            <Text style={styles.actionButtonText}>{t('settings.directorySettings.title')}</Text>
            <Text style={styles.actionButtonDescription}>
              {t('settings.directorySettings.description')}
            </Text>
            
            {/* 目录选择器按钮 */}
            <TouchableOpacity
              style={styles.directoryPickerButton}
              onPress={openDirectoryPicker}
            >
              <Text style={styles.directoryPickerButtonText}>{t('settings.directorySettings.browseSelectDirectory')}</Text>
            </TouchableOpacity>

            {/* 快捷目录按钮 */}
            <View style={styles.quickDirectoryContainer}>
              <Text style={styles.quickDirectoryTitle}>{t('settings.directorySettings.quickAddCommonDirectories')}</Text>
              <View style={styles.quickDirectoryRow}>
                <TouchableOpacity
                  style={[styles.quickDirectoryButton, detectingDirectory === 'wechat' && styles.quickDirectoryButtonDetecting]}
                  onPress={() => detectAndAddDirectory('wechat')}
                  disabled={!!detectingDirectory}
                >
                  <Text style={styles.quickDirectoryButtonText}>
                    {detectingDirectory === 'wechat' ? `🔍 ${t('settings.detecting')}` : `💬 ${t('settings.directorySettings.wechatDirectory')}`}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.quickDirectoryButton, detectingDirectory === 'qq' && styles.quickDirectoryButtonDetecting]}
                  onPress={() => detectAndAddDirectory('qq')}
                  disabled={!!detectingDirectory}
                >
                  <Text style={styles.quickDirectoryButtonText}>
                    {detectingDirectory === 'qq' ? `🔍 ${t('settings.detecting')}` : `💬 ${t('settings.directorySettings.qqDirectory')}`}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.quickDirectoryRow}>
                <TouchableOpacity
                  style={[styles.quickDirectoryButton, detectingDirectory === 'camera' && styles.quickDirectoryButtonDetecting]}
                  onPress={() => detectAndAddDirectory('camera')}
                  disabled={!!detectingDirectory}
                >
                  <Text style={styles.quickDirectoryButtonText}>
                    {detectingDirectory === 'camera' ? `🔍 ${t('settings.detecting')}` : `📷 ${t('settings.directorySettings.cameraDirectory')}`}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.quickDirectoryButton, detectingDirectory === 'screenshots' && styles.quickDirectoryButtonDetecting]}
                  onPress={() => detectAndAddDirectory('screenshots')}
                  disabled={!!detectingDirectory}
                >
                  <Text style={styles.quickDirectoryButtonText}>
                    {detectingDirectory === 'screenshots' ? `🔍 ${t('settings.detecting')}` : `📸 ${t('settings.directorySettings.screenshotsDirectory')}`}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* 路径列表 */}
            {galleryPaths.map((path, index) => (
              <View key={index} style={styles.pathItem}>
                <Text style={styles.pathText} numberOfLines={1} ellipsizeMode="middle">
                  {path}
                </Text>
                <TouchableOpacity
                  style={styles.removeButton}
                  onPress={() => removeGalleryPath(path)}
                >
                  <Text style={styles.removeButtonText}>×</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </View>

        {/* 照片创玩 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.titleRow}>
              <Text style={styles.sectionTitle}>✨ {t('settings.photoEnhancement')}</Text>
            </View>
          </View>
          <Text style={styles.sectionDescription}>
            {t('settings.photoEnhancementDesc')}
          </Text>
          
          {Object.entries(aiEnhancePresets)
            .sort(([, a], [, b]) => a.sortOrder - b.sortOrder)
            .map(([presetId, preset]) => {
              // 获取当前语言的缺省预设，用于显示
              const defaultPresets = getDefaultPresets(currentLanguage);
              const defaultPreset = defaultPresets[presetId];
              
              // 如果是缺省预设，且用户没有修改过名称、描述和提示词，使用当前语言的翻译
              // 判断方法：检查当前值是否等于中文或英文的缺省值
              const zhDefaults = getDefaultPresets('zh');
              const enDefaults = getDefaultPresets('en');
              const isDefaultName = defaultPreset && (
                preset.name === zhDefaults[presetId]?.name || 
                preset.name === enDefaults[presetId]?.name
              );
              const isDefaultDescription = defaultPreset && (
                preset.description === zhDefaults[presetId]?.description || 
                preset.description === enDefaults[presetId]?.description
              );
              const isDefaultPrompt = defaultPreset && (
                preset.prompt === zhDefaults[presetId]?.prompt || 
                preset.prompt === enDefaults[presetId]?.prompt
              );
              
              // 显示用的名称、描述和提示词
              const displayName = (defaultPreset && isDefaultName) ? defaultPreset.name : preset.name;
              const displayDescription = (defaultPreset && isDefaultDescription) ? defaultPreset.description : preset.description;
              const displayPrompt = (defaultPreset && isDefaultPrompt) ? defaultPreset.prompt : preset.prompt;
              
              return (
                <View key={presetId} style={styles.presetItem}>
                  <View style={styles.presetLeft}>
                    {SetIonicons
                      ? <SetIonicons name={presetIcon(presetId)} size={24} color="#007AFF" style={styles.presetIcon} />
                      : <Text style={styles.presetIcon}>{preset.icon}</Text>}
                    <View style={styles.presetInfo}>
                      <Text style={styles.presetName}>{displayName}</Text>
                      <Text style={styles.presetPrompt} numberOfLines={2}>
                        {displayPrompt || t('settings.noPromptSet')}
                      </Text>
                    </View>
                  </View>
                <View style={styles.presetRight}>
                  <TouchableOpacity
                    style={styles.editPresetButton}
                    onPress={() => openEditPreset(presetId)}>
                    <Text style={styles.editPresetButtonText}>{t('settings.editPreset')}</Text>
                  </TouchableOpacity>
                  <Switch
                    value={preset.enabled}
                    onValueChange={() => togglePresetEnabled(presetId)}
                    trackColor={{ false: '#ccc', true: '#4CAF50' }}
                  />
                </View>
              </View>
              );
            })}
          
        </View>

        {/* 会员服务（已按需求隐藏，不向用户展示会员/额度/二维码） */}
        {false && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.titleRow}>
              <Text style={styles.sectionTitle}>💎 {t('settings.membershipService')}</Text>
            </View>
          </View>
          
          {/* 付费会员 */}
          <View style={styles.membershipCardPremium}>
            <View style={styles.membershipHeader}>
              <Text style={styles.membershipIcon}>💎</Text>
              <View>
                <Text style={styles.membershipName}>{t('settings.lifetimeMember')}</Text>
                <Text style={styles.membershipTagPremium}>
                  {wechatStatus === 'member' 
                    ? t('settings.activated') 
                    : wechatStatus === 'followed_not_member' 
                    ? t('settings.followedPendingActivation')
                    : t('settings.notActivated')}
                </Text>
              </View>
            </View>

            {/* 权益列表 */}
            <View style={styles.membershipFeaturesColumn}>
              <View style={styles.membershipFeatureItem}>
                <Text style={styles.membershipFeatureIcon}>✓</Text>
                <Text style={styles.membershipFeatureText}>{t('settings.lifetimeMemberSmartClassification')}</Text>
              </View>
              <View style={styles.membershipFeatureItem}>
                <Text style={styles.membershipFeatureIcon}>✓</Text>
                <Text style={styles.membershipFeatureText}>{t('settings.lifetimeMemberPhotoEnhancement')}</Text>
              </View>
              
              {/* 如果已关注（包括已关注未付费和已付费），在AI修图下面显示额度信息 */}
              {(wechatStatus === 'member' || wechatStatus === 'followed_not_member') && (
                <View style={styles.creditsInfoInline}>
                  <Text style={styles.creditsLabelInline}>{t('settings.remainingCredits')}: </Text>
                  <Text style={styles.creditsValueInline} numberOfLines={1}>
                    {credits.remaining}
                  </Text>
                </View>
              )}
            </View>

            {/* 免费会员权限声明 */}
            <View style={styles.freeMemberSection}>
              <Text style={styles.freeMemberTitle}>{t('settings.freeMember')}</Text>
              <View style={styles.freeMemberFeatureItem}>
                <Text style={styles.freeMemberFeatureText}>{t('settings.freeMemberSmartClassification')}</Text>
              </View>
              <View style={styles.freeMemberFeatureItem}>
                <Text style={styles.freeMemberFeatureText}>{t('settings.freeMemberPhotoEnhancement')}</Text>
              </View>
            </View>

            {/* 二维码区域（仅未关注时显示） */}
            {wechatStatus === 'not_followed' && (
              <View style={styles.membershipQrColumn}>
                {qrCode ? (
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={openWeChatScan}>
                    <Image
                      source={{ uri: qrCode }}
                      style={styles.membershipQrCode}
                    />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={styles.membershipQrButton}
                    onPress={generateQrCode}>
                    <Text style={styles.membershipQrButtonText}>
                      {checkingFollow ? t('settings.generating') : t('settings.generateQrCode')}
                    </Text>
                  </TouchableOpacity>
                )}
                <Text style={styles.membershipQrHint}>
                  {qrCode ? t('settings.clickQrCodeToOpenWeChat') : t('settings.qrCodeHint')}
                </Text>
              </View>
            )}
          </View>
        </View>
        )}

        {/* 应用信息 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.titleRow}>
              <Text style={styles.sectionTitle}>ℹ️ {t('settings.appInfo')}</Text>
            </View>
          </View>
          {renderInfoItem(t('settings.version'), BUILD_VERSION)}
          {renderInfoItem(t('settings.buildVersion'), `${BUILD_VERSION_CODE} (${BUILD_DATE})`)}
          {renderInfoItem(t('settings.platform'), t('settings.mobile'))}
          {renderInfoItem(t('settings.storageType'), storageType)}
          {renderInfoItem(t('settings.storageSize'), storageSize)}
          {renderLanguageItem()}
        </View>

        {/* 底部空白 */}
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* 目录选择器 */}
      <DirectoryPicker
        visible={showDirectoryPicker}
        onClose={closeDirectoryPicker}
        onSelectDirectory={handleDirectorySelected}
      />

      {/* 编辑预设模态框 */}
      <Modal
        visible={showEditModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {
          setShowEditModal(false);
          setEditingPreset(null);
        }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingPreset?.name || t('common.edit')}</Text>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => {
                  setShowEditModal(false);
                  setEditingPreset(null);
                }}>
                <Text style={styles.modalCloseButtonText}>×</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              {editingPreset && (
                <>
                  <View style={styles.presetInfoDisplay}>
                    {SetIonicons
                      ? <SetIonicons name={presetIcon(editingPreset.id)} size={40} color="#007AFF" style={styles.presetIconLarge} />
                      : <Text style={styles.presetIconLarge}>{editingPreset.icon}</Text>}
                    <View>
                      <Text style={styles.presetNameLarge}>{editingPreset.name}</Text>
                      <Text style={styles.presetDescriptionSmall}>
                        {editingPreset.description}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.modalField}>
                    <Text style={styles.modalLabel}>{t('settings.prompt')}</Text>
                    <TextInput
                      style={[styles.modalInput, styles.modalTextArea]}
                      value={editingPreset.prompt}
                      onChangeText={(text) =>
                        setEditingPreset({ ...editingPreset, prompt: text })
                      }
                      placeholder={t('settings.promptPlaceholder')}
                      multiline
                      numberOfLines={6}
                      textAlignVertical="top"
                    />

                    {/* 证件类型快捷按钮（仅限证件处理预设） */}
                    {editingPreset.id === 'document' && (
                      <View style={styles.documentButtonsContainer}>
                        <TouchableOpacity
                          style={styles.documentButton}
                          onPress={() => {
                            const idCardPrompt = t('settings.idCardPrompt');
                            setEditingPreset({ ...editingPreset, prompt: idCardPrompt });
                          }}>
                          <Text style={styles.documentButtonText}>🆔 {t('settings.idCard')}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.documentButton}
                          onPress={() => {
                            const passportPrompt = t('settings.passportPrompt');
                            setEditingPreset({ ...editingPreset, prompt: passportPrompt });
                          }}>
                          <Text style={styles.documentButtonText}>📘 {t('settings.passport')}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.documentButton}
                          onPress={() => {
                            const hkMacauPrompt = t('settings.hkMacauPassPrompt');
                            setEditingPreset({ ...editingPreset, prompt: hkMacauPrompt });
                          }}>
                          <Text style={styles.documentButtonText}>🏝️ {t('settings.hkMacauPass')}</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </>
              )}
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => {
                  setShowEditModal(false);
                  setEditingPreset(null);
                }}>
                <Text style={styles.modalCancelButtonText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveButton} onPress={saveEditedPreset}>
                <Text style={styles.modalSaveButtonText}>保存</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    marginTop: 16,
    fontSize: 16,
    color: '#8E8E93',
  },
  
  // 扫描路径设置样式
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#8E8E93',
    fontWeight: 'normal',
    marginLeft: 8,
    flex: 1,
    textAlignVertical: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  directoryPickerButton: {
    marginTop: 8,
    marginBottom: 8,
    padding: 16,
    backgroundColor: '#007AFF',
    borderRadius: 8,
    alignItems: 'center',
  },
  directoryPickerButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  pathItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  pathText: {
    flex: 1,
    fontSize: 14,
    color: '#333',
    fontFamily: 'monospace',
  },
  removeButton: {
    marginLeft: 12,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#ff4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  header: {
    height: 56,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000000',
  },
  scrollView: {
    flex: 1,
  },
  
  // 分组
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#8E8E93',
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    flex: 1,
    textAlignVertical: 'center',
  },
  section: {
    backgroundColor: '#FFFFFF',
    marginTop: 8,
  },
  
  // 操作按钮（iOS 风格：纯白圆角单元格 + 右侧箭头）
  actionButton: {
    marginHorizontal: 16,
    marginVertical: 5,
    paddingHorizontal: 16,
    paddingVertical: 13,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
  },
  actionButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionButtonMain: {
    flex: 1,
  },
  actionChevron: {
    color: '#C4C4C6',
    fontSize: 22,
    marginLeft: 8,
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
  },
  actionButtonDescription: {
    fontSize: 13,
    color: '#8E8E93',
    marginTop: 3,
    lineHeight: 18,
  },
  // 超分模型选择
  srOptionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9 },
  srOptionLabel: { fontSize: 15, color: '#000000', marginLeft: 10 },
  srCustomRow: { marginTop: 4, marginBottom: 4 },
  srInput: { borderWidth: StyleSheet.hairlineWidth, borderColor: '#C6C6C8', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13, color: '#000000', backgroundColor: '#F2F2F7' },
  srStatusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  srStatusText: { fontSize: 13, color: '#8E8E93' },
  srDownloadBtn: { backgroundColor: '#007AFF', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 },
  srDownloadBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  dangerText: {
    color: '#FF3B30',
  },
  
  // 信息项
  infoItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  infoLabel: {
    fontSize: 16,
    color: '#000000',
  },
  infoValue: {
    fontSize: 14,
    color: '#8E8E93',
    textAlign: 'right',
    flex: 1,
    marginLeft: 16,
  },
  // 子区域样式
  subSection: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  subSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 8,
  },
  subSectionDescription: {
    fontSize: 14,
    color: '#8E8E93',
    marginBottom: 12,
  },
  // AI增强预设样式
  sectionDescription: {
    fontSize: 14,
    color: '#8E8E93',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  presetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  presetLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
    marginRight: 12,
  },
  presetIcon: {
    fontSize: 28,
    marginRight: 12,
  },
  presetInfo: {
    flex: 1,
  },
  presetName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 6,
  },
  presetPrompt: {
    fontSize: 13,
    color: '#8E8E93',
    lineHeight: 18,
  },
  presetRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  editPresetButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#007AFF',
    borderRadius: 6,
    marginRight: 12,
  },
  editPresetButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  // 额度显示样式
  creditsContainer: {
    margin: 16,
    padding: 16,
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  creditsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 12,
  },
  creditsInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  creditsLabel: {
    fontSize: 14,
    color: '#8E8E93',
  },
  creditsValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
    marginLeft: 8,
  },
  creditsDescription: {
    fontSize: 13,
    color: '#8E8E93',
  },
  // 内联额度显示样式（与PC端对齐）
  creditsInfoInline: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#E5E5EA',
    flexWrap: 'nowrap',
    marginLeft: 28, // 与AI修图文案对齐（对号宽度20 + 间距8）
  },
  creditsLabelInline: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
    flexShrink: 0,
  },
  creditsValueInline: {
    fontSize: 14,
    color: '#4CAF50',
    fontWeight: '600',
    marginLeft: 4,
    flexShrink: 0,
  },
  // 会员服务样式
  membershipCard: {
    margin: 16,
    padding: 16,
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  membershipCardPremium: {
    margin: 16,
    padding: 16,
    backgroundColor: '#FFF7E6',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FFD700',
  },
  membershipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  membershipIcon: {
    fontSize: 32,
    marginRight: 12,
  },
  membershipName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 4,
  },
  membershipTag: {
    fontSize: 13,
    color: '#4CAF50',
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  membershipTagPremium: {
    fontSize: 13,
    color: '#FF9800',
    backgroundColor: '#FFF3E0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  membershipFeaturesColumn: {
    marginTop: 16,
  },
  membershipFeatures: {
    marginTop: 8,
  },
  membershipQrColumn: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginTop: 16,
  },
  membershipFeatureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  membershipFeatureIcon: {
    fontSize: 16,
    color: '#4CAF50',
    minWidth: 20,
    marginRight: 8,
  },
  membershipFeatureText: {
    fontSize: 14,
    color: '#8E8E93',
  },
  membershipQrCode: {
    width: 200,
    height: 200,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    marginBottom: 12,
  },
  membershipStatusContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  membershipStatusText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4CAF50',
    marginBottom: 8,
    textAlign: 'center',
  },
  membershipStatusHint: {
    fontSize: 13,
    color: '#8E8E93',
    textAlign: 'center',
  },
  membershipQrHint: {
    fontSize: 13,
    color: '#8E8E93',
    textAlign: 'center',
    lineHeight: 18,
  },
  membershipQrButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    marginBottom: 12,
  },
  membershipQrButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  // 免费会员权限声明样式
  freeMemberSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E5EA',
  },
  freeMemberTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
  },
  freeMemberFeatureItem: {
    marginTop: 6,
  },
  freeMemberFeatureText: {
    fontSize: 13,
    color: '#8E8E93',
    lineHeight: 18,
  },
  // 模态框样式
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000000',
  },
  modalCloseButton: {
    padding: 4,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseButtonText: {
    fontSize: 24,
    color: '#8E8E93',
    lineHeight: 24,
  },
  modalBody: {
    padding: 20,
    maxHeight: 500,
  },
  presetInfoDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    marginBottom: 20,
  },
  presetIconLarge: {
    fontSize: 36,
    marginRight: 12,
  },
  presetNameLarge: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 4,
  },
  presetDescriptionSmall: {
    fontSize: 13,
    color: '#8E8E93',
  },
  modalField: {
    marginBottom: 0,
  },
  modalLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 8,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#E5E5EA',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#000000',
    backgroundColor: '#F8F9FA',
  },
  modalTextArea: {
    height: 150,
    paddingTop: 10,
  },
  documentButtonsContainer: {
    flexDirection: 'row',
    marginTop: 12,
  },
  documentButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#F0F0F0',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  documentButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#000000',
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E5EA',
  },
  modalCancelButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#F0F0F0',
    borderRadius: 8,
    marginRight: 12,
  },
  modalCancelButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8E8E93',
  },
  modalSaveButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#007AFF',
    borderRadius: 8,
  },
  modalSaveButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  // 快捷目录按钮样式
  quickDirectoryContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F2F2F7',
  },
  quickDirectoryTitle: {
    fontSize: 13,
    color: '#8E8E93',
    marginBottom: 8,
    fontWeight: '500',
  },
  quickDirectoryRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  quickDirectoryButton: {
    flex: 1,
    padding: 10,
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickDirectoryButtonDetecting: {
    backgroundColor: '#E3F2FD',
    borderColor: '#2196F3',
  },
  quickDirectoryButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#007AFF',
  },
  // 显示设置样式 - 开关面板
  switchPanel: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  switchPanelTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 12,
  },
  switchGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  switchItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '48%',
    paddingVertical: 12,
    paddingHorizontal: 8,
    marginBottom: 8,
    backgroundColor: '#F8F8F8',
    borderRadius: 8,
  },
  switchLabel: {
    fontSize: 15,
    color: '#000000',
    flex: 1,
  },
  // 紧凑布局样式（用于目录设置中的开关）
  switchItemCompact: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E5EA',
  },
  switchItemCompactLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  switchLabelCompact: {
    fontSize: 15,
    fontWeight: '500',
    color: '#000000',
    flex: 1,
    marginRight: 12,
  },
  switchDescriptionCompact: {
    fontSize: 13,
    color: '#8E8E93',
    lineHeight: 18,
    marginTop: 4,
  },
  languageOptions: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 12,
  },
  languageOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    backgroundColor: '#F8F8F8',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#E5E5EA',
  },
  languageOptionActive: {
    backgroundColor: '#E3F2FD',
    borderColor: '#007AFF',
  },
  languageOptionText: {
    fontSize: 16,
    color: '#000000',
  },
  languageOptionTextActive: {
    color: '#007AFF',
    fontWeight: '600',
  },
  languageCheckmark: {
    fontSize: 18,
    color: '#007AFF',
    fontWeight: 'bold',
    marginLeft: 8,
  },
  // 内联语言选择器样式（应用信息部分）
  languageSelectorInline: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  languageButtonInline: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#F8F8F8',
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  languageButtonInlineActive: {
    backgroundColor: '#E3F2FD',
    borderColor: '#007AFF',
  },
  languageButtonTextInline: {
    fontSize: 14,
    color: '#666666',
  },
  languageButtonTextInlineActive: {
    color: '#007AFF',
    fontWeight: '600',
  },
});

export default SettingsScreen;
