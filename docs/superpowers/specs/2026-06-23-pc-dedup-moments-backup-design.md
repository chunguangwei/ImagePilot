# PC 端 去重 / 回忆 / 备份（desktop）— 设计文档

> 日期：2026-06-23。PC 拉齐 🟢 档第二批（相册报告已建样板）。3 个独立 desktop 功能，共用样板。语义搜索因复杂单列后置。

## 通用模式（照 StatsScreen.desktop 样板）

- 每个新建 `src/screens/desktop/XxxScreen.desktop.js`：签名 `({ onBack }) => {...}`（无 react-navigation）；`renderHeader()` 返回栏调 `onBack()`；ScrollView + 卡片；loading/空态分支；硬编码色值（跟随 StatsScreen.desktop 样板）。
- `HomeScreen.desktop.js` 三处接入（照 Stats 模式）：① switch 加 `case 'Xxx'` 动态 import ② 首页入口按钮 `setCurrentScreen('Xxx')` ③ 渲染块 `currentScreen==='Xxx'` + `loadedScreens.Xxx`，onBack 回 Home 并 `loadData()`。注意 :1603 useMemo 依赖数组若引入新状态需补。
- **Alert 不可靠**：desktop 删除/确认用 CategoryScreen.desktop 的自绘 dialog 模式（:2219），不用 `Alert.alert`。

---

## 1. 去重（DuplicatesScreen.desktop）

**数据**：`UnifiedDataService.findExactDuplicates()`（无参）→ `{ groups, totalRedundant, totalWastedBytes }`；group = `{ key, images:[...], keepId, redundantIds:[...], wastedBytes }`（images[0] 保留，redundantIds 待删）。一期只做**完全重复**（相似组后置）。

**删除**：`UnifiedDataService.writeDeleteImages(imageIds, onProgress)` → `{ success, filesDeleted, filesFailed, ... }`。复用 CategoryScreen.desktop 已验证能在 PC 删文件的同一方法。

**UI**：重复组卡片（横向缩略图，images[0] 绿「保留」badge、其余红「删除」badge）+ 逐组「清理该组」(删 group.redundantIds) + 底部「一键清理全部」(删所有 redundantIds)。自绘确认 dialog + 删除进度。删完重新 `findExactDuplicates()`。

**一期风险（实现验证）**：确认 `writeDeleteImages` 在 web 通用分支真落 electron `delete-file`（CategoryScreen.desktop 批量删已能在 PC 删，链路应在）。

## 2. 回忆（MomentsScreen.desktop）— 最易，纯内存零平台依赖

**数据**（全纯内存）：
- 那年今天：内联遍历 `GlobalImageCache.getCache().allImages`，匹配同月同日且年份更早，取前 30。
- `UnifiedDataService.findHolidayMemories({minPhotos=3})` → `{ cards:[{key,name,nameEn,year,count,cover,images,ts}] }`。
- `UnifiedDataService.findTrips({minPhotos=5,maxGapDays=1})` → `{ trips:[{city,cityName,startDay,endDay,days,count,cover,images}] }`。
- 封面覆盖：`getMomentCoverOverrides()` / `setMomentCoverOverride(key,id)`（走 settings，desktop 可用）。

**UI**：三类回忆卡片（那年今天横向缩略图+年份 badge；节日/旅行 WideCard 封面+标题+meta）。封面用 `getUri(img)`（desktop 已适配）。

**一期砍掉**：时刻秀 section（导出视频/分享 desktop 不支持）。

**点开看照片**：复用 HomeScreen.desktop 现有 ImagePreview/Category 切换机制（`setCurrentScreen`+`setScreenProps`）展示卡片内 images。

## 3. 备份（BackupRestoreScreen.desktop + BackupService.desktop）— 改动最大

**核心**：新建 `src/services/BackupService.desktop.js`，**共用 mobile 的 `applyBackup(payload)` 纯 DB 还原逻辑（零改，import 复用）**，只替换文件 IO（mobile 用 `RNFS`，PC 不可用）：

| 方法 | mobile（RNFS） | desktop 改为 |
|---|---|---|
| 导出 `exportBackup` | `RNFS.writeFile` | `select-folder` IPC 选目录 + 渲染进程 `window.require('fs').writeFileSync(path, json, 'utf8')` |
| 列表 `listBackups` | `RNFS.readDir` | `fs.readdirSync` + `statSync`（取 name/size/mtime，过滤 imagepilot-backup-*.json） |
| 读取 `readBackup` | `RNFS.readFile` | `fs.readFileSync(path,'utf8')` + JSON.parse + 校验 `app==='ImagePilot'` |
| 删除 `deleteBackup` | `RNFS.unlink` | `fs.unlinkSync`（或 `delete-file` IPC） |
| `applyBackup` | — | **完全不动，import mobile 版复用** |

> 文件位置：导出用 `select-folder` 让用户选目录；列表扫该目录（记住上次目录到 settings 或固定 `os.homedir()/Pictures`，实现时定）。

**UI**：BackupRestoreScreen.desktop（照样板）：导出按钮、备份列表、每项「还原 / 删除」。**砍掉分享**（desktop 无 Share）。还原走 `readBackup` → `applyBackup`。

## 一期不做（全批 YAGNI）

- 去重：相似组（非字节重复）。回忆：时刻秀 section、分享。备份：分享、自动备份。
- 三者均复用现有 service 逻辑，不改移动端、不改共享 service（备份的 applyBackup 复用不改）。

## 验证（桌面端装包）

- 去重：重复组正确展示；逐组/全部清理真删文件、DB 更新、列表刷新。
- 回忆：三类回忆卡片正确（与移动端一致）；点开看照片正常；时刻秀 section 不出现。
- 备份：导出落盘真实 JSON（选的目录里有文件）；列表正确；还原后分类/自定义分类生效；删除生效。
- 移动端三个功能不受影响（desktop 独立文件，未改 mobile/共享 service）。
