# 版本号规范与发布须知 / Release Versioning Guide

本文件记录 ImagePilot 各端版本号的定义、修改位置，以及**下一个版本发布前必须遵守的号段规则**，避免出现「build 号重复被 App Store 拒收」或「安卓/PC 老用户收不到更新」等问题。

---

## 一、当前线上版本（基线）

| 端 | 版本名 (version name) | 构建号 (build) | 修改位置 |
| --- | --- | --- | --- |
| iOS | `1.5.75` (`MARKETING_VERSION`) | `7` (`CURRENT_PROJECT_VERSION`) | `ios/ImagePilot.xcodeproj/project.pbxproj` |
| Android | `1.5.75` (`versionName`) | 构建时间戳 `MMddHHmm`（自动，`versionCode`） | `android/app/build.gradle` |
| PC / 通用 | `1.5.75` | — | `package.json` 的 `version`（**桌面打包产物命名读取 `pc-version-final/package.json` 的 `version`，务必同步 bump**）|

> 说明：GitHub Releases 的发布逻辑（`.github/workflows/main-build.yml`）读取 **`package.json` 的 `version`** 作为 tag（`v{version}`）。

---

## 二、⚠️ 下一个版本发布前必做（号段规则）

### 1. iOS —— 两个号都要涨
下次提交 App Store 时：
- `MARKETING_VERSION` **必须 > `1.5.75`**（如 `1.5.76`）——用户可见版本名。
- `CURRENT_PROJECT_VERSION` **必须 > `7`**（如 `8`）——同一版本名下 build 号必须严格递增，否则 App Store Connect 拒收。
  > 历史教训：1.5.74 曾上传过 build 4、5（被拒），过审用 build 6；1.5.75 用 build 7。下次至少从 **8** 起。

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

_最后更新：2026-07-19，对应线上基线 1.5.75 (iOS build 7)。_
