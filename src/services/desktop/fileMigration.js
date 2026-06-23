/**
 * fileMigration —— PC 端分类文件物理迁移（纯逻辑 + IPC 编排）。
 * 仅桌面端（Platform.OS==='web'）用。纯函数部分（sanitizeDirName / resolveNameConflict /
 * buildMigrationItems）可 Node 单测；migrateCategories 含 window/IPC，靠桌面端验证。
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

export default { sanitizeDirName, resolveNameConflict, buildMigrationItems, migrateCategories };
