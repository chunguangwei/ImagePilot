# 版本号规范与发布须知 / Release Versioning Guide

本文件记录 ImagePilot 各端版本号的定义、修改位置，以及**下一个版本发布前必须遵守的号段规则**，避免出现「build 号重复被 App Store 拒收」或「安卓/PC 老用户收不到更新」等问题。

---

## 一、当前版本与本次测试发行（2026-11-05）

| 范围 | 版本 | 状态 |
| --- | --- | --- |
| 历史正式版 | `v1.5.82` | 保留现有 Android / 桌面资产 |
| 本次 Android | `1.5.85` | 应用内下载及重试安装修正 |
| iOS | 工程 `1.5.82` / build `12` | 新模型代码已接入，本次不提交 App Store；上架状态以 App Store Connect 为准 |
| PC | `1.5.82` | 本次不构建，不升级桌面版本 |

本次仅同步根目录 `package.json`、`package-lock.json`、Android `versionName` 与生成的 `BuildInfo.js`。测试分支为 `codex/embeddinggemma2-android-preview`，手动工作流选择 `platform=android`，使用现有正式签名。本次 GitHub Release 使用非 prerelease 并设为 latest。现有比较器忽略 beta 后缀，因此从 1.5.83-beta.1 升级采用 1.5.84，不能仅增加 beta 序号。旧版应用读取 `releases/latest` 即可发现更新。

正式全端发布仍按下文同步各端版本；不得因 Android 测试包而声称 iOS/PC 已发布新版。

---

## 二、⚠️ 下一个版本发布前必做（号段规则）

### 1. iOS —— 两个号都要涨
下次提交 App Store 时：
- `MARKETING_VERSION` **必须 > `1.5.82`**（如 `1.5.83`）——用户可见版本名。
- `CURRENT_PROJECT_VERSION` **必须 > `12`**（如 `13`）——同一版本名下 build 号必须严格递增，否则 App Store Connect 拒收。
  > 历史教训：1.5.74 曾上传过 build 4、5（被拒），过审用 build 6；1.5.75 用 build 7。当前工程 build 12，下次至少从 **13** 起。

### 2. Android / PC —— 版本名必须变，否则不推送更新
安卓端更新检测（`src/services/UpdateService.js`）逻辑：
- 拉取 GitHub `releases/latest` 的 `tag_name`（如 `v1.5.75`）。
- 与 App 内 `BUILD_VERSION`（`src/config/BuildInfo.js`）做**语义版本比较** `isNewer(tag, current)`。
- **只有 tag 版本号 > 当前版本号时，老用户才会收到更新提示。**

因此：**发安卓/PC 新版必须 bump `package.json` 的 `version`**（如 1.5.75），否则：
- GitHub workflow 的护栏会检测到 `v1.5.74` 已存在 → **跳过发布**，新包传不上去；
- 即使手动替换了同版本号的包，老用户 `isNewer` 判定为 false → **收不到更新**。

> 本次（1.5.74 修复）是特例：因安卓/PC **尚无存量用户**，才允许沿用 1.5.74 直接覆盖 release 附件。一旦有用户，务必走「升版本号」流程。

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

_最后更新：2026-11-05，本次为 Android 单端测试发布。_

### 1.5.86 LFM 可选描述

Android 下一补丁版本为 1.5.86，避免同版本号漏检更新。LFM 权重独立按需下载，不打入 APK。iOS 原生构建验证不等于 iOS 上架发布；当前 iOS 发布版本保持不变。

## 1.5.87：描述生成修复与配置简化（2026-11-05）

- 修复 Android 旧架构缺少 `clearCache` 原生桥接，导致 LFM 每张图片生成前失败、描述为空的问题；补丁由安装依赖时自动应用。
- EmbeddingGemma 类别编码改用官方 `task: classification | query:` 前缀；保留完整类别含义和自定义规则。相似度仍不是概率，单人照片准确率需更多原图回归。
- 描述开关归入已选中的 EmbeddingGemma，打开后展开“下载并启用”；下载完成自动生效，关闭保留文件。移除语言按钮，中文系统生成中文，其它系统语言生成英文。
- 图片信息显示描述生成状态和失败阶段，失败保留已有描述。Gemma 名称完整换行，移除多余选择圆圈。
- Android 应用内下载或安装失败时提供下载页入口；安装器启动界面也保留手动下载安装入口。
- Android/iOS 均更新至 1.5.87，iOS build 13。iOS 签名与分发状态以发布页实际附件说明为准，不将未签名归档视作可直接安装包或 TestFlight 发布。
