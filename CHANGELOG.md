# 更新日志 / Changelog

本文件记录 ImagePilot 各版本的正式更新内容。遵循 [语义化版本](https://semver.org/lang/zh-CN/) 与 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范。

---

## [1.5.82] - 2026-07-28

Bug 修复版（iOS 关键修复），全端同步更新。

### 修复 / Fixed
- **iOS「按城市」分类为空**：自 v1.5.75 起，首页「重新检测」与空态引导改走增量扫描（`handleScan`）后，iOS 扫描链路中不再有任何入口触发位置补全（`enrichLocationInfo` 零调用）——Android 扫描内部会自动补全，iOS 不会。导致 iOS 上照片只有 GPS 经纬度、永远不会有城市，「按城市」整段为空且点「重新检测」无反应（新安装用户尤甚）。现对齐 Android：iOS 扫描收尾时自动执行位置补全（GPS → 离线城市反查 → 落库 → 刷缓存），存量缺城市的照片下次扫描自动补齐。同步清理 `HomeScreen.mobile.js` 中已无调用的 `handleStartLocationEnrichment` 死代码（`GalleryScannerService.ios.js`）。
  Fixed iOS "By City" section being empty: since v1.5.75 no code path triggered location enrichment on iOS (Android scans enrich automatically, iOS did not), so photos had GPS coordinates but never got a city. iOS scans now run location enrichment at completion (parity with Android); previously-missed photos are backfilled on the next scan. Also removed the dead `handleStartLocationEnrichment` handler.

### 平台发布状态 / Platform Release
| 平台 | 版本 | 发布渠道 | 说明 |
| --- | --- | --- | --- |
| iOS | 1.5.82 (12) | Apple App Store | 纯 JS 逻辑，影响 iOS，需提交 App Store 更新 |
| Android | 1.5.82 | GitHub Releases | APK（版本号同步，无安卓侧代码变化） |
| macOS | 1.5.82 | GitHub Releases | dmg（版本号同步，无桌面侧代码变化） |
| Windows | 1.5.82 | GitHub Releases | exe / appx（版本号同步，无桌面侧代码变化） |

---

## [1.5.81] - 2026-07-27

Bug 修复版，全端同步更新。（1.5.80 之后补充的两处修复，随本次 iOS 上架一并发布）

### 修复 / Fixed
- **旅行回忆漏掉大理/丽江等目的地**：旅行回忆此前把「去过较久的城市」误判为常驻城市而过滤掉，导致大理、丽江等长途旅行目的地不出现在旅行回忆中。现在常驻城市判定加入**时间跨度判据（照片时间跨度 ≥ 45 天才算常驻）**，短期集中拍摄的旅行城市不再被误判为常驻，正常纳入旅行回忆（`MomentsScreen.mobile.js` 常驻城市判定逻辑）。
  Fixed travel memories missing destinations like Dali/Lijiang: resident-city detection now also requires a photo time span ≥ 45 days, so short trips are no longer misclassified as resident cities and are included in travel memories.
- **首页类目卡片数量徽章位置调整**：数量徽章从卡片右下角移到**右上角**，避开左下角的主题名，避免主题名较长时与数量徽章重叠（`HomeScreen.mobile.js` 样式 `categoryCountBadge`）。
  Moved the category count badge from bottom-right to top-right to avoid overlapping the theme name in the bottom-left corner.

### 平台发布状态 / Platform Release
| 平台 | 版本 | 发布渠道 | 说明 |
| --- | --- | --- | --- |
| iOS | 1.5.81 (11) | Apple App Store | 纯 JS 逻辑，影响 iOS，需提交 App Store 更新 |
| Android | 1.5.81 | GitHub Releases | APK |
| macOS | 1.5.81 | GitHub Releases | dmg |
| Windows | 1.5.81 | GitHub Releases | exe / appx |

---

## [1.5.80] - 2026-07-21

Bug 修复版，全端同步更新。

### 修复 / Fixed
- **编辑时刻秀时图片丢失**：原因是从缓存查图可能不全（缓存异步加载中），现改为编辑模式进入时从 `imageIds` 实时查库重建完整图片列表，显示 loading 提示（`ShowcaseCreateScreen.mobile.js`）。
  Fixed missing images when editing Showtime: now rebuilds the full image list from `imageIds` on entry instead of relying on potentially incomplete cache.
- **首页类目卡片数量与名称重叠**：城市/时间/分类卡片的数量文字改为**右下角白底半透明徽章**（绝对定位，不占名称布局空间），数量再大也不会与名称挤在一起（`HomeScreen.mobile.js` 样式 `categoryCountBadge`）。
  Fixed count text overlapping category names: counts now render as bottom-right badges (absolute positioned, white translucent background) that never interfere with the name.

### 平台发布状态 / Platform Release
| 平台 | 版本 | 发布渠道 | 说明 |
| --- | --- | --- | --- |
| iOS | 1.5.80 (10) | Apple App Store | 纯 JS 逻辑，影响 iOS，需提交 App Store 更新 |
| Android | 1.5.80 | GitHub Releases | APK |
| macOS | 1.5.80 | GitHub Releases | dmg |
| Windows | 1.5.80 | GitHub Releases | exe / appx |

---

## [1.5.79] - 2026-07-21

功能优化，全端同步更新：相似照片检测支持「增量检测」。

### 新增 / Added
- **相似照片检测支持「增量检测 / 全部检测」二选一**：点击「相似照片」的「重新检测」时，弹窗让用户选择——
  - **增量检测（仅新增）**：只对「尚未建立特征索引的新增照片」所在的时间窗口做比对，其余照片的既有相似组保留不动，并复用历史颜色直方图缓存，**照片多时显著更快**；
  - **全部检测**：清空后对全库重新比对（原行为）。
  首次检测（无任何历史特征）时增量会自动回退全量。移动端为三按钮弹窗，桌面端为「确定=增量 / 取消=全部」确认框。（`similarityDetectionPhase.js` / `ImageSimilarityService.js` / `GalleryScannerService{.js,.android.js,.ios.js}` / `HomeScreen.mobile.js` / `HomeScreen.desktop.js`，iOS + Android + 桌面全端）
  Added incremental vs full choice for similar-photo detection: incremental only re-compares time windows containing newly added photos (reusing cached color-histogram features), which is much faster on large libraries; falls back to full on first run.
- **相似照片列表改为缩略图卡片 + 最新优先**：展开查看全部相似组时，原来是纯文字「相似组·N」难以辨认，现统一改为**缩略图卡片**（取组内最新一张照片作代表图，右下角显示数量）；相似组默认按**组内最新照片时间降序**排列，最新/增量新增的组排最前（`HomeScreen.mobile.js` 缩略图网格、`UnifiedDataService.getSimilarityGroupsStats` 排序，全端受益）。
  Similar-photo groups now render as thumbnail cards (representative photo + count) instead of text-only chips, and are sorted newest-first so newly added groups appear on top.

### 修复 / Fixed
- 「最新发现照片」头部去掉冗余数字（蓝色总数徽章与「更多 (N)」的数字），避免与按钮挤在一排（`HomeScreen.mobile.js`）。
  Removed redundant numbers in the "Recently Discovered" header to fix cramped layout.

### 平台发布状态 / Platform Release
| 平台 | 版本 | 发布渠道 | 说明 |
| --- | --- | --- | --- |
| iOS | 1.5.79 (8) | Apple App Store | 纯 JS 逻辑，影响 iOS，需提交 App Store 更新 |
| Android | 1.5.79 | GitHub Releases | APK |
| macOS | 1.5.79 | GitHub Releases | dmg |
| Windows | 1.5.79 | GitHub Releases | exe / appx |

---

## [1.5.78] - 2026-07-21

稳定性修复（续 1.5.77）：本地大模型分类「刚完成即闪退」。

### 修复 / Fixed
- **离线分类完成瞬间 App 崩溃退出（Android）**：分类循环跑完后，代码先执行 `refreshCache()`（重建全量图片缓存，内存开销大），而此时 ~2.5GB 的 VLM 原生引擎尚未释放——「引擎常驻 + 重建缓存」在收尾一刻叠加顶爆内存，被系统 OOM-kill，表现为「分类刚完成就闪退」。现将 VLM 引擎释放**提前到 `refreshCache()` 之前**（循环一结束即释放），削掉收尾内存峰值；`finally` 中保留一次幂等释放兜底（`GalleryScannerService.android.js`，Android）。
  Fixed the app crashing right after offline classification finished (Android): the ~2.5GB VLM engine was released only after the memory-heavy cache rebuild, causing an OOM at the tail. Now the engine is released before the cache rebuild to cut the peak.

### 平台发布状态 / Platform Release
| 平台 | 版本 | 发布渠道 | 说明 |
| --- | --- | --- | --- |
| iOS | 1.5.76 (8) | Apple App Store | Android 收尾内存修复，iOS 不受影响，**无需重新提交** |
| Android | 1.5.78 | GitHub Releases | APK |
| macOS | 1.5.78 | GitHub Releases | dmg |
| Windows | 1.5.78 | GitHub Releases | exe / appx |

---

## [1.5.77] - 2026-07-20

稳定性修复：本地大模型（端侧 Gemma VLM）分类崩溃退出。

### 修复 / Fixed
- **本地大模型分类时 App 崩溃退出（Android）**：一次性定位并彻底修复三处根因——
  1. **GPU 驱动原生崩溃**：原 `ensureEngine` GPU 优先，部分机型 GPU 能通过「建会话」探测却在真正跑推理时于 native 层 SIGSEGV（Java try/catch 无法捕获），导致整个 App 退出。现改为 **CPU-only**（对齐 iOS，稍慢但稳定）。
  2. **加载前无内存校验、门槛过低**：新增**可用内存实时校验**（`availMemoryMB`，低于 2200MB 直接判不可用），并将设备内存门槛 `minDeviceMemMB` 由 2800 提高到 3800（仅 4GB+ 机型放行），避免加载 ~2.5GB 权重途中被系统 OOM-kill / 崩溃。
  3. **引擎从不释放**：VLM 档扫描跑完 / 出错 / 中途停止后，均调用 `disposeVLMContext` 释放原生 Engine（~2.5GB 常驻内存），避免与下次加载叠加触发 OOM。
  （`GemmaModule.java` / `vlmModels.android.js` / `GalleryScannerService.android.js`，Android。iOS 使用 Qwen/llama.rn 且本就 CPU-only 稳定，不受影响。）
  Fixed the app crashing/exiting during on-device VLM classification (Android): switched engine to CPU-only (some GPU drivers SIGSEGV at inference time, uncatchable in Java), added a runtime available-memory check plus a higher device-memory gate, and now release the ~2.5GB native engine after scanning.

### 平台发布状态 / Platform Release
| 平台 | 版本 | 发布渠道 | 说明 |
| --- | --- | --- | --- |
| iOS | 1.5.76 (8) | Apple App Store | 本次为 Android 原生修复，iOS 不受影响，**无需重新提交** |
| Android | 1.5.77 | GitHub Releases | 含原生改动（VLM CPU-only + 内存校验），需重新编译 APK |
| macOS | 1.5.77 | GitHub Releases | dmg |
| Windows | 1.5.77 | GitHub Releases | exe / appx |

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
