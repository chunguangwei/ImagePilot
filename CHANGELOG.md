# 更新日志 / Changelog

本文件记录 ImagePilot 各版本的正式更新内容。遵循 [语义化版本](https://semver.org/lang/zh-CN/) 与 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范。

---

## [1.5.76] - 2026-07-19

体验优化，全端同步更新。

### 新增 / Added
- **「最新发现照片」支持展开查看更多**：原固定显示 12 张，现默认显示 12 张、超过时出现「显示更多 (N)」按钮，展开最多显示 100 张，可「收起」恢复折叠（`HomeScreen.mobile.js`，iOS + Android）。
  Added \"Show More\" to Recently Discovered Photos: defaults to 12, expands up to 100 when available, collapsible.

### 平台发布状态 / Platform Release
| 平台 | 版本 | 发布渠道 | 说明 |
| --- | --- | --- | --- |
| iOS | 1.5.76 (8) | Apple App Store | 需提交 App Store 更新 |
| Android | 1.5.76 | GitHub Releases | APK 已发布 |
| macOS | 1.5.76 | GitHub Releases | dmg |
| Windows | 1.5.76 | GitHub Releases | exe / appx |

---

## [1.5.75] - 2026-07-19

体验缺陷修复，覆盖 iOS / Android / 桌面全端。

### 修复 / Fixed
- **时刻秀封面无法修改**：模板类时刻秀在保存时被强制清空 `coverId`，导致用户手动选择的封面永远回退到首帧。现改为无论普通秀还是模板秀都保存用户所选封面（`ShowcaseCreateScreen.mobile.js`，iOS + Android）。
  Fixed showcase cover not updating: template showcases had their `coverId` force-cleared on save, so a manually picked cover always fell back to the first frame. Now the chosen cover is persisted for both normal and template showcases.
- **「按城市」看不到最新去过的城市**：折叠首屏原按照片数量降序截取前 8 个，照片较少的新城市被挤出。现折叠首屏改为**按「最近去过」（最新照片时间）降序**，最新城市必在首屏；城市多于 8 个时点「显示更多」进入完整列表（按数量排序）。此外，「重新检测」原先只做位置补全（仅处理已入库但缺 city 的照片），无法纳入尚未扫描的新照片，导致新城市始终不出现且点击「没反应」；现改为触发**增量扫描**（只处理未扫过的新照片 → 提取 GPS → 补全城市 → 刷新缓存并重载），既能发现新城市又保持增量速度。（`HomeScreen.mobile.js`，iOS + Android；桌面端本就全量展示）
  Fixed newest city missing from the "By City" section: the collapsed view now sorts by most-recently-visited so new cities always appear first, and "Re-check" now runs an incremental scan (ingesting new photos, extracting GPS, resolving cities) instead of location-enrichment only — so newly added cities actually show up.
- **「最新发现照片」长期为空**：该区基于「上次扫描之后新增」的时间窗，窗口随多次扫描不断前滑后会永久为空。新增**空窗兜底**：当该窗口无结果时，自动回退展示「最近入库的照片」，保证不再长期空白且总能看到最新照片（`UnifiedDataService.js` / `HomeScreen.mobile.js`，全端生效）。
  Fixed the "Recently Discovered" section staying empty: the since-last-scan time window slides forward and eventually yields nothing. Added a fallback to show the most recently added photos when the window is empty, so it is never perpetually blank.
- **位置补全后新城市需重启才显示**：位置补全阶段结束时的缓存刷新依赖 `filesProcessed === filesFound` 的脆弱推断，部分图片 GPS 查不到城市时末批新城市会漏刷。改为显式 `phaseComplete` 标记，确保阶段完成时必定重建缓存并通知首页重载（`GalleryScannerService.js` / `.android.js`；iOS 变体本就显式刷新）。
  Fixed new cities requiring an app restart to appear: end-of-phase cache refresh relied on a fragile equality check. Now an explicit `phaseComplete` flag guarantees a cache rebuild and UI reload.
- **「最近照片」在 Android 只显示相机拍摄的照片**：原生查询用 `DATE_TAKEN` 过滤与排序，而截图、下载、社交软件保存的图片 `DATE_TAKEN` 为 0/NULL，被系统性排除。改用**入库时间 `DATE_ADDED`**（列安全、不使用 `COALESCE`/`NULLIF` 等 SQL 函数，规避部分 Android 版本对 selection 表达式的限制）过滤与排序，覆盖所有来源的照片（`MediaStoreModule.java`，Android；iOS/桌面按 `takenAt`/文件时间，本就不受影响）。
  Fixed "recent photos" only showing camera shots on Android: switched the native query from `DATE_TAKEN` to `DATE_ADDED` (column-only, no SQL functions) so screenshots, downloads and social-app images are included.
- **部分城市（如云南大理/丽江/香格里拉）照片识别不出城市**：离线反向地理编码的内置城市库过于精简（云南仅「昆明」），且「最近城市」匹配上限 250km，导致大理（距昆明约 290km）等地坐标解析为空、不进「按城市」。现将内置城市库从 ~55 扩充到 ~213（补齐云南全部州市及全国主要地级市），并新增**省份兜底**：城市 250km 内无命中时按最近省份（≤800km）归类并标记 `isProvince`，不再落「未知」（`cityData.js` / `bundledGeocoder.js`，全端）。
  Fixed photos in cities like Dali/Lijiang/Shangri-La (Yunnan) not resolving: the bundled offline city set was too sparse (only Kunming in Yunnan) with a 250km cap. Expanded the set from ~55 to ~213 cities and added province-level fallback when no city matches within range.

### 平台发布状态 / Platform Release
| 平台 | 版本 | 发布渠道 | 说明 |
| --- | --- | --- | --- |
| iOS | 1.5.75 (7) | Apple App Store | 需提交 App Store 更新（时刻秀封面、按城市、最新发现照片兜底为 JS 逻辑，影响 iOS）|
| Android | 1.5.75 | GitHub Releases | 含原生改动（最近照片 `DATE_ADDED`），需重新编译 APK |
| macOS | 1.5.75 | GitHub Releases | dmg |
| Windows | 1.5.75 | GitHub Releases | appx / setup / portable |

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
