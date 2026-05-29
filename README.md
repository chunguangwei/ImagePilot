# ImagePilot - AI 智能照片分类管理工具

[![Repo](https://img.shields.io/badge/GitHub-chunguangwei%2FImagePilot-blue.svg)](https://github.com/chunguangwei/ImagePilot)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Android-lightgrey.svg)](https://github.com/chunguangwei/ImagePilot)
[![AI](https://img.shields.io/badge/AI-Local%20ONNX%20%7C%20Optional%20LLM-brightgreen.svg)](https://github.com/chunguangwei/ImagePilot)

## 📖 项目简介

**ImagePilot** 是一款隐私优先的智能照片分类管理工具：默认全程本地离线分类（设备端 ONNX），可选配置你自己的大模型做在线增强；并内置从 GitHub 一键升级的能力。支持 Android（React Native）与 PC 桌面（Electron / react-native-web），已验证平台为 Android 与 PC。

> 本项目以 MIT 许可证开源，早期基于上游 ImageClassifier 起步，现已作为独立产品演进（移除原作者公网后端、统一走用户自配大模型、自建 GitHub 升级通道等）。上游致谢见文末「致谢」。

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

### ✨ 修图（全设备端 · 一键预设 + 可调滤镜）

修图功能全部在设备端本地完成，不联网、不上传，移动端与 PC 均可用：

- 🔍 **AI 清晰增强（超分）** - Real-ESRGAN x4，onnxruntime 设备端推理，分块处理大图
- ✂️ **AI 抠图** - U²-Net 显著性分割，自动剥离主体并铺白底
- 🩹 **物体消除（涂抹）** - MI-GAN 修复，手指涂抹要去除的区域即可
- 💄 **人像美颜** - 保边平滑 + 提亮 + 暖肤气色，免模型（纯 jimp，秒级）
- 🌈 **色彩优化** - 单次像素扫描（饱和/对比/亮度），约 10× 快于链式滤镜
- 📄 **证件矫正** - 自动找四角 + 可调手柄 + 透视矫正 + 扫描增强
- 🎨 **滤镜编辑器** - jimp 纯 JS：黑白 / 复古 / 鲜艳 / 淡雅 / 暖冷色 / 胶片 / 柔化 / 反色，可调强度
- 👀 **前后对比** - 预览支持「按住看原图」，松手回到处理后效果

> 大尺寸 AI 模型（超分大/抠图/消除）首次使用时按需从 GitHub Release 下载，安装包瘦身至 ≈192MB；下载与推理进度在处理蒙层实时显示，← 可随时退出。

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

### 🔄 应用内更新

直接从本项目的 GitHub Releases 升级，无需第三方应用商店：

- **启动自动检查**：每次启动静默检查 [chunguangwei/ImagePilot](https://github.com/chunguangwei/ImagePilot/releases) 的最新发布；有新版才弹窗提示。
- **手动检查**：「设置 → 检查更新」随时查看当前版本与最新版本。
- **一键下载**：检测到新版后点击「前往下载」，浏览器下载最新 APK，由系统安装器完成安装。
- **网络容灾**：`api.github.com` 不可达时自动回退 `releases.atom`，仍不可达则引导打开发布页手动下载。

> 发布方式：在 `chunguangwei/ImagePilot` 打 Release、tag 用语义化版本（如 `v1.2.0`）、并把 APK 作为 Release 资产上传，客户端即可检测并引导下载。

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

**Android：从 GitHub Releases 下载（推荐）**
1. 打开 [chunguangwei/ImagePilot Releases](https://github.com/chunguangwei/ImagePilot/releases/latest)
2. 下载最新版 `app-release.apk`
3. 在手机上点击安装（首次需允许「安装未知来源应用」）
4. 装好后，应用会在启动时自动检查更新，后续升级一键完成

**PC（桌面版）**
- 从源码构建（见下方「开发指南」）；Electron 打包产物用于 Windows / macOS。

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
- **Real-ESRGAN x4**（v3 小/plus 大可选）- 设备端超分增强（修图 AI 清晰增强）
- **U²-Net** - 设备端显著性分割（修图 AI 抠图 + 证件文档边缘检测）
- **MI-GAN** - 设备端图像修复（修图 物体消除）
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
ImagePilot/
├── src/
│   ├── components/             # 可复用组件
│   ├── screens/
│   │   ├── desktop/            # 桌面端页面
│   │   └── mobile/             # 移动端页面（iOS 风格）
│   ├── services/               # 业务服务
│   │   ├── enhance/            # 修图：超分/抠图/消除/美颜/色彩/证件矫正/滤镜 + 模型按需下载
│   │   ├── ImageClassifierService.js    # 图片分类核心
│   │   ├── ImageSimilarityService.js    # 相似度检测（时间窗 ≥2 张）
│   │   ├── ImageStorageService.js       # 存储
│   │   ├── GalleryScannerService.js     # 相册扫描
│   │   ├── CityLocationService.js       # 离线反向地理编码
│   │   ├── UnifiedDataService.js        # 统一数据
│   │   ├── ConfigService.js             # 配置
│   │   ├── ImageEnhanceService.js       # 修图入口
│   │   ├── UpdateService.js             # 应用内更新（GitHub Releases）
│   │   ├── ParallelHashCalculator.js    # 并行哈希
│   │   └── …
│   ├── ui/ios/                 # iOS 风格 UI（Ionicons / 蓝色 i 图标 / 蒙层 spinner）
│   ├── adapters/               # 平台适配（WebAdapters / RNFS）
│   ├── i18n/                   # 中英文案
│   └── workers/                # Web Worker（PC 端哈希）
├── android/                    # Android 原生
│   └── app/src/main/java/com/imageclassifier/v2/
│       ├── MediaStoreModule.java        # 含 Android 11+ 删除授权（IntentSender）
│       └── …
├── pc-version-final/           # PC 桌面（Electron + react-native-web）
├── scripts/generate-build-info.js       # 构建时自动写 BuildInfo.js
└── package.json
```

> 设备端 ONNX 模型（超分大/抠图/消除）首次使用时按需从 GitHub Release 下载并缓存到 `files/models/`，不打入 APK——这也是 APK 从 234MB 瘦身至 ≈192MB 的核心改动。

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

> 当前 iOS 风格 UI（Ionicons 单色线性 + SF 字号/色板）已全面落地：首页分类网格、单图 AI 识别胶囊、设置页、修图蒙层 都已统一主题。截图待补充。

## 🤝 贡献指南

我们欢迎各种形式的贡献：

- 🐛 **报告Bug** - 在 [Issues](https://github.com/chunguangwei/ImagePilot/issues) 中提交问题
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

- 📦 [Releases](https://github.com/chunguangwei/ImagePilot/releases) - 下载最新版本与更新日志
- 🐛 [Issues](https://github.com/chunguangwei/ImagePilot/issues) - 反馈问题与功能建议
- 📖 [使用指南](docs/User) - `docs/User` 下的使用与功能文档

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

| 模型 | 用途 | 推理位置 | 加载方式 | 备注 |
|------|------|---------|---------|------|
| MobileNetV3 | 内容/场景分类 | 设备端 ONNX | 内置 | 默认本地分类核心 |
| Real-ESRGAN x4v3 / x4plus | 超分增强（修图） | 设备端 ONNX | 按需下载 | 小模型 5MB / 大模型 64MB，可在设置切换 |
| U²-Netp | 抠图 + 证件边缘检测 | 设备端 ONNX | 按需下载 | 复用同一模型 |
| MI-GAN | 物体消除 | 设备端 ONNX | 按需下载 | 涂抹蒙版 → 修复 |
| 用户配置的在线大模型 | 内容/颜色分类（可选） | 用户指定服务商 | API | OpenAI/Kimi/Claude/Gemini/Azure/Ollama |

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

### Android 11+ 文件删除（已解决）

Scoped Storage 下，删除其他应用拍/截的图需要用户授权。v1.2.1 起接入 `MediaStore.createDeleteRequest`：删除时弹出系统授权对话框，同意即正常删除，拒绝则保留原图。本应用拍/截或自有目录下的图仍可直接删除，不会弹窗。v1.4.0 进一步在 unlink 后复核文件确实消失（避免 Scoped Storage 假成功），且系统授权删除后同步清掉 app 内 DB 残留记录，杜绝"提示已删除但相册还在"的鬼影。

### EXIF位置信息

部分照片可能缺少GPS位置信息，导致无法按城市分类。

## 🔄 更新日志

### v1.4.2（2026-05-29）

- 📦 **分类备份与还原**：设置页新增入口，一键把"每张图归到哪个分类 + 自定义分类定义"导出到 `Downloads/imagepilot-backup-*.json`；换机/重装/清数据后在新机的同位置选文件即可一键还原，按 `文件名 + 大小 + 拍摄时间` 命中本地相册，不必再走云端 LLM 重新分类

### v1.4.1（2026-05-29）

- ✏️ **自定义分类可编辑**：每项可改名称 / 规则 / 图标（id 因关系到历史归属图，仍只读）
- 🧯 **删除分类不丢图**：删除自定义分类前，先把其下照片回归到「待分类」，再移除分类项——再也不会"删分类→图也没了"

### v1.4.0（2026-05-29）

- 🗑️ **删除可靠性**：unlink 后复核 + 系统授权后清 DB —— 不再出现"已删除但其实没删"
- 🧭 **分类排序**：「其它」恒定倒数第二、「待分类」恒定末位（首页 / 改分类弹窗 / 全部入口一致）
- 🎨 **统一图标主题**：改分类弹窗与自定义分类管理改用 MaterialIcons + 圆形主题色背景，告别零散 emoji
- 🏷️ **自定义分类带图标**：新建时可在 18 个预设里挑一个；删除分类时其图标也随之消失

### v1.3.0 及更早

查看 [CHANGELOG](CHANGELOG.md) 或 [Releases](https://github.com/chunguangwei/ImagePilot/releases) 了解早期版本详情。

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 📞 联系与反馈

- 💬 **问题反馈 / 功能建议**：[GitHub Issues](https://github.com/chunguangwei/ImagePilot/issues)
- 📦 **下载 / 更新**：[Releases](https://github.com/chunguangwei/ImagePilot/releases)

## 🙏 致谢

感谢所有使用和支持ImagePilot的用户！

特别感谢：
- ONNX Runtime 团队提供的高性能推理引擎
- MobileNetV3 与 Real-ESRGAN 模型的作者与社区
- 上游项目 [ImageClassifier](https://github.com/xiawenyong1977-netizen/ImageClassifier)（MIT，ImagePilot 早期基于其起步）
- React Native 社区的优秀框架
- 所有开源项目的贡献者

---

**© 2026 ImagePilot. 保留所有权利.**

*让照片管理更智能，让隐私更安全*
