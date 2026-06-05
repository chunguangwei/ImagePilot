---
name: update-version
description: Updates the app version number across ImageClassifierApp source files and GitHub Actions. Use when bumping release version (e.g. 1.1.4), when the user asks to change version, or when preparing a release.
---

# 版本号修改 (Update App Version)

在修改应用版本号（如 1.1.3 → 1.1.4）时，需同步更新以下**源文件**中的版本字符串。不要改 `package-lock.json` 里的依赖版本、不要改 `android/app/build/` 等构建产物。

## 必须修改的源文件

按顺序替换为新版本号（如 `1.1.4`）：

| 文件 | 修改内容 |
|------|----------|
| `package.json` | `"version": "x.y.z"` → 新版本 |
| `android/app/build.gradle` | `versionName "x.y.z"` → 新版本 |
| `ios/ImagePilot.xcodeproj/project.pbxproj` | `MARKETING_VERSION = x.y.z;`（**两处** Debug/Release）→ 新版本（iOS 上架版本号，易漏） |
| `public/initialSettings.json` | `"version": "x.y.z"` → 新版本 |
| `src/config/BuildInfo.js` | `BUILD_VERSION = 'x.y.z'` → 新版本 |
| `src/services/ImageStorageService.js` | `version: 'x.y.z'`（仅应用元数据处）→ 新版本 |
| `pc-version-final/package.json` | `"version": "x.y.z"` → 新版本 |
| `pc-version-final/public/initialSettings.json` | `"version": "x.y.z"` → 新版本 |
| `.github/workflows/main-build.yml` | `vars.CURRENT_VERSION || 'x.y.z'` 三处默认回退值 → 新版本 |

## 说明

- **BuildInfo.js**：由 `scripts/generate-build-info.js` 在 `prebuild`/构建时根据**当前工作目录**对应的 `package.json` 自动生成。若已改根目录或 `pc-version-final` 的 `package.json`，构建时会覆盖该文件；手动改一次可保证未构建前显示正确。
- **main-build.yml**：Release 的 tag/name/body 使用 `vars.CURRENT_VERSION || 'x.y.z'`。未在仓库 Variables 中设置 `CURRENT_VERSION` 时，使用这里的默认值，故需与当前发布版本一致。
- **ImageStorageService.js**：只改应用元数据里的 `version` 字段（与「版本号」相关的那一处），不要改其他依赖或配置里的版本号。

## 不要修改

- `package-lock.json`、`pc-version-final/package-lock.json` 中**依赖包**的 version（如 color-name、sprintf-js 等）。
- `android/app/build/` 下任何文件（构建生成）。
- `node_modules/` 下任何文件。

## 检查清单

修改完成后可快速核对：

- [ ] 根目录 `package.json` 的 `version`
- [ ] `android/app/build.gradle` 的 `versionName`
- [ ] `ios/ImagePilot.xcodeproj/project.pbxproj` 的 `MARKETING_VERSION`（两处，iOS 上架用，易漏）
- [ ] `public/initialSettings.json` 的 `version`
- [ ] `src/config/BuildInfo.js` 的 `BUILD_VERSION`
- [ ] `src/services/ImageStorageService.js` 中应用 `version`
- [ ] `pc-version-final/package.json` 与 `pc-version-final/public/initialSettings.json` 的 `version`
- [ ] `.github/workflows/main-build.yml` 中三处 `'x.y.z'` 默认值
