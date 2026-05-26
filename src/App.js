// 🔧 确保 polyfill 已加载
import './polyfills';

// 🌐 初始化i18n
import './i18n';
import { loadSavedLanguage } from './i18n';

import React, { useEffect, useState, Suspense } from 'react';
import { View, Text, StyleSheet, StatusBar, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useTranslation } from 'react-i18next';

console.log('📦 App.js: 开始导入模块...');

import { NavigationContainer } from './adapters/WebAdapters';
import { createStackNavigator } from './adapters/WebAdapters';
import { createBottomTabNavigator } from './adapters/WebAdapters';
import { Icon } from './adapters/WebAdapters';
import { PermissionsAndroid } from './adapters/WebAdapters';
import { logger } from './adapters/WebAdapters';
import { AsyncStorage } from './adapters/WebAdapters';
import { BackHandler } from './adapters/WebAdapters';
import { Alert } from './adapters/WebAdapters';

console.log('📦 App.js: WebAdapters 导入成功');

// 导入隐私政策确认组件
import PrivacyPolicyModal, { PRIVACY_AGREED_KEY } from './components/PrivacyPolicyModal.mobile';

// 导入所有屏�?
import HomeScreen from './screens/mobile/HomeScreen.mobile';
console.log('📦 App.js: HomeScreen 导入成功');
import CategoryScreen from './screens/mobile/CategoryScreen.mobile';
console.log('📦 App.js: CategoryScreen 导入成功');
import ImagePreviewScreen from './screens/mobile/ImagePreviewScreen.mobile';
console.log('📦 App.js: ImagePreviewScreen 导入成功');
import SettingsScreen from './screens/mobile/SettingsScreen.mobile';
console.log('📦 App.js: SettingsScreen 导入成功');
import EnhanceResultScreen from './screens/mobile/EnhanceResultScreen.mobile';
import CustomCategoriesScreen from './screens/mobile/CustomCategoriesScreen.mobile';
import { AIModelConfigScreen } from './ui/config/AIModelConfigScreen.mobile.jsx';
import { makeAIModelConfigDeps } from './ui/config/aiModelConfigDeps.js';

// 🆕 滤镜修图屏（jimp 纯 JS）：懒加载，仅在进入该屏时才加载 jimp
const FilterEditorScreen = React.lazy(() => import('./screens/mobile/FilterEditorScreen.mobile'));

// 滤镜屏错误边界：万一加载/处理出错，只在该屏显示提示，不崩 App
class FilterErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (this.state.err) {
      return (
        <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <Text style={{ color: '#fff', textAlign: 'center' }}>滤镜功能加载失败：{String(this.state.err?.message || this.state.err)}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

// 静态导入服务模块（避免 release 构建时的 require undefined 问题）
import UnifiedDataService from './services/UnifiedDataService';
import configService from './services/ConfigService';
import { ModelPathAdapter } from './adapters/WebAdapters';

console.log('📦 App.js: 创建 Navigator...');
const Stack = createStackNavigator();
console.log('📦 App.js: Stack Navigator 创建成功');
// iOS 风格 tab 图标用 Ionicons（字体已打包在 res/font）；web/异常时回退 emoji。
let Ionicons = null;
try { Ionicons = require('react-native-vector-icons/Ionicons').default; } catch (_) { Ionicons = null; }
const TAB_ICONS = {
  Home: { on: 'home', off: 'home-outline', emoji: '🏠' },
  StagingBox: { on: 'create', off: 'create-outline', emoji: '✏️' },
  Settings: { on: 'settings', off: 'settings-outline', emoji: '⚙️' },
};

const Tab = createBottomTabNavigator();
console.log('📦 App.js: Tab Navigator 创建成功');

// 主标签导航器
const MainTabNavigator = ({ stagingBoxCount }) => {
  const { t } = useTranslation('common');
  
  return (
  <Tab.Navigator
    screenOptions={({ route }) => ({
      tabBarIcon: ({ focused, color }) => {
        const cfg = TAB_ICONS[route.name] || {};
        // iOS 风格：选中填充、未选中描边，单色随 color 着色；无 Ionicons 时回退 emoji
        const iconNode = Ionicons
          ? <Ionicons name={focused ? cfg.on : cfg.off} size={26} color={color} />
          : <Text style={{ fontSize: 24, color }}>{cfg.emoji}</Text>;

        // 暂存箱有数量时叠加红点徽标
        if (route.name === 'StagingBox' && stagingBoxCount > 0) {
          return (
            <View style={{ position: 'relative', alignItems: 'center', justifyContent: 'center' }}>
              {iconNode}
              <View style={{
                position: 'absolute',
                top: -5,
                right: -10,
                backgroundColor: '#FF3B30',
                borderRadius: 10,
                minWidth: 18,
                height: 18,
                paddingHorizontal: 5,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 2,
                borderColor: '#FFFFFF',
              }}>
                <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '700' }}>
                  {stagingBoxCount > 99 ? '99+' : stagingBoxCount}
                </Text>
              </View>
            </View>
          );
        }
        return iconNode;
      },
      tabBarActiveTintColor: '#007AFF',
      tabBarInactiveTintColor: '#8E8E93',
      tabBarStyle: {
        backgroundColor: '#FFFFFF',
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: '#C6C6C8',
        height: 58,
        paddingBottom: 6,
        paddingTop: 6,
      },
      tabBarShowLabel: true,
      tabBarLabelStyle: {
        fontSize: 11,
        fontWeight: '500',
        marginTop: 0,
      },
      headerShown: false,
    })}
  >
    <Tab.Screen 
      name="Home" 
      component={HomeScreen}
      options={{ 
        title: t('home.title'),
        tabBarLabel: t('home.title'),
      }}
    />
    <Tab.Screen 
      name="StagingBox" 
      options={{ 
        title: t('common.edit'),
        tabBarLabel: t('common.edit'),
        tabBarStyle: { display: 'none' }, // 隐藏底部导航栏
      }}
    >
      {({ navigation, route: tabRoute }) => (
        <CategoryScreen 
          navigation={navigation}
          route={{ 
            params: { 
              category: 'stagingBox',
              fromScreen: 'StagingBox',
              // 合并 Tab 路由参数（如果有 returnedImageId）
              ...(tabRoute?.params || {})
            } 
          }} 
        />
      )}
    </Tab.Screen>
    <Tab.Screen 
      name="Settings" 
      component={SettingsScreen}
      options={{ 
        title: t('common.settings'),
        tabBarLabel: t('common.settings'),
      }}
    />
  </Tab.Navigator>
  );
};

// 权限状态检查函数
const checkAppPermissions = async () => {
  if (Platform.OS === 'android') {
    try {
      console.log('🚀 应用启动 - 权限状态检查开始');
      console.log('📱 平台信息:', Platform.OS, 'API级别:', Platform.Version);
      
      // 检查所有相关权限
      const permissions = [
        PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
        PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
      ];
      
      // Android 13+ 添加媒体权限
      if (Platform.Version >= 33) {
        permissions.push(PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES);
      }
      
      console.log('📋 检查以下权限:');
      for (const permission of permissions) {
        const granted = await PermissionsAndroid.check(permission);
        const permissionName = permission.split('.').pop();
        console.log(`   ${granted ? '✓' : '✗'} ${permissionName}: ${granted ? '已授权' : '未授权'}`);
      }
      
      console.log('📋 权限状态检查完成\n');
      
    } catch (error) {
      console.error('❌ 权限检查失败:', error);
    }
  }
};

console.log('📦 App.js: 定义 App 组件...');

export default function App() {
  console.log('📦 App.js: App 组件开始渲染');
  const { t } = useTranslation('common');
  
  const [isServiceReady, setIsServiceReady] = React.useState(false);
  const [stagingBoxCount, setStagingBoxCount] = React.useState(0);
  const [privacyAgreed, setPrivacyAgreed] = React.useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = React.useState(false);
  const [checkingPrivacy, setCheckingPrivacy] = React.useState(true);
  
  // 检查隐私政策是否已同意
  useEffect(() => {
    const checkPrivacyAgreement = async () => {
      try {
        const agreed = await AsyncStorage.getItem(PRIVACY_AGREED_KEY);
        console.log('🔍 检查隐私政策同意状态:', { key: PRIVACY_AGREED_KEY, value: agreed, type: typeof agreed });
        
        // 支持多种格式：'true'、true、'"true"'（JSON字符串）
        // 注意：typeof null === 'object' 是 JavaScript 的已知 bug，所以需要显式检查 null
        const isAgreed = agreed !== null && (agreed === 'true' || agreed === true || agreed === '"true"');
        
        if (isAgreed) {
          console.log('✅ 用户已同意隐私政策');
          setPrivacyAgreed(true);
          setShowPrivacyModal(false);
        } else {
          console.log('📋 用户未同意隐私政策，显示确认弹窗');
          setShowPrivacyModal(true);
        }
      } catch (error) {
        console.error('❌ 检查隐私政策同意状态失败:', error);
        // 出错时显示隐私政策弹窗
        setShowPrivacyModal(true);
      } finally {
        setCheckingPrivacy(false);
      }
    };
    
    checkPrivacyAgreement();
  }, []);
  
  // 处理隐私政策同意
  const handlePrivacyAgree = async () => {
    try {
      // 存储为字符串 'true'，确保能被正确读取
      await AsyncStorage.setItem(PRIVACY_AGREED_KEY, 'true');
      
      // 立即验证存储是否成功
      const verify = await AsyncStorage.getItem(PRIVACY_AGREED_KEY);
      console.log('✅ 隐私政策同意状态已保存，验证值:', { key: PRIVACY_AGREED_KEY, value: verify, type: typeof verify });
      
      // 如果验证失败，再次尝试保存
      if (verify !== 'true' && verify !== true && verify !== '"true"') {
        console.warn('⚠️ 验证失败，重新保存隐私政策同意状态');
        await AsyncStorage.setItem(PRIVACY_AGREED_KEY, 'true');
      }
      
      setPrivacyAgreed(true);
      setShowPrivacyModal(false);
    } catch (error) {
      console.error('❌ 保存隐私政策同意状态失败:', error);
      // 即使保存失败，也允许继续使用应用
      setPrivacyAgreed(true);
      setShowPrivacyModal(false);
    }
  };
  
  // 处理隐私政策不同意（不允许使用应用）
  const handlePrivacyDisagree = () => {
    // 华为应用市场要求必须同意才能使用
    // 用户不同意时，直接退出应用
    console.log('⚠️ 用户未同意隐私政策，退出应用');
    
    // 直接退出应用
    if (BackHandler && BackHandler.exitApp) {
      BackHandler.exitApp();
    } else {
      // 如果 BackHandler 不可用，记录错误
      console.error('无法退出应用，BackHandler 不可用');
    }
  };
  
  useEffect(() => {
    // 只有在隐私政策已同意且服务未就绪时，才初始化应用
    if (privacyAgreed && !isServiceReady) {
      console.log('📦 App.js: App useEffect 运行');
      // 加载保存的语言设置
      loadSavedLanguage();
      initializeApp();
    }
  }, [privacyAgreed]);

  // 加载暂存箱数量
  useEffect(() => {
    if (!isServiceReady) return;

    const loadStagingBoxCount = async () => {
      try {
        const count = await UnifiedDataService.getStagingBoxCount();
        setStagingBoxCount(count);
      } catch (error) {
        console.error('获取暂存箱数量失败:', error);
        setStagingBoxCount(0);
      }
    };

    loadStagingBoxCount();

    // 定期刷新暂存箱数量（每5秒）
    const interval = setInterval(loadStagingBoxCount, 5000);

    return () => clearInterval(interval);
  }, [isServiceReady]);
  
  const initializeApp = async () => {
    try {
      console.log('🚀 开始初始化应用核心服务...');
      
      // 1. 首先初始化 ConfigService（最重要，其他服务依赖它）
      console.log('📋 [1/3] 初始化 ConfigService...');
      await configService.initialize();
      console.log('✅ ConfigService 初始化完成');
      
      // 2. 初始化 UnifiedDataService（数据存储服务）
      console.log('📋 [2/3] 初始化 UnifiedDataService...');
      await UnifiedDataService.initialize();
      console.log('✅ UnifiedDataService 初始化完成');
      
      // 3. 后台复制模型文件（移动端）
      console.log('📋 [3/3] 复制模型文件...');
      if (ModelPathAdapter && ModelPathAdapter.ensureModelExists) {
        const models = ['mobilenetv3_rw_Opset17.onnx'];
        for (const model of models) {
          await ModelPathAdapter.ensureModelExists(model);
        }
        console.log('✅ 模型文件初始化完成');
      }
      
      console.log('🎉 应用核心服务初始化完成！');
      setIsServiceReady(true);
    } catch (error) {
      console.error('❌ 应用初始化失败:', error);
      // 即使失败也允许进入应用，避免白屏
      setIsServiceReady(true);
    }
  };

  console.log('📦 App.js: 返回 JSX');
  
  // 如果正在检查隐私政策，显示加载界面
  if (checkingPrivacy) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor="#fff" />
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>🚀 {t('common.initializing')}</Text>
        </View>
      </View>
    );
  }
  
  // 显示隐私政策确认弹窗
  if (showPrivacyModal) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor="#fff" />
        <PrivacyPolicyModal
          visible={showPrivacyModal}
          onAgree={handlePrivacyAgree}
          onDisagree={handlePrivacyDisagree}
        />
      </View>
    );
  }
  
  // 如果服务还未就绪，显示加载界面
  if (!isServiceReady) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor="#fff" />
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>🚀 {t('common.initializing')}</Text>
          <Text style={styles.loadingSubText}>{t('app.loadingServices')}</Text>
        </View>
      </View>
    );
  }
  
  // 服务就绪后，渲染主界面
  return (
    <GestureHandlerRootView style={styles.container}>
      <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="MainTabs">
            {() => <MainTabNavigator stagingBoxCount={stagingBoxCount} />}
          </Stack.Screen>
          <Stack.Screen name="Category" component={CategoryScreen} />
          <Stack.Screen name="ImagePreview" component={ImagePreviewScreen} />
          <Stack.Screen name="EnhanceResult" component={EnhanceResultScreen} options={{ presentation: 'modal' }} />
          <Stack.Screen name="CustomCategories" component={CustomCategoriesScreen} />
          <Stack.Screen name="FilterEditor">
            {(props) => (
              <FilterErrorBoundary>
                <Suspense fallback={<View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }}><Text style={{ color: '#fff' }}>加载滤镜…</Text></View>}>
                  <FilterEditorScreen {...props} />
                </Suspense>
              </FilterErrorBoundary>
            )}
          </Stack.Screen>
          <Stack.Screen name="AIModelConfig" options={{ headerShown: true, title: 'AI 模型设置' }}>
            {() => <AIModelConfigScreen deps={makeAIModelConfigDeps()} />}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
      </View>
    </GestureHandlerRootView>
  );
}

console.log('📦 App.js: App 组件定义完成');

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5FCFF',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5FCFF',
  },
  loadingText: {
    fontSize: 18,
    color: '#333',
    fontWeight: '600',
    marginBottom: 8,
  },
  loadingSubText: {
    fontSize: 14,
    color: '#666',
  },
});

