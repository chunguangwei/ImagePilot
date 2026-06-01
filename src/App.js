// 🔧 确保 polyfill 已加载
import './polyfills';

// 🌐 初始化i18n
import './i18n';
import { loadSavedLanguage } from './i18n';

import React, { useEffect, useState, Suspense } from 'react';
import { View, Text, StyleSheet, StatusBar, Platform, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useTranslation } from 'react-i18next';

console.log('📦 App.js: 开始导入模块...');

import { ThemeProvider, ThemeContext } from './ui/ios/theme';
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

// 隐私政策弹窗已下线（fork 不联第三方后端，无需弹）。组件文件保留备用。

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
import BackupRestoreScreen from './screens/mobile/BackupRestoreScreen.mobile';
import { AIModelConfigScreen } from './ui/config/AIModelConfigScreen.mobile.jsx';
import { makeAIModelConfigDeps } from './ui/config/aiModelConfigDeps.js';

// 🆕 滤镜修图屏（jimp 纯 JS）：懒加载，仅在进入该屏时才加载 jimp
const FilterEditorScreen = React.lazy(() => import('./screens/mobile/FilterEditorScreen.mobile'));
const InpaintScreen = React.lazy(() => import('./screens/mobile/InpaintScreen.mobile'));
const DocScanScreen = React.lazy(() => import('./screens/mobile/DocScanScreen.mobile'));

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
        // 不写 height，让 React Navigation 自适应 home-indicator 安全区
        // iOS 标准 49pt + 底部安全区；Android 用默认值
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

function AppInner() {
  console.log('📦 App.js: App 组件开始渲染');
  const { t } = useTranslation('common');
  const { scheme, setScheme } = React.useContext(ThemeContext);
  // 跟随"用户主题选择 > 系统外观"切 StatusBar 风格（light: 黑字白底 / dark: 白字黑底）
  const sysScheme = useColorScheme();
  const effectiveScheme = scheme === 'system' ? sysScheme : scheme;
  const isDark = effectiveScheme === 'dark';
  const sbStyle = isDark ? 'light-content' : 'dark-content';
  const sbBg = isDark ? '#000000' : '#ffffff';

  const [isServiceReady, setIsServiceReady] = React.useState(false);
  const [stagingBoxCount, setStagingBoxCount] = React.useState(0);
  // 隐私政策预同意：fork（ImagePilot）已彻底剥离原作者第三方后端，所有 AI 分类/增强
  // 仅在设备端或用户自配 Provider 上发生，无需在首次安装弹隐私政策确认页。
  // 直接当"已同意"，跳过 modal。
  const privacyAgreed = true;
  
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

      // 2b. 读取持久化的主题选择，同步到 ThemeContext（Provider state 变化会让所有
      //     useThemeColors 立即重渲染）。settings.colorScheme: 'system' | 'light' | 'dark'
      try {
        const savedSettings = await UnifiedDataService.readSettings();
        const saved = savedSettings && savedSettings.colorScheme;
        if (saved === 'light' || saved === 'dark' || saved === 'system') {
          setScheme(saved);
        }
      } catch (e) {
        console.warn('读取 colorScheme 失败，沿用默认 system:', e?.message || e);
      }
      
      // 3. 模型不再随包打包（移动端走 GH Release 按需下载，basic/scene/clip 各档统一）
      //    需要的时候在 Settings 里下载；ImageClassifierService 加载时会触发首次下载。
      console.log('📋 [3/3] 模型按需下载（不在启动时强制拉）');
      
      console.log('🎉 应用核心服务初始化完成！');
      setIsServiceReady(true);
    } catch (error) {
      console.error('❌ 应用初始化失败:', error);
      // 即使失败也允许进入应用，避免白屏
      setIsServiceReady(true);
    }
  };

  console.log('📦 App.js: 返回 JSX');
  
  // 如果服务还未就绪，显示加载界面
  if (!isServiceReady) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle={sbStyle} backgroundColor={sbBg} />
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
      <StatusBar barStyle={sbStyle} backgroundColor={sbBg} />
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="MainTabs">
            {() => <MainTabNavigator stagingBoxCount={stagingBoxCount} />}
          </Stack.Screen>
          <Stack.Screen name="Category" component={CategoryScreen} />
          <Stack.Screen name="ImagePreview" component={ImagePreviewScreen} />
          <Stack.Screen name="EnhanceResult" component={EnhanceResultScreen} options={{ presentation: 'modal' }} />
          <Stack.Screen name="CustomCategories" component={CustomCategoriesScreen} />
          <Stack.Screen name="BackupRestore" component={BackupRestoreScreen} />
          <Stack.Screen name="FilterEditor">
            {(props) => (
              <FilterErrorBoundary>
                <Suspense fallback={<View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }}><Text style={{ color: '#fff' }}>加载滤镜…</Text></View>}>
                  <FilterEditorScreen {...props} />
                </Suspense>
              </FilterErrorBoundary>
            )}
          </Stack.Screen>
          <Stack.Screen name="Inpaint">
            {(props) => (
              <FilterErrorBoundary>
                <Suspense fallback={<View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }}><Text style={{ color: '#fff' }}>加载消除…</Text></View>}>
                  <InpaintScreen {...props} />
                </Suspense>
              </FilterErrorBoundary>
            )}
          </Stack.Screen>
          <Stack.Screen name="DocScan">
            {(props) => (
              <FilterErrorBoundary>
                <Suspense fallback={<View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }}><Text style={{ color: '#fff' }}>加载证件矫正…</Text></View>}>
                  <DocScanScreen {...props} />
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

// 默认导出：用 ThemeProvider 包一层，初始为 'system'（与历史行为一致）。
// 启动 initializeApp 里读到 settings.colorScheme 后 setScheme 同步到 Provider，
// 之后所有 useThemeColors 会自动重渲染——主题切换全屏即时生效。
export default function App() {
  return (
    <ThemeProvider initialScheme="system">
      <AppInner />
    </ThemeProvider>
  );
}

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

