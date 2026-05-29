/**
 * BackupService — 分类索引备份/还原
 *
 * 目的：让用户把"已分类的图归到哪个分类"这层成果（含自定义分类定义）导出到一个 JSON
 * 文件，换手机 / 重装后或想跨设备同步时一键导入回来，不必再走云端 LLM 重新跑一遍。
 *
 * 不备份：图片本体（用户的相册系统已经在管）、相似组（可回扫重建）、暂存箱。
 * 只备份：每张图的 category / confidence / message / background_color，以及
 *        settings.aiProvider.customCategories。
 *
 * 匹配键 matchKey = `${fileName}|${size}|${takenAt || ''}`
 *   - 同手机重装：完全一致，命中率 ~100%
 *   - 跨手机：用户复制相册过去后，三元组仍稳定（DCIM 文件未改），命中率高
 *   - 仅当用户改名/转码/重新压缩，才会失配——这种本来就是新图
 *
 * 文件位置：`<RNFS.DownloadDirectoryPath>/imagepilot-backup-<yyyymmddhhmm>.json`
 *           （公开 Downloads 目录，文件管理器 / 电脑 USB 都能看到）
 */

import RNFS from 'react-native-fs';
import { Platform } from 'react-native';
import UnifiedDataService from './UnifiedDataService';
import configService from './llm/adapters/UnifiedDataConfigService';

// iOS 没有公共 Downloads 概念；用 DocumentDirectoryPath（在「文件」App 里可见，
// 也可 iTunes 文件共享/AirDrop 出去）。Android 仍走 DownloadDirectoryPath，便于
// 系统文件管理器 / 电脑 USB 直接看到。
const BACKUP_DIR = Platform.OS === 'ios' ? RNFS.DocumentDirectoryPath : RNFS.DownloadDirectoryPath;
const FILE_PREFIX = 'imagepilot-backup-';
const FILE_SUFFIX = '.json';
const SCHEMA_VERSION = 1;

/** matchKey：fileName + size + takenAt（缺值用空串占位，保证可读但仍唯一） */
function buildKey(img) {
  if (!img) return '';
  const fn = img.fileName || '';
  const sz = (img.size != null) ? String(img.size) : '';
  const ta = (img.takenAt != null) ? String(img.takenAt) : '';
  return `${fn}|${sz}|${ta}`;
}

/** 形如 202605291234 的稳定时间戳，做文件名用（避免冒号/斜杠等不合法字符） */
function tsForFile() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * 导出当前分类索引到 Downloads 目录。
 * @returns {Promise<{ path: string, fileName: string, total: number, withCategory: number }>}
 */
export async function exportBackup() {
  const all = await UnifiedDataService.readAllImages();
  const list = Array.isArray(all) ? all : [];

  // 只导出真正归过类的图（含 NA 是浪费空间——NA 是缺省态）
  const items = list
    .filter((img) => img && img.category && img.category !== 'NA')
    .map((img) => ({
      key: buildKey(img),
      fileName: img.fileName || '',
      size: img.size || 0,
      takenAt: img.takenAt || 0,
      category: img.category,
      confidence: img.confidence == null ? null : img.confidence,
      message: img.message || '',
      background_color: img.background_color || '',
    }));

  // 自定义分类定义也带上 —— 还原端能直接拿到 id/name/rule/iconKey
  let customCategories = [];
  try {
    const cfg = await configService.getAIProviderConfig();
    customCategories = Array.isArray(cfg.customCategories) ? cfg.customCategories : [];
  } catch (_) { /* 拿不到就空数组，不影响图分类还原 */ }

  const payload = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    app: 'ImagePilot',
    matchKey: 'fileName|size|takenAt',
    customCategories,
    items,
  };

  // RNFS 在 Android 上 mkdir 对公共 Downloads 也是幂等的
  try { await RNFS.mkdir(BACKUP_DIR); } catch (_) {}
  const fileName = `${FILE_PREFIX}${tsForFile()}${FILE_SUFFIX}`;
  const path = `${BACKUP_DIR}/${fileName}`;
  await RNFS.writeFile(path, JSON.stringify(payload), 'utf8');

  return { path, fileName, total: list.length, withCategory: items.length };
}

/**
 * 列出 Downloads 目录里现有的 imagepilot 备份文件，按修改时间倒序。
 */
export async function listBackups() {
  try {
    const entries = await RNFS.readDir(BACKUP_DIR);
    return entries
      .filter((e) => e.isFile() && e.name.startsWith(FILE_PREFIX) && e.name.endsWith(FILE_SUFFIX))
      .map((e) => ({
        name: e.name,
        path: e.path,
        size: e.size,
        mtime: e.mtime ? new Date(e.mtime).toISOString() : '',
      }))
      .sort((a, b) => (b.mtime || '').localeCompare(a.mtime || ''));
  } catch (_) {
    return [];
  }
}

/**
 * 读 + 校验备份文件，返回 payload 对象；不合法时抛错。
 */
export async function readBackup(path) {
  const text = await RNFS.readFile(path, 'utf8');
  let payload;
  try { payload = JSON.parse(text); } catch (e) {
    throw new Error('备份文件不是合法 JSON');
  }
  if (!payload || payload.app !== 'ImagePilot') {
    throw new Error('不是 ImagePilot 备份文件');
  }
  if (!Number.isFinite(payload.schemaVersion) || payload.schemaVersion > SCHEMA_VERSION) {
    throw new Error(`备份文件版本(${payload.schemaVersion})过新，请升级 app 后重试`);
  }
  if (!Array.isArray(payload.items)) {
    throw new Error('备份文件格式异常：items 不是数组');
  }
  return payload;
}

/**
 * 把备份应用到当前库。
 *  1) 合并 customCategories（按 id 去重，本地已有的不动）
 *  2) 在本地 allImages 里按 matchKey 找命中的图，按 category 分组批量 updateImagesCategory
 *
 * @param {object} payload readBackup 返回的对象
 * @returns {Promise<{ customAdded:number, matched:number, applied:number, skipped:number }>}
 */
export async function applyBackup(payload) {
  let customAdded = 0;
  if (Array.isArray(payload.customCategories) && payload.customCategories.length > 0) {
    try {
      const cfg = await configService.getAIProviderConfig();
      const existing = Array.isArray(cfg.customCategories) ? cfg.customCategories : [];
      const existingIds = new Set(existing.map((c) => c && c.id).filter(Boolean));
      const merged = [...existing];
      for (const c of payload.customCategories) {
        if (c && c.id && !existingIds.has(c.id)) {
          merged.push(c);
          customAdded++;
        }
      }
      if (customAdded > 0) {
        await configService.setCustomCategories(merged);
      }
    } catch (_) { /* 合并失败不阻断主流程 */ }
  }

  // 本地库 → key 索引（同 key 多张图都视作命中）
  const all = await UnifiedDataService.readAllImages();
  const list = Array.isArray(all) ? all : [];
  const keyToIds = new Map();
  for (const img of list) {
    if (!img || !img.id) continue;
    const k = buildKey(img);
    if (!k) continue;
    if (!keyToIds.has(k)) keyToIds.set(k, []);
    keyToIds.get(k).push(img.id);
  }

  // 按 category 分组要写的 id 列表
  let matched = 0;
  let skipped = 0;
  const byCategory = new Map();
  for (const it of payload.items) {
    const ids = keyToIds.get(it.key);
    if (!ids || ids.length === 0) { skipped++; continue; }
    matched++;
    if (!byCategory.has(it.category)) byCategory.set(it.category, []);
    byCategory.get(it.category).push(...ids);
  }

  let applied = 0;
  for (const [cat, ids] of byCategory.entries()) {
    if (!cat || ids.length === 0) continue;
    try {
      // 'manual' 表示用户/还原操作，后续 AI 重扫不会覆盖（与"改分类"一致）
      await UnifiedDataService.updateImagesCategory(ids, cat, 'manual');
      applied += ids.length;
    } catch (e) {
      // 单个分类失败不阻断其它分类
    }
  }

  return { customAdded, matched, applied, skipped };
}

/**
 * 删除指定备份文件（直接物理删除）。返回 { ok }。
 * 仅允许删 BACKUP_DIR 下的 imagepilot-backup-*.json，防止误删别处文件。
 */
export async function deleteBackup(path) {
  if (typeof path !== 'string' || !path) {
    throw new Error('备份路径无效');
  }
  if (!path.startsWith(BACKUP_DIR)) {
    throw new Error('仅允许删 Downloads 下的 ImagePilot 备份');
  }
  const base = path.split('/').pop() || '';
  if (!base.startsWith(FILE_PREFIX) || !base.endsWith(FILE_SUFFIX)) {
    throw new Error('文件名不是 ImagePilot 备份格式');
  }
  await RNFS.unlink(path);
  return { ok: true };
}

export default { exportBackup, listBackups, readBackup, applyBackup, deleteBackup };
