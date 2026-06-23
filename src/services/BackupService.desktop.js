/**
 * BackupService（桌面端）—— 分类索引备份/还原（Electron 文件 IO 适配）
 *
 * 与移动端 BackupService.js 共用「纯 DB」还原逻辑：直接 `import { applyBackup }`
 * 复用，不改它。仅把文件 IO 从 react-native-fs 换成 Electron 渲染进程的
 * `window.require('fs')`（writeFileSync/readdirSync/statSync/readFileSync/unlinkSync）。
 *
 * payload 结构与 mobile exportBackup（:53-91）完全一致：
 *   { schemaVersion, exportedAt, app:'ImagePilot', matchKey, customCategories, items }
 * 文件名同样是 imagepilot-backup-<yyyymmddhhmm>.json，跨端可互相还原。
 *
 * 桌面端差异：
 * - 目录由用户通过 ipcRenderer.invoke('select-folder') 选择（无固定 Downloads 概念）。
 * - 不做分享（桌面端文件本就可见）。
 */

import UnifiedDataService from './UnifiedDataService';
import configService from './llm/adapters/UnifiedDataConfigService';
import { applyBackup } from './BackupService';

const FILE_PREFIX = 'imagepilot-backup-';
const FILE_SUFFIX = '.json';
const SCHEMA_VERSION = 1;

/** 取 Electron 渲染进程的 fs 模块（仅桌面端可用） */
function getFs() {
  if (typeof window === 'undefined' || !window.require) {
    throw new Error('文件系统不可用（仅桌面端支持备份）');
  }
  return window.require('fs');
}

/** matchKey：fileName + size + takenAt（与 mobile buildKey 完全一致） */
function buildKey(img) {
  if (!img) return '';
  const fn = img.fileName || '';
  const sz = (img.size != null) ? String(img.size) : '';
  const ta = (img.takenAt != null) ? String(img.takenAt) : '';
  return `${fn}|${sz}|${ta}`;
}

/** 形如 202605291234 的稳定时间戳，做文件名用 */
function tsForFile() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * 导出当前分类索引到指定目录。
 * @param {string} dir 用户选择的目录（select-folder 返回的 path）
 * @returns {Promise<{ path: string, fileName: string, total: number, withCategory: number }>}
 */
export async function exportBackup(dir) {
  if (!dir || typeof dir !== 'string') {
    throw new Error('未选择导出目录');
  }
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

  // 自定义分类定义也带上
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

  const fs = getFs();
  const cleanDir = dir.replace(/\\/g, '/').replace(/\/+$/, '');
  const fileName = `${FILE_PREFIX}${tsForFile()}${FILE_SUFFIX}`;
  const path = `${cleanDir}/${fileName}`;
  fs.writeFileSync(path, JSON.stringify(payload), 'utf8');

  return { path, fileName, total: list.length, withCategory: items.length };
}

/**
 * 列出指定目录里现有的 imagepilot 备份文件，按修改时间倒序。
 * @param {string} dir
 * @returns {Promise<Array<{ name, path, size, mtime }>>}
 */
export async function listBackups(dir) {
  if (!dir || typeof dir !== 'string') return [];
  try {
    const fs = getFs();
    const cleanDir = dir.replace(/\\/g, '/').replace(/\/+$/, '');
    const names = fs.readdirSync(cleanDir);
    const re = /^imagepilot-backup-.*\.json$/;
    return names
      .filter((name) => re.test(name))
      .map((name) => {
        const path = `${cleanDir}/${name}`;
        let size = 0;
        let mtime = '';
        try {
          const st = fs.statSync(path);
          size = st.size || 0;
          mtime = st.mtime ? new Date(st.mtime).toISOString() : '';
        } catch (_) { /* 单个文件 stat 失败忽略 */ }
        return { name, path, size, mtime };
      })
      .sort((a, b) => (b.mtime || '').localeCompare(a.mtime || ''));
  } catch (_) {
    return [];
  }
}

/**
 * 读 + 校验备份文件，返回 payload 对象；不合法时抛错（校验照 mobile :125-134）。
 */
export function readBackup(path) {
  if (!path || typeof path !== 'string') {
    throw new Error('备份路径无效');
  }
  const fs = getFs();
  const text = fs.readFileSync(path, 'utf8');
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
 * 删除指定备份文件（直接物理删除）。返回 { ok }。
 * 仅允许删 imagepilot-backup-*.json，防止误删别处文件。
 */
export function deleteBackup(path) {
  if (typeof path !== 'string' || !path) {
    throw new Error('备份路径无效');
  }
  const base = path.replace(/\\/g, '/').split('/').pop() || '';
  if (!base.startsWith(FILE_PREFIX) || !base.endsWith(FILE_SUFFIX)) {
    throw new Error('文件名不是 ImagePilot 备份格式');
  }
  const fs = getFs();
  fs.unlinkSync(path);
  return { ok: true };
}

/**
 * 读 + 校验 + 应用备份（复用 mobile applyBackup 纯 DB 还原逻辑）。
 * @returns {Promise<{ customAdded, matched, applied, skipped }>}
 */
export async function restoreBackup(path) {
  const payload = readBackup(path);
  return applyBackup(payload);
}

export default { exportBackup, listBackups, readBackup, deleteBackup, restoreBackup };
