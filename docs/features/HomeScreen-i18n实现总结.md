# HomeScreen i18n 实现总结

## 📋 概述

本文档总结了 `HomeScreen.desktop.js` 中多语言国际化（i18n）的实现方案。HomeScreen 是应用的主页面，包含了多种分类展示、扫描功能、以及各种用户交互界面，所有用户可见的文本都已实现中英文双语支持。

**文件位置**: `src/screens/desktop/HomeScreen.desktop.js`  
**i18n 库**: `react-i18next`  
**支持语言**: 中文（zh）、英文（en）

---

## 🔧 技术实现

### 1. 基础配置

#### 导入依赖
```javascript
import { useTranslation } from 'react-i18next';
import { getColorNameTranslation } from '../../i18n';
```

#### Hook 使用
```javascript
const HomeScreen = () => {
  const { t, i18n } = useTranslation('common');
  // ...
};
```

- `t`: 翻译函数，用于获取翻译文本
- `i18n`: i18n 实例，用于获取当前语言设置

---

## 📝 翻译键使用情况

### 2.1 应用基础信息

| 翻译键 | 中文 | 英文 | 使用位置 |
|--------|------|------|----------|
| `app.name` | ImagePilot | ImagePilot | 标题栏 |

### 2.2 首页状态信息

| 翻译键 | 中文 | 英文 | 使用位置 |
|--------|------|------|----------|
| `home.ready` | 图片分类应用已就绪 | Image classification app is ready | 全局消息 |
| `home.scanning` | 扫描中... | Scanning... | 扫描状态 |
| `home.scanComplete` | 扫描完成 | Scan complete | 扫描完成提示 |
| `home.smartScan` | 智能扫描 | Smart Scan | 扫描按钮 |
| `home.scanTip` | 为相册智能分类100张，在设置页面开通终身会员后，无限制 | Smart classify 100 photos for the album. Unlimited after subscribing to lifetime membership in settings | 扫描提示 |
| `home.processing` | 处理中... | Processing... | 处理状态 |
| `home.initScanning` | 初始化扫描: 准备扫描环境 | Initializing scan: Preparing scan environment | 初始化消息 |
| `home.scanFailed` | 扫描失败: {{error}} | Scan failed: {{error}} | 扫描失败提示 |
| `home.lastScanInfo` | 最近扫描完成时间: {{time}} \| 照片数量: {{count}} \| 空间大小: {{size}}{{duration}} | Last scan completed: {{time}} \| Photos: {{count}} \| Size: {{size}}{{duration}} | 最近扫描信息 |
| `home.duration` | 耗时 | Duration | 扫描耗时 |
| `home.minutes` | 分钟 | minutes | 时间单位 |
| `home.seconds` | 秒 | seconds | 时间单位 |

### 2.3 欢迎区域

| 翻译键 | 中文 | 英文 | 使用位置 |
|--------|------|------|----------|
| `home.welcome` | 欢迎使用ImagePilot | Welcome to ImagePilot | 欢迎文本 |
| `home.goToSettings` | 进入设置 → | Go to Settings → | 设置入口 |

### 2.4 分类区域标题

| 翻译键 | 中文 | 英文 | 使用位置 |
|--------|------|------|----------|
| `home.byContent` | 按内容 | By Content | 内容分类标题 |
| `home.byCity` | 按城市 | By City | 城市分类标题 |
| `home.byColor` | 按颜色 | By Color | 颜色分类标题 |
| `home.byStorage` | 按存储 | By Storage | 存储分类标题 |
| `home.byFormat` | 按格式 | By Format | 格式分类标题 |
| `home.byResolution` | 按分辨率 | By Resolution | 分辨率分类标题 |
| `home.byOrientation` | 按方向 | By Orientation | 方向分类标题 |

### 2.5 分类操作

| 翻译键 | 中文 | 英文 | 使用位置 |
|--------|------|------|----------|
| `home.showEmptyCategories` | 显示空分类 | Show Empty Categories | 显示空分类按钮 |
| `home.hideEmptyCategories` | 隐藏空分类 | Hide Empty Categories | 隐藏空分类按钮 |
| `home.configServiceNotInitialized` | 配置服务未初始化 | Config service not initialized | 配置服务错误提示 |
| `home.scanOrAdjustSettings` | 请先扫描图片或调整显示设置 | Please scan images or adjust display settings | 空状态提示 |

### 2.6 空状态提示

| 翻译键 | 中文 | 英文 | 使用位置 |
|--------|------|------|----------|
| `home.noCityData` | 暂无城市数据 | No city data | 城市分类空状态 |
| `home.noColorData` | 暂无颜色数据 | No color data | 颜色分类空状态 |
| `home.recentDiscoveredPhotos` | 最新发现照片 | Recent Discovered Photos | 最新照片标题 |
| `home.noNewPhotos` | 暂无新照片 | No new photos | 最新照片空状态 |
| `home.unknownDirectory` | 未知目录 | Unknown Directory | 未知目录提示 |

### 2.7 页面加载提示

| 翻译键 | 中文 | 英文 | 使用位置 |
|--------|------|------|----------|
| `home.loadingCategoryPage` | 正在加载分类页面... | Loading category page... | 分类页面加载 |
| `home.loadingPreview` | 正在加载预览页面... | Loading preview page... | 预览页面加载 |
| `home.loadingSettings` | 正在加载设置页面... | Loading settings page... | 设置页面加载 |

### 2.8 分类相关

| 翻译键 | 中文 | 英文 | 使用位置 |
|--------|------|------|----------|
| `category.noImages` | 暂无图片 | No images | 空状态提示 |
| `category.similarityGroup` | 相似组 | Similarity Group | 相似组标题 |

---

## 🎨 特殊数据处理

### 3.1 分类名称国际化

**实现方式**: 动态选择配置中的中英文名称

**数据来源**: `initialSettings.json` 中的 `categoryNameMap`，每个分类包含 `chinese` 和 `english` 字段。

**实现位置**:
1. **主分类列表** (第1076-1089行):
```javascript
const categories = configService.getAllCategoriesWithUI().map(category => {
  const currentLang = i18n.language || 'zh';
  const categoryName = currentLang === 'en' 
    ? (category.english || category.chinese) 
    : (category.chinese || category.english);
  
  return {
    id: category.id,
    name: categoryName,
    // ...
  };
});
```

2. **CategoryCard 组件** (第1656-1669行):
```javascript
const getCategoryDisplayName = () => {
  if (typeof category === 'object' && category !== null) {
    if (category.name) {
      return category.name; // 已处理过的名称
    }
    const currentLang = i18n.language || 'zh';
    return currentLang === 'en' 
      ? (category.english || category.chinese)
      : (category.chinese || category.english);
  }
  return category;
};
```

**特点**:
- 不依赖 i18n JSON 文件，直接从配置读取
- 支持回退：如果首选语言不存在，自动使用另一种语言
- 保持单一数据源，避免重复维护

---

### 3.2 城市名称国际化

**实现方式**: 在扫描时根据用户语言配置保存对应语言的城市名称

**数据来源**: 
- 远程API返回: `name` (英文) 和 `name_zh` (中文)
- 本地数据: 只有中文名称

**实现位置**: `src/services/CityLocationService.js`

**逻辑**:
- 如果用户配置是英文 → 保存英文名称（如 "Beijing"）
- 如果用户配置是中文 → 保存中文名称（如 "北京"）
- 如果远程API失败降级到本地 → 保存中文名称（本地数据只有中文）

**显示**: 直接显示数据库中存储的城市名称，无需额外翻译

---

### 3.3 颜色名称国际化

**实现方式**: 使用颜色名称映射表进行翻译

**数据来源**: 服务器API返回的颜色名称（可能是中文或英文）

**实现位置**: `src/i18n/index.js` 中的 `getColorNameTranslation` 函数

**映射表**:
```javascript
const COLOR_NAME_MAP = {
  // 中文 -> 英文
  '橙色': 'Orange',
  '蓝色': 'Blue',
  '红色': 'Red',
  '绿色': 'Green',
  '紫色': 'Purple',
  '粉色': 'Pink',
  '黄色': 'Yellow',
  '灰色': 'Gray',
  '黑色': 'Black',
  '白色': 'White',
  // ... 英文 -> 中文映射
};
```

**使用位置**: `ColorCard` 组件 (第1747-1750行)
```javascript
const displayColorName = useMemo(() => {
  return getColorNameTranslation(color, i18n.language);
}, [color, i18n.language]);
```

**特点**:
- 支持中文、英文（大小写）格式的输入
- 如果找不到映射，返回原始值
- 自动根据当前语言选择对应的翻译

---

## 🔄 动态内容处理

### 4.1 日期格式化

**实现位置**: `loadLastScanTime` 函数 (第820-853行)

```javascript
const locale = i18n.language === 'en' ? 'en-US' : 'zh-CN';
const formattedTime = new Date(settings.lastScanTime).toLocaleString(locale);
```

根据当前语言动态选择日期格式：
- 中文: `zh-CN` 格式
- 英文: `en-US` 格式

### 4.2 插值使用

多个翻译键使用了插值（interpolation）来插入动态值：

```javascript
// 扫描失败提示
t('home.scanFailed', { error: error.message })

// 最近扫描信息
t('home.lastScanInfo', { 
  time: formattedTime, 
  count: totalImages, 
  size: formattedSize, 
  duration: durationText 
})
```

---

## 📦 组件级 i18n 实现

### 5.1 CategoryCard 组件

**位置**: 第1634-1698行

**实现**:
- 使用 `useTranslation` hook 获取 `i18n` 实例
- 通过 `getCategoryDisplayName` 函数动态选择分类名称
- 根据 `i18n.language` 判断当前语言

### 5.2 ColorCard 组件

**位置**: 第1735-1775行

**实现**:
- 使用 `useTranslation` hook 获取 `i18n` 实例
- 使用 `getColorNameTranslation` 函数翻译颜色名称
- 使用 `useMemo` 缓存翻译结果，优化性能

### 5.3 SimilarityCard 组件

**位置**: 第1830-1850行

**实现**:
- 使用 `useTranslation` hook 获取 `t` 函数
- 使用 `t('category.similarityGroup')` 显示相似组标题

---

## ⚙️ 性能优化

### 6.1 useMemo 缓存

在 `ColorCard` 组件中使用 `useMemo` 缓存颜色名称翻译结果：

```javascript
const displayColorName = useMemo(() => {
  return getColorNameTranslation(color, i18n.language);
}, [color, i18n.language]);
```

避免每次渲染都重新计算翻译。

### 6.2 状态初始化优化

`globalMessage` 状态的初始化使用了延迟设置：

```javascript
const [globalMessage, setGlobalMessage] = useState('');

useEffect(() => {
  setGlobalMessage(t('home.ready'));
  loadLastScanTime();
}, [t]);
```

确保 `t` 函数准备就绪后再设置初始值。

---

## 📋 翻译键清单

### 使用的命名空间

- `common`: 通用翻译（通过 `useTranslation('common')` 使用）
  - `app.*`: 应用基础信息
  - `home.*`: 首页相关翻译
  - `category.*`: 分类相关翻译

### 完整翻译键列表

所有翻译键定义在：
- `src/i18n/locales/zh/common.json`
- `src/i18n/locales/en/common.json`

---

## 🔍 注意事项

### 1. 分类名称处理
- 分类名称不存储在 i18n JSON 文件中
- 直接从 `initialSettings.json` 读取，保持单一数据源
- 如果配置中没有对应语言的名称，会自动回退到另一种语言

### 2. 城市名称处理
- 城市名称在扫描时根据用户语言配置保存
- 已存储的数据不会自动更新，需要重新扫描
- 如果远程API失败，降级到本地查询时只能保存中文名称

### 3. 颜色名称处理
- 颜色名称通过映射表翻译
- 如果服务器返回新颜色且映射表中没有，会显示原始值
- 需要手动添加新颜色的映射关系

### 4. 日期格式化
- 使用 `toLocaleString` 根据语言设置格式化日期
- 确保日期格式符合用户的语言习惯

---

## 🚀 未来改进建议

1. **城市名称映射表**: 考虑创建城市名称映射表，支持已存储数据的国际化显示
2. **颜色名称扩展**: 根据实际使用情况扩展颜色名称映射表
3. **日期格式统一**: 考虑使用 i18n 的日期格式化功能，统一日期显示格式
4. **翻译键组织**: 如果翻译键继续增加，考虑按功能模块拆分命名空间

---

## 📚 相关文档

- [i18n 配置文档](../architecture/i18n配置说明.md) (如果存在)
- [分类配置说明](../../public/initialSettings.json)
- [react-i18next 官方文档](https://react.i18next.com/)

---

**文档版本**: 1.0  
**最后更新**: 2025-12-15  
**维护者**: 开发团队
