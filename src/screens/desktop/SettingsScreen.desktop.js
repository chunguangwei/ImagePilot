import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, ActivityIndicator, TextInput, Image } from 'react-native';
import { SafeAreaView, Alert, AsyncStorage, logger } from '../../adapters/WebAdapters';
import UnifiedDataService from '../../services/UnifiedDataService';
import ImageStorageService from '../../services/ImageStorageService';
import WeChatAuthService from '../../services/WeChatAuthService';
import { BUILD_DATE, BUILD_VERSION, BUILD_VERSION_CODE } from '../../config/BuildInfo';
import { changeLanguage, getCurrentLanguage, getDefaultPresets } from '../../i18n';

const SettingsScreen = ({ navigation, onRescanGallery, onScanProgress, isScanning }) => {
  const { t, i18n } = useTranslation('common');
  const [currentLanguage, setCurrentLanguage] = useState(getCurrentLanguage());
  
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [galleryPaths, setGalleryPaths] = useState([]); // 默认路径，将在loadSettings中设置
  const [newPath, setNewPath] = useState(''); // 新路径输入
  const [originalPaths, setOriginalPaths] = useState([]); // 原始路径，用于比较变更
  const [storageType, setStorageType] = useState(t('settings.detecting')); // 存储类型
  const [storageSize, setStorageSize] = useState(t('settings.calculating')); // 存储大小
  
  // AI增强预设相关状态
  const [aiEnhancePresets, setAiEnhancePresets] = useState({});
  const [editingPreset, setEditingPreset] = useState(null); // 当前编辑的预设 {id, name, icon, prompt, description}
  const [showEditModal, setShowEditModal] = useState(false);

  // 微信授权相关状态
  const [wechatStatus, setWechatStatus] = useState('checking'); // checking, not_followed, followed_not_member, member
  const [qrCode, setQrCode] = useState('');
  const [credits, setCredits] = useState({ total: 0, used: 0, remaining: 0 });
  const [checkingFollow, setCheckingFollow] = useState(false);

  const activationAlertShownRef = useRef(false);
  const pollIntervalRef = useRef(null); // 保存轮询ID

  useEffect(() => {
    loadSettings();
    checkMembershipStatus();
    
    // 组件卸载时清理轮询
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, []);

  // 检查会员状态（统一使用 getCredits 接口）
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
        logger.debug('🔍 设置状态为 followed_not_member，额度:', {
          total: creditsResult.total,
          used: creditsResult.used,
          remaining: creditsResult.remaining
        });
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

  // 生成二维码
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
      // 注意：轮询会持续进行，直到用户成为会员，或者组件卸载
      pollIntervalRef.current = setInterval(async () => {
        try {
          const creditsResult = await WeChatAuthService.getCredits();
          const { isFollowed, isMember } = creditsResult;
          
          if (isMember) {
            // 用户已成为会员，停止轮询
            setWechatStatus('member');
            setCredits({
              total: creditsResult.total,
              used: creditsResult.used,
              remaining: creditsResult.remaining
            });
            if (!activationAlertShownRef.current) {
              activationAlertShownRef.current = true;
              // 确保使用最新的语言设置：从 i18n 实例获取最新的 t 函数
              // 因为 setInterval 回调可能捕获旧的闭包，需要显式获取当前语言
              const currentLang = i18n.language || 'zh';
              // 使用 i18n 实例的 t 函数，确保使用最新语言
              Alert.alert(i18n.t('common.success', { lng: currentLang }), i18n.t('settings.memberActivated', { lng: currentLang }), [
                { text: i18n.t('common.confirm', { lng: currentLang }), style: 'default' }
              ]);
            }
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            setCheckingFollow(false);
          } else if (isFollowed) {
            // 已关注但未付费，更新状态和额度，继续轮询等待付费
            logger.debug('🔄 轮询检测到：用户已关注但未付费，更新状态为 followed_not_member');
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
      
      // 保存轮询ID，以便在组件卸载时清理
      // 注意：这里需要将 poll 保存到 ref 中，以便在 useEffect 清理函数中使用
      // 但由于 setInterval 返回的 ID 是数字，我们可以使用一个 ref 来保存
    } catch (error) {
      // 生成二维码失败，使用debug日志（不输出error）
      logger.debug('生成二维码失败:', error);
      setCheckingFollow(false);
    }
  };

  // 加载额度信息
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

  const loadSettings = async () => {
    try {
      const savedSettings = await UnifiedDataService.readSettings();
      
      // 从统一设置中加载照片目录配置
      if (savedSettings.scanPaths && savedSettings.scanPaths.length > 0) {
        setGalleryPaths(savedSettings.scanPaths);
        setOriginalPaths([...savedSettings.scanPaths]); // 记录原始路径用于比较变更
      } else {
        // 如果没有保存的路径，设置为空数组，用户需要手动添加路径
        setGalleryPaths([]);
        setOriginalPaths([]);
      }
      
      
      // 设置其他设置项
      setSettings(savedSettings);
      
      // 加载AI增强预设
      if (savedSettings.aiEnhancePresets) {
        setAiEnhancePresets(savedSettings.aiEnhancePresets);
      }
      
      // 检测存储类型
      await detectStorageType();
    } catch (error) {
      logger.error('Failed to load settings:', error);
    } finally {
      setLoading(false);
    }
  };

  // 检测存储类型和大小
  const detectStorageType = async () => {
    try {
      // 检测平台
      let Platform;
      try {
        if (typeof window !== 'undefined' && typeof document !== 'undefined') {
          Platform = { OS: 'web' };
        } else {
          Platform = eval('require("react-native").Platform');
        }
      } catch (error) {
        Platform = { OS: 'web' };
      }

      if (Platform.OS === 'web') {
        // Web环境检测IndexedDB和localStorage
        const indexedDBSize = await getIndexedDBSize();
        const localStorageSize = getLocalStorageSize();
        
        if (indexedDBSize > 0) {
          setStorageType('IndexedDB');
          setStorageSize(formatBytes(indexedDBSize));
        } else if (localStorageSize > 0) {
          setStorageType(t('settings.localStorageFallback'));
          setStorageSize(formatBytes(localStorageSize));
        } else {
          setStorageType('IndexedDB');
          setStorageSize('0 B');
        }
      } else {
        // 移动端使用AsyncStorage
        setStorageType('AsyncStorage');
        const asyncStorageSize = await getAsyncStorageSize();
        setStorageSize(formatBytes(asyncStorageSize));
      }
    } catch (error) {
      logger.error('检测存储类型失败:', error);
      setStorageType(t('settings.unknown'));
      setStorageSize(t('settings.cannotCalculate'));
    }
  };

  // 获取IndexedDB存储大小
  const getIndexedDBSize = async () => {
    try {
      if ('indexedDB' in window) {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('ImageClassifierDB', 4); // 版本 4：添加 stagingBox 对象存储
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        
        // 获取所有对象存储的大小
        let totalSize = 0;
        // 获取所有对象存储名称
        const storeNames = Array.from(db.objectStoreNames);
        const transaction = db.transaction(storeNames, 'readonly');
        
        for (const storeName of storeNames) {
          const store = transaction.objectStore(storeName);
          const request = store.getAll();
          await new Promise((resolve, reject) => {
            request.onsuccess = () => {
              const data = request.result;
              totalSize += JSON.stringify(data).length;
              resolve();
            };
            request.onerror = () => reject(request.error);
          });
        }
        
        return totalSize;
      }
      return 0;
    } catch (error) {
      logger.error('获取IndexedDB大小失败:', error);
      return 0;
    }
  };

  // 获取localStorage存储大小
  const getLocalStorageSize = () => {
    try {
      let totalSize = 0;
      for (let key in localStorage) {
        if (localStorage.hasOwnProperty(key)) {
          totalSize += localStorage[key].length;
        }
      }
      return totalSize;
    } catch (error) {
      logger.error('获取localStorage大小失败:', error);
      return 0;
    }
  };

  // 获取AsyncStorage存储大小
  const getAsyncStorageSize = async () => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      let totalSize = 0;
      
      for (const key of keys) {
        const value = await AsyncStorage.getItem(key);
        if (value) {
          totalSize += value.length;
        }
      }
      
      return totalSize;
    } catch (error) {
      logger.error('获取AsyncStorage大小失败:', error);
      return 0;
    }
  };

  // 格式化字节大小
  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };


  // 加载分类规则

  const updateSetting = async (key, value) => {
    try {
      const newSettings = { ...settings, [key]: value };
      await UnifiedDataService.writeSettings(newSettings);
      // 重新加载设置以保持数据一致性
      await loadSettings();
      
      // 通知首页设置已更新
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('settingsUpdated', { 
          detail: { key, value, settings: newSettings } 
        }));
      }
    } catch (error) {
      logger.error('Failed to save settings:', error);
      Alert.alert(t('common.error'), t('settings.saveSettingsFailed'), [
        { text: t('common.confirm'), style: 'default' }
      ]);
    }
  };


  // 保存照片目录配置
  const saveGalleryPaths = async (paths) => {
    try {
      logger.debug('正在保存目录配置到统一设置:', paths);
      
      // 验证路径不能为空数组
      if (!paths || paths.length === 0) {
        Alert.alert(t('common.error'), t('settings.scanPathCannotBeEmpty'), [
          { text: t('common.confirm'), style: 'default' }
        ]);
        return;
      }
      
      // 通过UnifiedDataService保存到统一设置中
      const newSettings = { ...settings, scanPaths: paths };
      await UnifiedDataService.writeSettings(newSettings);
      logger.debug('目录配置已保存到统一设置');
      
      setGalleryPaths(paths);
      

    } catch (error) {
      logger.error('Failed to save gallery paths:', error);
      Alert.alert(t('common.error'), error.message || t('settings.saveDirectoryFailed'), [
        { text: t('common.confirm'), style: 'default' }
      ]);
    }
  };

 


  // 选择文件夹
  const selectFolder = async () => {
    try {
      const { ipcRenderer } = window.require('electron');
      const result = await ipcRenderer.invoke('select-folder');
      
      if (result.success) {
        const selectedPath = result.path.trim();
        // 如果路径不存在于列表中，自动添加到列表
        if (selectedPath && !galleryPaths.includes(selectedPath)) {
          const updatedPaths = [...galleryPaths, selectedPath];
          saveGalleryPaths(updatedPaths);
          setNewPath(''); // 清空输入框
        } else if (galleryPaths.includes(selectedPath)) {
          // 如果路径已存在，提示用户
          Alert.alert(t('common.confirm'), t('settings.directoryExists'), [
            { text: t('common.confirm'), style: 'default' }
          ]);
          setNewPath(''); // 清空输入框
        }
      } else {
        logger.debug('文件夹选择取消或失败:', result.message);
      }
    } catch (error) {
      logger.error('文件夹选择失败:', error);
      Alert.alert(t('common.error'), t('settings.folderSelectionFailed'), [
        { text: t('common.confirm'), style: 'default' }
      ]);
    }
  };

  // 添加新目录
  const addGalleryPath = () => {
    if (newPath.trim() && !galleryPaths.includes(newPath.trim())) {
      const updatedPaths = [...galleryPaths, newPath.trim()];
      saveGalleryPaths(updatedPaths);
      setNewPath('');
    } else if (galleryPaths.includes(newPath.trim())) {
      Alert.alert(t('common.confirm'), t('settings.directoryExists'), [
        { text: t('common.confirm'), style: 'default' }
      ]);
    } else {
      Alert.alert(t('common.confirm'), t('settings.pleaseEnterValidPath'), [
        { text: t('common.confirm'), style: 'default' }
      ]);
    }
  };

  // 删除目录
  const removeGalleryPath = (pathToRemove) => {
    if (galleryPaths.length <= 1) {
      Alert.alert(t('common.confirm'), t('settings.atLeastOneDirectoryRequired'), [
        { text: t('common.confirm'), style: 'default' }
      ]);
      return;
    }
    
    Alert.alert(
      t('settings.confirmDeleteDirectory'),
      t('settings.confirmDeleteDirectoryMessage', { path: pathToRemove }),
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

  // ========== AI增强预设管理 ==========
  
  // 打开编辑预设模态框
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

  // 保存编辑的预设
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
      
      // 通知其他页面设置已更新
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('settingsUpdated', { 
          detail: { key: 'aiEnhancePresets', value: updatedPresets, settings: newSettings } 
        }));
      }
      
              Alert.alert(t('common.success'), t('settings.presetSaved'), [
                { text: t('common.confirm'), style: 'default' }
              ]);
            } catch (error) {
              logger.error('保存AI增强预设失败:', error);
              Alert.alert(t('common.error'), t('settings.savePresetFailed'), [
                { text: t('common.confirm'), style: 'default' }
              ]);
    }
  };

  // 切换预设启用状态
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
      
      // 通知其他页面设置已更新
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('settingsUpdated', { 
          detail: { key: 'aiEnhancePresets', value: updatedPresets, settings: newSettings } 
        }));
      }
    } catch (error) {
      logger.error('切换预设状态失败:', error);
      Alert.alert(t('common.error'), t('settings.operationFailed'), [
        { text: t('common.confirm'), style: 'default' }
      ]);
    }
  };


  const handleClearData = async () => {
    // 先检查是否正在扫描（使用全局变量）
    if (typeof window !== 'undefined' && window.isScanning) {
      Alert.alert(
        t('settings.operationTip'),
        t('settings.scanningInProgress'),
        [{ text: t('common.confirm'), style: 'default' }]
      );
      return;
    }

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
              // 调用UnifiedDataService清空数据
              await UnifiedDataService.clearAllData();
              
              // 发送数据清空事件，通知HomeScreen刷新数据
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('dataCleared'));
              }
              
              // 重新加载设置以反映清空后的状态
              await loadSettings();
              Alert.alert(t('common.success'), t('settings.photoInfoCleared'), [
                { text: t('common.confirm'), style: 'default' }
              ]);
            } catch (error) {
              logger.error('清空数据失败:', error);
              Alert.alert(t('common.error'), t('settings.clearDataFailed'), [
                { text: t('common.confirm'), style: 'default' }
              ]);
            }
          }
        }
      ]
    );
  };


  



  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#2196F3" />
          <Text style={styles.loadingText}>Loading settings...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}>
            <Text style={styles.backIcon}>←</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{t('settings.title')}</Text>
          <View style={styles.placeholder} />
        </View>

        {/* 智能分类 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle} numberOfLines={1} ellipsizeMode="tail">🤖 {t('settings.smartClassification')}</Text>
          
          <TouchableOpacity
            style={styles.actionButton}
            onPress={handleClearData}>
            <Text style={styles.actionButtonTextRed}>🗑️ {t('settings.clearAlbumInfo')}</Text>
            <Text style={styles.actionButtonDescription}>
              {t('settings.clearAlbumInfoDesc')}
            </Text>
          </TouchableOpacity>

          {/* 🆕 AI 模型设置：配置个人 LLM API Key，启用云端在线分类 */}
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => navigation && navigation.navigate && navigation.navigate('AIModelConfig')}>
            <Text style={styles.actionButtonText}>☁️ {t('settings.aiModelConfig') || 'AI 模型设置（在线分类）'}</Text>
            <Text style={styles.actionButtonDescription}>
              {t('settings.aiModelConfigDesc') || '配置 OpenAI / Kimi 等大模型 API Key，启用云端在线分类'}
            </Text>
          </TouchableOpacity>

          {/* 本地分类设置 - 子区域 */}
          <View style={styles.switchPanel}>
            <Text style={styles.switchPanelTitle}>🔍 {t('settings.localClassification')}</Text>

            {/* 「本地辅助识别」开关已移除（多余项，详见 mobile 同处注释）。 */}

            {/* 相似度检测阈值 */}
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
            
            {/* 添加新目录 */}
            <View style={styles.addPathContainer}>
              <TextInput
                style={styles.pathInput}
                placeholder={t('settings.directoryPathPlaceholder')}
                value={newPath}
                onChangeText={setNewPath}
                placeholderTextColor="#999"
              />
              <TouchableOpacity
                style={styles.selectButton}
                onPress={selectFolder}>
                <Text style={styles.selectButtonText}>📁</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.addButton}
                onPress={addGalleryPath}>
                <Text style={styles.addButtonText}>+ {t('common.add')}</Text>
              </TouchableOpacity>
            </View>

            {/* 目录列表 */}
            <View style={styles.pathsList}>
              {galleryPaths.map((path, index) => (
                <View key={index} style={styles.pathItem}>
                  <Text style={styles.pathText} numberOfLines={1} ellipsizeMode="middle">
                    {path}
                  </Text>
                  <TouchableOpacity
                    style={[
                      styles.removeButton,
                      galleryPaths.length <= 1 && styles.removeButtonDisabled
                    ]}
                    onPress={() => removeGalleryPath(path)}
                    disabled={galleryPaths.length <= 1}>
                    <Text style={[
                      styles.removeButtonText,
                      galleryPaths.length <= 1 && styles.removeButtonTextDisabled
                    ]}>×</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </View>

        </View>

        {/* AI Image Enhancement Presets */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>✨ {t('settings.photoEnhancement')}</Text>
          
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
                    <Text style={styles.presetIcon}>{preset.icon}</Text>
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
                      <Text style={styles.editPresetButtonText}>✏️ {t('common.edit')}</Text>
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
          <Text style={styles.sectionTitle}>💎 {t('settings.membershipService')}</Text>
          
          {/* 付费会员 */}
          <View style={styles.membershipCardPremium}>
            {/* 标题栏和内容在同一水平行 */}
            <View style={styles.membershipRow}>
              {/* 左侧：标题和权益 */}
              <View style={styles.membershipLeft}>
                <View style={styles.membershipHeader}>
                  <Text style={styles.membershipIcon}>💎</Text>
                  <View style={{ flex: 1 }}>
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
              </View>

              {/* 右侧：二维码区域（仅未关注时显示） */}
              {wechatStatus === 'not_followed' && (
                <View style={styles.membershipQrColumn}>
                  {qrCode ? (
                    <Image
                      source={{ uri: qrCode }}
                      style={styles.membershipQrCode}
                    />
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
                    {t('settings.qrCodeHint')}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>
        )}

        {/* App Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ℹ️ {t('settings.appInfo')}</Text>
          
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>{t('settings.version')}</Text>
            <Text style={styles.infoValue}>{BUILD_VERSION}</Text>
          </View>
          
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>{t('settings.buildVersion')}</Text>
            <Text style={styles.infoValue}>{BUILD_VERSION_CODE} ({BUILD_DATE})</Text>
          </View>
          
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>{t('settings.platform')}</Text>
            <Text style={styles.infoValue}>{t('settings.desktop')}</Text>
          </View>
          
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>{t('settings.storageType')}</Text>
            <Text style={styles.infoValue}>{storageType}</Text>
          </View>
          
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>{t('settings.storageSize')}</Text>
            <Text style={styles.infoValue}>{storageSize}</Text>
          </View>
          
          {/* 语言设置 */}
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>{t('settings.language')}</Text>
            <View style={styles.languageSelector}>
              <TouchableOpacity
                style={[styles.languageButton, currentLanguage === 'zh' && styles.languageButtonActive]}
                onPress={async () => {
                  await changeLanguage('zh');
                  setCurrentLanguage('zh');
                }}
              >
                <Text style={[styles.languageButtonText, currentLanguage === 'zh' && styles.languageButtonTextActive]}>
                  {t('common.chinese')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.languageButton, currentLanguage === 'en' && styles.languageButtonActive]}
                onPress={async () => {
                  await changeLanguage('en');
                  setCurrentLanguage('en');
                  // 语言切换后，重新加载设置以更新缺省预设的显示
                  await loadSettings();
                }}
              >
                <Text style={[styles.languageButtonText, currentLanguage === 'en' && styles.languageButtonTextActive]}>
                  {t('common.english')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Edit Preset Modal */}
      {showEditModal && editingPreset && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingPreset.name}</Text>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => {
                  setShowEditModal(false);
                  setEditingPreset(null);
                }}>
                <Text style={styles.modalCloseButtonText}>×</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <View style={styles.presetInfoDisplay}>
                <Text style={styles.presetIconLarge}>{editingPreset.icon}</Text>
                <View>
                  <Text style={styles.presetNameLarge}>{editingPreset.name}</Text>
                  <Text style={styles.presetDescriptionSmall}>{editingPreset.description}</Text>
                </View>
              </View>

              <View style={styles.modalField}>
                <Text style={styles.modalLabel}>{t('settings.prompt')}</Text>
                <TextInput
                  style={[styles.modalInput, styles.modalTextArea]}
                  value={editingPreset.prompt}
                  onChangeText={(text) => setEditingPreset({ ...editingPreset, prompt: text })}
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
            </View>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => {
                  setShowEditModal(false);
                  setEditingPreset(null);
                }}>
                <Text style={styles.modalCancelButtonText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveButton}
                onPress={saveEditedPreset}>
                <Text style={styles.modalSaveButtonText}>{t('common.save')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    padding: 8,
  },
  backIcon: {
    fontSize: 24,
    color: '#333',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
  },
  placeholder: {
    width: 40,
  },
  section: {
    marginTop: 20,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#e0e0e0',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    padding: 16,
    paddingBottom: 8,
    flexShrink: 1,
  },
  subSection: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  subSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  // 显示设置样式 - 开关面板
  switchPanel: {
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    padding: 16,
    margin: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  switchPanelTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 16,
  },
  switchPanelDescription: {
    fontSize: 13,
    color: '#666',
    marginTop: 8,
    paddingHorizontal: 16,
    lineHeight: 18,
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
    width: '23.5%', // 4列布局，每列23.5%，留出间距
    marginBottom: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#F8F8F8',
    borderRadius: 8,
  },
  switchLabel: {
    fontSize: 15,
    color: '#333',
    flex: 1,
  },
  // 紧凑布局样式（用于本地分类）
  switchItemCompact: {
    flexDirection: 'column',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#F8F8F8',
    borderRadius: 8,
  },
  switchItemCompactLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  switchLabelCompact: {
    fontSize: 15,
    color: '#333',
    flex: 1,
    marginRight: 12,
  },
  switchDescriptionCompact: {
    fontSize: 13,
    color: '#666',
    lineHeight: 18,
    paddingLeft: 0,
  },
  // 保留旧的样式定义（可能其他地方还在使用）
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  settingInfo: {
    flex: 1,
    marginRight: 16,
  },
  settingLabel: {
    fontSize: 16,
    color: '#333',
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 14,
    color: '#666',
  },
  sliderContainer: {
    alignItems: 'center',
  },
  sliderValue: {
    fontSize: 16,
    color: '#2196F3',
    fontWeight: '600',
  },
  actionButton: {
    margin: 16,
    padding: 16,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  actionButtonTextRed: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FF4444', // 红色文字
    marginBottom: 4,
  },
  actionButtonDescription: {
    fontSize: 14,
    color: '#666',
  },
  infoItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  infoLabel: {
    fontSize: 14,
    color: '#333',
  },
  infoValue: {
    fontSize: 14,
    color: '#666',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  // 相似度阈值 / 快捷目录按钮样式
  quickDirectoryRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
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
  // 照片目录配置样式
  addPathContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  pathInput: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#333',
    backgroundColor: '#fafafa',
  },
  selectButton: {
    marginLeft: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#4CAF50',
    borderRadius: 8,
  },
  selectButtonText: {
    color: '#fff',
    fontSize: 16,
  },
  addButton: {
    marginLeft: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#2196F3',
    borderRadius: 8,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  pathsList: {
    // 移除白色背景，使用透明背景
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
  removeButtonDisabled: {
    backgroundColor: '#ccc',
    opacity: 0.6,
  },
  removeButtonTextDisabled: {
    color: '#999',
  },
  // AI增强预设样式
  sectionDescription: {
    fontSize: 14,
    color: '#666',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  presetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
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
    color: '#333',
    marginBottom: 6,
  },
  presetPrompt: {
    fontSize: 13,
    color: '#666',
    lineHeight: 18,
  },
  presetRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  editPresetButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#2196F3',
    borderRadius: 6,
  },
  editPresetButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  // 模态框样式
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  modalContent: {
    width: '90%',
    maxWidth: 600,
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
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
    color: '#666',
    lineHeight: 24,
  },
  modalBody: {
    padding: 20,
  },
  presetInfoDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    marginBottom: 20,
  },
  presetIconLarge: {
    fontSize: 36,
  },
  presetNameLarge: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  presetDescriptionSmall: {
    fontSize: 13,
    color: '#666',
  },
  modalField: {
    marginBottom: 0,
  },
  modalLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#333',
    backgroundColor: '#fafafa',
  },
  modalTextArea: {
    height: 150,
    paddingTop: 10,
  },
  documentButtonsContainer: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  documentButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  documentButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#333',
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  modalCancelButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
  },
  modalCancelButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  modalSaveButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#2196F3',
    borderRadius: 8,
  },
  modalSaveButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  // 微信授权样式
  wechatAuthContainer: {
    padding: 16,
    alignItems: 'center',
  },
  wechatAuthTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
    textAlign: 'center',
  },
  wechatAuthDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
    textAlign: 'center',
  },
  wechatAuthText: {
    fontSize: 14,
    color: '#666',
    marginTop: 12,
  },
  qrCodeContainer: {
    alignItems: 'center',
    marginTop: 12,
  },
  qrCodeImage: {
    width: 200,
    height: 200,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 8,
  },
  qrCodeHint: {
    fontSize: 13,
    color: '#999',
    marginTop: 12,
    textAlign: 'center',
  },
  generateQrButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#4CAF50',
    borderRadius: 8,
  },
  generateQrButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  // 额度显示样式
  creditsContainer: {
    margin: 16,
    padding: 16,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  creditsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  creditsInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  creditsLabel: {
    fontSize: 14,
    color: '#666',
  },
  creditsValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2196F3',
    marginLeft: 8,
  },
  creditsDescription: {
    fontSize: 13,
    color: '#999',
  },
  // 会员服务样式
  membershipCard: {
    margin: 16,
    padding: 16,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  membershipCardPremium: {
    margin: 16,
    padding: 16,
    backgroundColor: '#fff7e6',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ffd700',
  },
  membershipHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  membershipIcon: {
    fontSize: 32,
    marginRight: 12,
    lineHeight: 24, // 与文字行高对齐
  },
  membershipName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
    lineHeight: 24, // 确保行高一致
  },
  membershipTag: {
    fontSize: 13,
    color: '#4CAF50',
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  membershipTagPremium: {
    fontSize: 13,
    color: '#ff9800',
    backgroundColor: '#fff3e0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    alignSelf: 'flex-start',
    lineHeight: 18, // 确保行高一致
  },
  membershipRow: {
    flexDirection: 'row',
    gap: 8,
  },
  membershipLeft: {
    flex: 1,
  },
  membershipBody: {
    flexDirection: 'row',
    gap: 20,
    marginTop: 8,
  },
  membershipFeaturesColumn: {
    flex: 1,
    gap: 8,
  },
  membershipFeatures: {
    gap: 8,
  },
  membershipQrColumn: {
    width: 200,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 0,
  },
  membershipLeft: {
    width: 320,
  },
  membershipFeatureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  membershipFeatureIcon: {
    fontSize: 16,
    color: '#4CAF50',
    minWidth: 20,
  },
  membershipFeatureText: {
    fontSize: 14,
    color: '#666',
  },
  creditsInfoInline: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
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
  membershipQrTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
    textAlign: 'center',
  },
  membershipQrCode: {
    width: 150,
    height: 150,
    borderRadius: 8,
    backgroundColor: '#fff',
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
    color: '#666',
    textAlign: 'center',
  },
  membershipQrHint: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
    lineHeight: 18,
  },
  membershipQrButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#4CAF50',
    borderRadius: 8,
  },
  membershipQrButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  // 免费会员权限声明样式
  freeMemberSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
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
    color: '#666',
    lineHeight: 18,
  },
  languageSelector: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  languageButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#F0F0F0',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  languageButtonActive: {
    backgroundColor: '#E3F2FD',
    borderColor: '#007AFF',
  },
  languageButtonText: {
    fontSize: 14,
    color: '#666',
  },
  languageButtonTextActive: {
    color: '#007AFF',
    fontWeight: '600',
  },
});

export default SettingsScreen;