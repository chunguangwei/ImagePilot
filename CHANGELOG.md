# 更新日志 / Changelog

本文件记录 ImagePilot 各版本的正式更新内容。遵循 [语义化版本](https://semver.org/lang/zh-CN/) 与 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范。

---

## [1.5.74] - 2026-07-08

首个以 **ImagePilot** 品牌正式上架 Apple App Store 的版本（iOS build 6）。

### 修复 / Fixed
- **修复「立即升级」按钮点击无响应的问题**（App Store 审核 Guideline 2.1a）。
  根因：升级弹窗跳转设置页时携带的 `autoUpgradeClip` 路由参数从未被消费，导致点击后无任何反应。现已在设置页正确读取并处理该参数，自动展开分类器区域并触发模型下载。iOS 与 Android 共享该逻辑，双端同时修复。
  Fixed the "Upgrade Now" button doing nothing (App Store Guideline 2.1a). The `autoUpgradeClip` route param was never consumed; it is now handled correctly. Covers both iOS and Android.

### 新增 / Added
- **新增第三方 AI 在线分类的明确用户同意提示**。
  在启用需要将图片上传至第三方 AI 服务的在线分类前，弹出中/英文同意对话框（移动端 `Alert`、桌面端 `confirm`），用户明确同意后方可继续。
  Added an explicit consent dialog before enabling third-party online AI classification (mobile `Alert` / desktop `confirm`), with zh/en localization.

### 变更 / Changed
- **全端品牌更名：芯图相册 → ImagePilot**。涵盖 UI 文案、文档、包名展示、安装包命名等。
  Rebranded across all platforms: "芯图相册" → "ImagePilot".

### 平台发布状态 / Platform Release
| 平台 | 版本 | 发布渠道 | 状态 |
| --- | --- | --- | --- |
| iOS | 1.5.74 (6) | Apple App Store | ✅ 已上架（自动发布，可分发）|
| Android | 1.5.74 | GitHub Releases | ✅ 已发布（含签名 APK）|
| macOS | 1.5.74 | GitHub Releases | ✅ 已发布（dmg）|
| Windows | 1.5.74 | GitHub Releases | ✅ 已发布（appx / setup / portable）|

对应代码：commit `b6c1280`，git tag `ios-appstore-1.5.74-b6`。

---

<!--
新版本请在此上方追加，保持倒序（最新在上）。模板：

## [x.y.z] - YYYY-MM-DD
### 新增 / Added
### 修复 / Fixed
### 变更 / Changed
### 移除 / Removed
-->
