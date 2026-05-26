# ImagePilot - AI智能照片分类管理工具

[![Website](https://img.shields.io/badge/website-https://www.xintuxiangce.top-blue.svg)](https://www.xintuxiangce.top)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Android-lightgrey.svg)](https://www.xintuxiangce.top)
[![AI](https://img.shields.io/badge/AI-Local%20ONNX%20%7C%20Optional%20LLM-brightgreen.svg)](https://www.xintuxiangce.top)

## 📖 项目简介

**ImagePilot**（fork 自 ImageClassifier）是一款智能照片分类管理工具，能够自动识别和分类您的照片，帮助用户高效整理海量照片，释放存储空间。支持 Android（React Native）与 PC 桌面（Electron / react-native-web），已验证平台为 Android 与 PC。

### 核心优势

- 🤖 **AI智能识别** - 内容/颜色分类由 AI 完成，效果取决于所选模型；默认使用设备端 ONNX 本地模型，也可选配在线大模型
- 🔒 **隐私可控** - 本地分类与全部修图均不联网、不上传；唯一的联网情形是您主动配置在线大模型后，分类请求发往您自己指定的服务商（不经任何作者/第三方服务器）
- ⚡ **高效快速** - 优化的算法确保处理速度，大批量照片也能快速完成（Android 扫描经 MediaStore 优化）
- 🎯 **多维度分类** - 支持8大分类维度：内容、城市、颜色、存储、格式、分辨率、方向、相似组
- 🏷️ **自定义分类** - 自定义类别与规则，配置在线大模型后由其按规则打标归类
- ✨ **修图工具** - 本地纯 JS 滤镜 + 设备端 AI 超分（Real-ESRGAN），全程离线、移动端与 PC 均可用
- ✏️ **灵活可控** - AI分类结果支持手动调整
- 🎨 **简洁易用** - 清晰直观的界面设计，简单四步即可完成照片整理
- 💰 **完全免费** - 无广告、无内购、无会员/额度、开源免费

## ✨ 核心功能

### 📋 多维度智能分类

ImagePilot支持**8大分类维度**，从多个角度智能管理您的照片：

| 分类维度 | 图标 | 分类方式 | 说明 |
|---------|------|---------|------|
| **按内容分类** | 📷 | 🤖 AI分类 | 识别照片内容，支持单人照、社交活动、宠物、美食、旅行风景、证件照等。默认走设备端 ONNX 本地模型；配置在线大模型后改由该模型识别 |
| **按城市分类** | 🏙️ | 💻 本地算法 | 仅基于照片 EXIF/GPS 文件信息 + 离线反向地理编码匹配城市，按拍摄地点归类，不联网、不做图像内容感知 |
| **按颜色分类** | 🎨 | 🤖 AI分类 | AI识别照片的主要颜色，按颜色主题分类（蓝色、绿色、红色等） |
| **按存储分类** | 📁 | 💻 本地算法 | 从文件路径提取目录信息，按存储位置分类（相机、微信、QQ等） |
| **按格式分类** | 🖼️ | 💻 本地算法 | 从文件MIME类型或扩展名提取格式信息（JPEG、PNG、HEIC等） |
| **按分辨率分类** | 📐 | 💻 本地算法 | 从图片元数据提取宽高像素，智能识别标准分辨率（4K、1080p、720p等） |
| **按方向分类** | 🔄 | 💻 本地算法 | 根据照片宽高比计算方向，自动分类（横屏、竖屏、全景、正方形） |
| **相似组分类** | 🔗 | 💻 本地算法 | 使用颜色直方图、时间窗口、文本相似度等算法，自动识别相似照片并分组 |

**分类方式说明：**
- **🤖 AI分类**：默认使用设备端 ONNX 本地模型（离线、免费、不上传）；也可在「设置 → AI 模型设置」配置在线大模型，此时分类请求发往您自己指定的服务商
- **💻 本地算法**：使用本地算法处理，无需联网，速度快，保护隐私

### 📋 内容分类详情

自动识别照片内容，支持以下分类（识别效果取决于所选模型——设备端本地 ONNX 或您配置的在线大模型）：

- 📱 **手机截图** - 自动识别手机屏幕截图
- 🪪 **证件照片** - 身份证、护照、驾照等重要证件
- 👤 **单人照** - 个人照、自拍、肖像照片
- 👥 **社交活动** - 聚会、合影、多人互动场景
- 🏞️ **旅行风景** - 旅游景点、山川湖海、自然风光
- 🍔 **美食** - 食物、餐饮、烹饪相关照片
- 🐱 **萌宠** - 猫、狗等宠物照片
- 🔲 **二维码** - 二维码图片
- 📷 **其它** - 其他类型的照片

### ⚙️ 分类控制面板

在设置页面提供**分类控制面板**，您可以根据个人使用场景，自由选择需要显示哪些维度的分类：

- 🏙️ **城市分类** - 按拍摄城市分类
- 🎨 **颜色分类** - 按颜色主题分类
- 📁 **存储分类** - 按存储位置分类
- 📄 **格式分类** - 按文件格式分类
- 📏 **分辨率分类** - 按分辨率分类
- 🧭 **方向分类** - 按拍摄方向分类
- 🔗 **相似照片** - 相似照片分组
- 📸 **最近照片** - 最近添加的照片

所有分类维度都可以独立开启或关闭，让首页更加简洁和个性化。

### ✨ 修图（本地滤镜 + 本地 AI 超分）

修图功能全程在设备端本地完成，不联网、不上传，移动端与 PC 均可用：

- 🎨 **本地滤镜** - 基于 jimp 的纯 JS 离线滤镜，无原生依赖：黑白、复古、提亮、增强、柔化、反色，可调强度
- 🔍 **AI 增强（超分）** - Real-ESRGAN x4 超分修复，由 onnxruntime 在设备端本地推理，离线、分块处理（大图较慢）
- 👀 **前后对比** - 预览支持「按住看原图」，松手回到处理后效果
- 💾 **灵活保存** - 处理结果保存到本地

### 🔧 手动配置 LLM 大模型（可选）

默认情况下内容/颜色分类使用设备端 ONNX 本地模型，免费、离线、不上传。如需更强的识别能力，可在「设置 → AI 模型设置」手动配置在线大模型：

- 由单一开关 `aiProvider.active` 决定路由：未配置时为 `local-onnx`（本地）；配置后所有 AI 分类统一走您选择的在线大模型。
- 支持的服务商：**OpenAI、Kimi（Moonshot）、Claude（Anthropic）、Gemini（Google）、Azure（OpenAI 兼容/自定义 Custom）、Ollama（PC）**。
- 填写 Base URL / 模型名称 / API Key 即可（API Key 安全存储）。所选模型若不支持图像，会提示改用多模态模型。
- 数据只发往您选择的服务商，不经任何作者/第三方服务器。本项目不存在作者后端、会员或额度系统。

### 🏷️ 自定义分类

在「设置 → 自定义分类」中可定义自己的类别（id / 名称 / 规则）：

- 配置在线大模型后，分类时会把自定义类别与规则拼进提示词，由大模型按规则打标，结果归入对应类目。
- id 仅限字母/数字/下划线（便于大模型稳定输出），且不能与内置类别冲突。
- 该功能依赖在线大模型；仅使用本地 ONNX 模型时不会应用自定义规则。

## 🚀 快速开始

### 系统要求

#### Windows版本
- Windows 10 或更高版本
- 4GB 以上内存（推荐8GB）
- 500MB 可用磁盘空间

#### macOS版本
- macOS 12 或更高版本
- 4GB 以上内存（推荐8GB）
- 500MB 可用磁盘空间

#### Android版本
- Android 10 或更高版本
- 2GB 以上内存
- 100MB 可用存储空间

### 下载安装

**方式1：官网下载（推荐）**
1. 访问官网：https://www.xintuxiangce.top
2. 点击下载按钮，选择对应平台版本
3. 运行安装程序
4. 按照提示完成安装

**方式2：GitHub Release**
1. 访问 [Releases](https://github.com/xiawenyong1977-netizen/ImageClassifier/releases)
2. 下载最新版本
3. 安装并运行

### 使用步骤

1. **连接与设置** - 使用数据线连接手机与电脑，选定需要整理的相册目录
2. **一键智能分类** - 点击"开始智能分类"，AI将自动扫描识别
3. **便捷拣选暂存** - 分类完成后，勾选需要处理的照片，一键移入暂存箱
4. **最终清理或归档** - 进入暂存箱二次确认，删除或归档

## 📊 性能指标

| 指标 | 数据 |
|------|------|
| 分类准确率 | **取决于所选模型**（设备端本地 ONNX 或您配置的在线大模型） |
| 支持分类类别 | **9大类**（内容分类） |
| 多维度分类 | **8大维度**（内容、城市、颜色、存储、格式、分辨率、方向、相似组） |
| AI分类维度 | **2个**（内容、颜色） |
| 本地算法维度 | **6个**（城市、存储、格式、分辨率、方向、相似组） |
| 隐私保护 | **本地默认离线**；在线分类为可选，走用户自配服务商，全部修图均在本地完成 |
| Android扫描速度 | **MediaStore 优化** |
| 哈希计算速度 | **原生多线程加速** |

## 🛠️ 技术架构

### 前端技术

- **React Native** - 跨平台移动应用开发框架
- **React** - Web/PC端界面框架
- **Electron** - 桌面应用封装

### AI技术

- **ONNX Runtime** - 设备端高性能 AI 推理引擎（本地、离线）
- **MobileNetV3** - 设备端图像分类模型，内容/场景识别（默认本地分类核心）
- **Real-ESRGAN x4** - 设备端超分增强模型（修图 AI 增强）
- **可选在线大模型** - OpenAI / Kimi / Claude / Gemini / Azure / Ollama，用户自行配置，分类请求发往用户指定服务商

### 数据存储

- **IndexedDB** - 浏览器端结构化数据存储
- **AsyncStorage** - React Native本地存储
- **SQLite** - 移动端数据库（可选）

### 性能优化

- **智能缓存** - 推理结果缓存，避免重复计算
- **统一路由** - 由 `aiProvider.active` 决定走本地 ONNX 还是用户配置的在线大模型
- **相似度优化** - 基于推理结果的快速相似度检测
- **MediaStore集成** - Android 平台使用 MediaStore API 加速扫描
- **原生多线程哈希** - Android 平台原生多线程并行计算哈希
- **并行处理** - 充分利用多核 CPU 提升处理效率

## 📁 项目结构

```
ImageClassifierApp/
├── src/
│   ├── components/             # 可复用组件
│   │   ├── CategoryCard.js     # 分类卡片组件
│   │   └── shared/             # 共享组件
│   ├── screens/                # 页面组件
│   │   ├── desktop/            # 桌面端页面
│   │   └── mobile/             # 移动端页面
│   ├── services/               # 业务服务
│   │   ├── ImageClassifierService.js    # 图片分类核心服务
│   │   ├── ImageSimilarityService.js    # 相似度检测服务
│   │   ├── ImageStorageService.js       # 存储服务
│   │   ├── GalleryScannerService.js     # 相册扫描服务
│   │   ├── CityLocationService.js       # 城市定位服务
│   │   ├── UnifiedDataService.js        # 统一数据服务
│   │   ├── ConfigService.js             # 配置服务
│   │   ├── ImageEnhanceService.js        # 修图服务（本地滤镜 + 本地 AI 超分）
│   │   ├── MediaStoreService.js          # MediaStore服务（Android）
│   │   ├── ParallelHashCalculator.js    # 并行哈希计算服务
│   │   ├── ImageProcessor.js             # 图像处理服务
│   │   ├── ColorHistogramExtractor.js    # 颜色直方图提取服务
│   │   ├── WakeLockService.js            # 唤醒锁服务
│   │   └── WeChatAuthService.js          # 微信认证服务
│   ├── adapters/               # 平台适配器
│   │   └── WebAdapters.js      # Web平台适配
│   └── workers/                # Web Worker
│       └── hashWorker.js       # 哈希计算Worker
├── public/                     # 公共资源
│   ├── models/                 # 设备端 ONNX 模型文件
│   │   ├── mobilenetv3_rw_Opset17.onnx   # MobileNetV3 内容分类模型
│   │   └── real_esrgan_x4v3_merged.onnx  # Real-ESRGAN x4 超分模型
│   └── index.html              # 入口HTML
├── pc-version-final/           # PC桌面版本
│   ├── src/                    # PC版源码
│   ├── build/                  # 构建输出
│   └── dist/                   # 打包文件
├── android/                    # Android原生代码
└── package.json                # 项目配置
```

## 🔐 隐私保护

- ✅ **本地默认离线** - 默认的本地分类（设备端 ONNX）与全部修图（本地滤镜、本地 AI 超分）均不联网、不上传
- ✅ **在线分类可选且透明** - 唯一的联网情形是您主动配置在线大模型后，分类请求发往您自己指定的服务商；不经任何作者/第三方固定后端
- ✅ **无作者后端** - 已彻底移除原作者公网后端；不存在作者服务器、会员或额度系统
- ✅ **不收集信息** - 不收集用户个人信息
- ✅ **无广告追踪** - 无广告、无第三方追踪
- ✅ **开源透明** - 代码完全开源，可审计

> **注意**：仅当您在「设置 → AI 模型设置」中自行配置了在线大模型时，分类请求才会联网发往您指定的服务商；本地分类与所有修图功能不联网、不上传。

## 🔧 开发指南

### 环境准备

```bash
# 安装Node.js依赖
npm install

# PC版本开发
cd pc-version-final
npm install
npm start              # 开发模式
npm run build          # 构建生产版本
npm run electron-dev   # Electron开发模式
npm run electron-pack  # 打包桌面应用

# macOS版本打包
cd pc-version-final
npm run electron:build-mac      # 打包macOS DMG
npm run electron:build-mac-zip  # 打包macOS ZIP

# 移动版本开发
npx react-native start          # 启动Metro服务器
npx react-native run-android    # 运行Android版本（已验证平台）
npx react-native run-ios        # RN 通用命令，iOS 未做验证
```

> 已验证平台为 Android 与 PC 桌面（Electron / react-native-web）。`run-ios` 为 React Native 通用命令，iOS 平台未做验证。

### 技术文档

- [分类规则配置](src/services/README_ConfigService.md)
- [使用指南](docs/User/芯图相册使用指南.md) - 安装、AI 模型设置、自定义分类、修图
- [多维度分类功能使用指南](docs/User/多维度分类功能使用指南.md)
- [核心功能文案](docs/应用介绍-核心功能文案.md)

## 📊 分类效果

### 内容分类类别

实际识别效果取决于所选模型（设备端本地 ONNX 或您配置的在线大模型），下表仅说明各类别含义：

| 分类类型 | 说明 |
|---------|------|
| 手机截图 | 手机屏幕截图、应用界面 |
| 证件照 | 身份证、护照、驾照等证件 |
| 单人照片 | 个人照、自拍、肖像 |
| 社交活动 | 聚会、合影、多人互动场景 |
| 旅行风景 | 旅游景点、自然风光 |
| 美食记录 | 食物、餐饮、烹饪相关 |
| 宠物萌照 | 猫、狗等宠物照片 |
| 二维码 | 二维码图片 |
| 其它 | 无法归类到上述类别 |

### 多维度分类支持

- **按内容分类** - AI 识别，效果取决于所选模型（本地 ONNX 或在线大模型）
- **按城市分类** - EXIF/GPS + 离线反向地理编码，不联网
- **按颜色分类** - AI 识别主色调，支持多种颜色分类
- **按存储分类** - 文件路径分析，支持按目录分类
- **按格式分类** - 文件格式识别，支持JPEG、PNG、HEIC、WEBP等
- **按分辨率分类** - 智能识别标准分辨率（4K、1080p、720p等）
- **按方向分类** - 宽高比计算，支持横屏、竖屏、全景、正方形
- **相似组分类** - 多算法融合，准确识别相似照片

## 🎯 使用场景

- 📸 **手机相册整理** - 快速清理手机中的海量照片
- 🗂️ **照片批量分类** - 8大维度自动分类，告别手动整理
- 💾 **存储空间清理** - 找出重复和相似照片，释放空间
- 🔍 **快速查找照片** - 按内容、城市、颜色、存储、格式、分辨率、方向等多维度快速定位照片
- 🎨 **个性化分类** - 通过分类控制面板自定义显示的分类维度，并可自定义分类类别与规则
- ✨ **本地修图** - 离线滤镜与设备端 AI 超分提升照片质量，移动端与 PC 均可用
- 📱 **隐私可控** - 本地分类与修图离线进行；在线分类为可选，发往用户自配服务商

## 📱 界面预览

### PC桌面版

![主界面](https://www.xintuxiangce.top/images/首页-1.jpg)
*主界面 - 查看分类统计和最近照片*

![分类详情](https://www.xintuxiangce.top/images/分类进展和统计信息.jpg)
*分类详情 - 查看各个类别的照片*

![暂存箱](https://www.xintuxiangce.top/images/暂存.jpg)
*暂存箱 - 批量处理照片*

## 🤝 贡献指南

我们欢迎各种形式的贡献：

- 🐛 **报告Bug** - 在[Issues](https://github.com/xiawenyong1977-netizen/ImageClassifier/issues)中提交问题
- 💡 **功能建议** - 提出新功能想法和改进建议
- 📝 **文档改进** - 完善使用说明和开发文档
- 🔧 **提交代码** - 修复Bug或添加新功能
- 🌟 **Star支持** - 给项目点星，支持项目发展

### 贡献步骤

1. Fork 本仓库
2. 创建您的特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交您的更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 打开一个 Pull Request

## 📚 相关资源

- 🌐 [官方网站](https://www.xintuxiangce.top) - 软件下载和使用指南
- 📖 [使用教程](https://www.xintuxiangce.top/blog.html) - 详细的使用教程
- 💡 [技术博客](https://www.xintuxiangce.top/blog.html) - AI照片分类技术解析
- ❓ [常见问题](https://www.xintuxiangce.top/#faq) - FAQ解答
- 📦 [更新日志](https://github.com/xiawenyong1977-netizen/ImageClassifier/releases) - 版本更新记录

## 🔐 权限说明

### Android权限

应用需要以下Android权限：

- `READ_EXTERNAL_STORAGE` - 读取外部存储中的照片
- `WRITE_EXTERNAL_STORAGE` - 写入处理结果
- `READ_MEDIA_IMAGES` - 读取媒体图片（Android 13+）
- `ACCESS_MEDIA_LOCATION` - 读取媒体位置信息（用于城市分类，Android 10+）
- `MANAGE_EXTERNAL_STORAGE` - 管理外部存储（可选）

### Windows/macOS权限

- 文件系统读写权限（安装时自动申请）

## 🏗️ 技术实现

### 架构设计

**分类路由架构：**
```
缓存查询（智能缓存，避免重复推理）
  ↓
AI 内容/颜色分类（由 aiProvider.active 决定）
  ├─ local-onnx：设备端 ONNX 本地推理（默认、离线、免费）
  └─ 在线大模型：用户在「AI 模型设置」配置后，请求发往用户指定服务商
  ↓
本地维度分类（城市/存储/格式/分辨率/方向/相似组，本地算法）
  ↓
相似度检测（智能去重）
```

### AI模型

| 模型 | 用途 | 推理位置 | 备注 |
|------|------|---------|--------|
| MobileNetV3 | 内容/场景分类 | 设备端 ONNX（本地） | 默认本地分类核心 |
| Real-ESRGAN x4 | 超分增强（修图） | 设备端 ONNX（本地） | 固定 128 输入、x4、分块处理 |
| 用户配置的在线大模型 | 内容/颜色分类（可选） | 用户指定服务商 | OpenAI/Kimi/Claude/Gemini/Azure/Ollama |

### 性能优化

- **智能缓存机制** - 推理结果缓存，避免重复计算
- **相似度算法优化** - 基于推理结果的快速相似度检测
- **并行哈希计算** - 使用 Web Worker（PC 端）和原生多线程（Android）并行计算图片哈希
- **MediaStore优化** - Android 平台使用 MediaStore API 替代文件系统遍历，加速扫描
- **原生多线程处理** - Android 平台使用原生 Java 多线程并行处理，充分利用多核 CPU

## 📦 部署说明

### PC桌面版打包

```bash
cd pc-version-final

# 构建应用
npm run build

# 打包Windows应用
npm run electron-pack

# 打包APPX（Microsoft Store）
npm run electron-pack-appx

# 打包macOS应用
npm run electron:build-mac      # DMG格式
npm run electron:build-mac-zip  # ZIP格式
```

### Android APK打包

```bash
cd android

# 生成Release APK
./gradlew assembleRelease

# APK输出路径
# android/app/build/outputs/apk/release/app-release.apk
```

## 🐛 已知问题

### Android 10+ 文件删除限制

由于Android 10+的Scoped Storage限制，某些目录下的文件可能无法直接删除。应用会尝试多种删除策略：

1. 使用Android MediaStore API
2. 使用react-native-fs
3. 复制到临时目录后删除

如果删除失败，建议用户手动删除文件。

### EXIF位置信息

部分照片可能缺少GPS位置信息，导致无法按城市分类。

## 🔄 更新日志

查看 [CHANGELOG](CHANGELOG.md) 了解版本更新详情。

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 📞 联系我们

- 🌐 **官网**：https://www.xintuxiangce.top
- 📧 **邮箱**：xiawenyong@xintuxiangce.top
- 💬 **问题反馈**：[GitHub Issues](https://github.com/xiawenyong1977-netizen/ImageClassifier/issues)
- 📱 **技术支持**：通过官网联系表单获取帮助

## 🙏 致谢

感谢所有使用和支持ImagePilot的用户！

特别感谢：
- ONNX Runtime 团队提供的高性能推理引擎
- MobileNetV3 与 Real-ESRGAN 模型的作者与社区
- 上游项目 ImageClassifier
- React Native 社区的优秀框架
- 所有开源项目的贡献者

## 🌟 Star History

如果这个项目对您有帮助，请给我们一个Star！⭐

---

**© 2025 ImagePilot. 保留所有权利.**

*让照片管理更智能，让隐私更安全*

# Test build trigger
