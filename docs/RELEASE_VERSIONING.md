# 版本号规范与发布须知 / Release Versioning Guide

本文件记录 ImagePilot 各端版本号的定义、修改位置，以及**下一个版本发布前必须遵守的号段规则**，避免出现「build 号重复被 App Store 拒收」或「安卓/PC 老用户收不到更新」等问题。

---

## 一、当前移动端发行（2026-11-07）

| 范围 | 版本 | 状态 |
| --- | --- | --- |
| Android | `1.6.5` | 使用现有正式签名；GitHub Release 非 prerelease 并设为 latest |
| iOS | `1.6.5` / build `38` | 开发签名真机测试；App Store 更新归档与资料另行准备 |
| PC | `1.5.82` | 本次不构建、不升级桌面版本 |

本次只发布移动端，更新根目录 package/package-lock、Android versionName、iOS marketing/build 和 BuildInfo。分支 `codex/embeddinggemma2-android-preview`，手动 workflow 选择 android。iOS 构建与安装结果以最终发布记录为准，不能将开发签名包当作通用 Ad Hoc / TestFlight 安装包。

## 二、下一版号段规则

- Android 下次版本名须高于 1.6.5，才能被应用内 `releases/latest` 更新检测识别。不得覆盖同版本 APK 代替递增版本。
- iOS 下次重新打包 build 至少为 39；需要提交 App Store 时使用正确分发签名并单独完成审核流程。
- Android versionCode 为构建时间生成，发布前核实大于上一版本；签名证书须与 1.5.90 一致。
- 若未来发布桌面端，另同步桌面 package 版本；本次不能把未构建的桌面端声明为 1.5.98。

---

## 三、标准发布流程（下次发版参考）

1. **统一 bump 版本号**（保持四端一致，除非 iOS 单独热修）：
   - `package.json` → `version`
   - **`pc-version-final/package.json` → `version`**（桌面 dmg/exe/appx 文件名由它决定，漏改会导致产物仍是旧版本号）
   - `ios/ImagePilot.xcodeproj/project.pbxproj` → `MARKETING_VERSION` + `CURRENT_PROJECT_VERSION`（build 号递增）
   - `android/app/build.gradle` → `versionName`（`versionCode` 自动按时间戳）
   - `src/config/BuildInfo.js` → `BUILD_VERSION`（可由 `scripts/generate-build-info.js` 生成）
2. **在 `CHANGELOG.md` 顶部追加本版更新内容**（完整技术记录）。
   - 同时更新根目录 **`RELEASE_NOTES.md`**（面向用户的简明更新要点）——CI 发布时用它作为 GitHub Release 正文，App 内「检查更新」弹窗会读取该正文（`UpdateService` 的 `data.body`）展示给用户。
3. **提交并 push 到 `main`** → GitHub Actions 自动构建四端并创建 `v{version}` Release（tag 不存在时才发布）。
4. **iOS**：Xcode Organizer 上传 build → App Store Connect 关联 build → 提交审核（附审核回复说明）。
5. 过审后打 tag 留档，如 `ios-appstore-{version}-b{build}`。

---

## 四、关键文件速查

| 用途 | 文件 |
| --- | --- |
| 通用版本号（发布 tag 来源） | `package.json` |
| iOS 版本名 / build 号 | `ios/ImagePilot.xcodeproj/project.pbxproj` |
| Android 版本名 / versionCode | `android/app/build.gradle` |
| App 内展示 / 更新比较用版本 | `src/config/BuildInfo.js` |
| 安卓/PC 更新检测逻辑 | `src/services/UpdateService.js` |
| CI 构建与发布护栏 | `.github/workflows/main-build.yml` |

---

_最后更新：2026-11-07。下方旧版章节为历史记录。_

### 1.5.86 LFM 可选描述

Android 下一补丁版本为 1.5.86，避免同版本号漏检更新。LFM 权重独立按需下载，不打入 APK。iOS 原生构建验证不等于 iOS 上架发布；当前 iOS 发布版本保持不变。

## 1.5.87：描述生成修复与配置简化（2026-11-05）

- 修复 Android 旧架构缺少 `clearCache` 原生桥接，导致 LFM 每张图片生成前失败、描述为空的问题；补丁由安装依赖时自动应用。
- EmbeddingGemma 类别编码改用官方 `task: classification | query:` 前缀；保留完整类别含义和自定义规则。相似度仍不是概率，单人照片准确率需更多原图回归。
- 描述开关归入已选中的 EmbeddingGemma，打开后展开“下载并启用”；下载完成自动生效，关闭保留文件。移除语言按钮，中文系统生成中文，其它系统语言生成英文。
- 图片信息显示描述生成状态和失败阶段，失败保留已有描述。Gemma 名称完整换行，移除多余选择圆圈。
- Android 应用内下载或安装失败时提供下载页入口；安装器启动界面也保留手动下载安装入口。
- Android/iOS 均更新至 1.5.87，iOS build 13。iOS 签名与分发状态以发布页实际附件说明为准，不将未签名归档视作可直接安装包或 TestFlight 发布。
