# PC 端分类文件物理迁移 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐 task 实现。步骤用 `- [ ]` 复选框跟踪。

**Goal:** PC 端把选中分类的已分类照片，按分类物理移动/复制到「目标根目录/分类名/」并同步 DB 路径。

**Architecture:** 纯函数（路径清洗/同名解决）+ Electron main 新增 `migrate-files` IPC（fs 移动/复制）+ DB 新增 `batchUpdateImagePath` 同步 uri + desktop 分类页迁移对话框编排。

**Tech Stack:** Electron（main `pc-version-final/public/electron.js`）、React Native Modal（desktop UI）、SQLite/IndexedDB（DB）、Node fs。

## Global Constraints（每个 task 隐含遵守）

- **仅桌面端**：所有新代码走 `Platform.OS === 'web'` 分支；移动端不受影响。
- **electron.js 两份同步**：改 `pc-version-final/public/electron.js`（活跃构建入口）**和** `public/electron.js`（根副本），内容一致。
- **移动/复制都把 DB uri 更新到新位置**（用户决策）。
- **DB 一致性**：单张「文件操作成功 → 才更新该张 DB」；失败只跳过该张。
- **用记录已有 `id` 更新**（绝不用 `generateStableId(uri)`，否则 id 漂移破坏关联）。
- **同名冲突**：加序号 `name(1).ext`，绝不覆盖。
- **NA 跳过**：只迁移已分类（appCategory 非空且非 NA/tobecleaned）。
- **uri 变更后**：调 `GlobalImageCache.refreshCache()`。
- 分类 id→目录名：`configService.getCategoryDisplayName(id, lang)`（内置+自定义都对）。

---

### Task 1: 纯函数 — 目录名清洗 + 同名冲突解决

**Files:**
- Create: `src/services/desktop/fileMigration.js`
- Test: `scripts/test/fileMigration.test.js`

**Interfaces:**
- Produces:
  - `sanitizeDirName(name: string): string` — 清洗成合法目录名
  - `resolveNameConflict(targetPath: string, exists: (p:string)=>boolean): string` — 返回不冲突的最终路径

- [ ] **Step 1: 写失败测试**

`scripts/test/fileMigration.test.js`:
```js
const babel = require('@babel/core'), Module = require('module'), path = require('path');
function load(p){const abs=path.resolve(__dirname,p);const{code}=babel.transformFileSync(abs,{presets:['module:metro-react-native-babel-preset']});const m=new Module(abs);m.filename=abs;m.paths=Module._nodeModulePaths(path.dirname(abs));m._compile(code,abs);return m.exports;}
const { sanitizeDirName, resolveNameConflict } = load('../../src/services/desktop/fileMigration.js');
let f=0; const ok=(c,m)=>{if(!c){console.error('FAIL',m);f++;}};

// 清洗非法字符
ok(sanitizeDirName('美食') === '美食', '中文保留');
ok(sanitizeDirName('a/b:c*?"<>|d') === 'a_b_c_____d', '非法字符→_');
ok(sanitizeDirName('  .trim. ') === 'trim', '首尾空格和点去掉');
ok(sanitizeDirName('') === '_', '空名兜底为_');

// 同名冲突：不存在→原样；存在→加序号
ok(resolveNameConflict('/d/a.jpg', () => false) === '/d/a.jpg', '不冲突原样');
let calls = ['/d/a.jpg', '/d/a(1).jpg']; // 这两个存在，a(2) 不存在
ok(resolveNameConflict('/d/a.jpg', (p) => calls.includes(p)) === '/d/a(2).jpg', '冲突加序号到不冲突');
ok(resolveNameConflict('/d/noext', (p)=>p==='/d/noext') === '/d/noext(1)', '无扩展名也能加序号');

console.log(f===0?'PASS':f+' FAIL'); process.exit(f?1:0);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/test/fileMigration.test.js`
Expected: 报错（fileMigration.js 不存在 / 函数未定义）

- [ ] **Step 3: 实现纯函数**

`src/services/desktop/fileMigration.js`:
```js
/**
 * fileMigration —— PC 端分类文件物理迁移（纯逻辑 + IPC 编排）。
 * 仅桌面端（Platform.OS==='web'）用。纯函数部分可 Node 单测。
 */

/** 清洗成合法目录名：替换文件名非法字符为 _，去首尾空格/点，空则兜底 '_'。 */
export function sanitizeDirName(name) {
  let s = String(name || '').replace(/[/\\:*?"<>|]/g, '_');
  s = s.replace(/^[\s.]+|[\s.]+$/g, ''); // 首尾空格和点（Windows 目录名不能以点/空格结尾）
  return s || '_';
}

/** 拆 path 为 { dir, base, ext }（用正斜杠，跨平台一致）。 */
function splitPath(p) {
  const s = String(p);
  const slash = s.lastIndexOf('/');
  const dir = slash >= 0 ? s.slice(0, slash) : '';
  const name = slash >= 0 ? s.slice(slash + 1) : s;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  return { dir, base, ext };
}

/** 目标已存在 → 加序号 name(1).ext、name(2).ext… 直到不冲突。exists 注入便于测试。 */
export function resolveNameConflict(targetPath, exists) {
  if (!exists(targetPath)) return targetPath;
  const { dir, base, ext } = splitPath(targetPath);
  for (let i = 1; i < 100000; i++) {
    const candidate = `${dir ? dir + '/' : ''}${base}(${i})${ext}`;
    if (!exists(candidate)) return candidate;
  }
  return targetPath; // 理论不可达
}

export default { sanitizeDirName, resolveNameConflict };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node scripts/test/fileMigration.test.js`
Expected: `PASS`

- [ ] **Step 5: 提交**

```bash
git add src/services/desktop/fileMigration.js scripts/test/fileMigration.test.js
git commit -m "feat(pc-migration): 目录名清洗 + 同名冲突解决纯函数"
```

---

### Task 2: Electron main — `migrate-files` IPC

**Files:**
- Modify: `pc-version-final/public/electron.js`（在 `delete-file` handler 附近，约 `:456` 之后）
- Modify: `public/electron.js`（根副本，同样改动）

**Interfaces:**
- Produces: IPC `migrate-files`。renderer `ipcRenderer.send('migrate-files', { items, mode })`，items=`[{ id, oldPath, targetDir, fileName }]`，mode=`'move'|'copy'`。main 回 `event.reply('migrate-files-result', { results })`，results=`[{ id, ok, newPath?, error? }]`；过程回 `event.reply('migrate-files-progress', { done, total })`。

- [ ] **Step 1: 在 `pc-version-final/public/electron.js` 加 handler**

在 `ipcMain.on('delete-file', ...)` handler 之后插入：
```js
// 分类文件物理迁移：逐项移动/复制到 targetDir，解决同名冲突，回结果+进度。
// 跨盘 move：fs.renameSync 抛 EXDEV → fallback copyFileSync + unlinkSync。
ipcMain.on('migrate-files', (event, payload) => {
  const fsm = require('fs');
  const pathm = require('path');
  const { items = [], mode = 'copy' } = payload || {};
  const results = [];
  const total = items.length;
  let done = 0;

  const resolveConflict = (target) => {
    if (!fsm.existsSync(target)) return target;
    const ext = pathm.extname(target);
    const base = target.slice(0, target.length - ext.length);
    for (let i = 1; i < 100000; i++) {
      const c = `${base}(${i})${ext}`;
      if (!fsm.existsSync(c)) return c;
    }
    return target;
  };

  for (const it of items) {
    try {
      if (!fsm.existsSync(it.oldPath)) { results.push({ id: it.id, ok: false, error: '源文件不存在' }); done++; continue; }
      fsm.mkdirSync(it.targetDir, { recursive: true });
      const dest = resolveConflict(pathm.join(it.targetDir, it.fileName).replace(/\\/g, '/'));
      if (mode === 'move') {
        try { fsm.renameSync(it.oldPath, dest); }
        catch (e) {
          if (e && e.code === 'EXDEV') { fsm.copyFileSync(it.oldPath, dest); fsm.unlinkSync(it.oldPath); }
          else throw e;
        }
      } else {
        fsm.copyFileSync(it.oldPath, dest);
      }
      results.push({ id: it.id, ok: true, newPath: dest });
    } catch (error) {
      results.push({ id: it.id, ok: false, error: error.message });
    }
    done++;
    event.reply('migrate-files-progress', { done, total });
  }
  event.reply('migrate-files-result', { results });
});
```

- [ ] **Step 2: 同样改动复制到根 `public/electron.js`**

把同一段插入根 `public/electron.js` 的 `delete-file` handler 之后（两份保持一致）。

- [ ] **Step 3: 语法校验**

Run: `node -e "require('./pc-version-final/public/electron.js')" 2>&1 | head -3`
Expected: 不报语法错（可能因 electron 环境报运行时错，但不能有 SyntaxError；只看有无 `SyntaxError`）。
备用纯语法检查：`node --check pc-version-final/public/electron.js && node --check public/electron.js && echo OK`
Expected: `OK`

- [ ] **Step 4: 提交**

```bash
git add pc-version-final/public/electron.js public/electron.js
git commit -m "feat(pc-migration): migrate-files IPC（move/copy+同名+跨盘fallback+进度）"
```

---

### Task 3: DB — `batchUpdateImagePath` 同步 uri

**Files:**
- Modify: `src/services/ImageStorageService.js`（照抄 `batchUpdateCity` 模板，约 `:2182`/`:2245`/`:2206`）
- Modify: `src/services/UnifiedDataService.js`（包装，照抄 `updateImagesCity` 约 `:2942`）

**Interfaces:**
- Consumes: 现有 `batchUpdateCity` / `_batchUpdateCitySQLite` / `_batchUpdateCityIndexedDB` 模式。
- Produces:
  - `ImageStorageService.batchUpdateImagePath(pathDataArray)` — pathDataArray=`[{ id, uri }]`（id 必传），更新 `uri` 字段。
  - `UnifiedDataService.updateImagesPath(pathDataArray, updateCache=false)`

- [ ] **Step 1: ImageStorageService 加入口 + 两端实现**

在 `batchUpdateCity`（`:2182`）附近加：
```js
/** 批量更新照片 uri（迁移后同步物理路径）。pathDataArray=[{id, uri}]，必须传 id。 */
async batchUpdateImagePath(pathDataArray) {
  if (Platform.OS === 'web') return this._batchUpdateImagePathIndexedDB(pathDataArray);
  return this._batchUpdateImagePathSQLite(pathDataArray);
}
```

IndexedDB（PC 端，照抄 `_batchUpdateCityIndexedDB` 结构 `:2206`，把改 city 换成改 uri）：
```js
async _batchUpdateImagePathIndexedDB(pathDataArray) {
  const db = await this.storage._getDB();
  let updated = 0, failed = 0;
  await new Promise((resolve) => {
    const tx = db.transaction(['images'], 'readwrite');
    const store = tx.objectStore('images');
    for (const d of pathDataArray) {
      if (!d.id) { failed++; continue; }
      const getReq = store.get(d.id);
      getReq.onsuccess = () => {
        const img = getReq.result;
        if (img) { img.uri = d.uri; img.updatedAt = Date.now(); store.put(img); updated++; }
        else failed++;
      };
      getReq.onerror = () => { failed++; };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  logger.info(`📁 批量更新 uri: 成功 ${updated} 失败 ${failed}`);
  return { updated, failed };
}
```

SQLite（移动端不用，但为对称补上，照抄 `_batchUpdateCitySQLite` `:2272`）：
```js
async _batchUpdateImagePathSQLite(pathDataArray) {
  const updatedAt = Date.now();
  let updated = 0, failed = 0;
  await new Promise((resolve) => {
    this.storage.db.transaction((tx) => {
      for (const d of pathDataArray) {
        if (!d.id) { failed++; continue; }
        tx.executeSql(
          `UPDATE images SET uri = ?, updatedAt = ? WHERE id = ?`,
          [d.uri, updatedAt, d.id],
          (_t, r) => { if (r.rowsAffected > 0) updated++; else failed++; },
          () => { failed++; }
        );
      }
    }, () => resolve(), () => resolve());
  });
  return { updated, failed };
}
```

- [ ] **Step 2: UnifiedDataService 加包装**

在 `updateImagesCity`（`:2942`）附近加：
```js
/** 批量更新照片 uri（迁移后同步路径）。pathDataArray=[{id, uri}]。 */
async updateImagesPath(pathDataArray, updateCache = false) {
  const result = await this.imageStorageService.batchUpdateImagePath(pathDataArray);
  if (updateCache) {
    try { await this.imageCache.refreshCache(); } catch (_) {}
  }
  return result;
}
```

- [ ] **Step 3: babel 校验两文件**

Run: `for f in src/services/ImageStorageService.js src/services/UnifiedDataService.js; do node -e "require('@babel/core').transformFileSync('$f')" >/dev/null 2>&1 && echo "OK $f" || echo "FAIL $f"; done`
Expected: 两个都 `OK`

- [ ] **Step 4: 提交**

```bash
git add src/services/ImageStorageService.js src/services/UnifiedDataService.js
git commit -m "feat(pc-migration): batchUpdateImagePath 同步照片 uri（DB+包装）"
```

---

### Task 4: 迁移编排 — `migrateCategories`

**Files:**
- Modify: `src/services/desktop/fileMigration.js`（加编排函数）
- Test: `scripts/test/fileMigration.test.js`（加目标路径计算测试）

**Interfaces:**
- Consumes: `sanitizeDirName`（Task 1）；`ipcRenderer`（window.require）；`UnifiedDataService.updateImagesPath`（Task 3）；`getLocalPath`（WebAdapters）；`configService.getCategoryDisplayName`。
- Produces:
  - `buildMigrationItems(images, rootDir, getName, getPath): { items, skipped }` — 纯函数，算每张目标。images=`[{id, uri, appCategory}]`，getName=`(catId)=>name`，getPath=`(image)=>localPath`。item=`{ id, oldPath, targetDir, fileName }`。NA/无路径跳过。
  - `async migrateCategories({ images, rootDir, mode, onProgress }): { ok, fail, skipped }` — 完整编排（IPC + DB 更新 + 刷新缓存）。

- [ ] **Step 1: 加 buildMigrationItems 的失败测试**

追加到 `scripts/test/fileMigration.test.js`（在 console.log 之前）:
```js
const { buildMigrationItems } = load('../../src/services/desktop/fileMigration.js');
const imgs = [
  { id: '1', uri: 'file:///D:/p/a.jpg', appCategory: 'foods' },
  { id: '2', uri: 'file:///D:/p/b.jpg', appCategory: 'NA' },      // 跳过
  { id: '3', uri: 'file:///D:/p/c.jpg', appCategory: '' },         // 跳过
  { id: '4', uri: 'file:///D:/p/d.jpg', appCategory: 'a/b' },      // 非法名清洗
];
const getName = (c) => ({ foods: '美食', 'a/b': 'a/b' }[c] || c);
const getPath = (im) => im.uri.replace('file:///', '');
const { items, skipped } = buildMigrationItems(imgs, 'D:/out', getName, getPath);
ok(items.length === 2, `已分类2张（得 ${items.length}）`);
ok(skipped === 2, 'NA+空 跳过2张');
ok(items[0].targetDir === 'D:/out/美食' && items[0].fileName === 'a.jpg', '美食目标正确');
ok(items[1].targetDir === 'D:/out/a_b', '非法分类名清洗为 a_b');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/test/fileMigration.test.js`
Expected: FAIL（buildMigrationItems 未定义）

- [ ] **Step 3: 实现 buildMigrationItems + migrateCategories**

追加到 `src/services/desktop/fileMigration.js`（export default 之前）:
```js
/** 算每张照片的迁移目标（纯函数）。NA/空分类/无本地路径 → 跳过。 */
export function buildMigrationItems(images, rootDir, getName, getPath) {
  const items = [];
  let skipped = 0;
  const SKIP = new Set(['', 'NA', 'NA_video', 'tobecleaned', null, undefined]);
  for (const im of images) {
    const cat = im.appCategory;
    const oldPath = getPath(im);
    if (SKIP.has(cat) || !oldPath) { skipped++; continue; }
    const dirName = sanitizeDirName(getName(cat) || cat);
    const fileName = String(oldPath).split('/').pop();
    items.push({ id: im.id, oldPath, targetDir: `${rootDir}/${dirName}`, fileName });
  }
  return { items, skipped };
}

/**
 * 完整迁移编排：算目标 → IPC 移动/复制 → 对成功项更新 DB uri → 刷新缓存。
 * @param {{images, rootDir, mode:'move'|'copy', onProgress?:(done,total)=>void}} opts
 * @returns {Promise<{ok:number, fail:number, skipped:number}>}
 */
export async function migrateCategories({ images, rootDir, mode, onProgress }) {
  // eslint-disable-next-line global-require
  const { getLocalPath } = require('../../adapters/WebAdapters');
  // eslint-disable-next-line global-require
  const UnifiedDataService = require('../UnifiedDataService').default;
  const configService = UnifiedDataService.configService;
  // eslint-disable-next-line global-require
  const i18n = require('../../i18n').default;
  const lang = (i18n && i18n.language) ? i18n.language : 'zh';
  const getName = (c) => configService.getCategoryDisplayName(c, lang);

  const { items, skipped } = buildMigrationItems(images, rootDir, getName, getLocalPath);
  if (items.length === 0) return { ok: 0, fail: 0, skipped };

  const { ipcRenderer } = window.require('electron');
  const results = await new Promise((resolve) => {
    const onProg = (_e, { done, total }) => { if (onProgress) onProgress(done, total); };
    ipcRenderer.on('migrate-files-progress', onProg);
    ipcRenderer.once('migrate-files-result', (_e, payload) => {
      ipcRenderer.removeListener('migrate-files-progress', onProg);
      resolve((payload && payload.results) || []);
    });
    ipcRenderer.send('migrate-files', { items, mode });
  });

  // 成功项 → 更新 DB uri（file:// 前缀，与 PC 端 uri 格式一致）
  const pathUpdates = results.filter((r) => r.ok && r.newPath)
    .map((r) => ({ id: r.id, uri: 'file:///' + String(r.newPath).replace(/^\/+/, '') }));
  if (pathUpdates.length > 0) {
    await UnifiedDataService.updateImagesPath(pathUpdates, true); // true=刷新缓存
  }
  const ok = results.filter((r) => r.ok).length;
  return { ok, fail: results.length - ok, skipped };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node scripts/test/fileMigration.test.js`
Expected: `PASS`（buildMigrationItems 纯函数过；migrateCategories 含 window/IPC 不在 node 测，靠桌面端验证）

- [ ] **Step 5: babel 校验**

Run: `node -e "require('@babel/core').transformFileSync('src/services/desktop/fileMigration.js')" >/dev/null 2>&1 && echo OK`
Expected: `OK`

- [ ] **Step 6: 提交**

```bash
git add src/services/desktop/fileMigration.js scripts/test/fileMigration.test.js
git commit -m "feat(pc-migration): migrateCategories 编排（算目标+IPC+DB同步+刷新）"
```

---

### Task 5: desktop UI — 入口菜单 + 迁移对话框

**Files:**
- Modify: `src/screens/desktop/CategoryScreen.desktop.js`（菜单项 `:1607` 后、Modal `:2174` 附近、handler、state）
- Modify: `src/i18n/locales/zh/common.json` + `src/i18n/locales/en/common.json`

**Interfaces:**
- Consumes: `migrateCategories`（Task 4）；`getCurrentSelectedImages()`（`:855`）；`select-folder` IPC；i18n。

- [ ] **Step 1: 加 state（在 `showDeleteProgress` state `:426` 附近）**

```js
const [showMigrateDialog, setShowMigrateDialog] = useState(false);
const [migrateMode, setMigrateMode] = useState('copy'); // 'copy' | 'move'
const [migrateProgress, setMigrateProgress] = useState(null); // {done,total} | null
```

- [ ] **Step 2: 加 handler（在 handleCopyToClipboard 附近）**

```js
// 整理到文件夹：选目标根目录 → 移动/复制选中分类照片 → DB 同步 + 刷新。
const handleMigrateToFolder = async (mode) => {
  try {
    const { ipcRenderer } = window.require('electron');
    const picked = await ipcRenderer.invoke('select-folder');
    if (!picked || !picked.success || !picked.path) return; // 用户取消
    const selected = await getCurrentSelectedImages();
    if (!selected || selected.length === 0) {
      Alert.alert(tHeader('common.tip', { defaultValue: '提示' }), tHeader('category.migrateNoSelection', { defaultValue: '请先选择要整理的照片' }));
      return;
    }
    setShowMigrateDialog(false);
    setMigrateProgress({ done: 0, total: selected.length });
    // eslint-disable-next-line global-require
    const { migrateCategories } = require('../../services/desktop/fileMigration');
    const res = await migrateCategories({
      images: selected,
      rootDir: picked.path.replace(/\\/g, '/'),
      mode,
      onProgress: (done, total) => setMigrateProgress({ done, total }),
    });
    setMigrateProgress(null);
    Alert.alert(
      tHeader('category.migrateDone', { defaultValue: '整理完成' }),
      tHeader('category.migrateSummary', { defaultValue: '成功 {{ok}} 张，失败 {{fail}} 张，跳过 {{skipped}} 张', ok: res.ok, fail: res.fail, skipped: res.skipped }),
    );
    await loadImages(); // 刷新当前页（uri 已变）
  } catch (e) {
    setMigrateProgress(null);
    Alert.alert(tHeader('common.tip', { defaultValue: '提示' }), e?.message || String(e));
  }
};
```
> 注：`Alert` desktop 端来自 WebAdapters（确认 CategoryScreen 已 import Alert；若无则从 `'../../adapters/WebAdapters'` 补 import）。`tHeader` 是 HeaderComponent 内的 t；handler 在组件主体则用主体的 `t`。实现时按所在作用域用对应的翻译函数。

- [ ] **Step 3: 加菜单入口（`actionMenuDropdown` 内、「复制到文件管理器」`:1607` 之后）**

```jsx
{/* 整理到文件夹：物理迁移到分类目录 */}
<TouchableOpacity
  style={styles.actionMenuItem}
  onPress={() => { setShowActionMenu(false); setShowMigrateDialog(true); }}>
  <Text style={styles.actionMenuItemText}>{tHeader('category.migrateToFolder', { defaultValue: '整理到文件夹' })}</Text>
</TouchableOpacity>
```

- [ ] **Step 4: 加迁移选择对话框 + 进度 Modal（`:2174` 删除进度 Modal 附近）**

```jsx
{/* 整理到文件夹：选移动/复制 */}
<Modal visible={showMigrateDialog} transparent animationType="fade" onRequestClose={() => setShowMigrateDialog(false)}>
  <View style={styles.modalOverlay}>
    <View style={styles.modalContent}>
      <Text style={styles.modalTitle}>{t('category.migrateToFolder', { defaultValue: '整理到文件夹' })}</Text>
      <Text style={styles.modalMessage}>{t('category.migrateModeHint', { defaultValue: '把选中的已分类照片按分类整理到一个目标文件夹。未分类的会跳过。' })}</Text>
      <TouchableOpacity style={styles.actionMenuItem} onPress={() => handleMigrateToFolder('copy')}>
        <Text style={styles.actionMenuItemText}>{t('category.migrateCopy', { defaultValue: '复制（保留原文件，安全）' })}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.actionMenuItem} onPress={() => {
        Alert.alert(
          t('category.migrateMoveConfirmTitle', { defaultValue: '确认移动？' }),
          t('category.migrateMoveConfirmMsg', { defaultValue: '移动会把原文件移走，原位置不再保留。建议先用复制。' }),
          [
            { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
            { text: t('category.migrateMove', { defaultValue: '移动' }), style: 'destructive', onPress: () => handleMigrateToFolder('move') },
          ],
        );
      }}>
        <Text style={[styles.actionMenuItemText, { color: '#FF3B30' }]}>{t('category.migrateMove', { defaultValue: '移动（原文件移走）' })}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.actionMenuItem} onPress={() => setShowMigrateDialog(false)}>
        <Text style={styles.actionMenuItemText}>{t('common.cancel', { defaultValue: '取消' })}</Text>
      </TouchableOpacity>
    </View>
  </View>
</Modal>

{/* 迁移进度 */}
<Modal visible={!!migrateProgress} transparent animationType="fade">
  <View style={styles.modalOverlay}>
    <View style={styles.modalContent}>
      <Text style={styles.modalTitle}>{t('category.migrating', { defaultValue: '整理中...' })}</Text>
      <Text style={styles.modalMessage}>{migrateProgress ? `${migrateProgress.done}/${migrateProgress.total}` : ''}</Text>
      <ActivityIndicator size="small" color="#2196F3" style={styles.modalIndicator} />
    </View>
  </View>
</Modal>
```
> 注：主体作用域用 `t`（不是 tHeader）。`Alert` 同 Step 2 注。

- [ ] **Step 5: i18n（zh + en，加到 category 段）**

zh：`migrateToFolder`「整理到文件夹」、`migrateModeHint`、`migrateCopy`「复制（保留原文件，安全）」、`migrateMove`「移动（原文件移走）」、`migrateMoveConfirmTitle`「确认移动？」、`migrateMoveConfirmMsg`、`migrating`「整理中...」、`migrateDone`「整理完成」、`migrateSummary`「成功 {{ok}} 张，失败 {{fail}} 张，跳过 {{skipped}} 张」、`migrateNoSelection`「请先选择要整理的照片」。
en：对应英文。

- [ ] **Step 6: 校验**

Run: `node -e "require('@babel/core').transformFileSync('src/screens/desktop/CategoryScreen.desktop.js')" >/dev/null 2>&1 && echo OK; node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/zh/common.json'))" && node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/en/common.json'))" && echo JSON_OK`
Expected: `OK` 和 `JSON_OK`

- [ ] **Step 7: 桌面端手动验证（必做，IPC/DB/UI 无法纯单测）**

构建/运行 PC 端（`cd pc-version-final && yarn build && yarn electron` 或既有桌面启动方式），验证清单：
1. 选中某分类几张照片 → 操作菜单「整理到文件夹」→ 选「复制」→ 选目标目录 → 文件出现在 `<目标>/<分类名>/`，原文件还在，缩略图/预览正常（DB uri 已更新）。
2. 「移动」模式 → 弹二次确认 → 确认后原文件消失、新位置存在、预览正常。
3. 自定义分类名含非法字符（如 `a/b`）→ 目录名清洗为 `a_b`。
4. 目标已有同名 → 新文件加序号 `(1)`，不覆盖。
5. 选中含未分类(NA)照片 → NA 跳过，汇总 skipped 计数正确。
6. 跨盘移动（源 C 盘、目标 D 盘）→ 成功（copy+unlink fallback）。

- [ ] **Step 8: 提交**

```bash
git add src/screens/desktop/CategoryScreen.desktop.js src/i18n/locales/zh/common.json src/i18n/locales/en/common.json
git commit -m "feat(pc-migration): desktop 迁移对话框 + 入口 + i18n"
```

---

## Self-Review

**Spec 覆盖**：选根目录(Task5 select-folder)✓ 建分类子目录(Task4 buildMigrationItems)✓ 移动/复制可选(Task2 mode + Task5 对话框)✓ DB 都更新新位置(Task3+Task4)✓ 可选分类(Task5 用选中照片)✓ NA 跳过(Task4 SKIP)✓ 同名加序号(Task1+Task2)✓ 跨盘 fallback(Task2)✓ 用已有 id(Task3 d.id)✓ 刷新缓存(Task4 updateImagesPath(...,true))✓ 二次确认(Task5)✓ 进度可取消（进度有；取消按钮一期未做——见下）。

**已知缩减（对齐 YAGNI / spec 一期范围）**：进度对话框一期**只显示进度、不做中途取消按钮**（spec 写「可取消」，但 IPC 已 send 的批次中途取消需 main 端协作，复杂度高）。如需取消，作为 Task 5 后续增量。**实现者注意**：这是有意缩减，不是遗漏。

**类型一致**：item `{id, oldPath, targetDir, fileName}` 在 Task2/Task4 一致；result `{id, ok, newPath, error}` 一致；pathDataArray `{id, uri}` 在 Task3/Task4 一致。✓
