# PC 端 去重 / 回忆 / 备份（desktop）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development（每 task 一个 subagent）。

**Goal:** PC 端补齐去重/回忆/备份三个 desktop 页，照 StatsScreen.desktop 样板，复用共享 service。

**Architecture:** 每功能新建 `XxxScreen.desktop.js`（onBack props），HomeScreen.desktop 状态机加 case+入口；备份另建 `BackupService.desktop.js` 适配文件 IO。

**Tech Stack:** React Native（desktop/web 变体）、共享 UnifiedDataService、Electron fs/IPC（备份）。

## Global Constraints（每 task 隐含）
- **样板** = `src/screens/desktop/StatsScreen.desktop.js`：`({onBack})=>`、`renderHeader()` 返回栏调 onBack、ScrollView+卡片 flexWrap、loading/空态、硬编码色值。
- **HomeScreen.desktop 三处接入**（照 Stats）：① switch(:237) 加 `case 'Xxx'` 动态 import ② 首页入口按钮 setCurrentScreen('Xxx') ③ 渲染块(:1589) `currentScreen==='Xxx'` + `loadedScreens.Xxx`，onBack 回 Home+loadData()。若引入新状态补 :1603 useMemo 依赖。
- **确认/删除用自绘 dialog**（CategoryScreen.desktop :2219 模式），**不用 Alert.alert**。
- **不改移动端、不改共享 service**（备份 applyBackup 复用不改）。
- 一期不做：去重相似组、回忆时刻秀/分享、备份分享。

---

### Task 1: 回忆 MomentsScreen.desktop（最易，纯内存）

**Files:** Create `src/screens/desktop/MomentsScreen.desktop.js`；Modify `src/screens/desktop/HomeScreen.desktop.js`（入口）。

**Interfaces（Consumes）:**
- `UnifiedDataService.findHolidayMemories({ minPhotos: 3 })` → `{ cards:[{key,name,nameEn,year,count,cover,images,ts}] }`
- `UnifiedDataService.findTrips({ minPhotos: 5, maxGapDays: 1 })` → `{ trips:[{city,cityName,startDay,endDay,days,count,cover,images}] }`
- 那年今天：内联遍历 `GlobalImageCache`（`require('../../services/GlobalImageCache').default.getCache().allImages`），匹配同月同日且 `new Date(ts).getFullYear() < 今年`，取前 30。
- 封面：`getUri(img)`（WebAdapters）。

- [ ] **Step 1: 读样板 + mobile**：读 `StatsScreen.desktop.js`（骨架）、`MomentsScreen.mobile.js`（四 section 渲染、WideCard/那年今天卡结构、:1603 useMemo 注意点）、`HomeScreen.desktop.js` 的 ImagePreview/Category 切换（点开看照片用）。
- [ ] **Step 2: 新建 MomentsScreen.desktop.js**：`({onBack})`。useEffect 加载：那年今天(内联) + `findHolidayMemories({minPhotos:3})` + `findTrips({minPhotos:5,maxGapDays:1})`。三 section 卡片（那年今天横向缩略图+年份；节日/旅行 WideCard 封面+标题+count/days）。**砍掉时刻秀 section**。点开看照片：调 HomeScreen 传入的切换（或一期内嵌 grid 展示 card.images，简化亦可）。loading/空态。硬编码色值跟样板。
- [ ] **Step 3: HomeScreen.desktop 接入**：switch 加 `case 'Moments'` 动态 import；首页加「回忆」入口按钮 setCurrentScreen('Moments')；渲染块 currentScreen==='Moments'。
- [ ] **Step 4: 校验**：`node -e "require('@babel/core').transformFileSync('src/screens/desktop/MomentsScreen.desktop.js')"` 和 HomeScreen.desktop 都无错。
- [ ] **Step 5: 提交**：`git add` 两文件 + `git commit -m "feat(pc): 回忆 desktop 页 + 入口"`

---

### Task 2: 去重 DuplicatesScreen.desktop

**Files:** Create `src/screens/desktop/DuplicatesScreen.desktop.js`；Modify `HomeScreen.desktop.js`。

**Interfaces（Consumes）:**
- `UnifiedDataService.findExactDuplicates()` → `{ groups:[{key,images,keepId,redundantIds,wastedBytes}], totalRedundant, totalWastedBytes }`（images[0] 保留，redundantIds 待删）
- `UnifiedDataService.writeDeleteImages(imageIds, onProgress)` → `{ success, filesDeleted, filesFailed, ... }`（onProgress({filesDeleted,filesFailed,total})）

- [ ] **Step 1: 读** `DuplicatesScreen.mobile.js`（renderGroup 卡结构、cleanGroup/cleanAll、deleteIds 流程）+ `CategoryScreen.desktop.js:2219`（自绘确认 dialog + 删除进度 Modal 模式）。
- [ ] **Step 2: 新建 DuplicatesScreen.desktop.js**：`({onBack})`。useEffect 调 `findExactDuplicates()`。渲染重复组卡（横向缩略图，images[0] 绿「保留」badge、redundantIds 红「删除」badge，显示 wastedBytes）。每组「清理该组」(删 group.redundantIds)、底部「一键清理全部」(删 groups.flatMap(g=>g.redundantIds))。**自绘确认 dialog**（照 CategoryScreen.desktop）+ 删除进度。删除调 `writeDeleteImages(ids, p=>setProgress(p))`，完成重新 findExactDuplicates。空态「无重复」。
- [ ] **Step 3: 实现验证删除链路**：确认 `writeDeleteImages` 在 web 下真删文件（读 UnifiedDataService.js writeDeleteImages 通用分支 ~:1846，看是否落 electron delete-file；CategoryScreen.desktop 批量删已验证可删，复用同方法应 OK，但跑桌面端实测删一组确认文件真没了）。
- [ ] **Step 4: HomeScreen.desktop 接入**（case 'Duplicates' + 入口 + 渲染块）。
- [ ] **Step 5: 校验**：babel 两文件无错。
- [ ] **Step 6: 提交**：`git commit -m "feat(pc): 去重 desktop 页 + 入口"`

---

### Task 3: 备份 BackupService.desktop + BackupRestoreScreen.desktop

**Files:** Create `src/services/BackupService.desktop.js`、`src/screens/desktop/BackupRestoreScreen.desktop.js`；Modify `HomeScreen.desktop.js`。

**Interfaces:**
- 复用 mobile `applyBackup(payload)`（`import { applyBackup } from './BackupService'` 或 `BackupService.mobile`，**不改它**）→ `{ customAdded, matched, applied, skipped }`
- mobile `exportBackup/listBackups/readBackup/deleteBackup` 的 payload 结构与校验逻辑照搬，仅换文件 IO。
- Electron：`ipcRenderer.invoke('select-folder')`→`{success,path}`；渲染进程 `window.require('fs')`（writeFileSync/readFileSync/readdirSync/statSync/unlinkSync）；`window.require('os')`。

- [ ] **Step 1: 读** `BackupService.mobile.js`（exportBackup payload 结构 :53-91、listBackups、readBackup 校验 :125-134、applyBackup :145、文件名 `imagepilot-backup-*.json`）+ `BackupRestoreScreen.mobile.js`（UI 流程）+ PC 文件迁移用的 `select-folder` IPC。
- [ ] **Step 2: 新建 BackupService.desktop.js**：
  - `import { applyBackup } from './BackupService'`（复用纯 DB 还原，不改）。
  - `exportBackup(dir)`：构造同款 payload（照 mobile 取 readAllImages + 过滤已分类 + customCategories），`window.require('fs').writeFileSync(`${dir}/imagepilot-backup-${stamp}.json`, JSON.stringify(payload), 'utf8')`，返回 {path,fileName,total}。
  - `listBackups(dir)`：`fs.readdirSync(dir)` 过滤 `imagepilot-backup-*.json` + `statSync` → `[{name,path,size,mtime}]`。
  - `readBackup(path)`：`JSON.parse(fs.readFileSync(path,'utf8'))` + 校验 `app==='ImagePilot'`（照 mobile）。
  - `deleteBackup(path)`：`fs.unlinkSync(path)` → `{ok:true}`。
  - `restoreBackup(path)`：`applyBackup(readBackup(path))`。
- [ ] **Step 3: 新建 BackupRestoreScreen.desktop.js**：`({onBack})`，照样板。「导出备份」按钮 → `select-folder` 选目录 → `exportBackup(dir)` → 提示成功。备份列表（记住目录到 settings 或让用户选目录后 listBackups(dir)）。每项「还原」(restoreBackup→提示统计)、「删除」(deleteBackup→刷新)。**砍掉分享**。自绘确认/提示 dialog。
- [ ] **Step 4: HomeScreen.desktop 接入**（case 'Backup' + 入口 + 渲染块）。
- [ ] **Step 5: 校验**：babel 三文件（BackupService.desktop / BackupRestoreScreen.desktop / HomeScreen.desktop）无错。
- [ ] **Step 6: 提交**：`git commit -m "feat(pc): 备份 desktop（文件IO适配electron）+ 入口"`

---

## Self-Review

**Spec 覆盖**：去重(Task2 findExactDuplicates+writeDeleteImages)✓ 回忆(Task1 findHolidayMemories/findTrips/那年今天)✓ 备份(Task3 复用applyBackup+替换文件IO)✓ 样板复用(全)✓ HomeScreen接入(全)✓ 自绘dialog(Task2/3)✓ 砍时刻秀/分享(Global)✓ 删除链路风险验证(Task2 Step3)✓。

**类型一致**：findExactDuplicates 返回 `{groups,totalRedundant,totalWastedBytes}`、group `{images,redundantIds,wastedBytes}`、writeDeleteImages(ids,onProgress)、findHolidayMemories→`{cards}`、findTrips→`{trips}`、applyBackup(payload)→`{customAdded,matched,applied,skipped}` —— 各 task 一致（均来自 Explore 实测签名）。

**Placeholder**：Step 1 的"读"是实现前必须的样板/接口核对（desktop 模式照现有的来），非占位；其余步骤均具体。

**注意**：Task 1/2/3 都改 HomeScreen.desktop 同文件的 switch/入口/渲染块 + useMemo 依赖——若并行 subagent 会冲突，**按顺序执行**（Task1→2→3），每个 task 完成提交后再下一个。
