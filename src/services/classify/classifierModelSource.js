/**
 * classifierModelSource — 分类模型按需下载（类比 enhance/modelSource，但专管分类）。
 *
 * basic 档（MobileNetV3-ImageNet）随 APK 打包，不走本模块；
 * scene（Places365）/ clip（MobileCLIP）按需下载到 DocumentDirectory/models/。
 *
 * 下载源走 chunguangwei/ImagePilot Release（github.com 域，多数设备可达；
 * api.github.com 被某些设备 403 因此不用 API）。
 *
 * 关键约束：返回路径形态跟 enhance/modelSource 一致（Android 用 file:// 前缀，
 * iOS 用裸路径）— onnxruntime-react-native 两端的偏好不同；loadOnnxSession
 * 已经能兼容两种形态（三策略 fallback），所以这里统一返回 file:// 即可。
 */

import { logger } from '../../adapters/WebAdapters';
import { Platform } from 'react-native';

// eslint-disable-next-line global-require
const RNFS = require('react-native-fs');

const MODELS_DIR = `${RNFS.DocumentDirectoryPath}/classify_models`;

export function modelLocalPath(filename) {
  return `${MODELS_DIR}/${filename}`;
}

export async function isClassifierModelDownloaded(filename) {
  try {
    const p = modelLocalPath(filename);
    if (!(await RNFS.exists(p))) return false;
    const st = await RNFS.stat(p);
    return Number(st.size) > 100000; // 至少 100KB，过滤 .part 半成品
  } catch (_) { return false; }
}

/**
 * 若该模型已「打包进 App」，拷到本地缓存目录并返回 true（拷一次后走本地、不再拷）。
 *  - 基础物体识别 mobilenetv3 随包：默认档零下载、离线开箱即用，不连任何云
 *    （解决国内/华为等连不上 github.com 时基础分类直接失败）。
 *  - Android：assets/models/<file>；iOS：App 资源包根 MainBundle/<file>。
 */
async function copyBundledModelIfPresent(filename, dest) {
  try {
    if (Platform.OS === 'android') {
      const assetPath = `models/${filename}`;
      const exists = await RNFS.existsAssets(assetPath).catch(() => false);
      if (!exists) return false;
      await RNFS.copyFileAssets(assetPath, dest);
      return true;
    }
    const bundlePath = `${RNFS.MainBundlePath}/${filename}`;
    const exists = await RNFS.exists(bundlePath).catch(() => false);
    if (!exists) return false;
    await RNFS.copyFile(bundlePath, dest);
    return true;
  } catch (_) {
    return false;
  }
}

// 模型按「地区选源」：国内 ModelScope 优先、海外 GitHub 直连优先（互为兜底）。见 modelRegion.js。
const GH_MIRROR = 'https://gh-proxy.com/';
const { modelCandidates, modelFilenameFromUrl } = require('./modelRegion');
function buildUrlCandidates(url) {
  // 本产品模型库（ModelScope 直链 或 GitHub models-v1）→ 按地区排好的候选列表
  const fn = modelFilenameFromUrl(url);
  if (fn) return modelCandidates(fn);
  // 其它 github.com 链接：代理 + 直连
  if (/^https?:\/\/github\.com\//i.test(url)) return [GH_MIRROR + url, url];
  return [url];
}

/** 单源下载到 dest（成功无返回；失败抛错；用户 abort 抛 E_ABORTED）。供多源循环调用。 */
async function downloadUrlToFile(url, tmp, dest, filename, onProgress, signal) {
  await RNFS.mkdir(MODELS_DIR).catch(() => {});
  try { if (await RNFS.exists(tmp)) await RNFS.unlink(tmp); } catch (_) {}
  logger.debug(`[classifierModelSource] 开始下载: ${filename} from ${url}`);
  let totalBytes = 0;
  const { jobId, promise } = RNFS.downloadFile({
    fromUrl: url,
    toFile: tmp,
    progressInterval: 400,
    begin: (r) => { if (r && r.contentLength > 0) totalBytes = r.contentLength; },
    progress: (r) => {
      if (!onProgress) return;
      const denom = totalBytes || r.contentLength;
      if (denom > 0) onProgress(Math.min(1, r.bytesWritten / denom));
      else if (r.bytesWritten > 0) onProgress(0.01);
    },
  });
  let aborted = false;
  const onAbort = () => { aborted = true; try { RNFS.stopDownload(jobId); } catch (_) {} };
  if (signal) signal.addEventListener('abort', onAbort);
  try {
    const res = await promise.catch((e) => { if (aborted) return null; throw e; });
    if (aborted) {
      try { if (await RNFS.exists(tmp)) await RNFS.unlink(tmp); } catch (_) {}
      throw new Error('E_ABORTED 下载已取消');
    }
    if (res && res.statusCode && res.statusCode >= 400) {
      try { await RNFS.unlink(tmp); } catch (_) {}
      throw new Error(`E_DOWNLOAD 分类模型下载失败 HTTP ${res.statusCode}`);
    }
    const st = await RNFS.stat(tmp).catch(() => null);
    if (!st || Number(st.size) < 100000) {
      try { await RNFS.unlink(tmp); } catch (_) {}
      throw new Error('E_CORRUPT 分类模型下载不完整');
    }
    await RNFS.moveFile(tmp, dest);
    logger.debug(`[classifierModelSource] 下载完成: ${filename}, size=${st.size}`);
  } finally {
    if (signal) { try { signal.removeEventListener('abort', onAbort); } catch (_) {} }
  }
}

/**
 * 确保分类模型在本地，否则从 url 下载。返回本地 file:// URI 供 ONNX 加载。
 * 加载优先级：本地缓存 → 打包资源(若有) → 网络下载（国内镜像优先、直连兜底）。
 * @param {string} filename
 * @param {string} url
 * @param {(p:number)=>void} [onProgress] 0~1 下载进度
 * @param {{ signal?: AbortSignal }} [opts] 可选 AbortSignal；abort 时调 RNFS.stopDownload(jobId)，
 *                                          并清理 .part 临时文件后 throw E_ABORTED
 */
export async function ensureClassifierModel(filename, url, onProgress, opts = {}) {
  const dest = modelLocalPath(filename);
  const asUri = (p) => (p.startsWith('file://') ? p : `file://${p}`);
  if (await isClassifierModelDownloaded(filename)) return asUri(dest);
  await RNFS.mkdir(MODELS_DIR).catch(() => {});
  // 打包模型优先（基础识别随包 → 零下载、离线可用）
  if (await copyBundledModelIfPresent(filename, dest)) {
    logger.debug(`[classifierModelSource] 使用打包模型: ${filename}`);
    return asUri(dest);
  }
  if (!url) throw new Error('E_NO_MODEL 未配置分类模型下载地址');

  const { signal } = opts;
  if (signal && signal.aborted) throw new Error('E_ABORTED 下载已取消');

  const tmp = `${dest}.part`;
  // 多源下载：国内 GitHub 加速镜像优先、直连兜底（解决国内/华为首次连不上 github.com）。
  let lastErr = null;
  for (const candUrl of buildUrlCandidates(url)) {
    if (signal && signal.aborted) throw new Error('E_ABORTED 下载已取消');
    try {
      await downloadUrlToFile(candUrl, tmp, dest, filename, onProgress, signal);
      return asUri(dest);
    } catch (e) {
      if (String(e?.message || '').includes('E_ABORTED')) throw e; // 用户取消 → 不再换源
      lastErr = e;
      logger.debug(`[classifierModelSource] 源失败转下一个: ${candUrl} — ${e?.message || e}`);
    }
  }
  throw lastErr || new Error('E_DOWNLOAD 所有下载源均失败');
}

export async function deleteClassifierModel(filename) {
  try {
    const p = modelLocalPath(filename);
    if (await RNFS.exists(p)) await RNFS.unlink(p);
  } catch (_) { /* 静默 */ }
}

// ==================== 大模型（VLM GGUF）断点续传下载 ====================
//
// VLM 档每个变体是 0.5~1.8GB 的 GGUF（model + mmproj），断网重下整包代价大，
// 因此走 HTTP Range 续传：保留 .part 已下字节 → Range: bytes=N- 拉剩余 → 分块 append。
// 与 ensureClassifierModel（小模型，失败即重下）分开，避免影响 CLIP/ImageNet 链路。

const APPEND_CHUNK = 8 * 1024 * 1024; // 8MB/块，限内存峰值（RNFS.read/append 走 base64）

/** 把 src 文件按块追加到 dest（不整文件载入内存）。 */
async function appendFileChunked(src, dest) {
  const total = Number((await RNFS.stat(src)).size) || 0;
  let pos = 0;
  while (pos < total) {
    const len = Math.min(APPEND_CHUNK, total - pos);
    // eslint-disable-next-line no-await-in-loop
    const b64 = await RNFS.read(src, len, pos, 'base64');
    // eslint-disable-next-line no-await-in-loop
    await RNFS.appendFile(dest, b64, 'base64');
    pos += len;
  }
}

// 各模型文件类型的「头部魔数」（base64 前缀；读前 6 字节即可判定头 3~4 字节）。
//  .litertlm：实测头是 ASCII 'LITERTLM' (4C 49 54 45 52 54 4C 4D) → base64 前缀 'TElU'（不是 zip！）
//  .gguf    ：'GGUF' 47 47 55 46                                  → base64 前缀 'R0dV'
// 用途：下完后校验内容类型——下成 HTML 错误页 / 文件头损坏的，直接判废，避免"大小对就放行"后端侧加载才崩。
const MODEL_MAGIC_B64 = {
  '.litertlm': 'TElU',
  '.gguf': 'R0dV',
};

/** 校验已下文件的头部魔数是否匹配其扩展名。未知类型 / 读失败 → 返回 true（不误杀）。 */
async function verifyModelMagic(path, filename) {
  const ext = (String(filename).match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
  const want = MODEL_MAGIC_B64[ext];
  if (!want) return true;
  try {
    const b64 = await RNFS.read(path, 6, 0, 'base64');
    return typeof b64 === 'string' && b64.startsWith(want);
  } catch (_) { return true; }
}

/** 大文件是否已完整下载（有 expectedBytes 则按字节核对，否则仅判存在且足够大）。 */
export async function isLargeModelComplete(filename, expectedBytes) {
  try {
    const p = modelLocalPath(filename);
    if (!(await RNFS.exists(p))) return false;
    const size = Number((await RNFS.stat(p)).size) || 0;
    if (expectedBytes && expectedBytes > 0) return size >= expectedBytes;
    return size > 1000000; // 无期望值时至少 1MB
  } catch (_) { return false; }
}

/**
 * 确保大模型在本地（断点续传）。返回本地 file:// URI。
 * @param {string} filename
 * @param {string} url
 * @param {(p:number)=>void} [onProgress] 0~1
 * @param {{ signal?: AbortSignal, expectedBytes?: number }} [opts]
 */
export async function ensureLargeModel(filename, url, onProgress, opts = {}) {
  const dest = modelLocalPath(filename);
  const asUri = (p) => (p.startsWith('file://') ? p : `file://${p}`);
  const { signal, expectedBytes = 0 } = opts;
  if (await isLargeModelComplete(filename, expectedBytes)) return asUri(dest);
  if (!url) throw new Error('E_NO_MODEL 未配置模型下载地址');
  if (signal && signal.aborted) throw new Error('E_ABORTED 下载已取消');

  await RNFS.mkdir(MODELS_DIR).catch(() => {});
  const tmp = `${dest}.part`;

  // 已下字节（断点）
  let existing = 0;
  try { if (await RNFS.exists(tmp)) existing = Number((await RNFS.stat(tmp)).size) || 0; } catch (_) { existing = 0; }
  // 已下满（.part 已是完整文件）→ 直接转正
  if (expectedBytes && existing >= expectedBytes) {
    await RNFS.moveFile(tmp, dest);
    return asUri(dest);
  }

  // existing>0 → 续传：剩余下到 .tail 再 append；existing==0 → 直接下到 .part
  const resuming = existing > 0;
  const tail = resuming ? `${dest}.tail` : tmp;
  if (resuming) { try { if (await RNFS.exists(tail)) await RNFS.unlink(tail); } catch (_) {} }

  logger.debug(`[classifierModelSource] 大模型下载 ${filename} existing=${existing} resuming=${resuming}`);

  // 不续传时不传 headers 键（与现有可用的 ensureClassifierModel 完全一致，避免 iOS 上
  // headers:undefined 影响首帧）；续传时才带 Range。
  const dlOpts = {
    fromUrl: url,
    toFile: tail,
    progressInterval: 500,
    // iOS 后台会话：锁屏/切后台也继续下（大模型 1~2.5GB，普通会话锁屏即暂停）。
    // discretionary:false 让系统别等 WiFi/充电才下。Android 忽略这两项。
    background: true,
    discretionary: false,
    begin: () => {},
    progress: (r) => {
      if (!onProgress) return;
      const denom = expectedBytes || (existing + (r.contentLength || 0));
      const done = existing + (r.bytesWritten || 0);
      if (denom > 0) onProgress(Math.min(1, done / denom));
      else if (done > 0) onProgress(0.01);
    },
  };
  if (resuming) dlOpts.headers = { Range: `bytes=${existing}-` };
  const { jobId, promise } = RNFS.downloadFile(dlOpts);

  let aborted = false;
  const onAbort = () => { aborted = true; try { RNFS.stopDownload(jobId); } catch (_) {} };
  if (signal) signal.addEventListener('abort', onAbort);

  try {
    const res = await promise.catch((e) => { if (aborted) return null; throw e; });
    if (aborted) throw new Error('E_ABORTED 下载已取消');
    const code = res && res.statusCode;
    if (code && code >= 400) {
      // 416（Range 越界，通常是已下完）容错：若 .part 达标就转正
      if (code === 416 && expectedBytes && existing >= expectedBytes) {
        if (resuming) { try { await RNFS.unlink(tail); } catch (_) {} }
        await RNFS.moveFile(tmp, dest);
        return asUri(dest);
      }
      throw new Error(`E_DOWNLOAD 模型下载失败 HTTP ${code}`);
    }

    if (resuming) {
      if (code === 206) {
        // 服务器支持续传：把剩余块 append 到 .part
        await appendFileChunked(tail, tmp);
        try { await RNFS.unlink(tail); } catch (_) {}
      } else {
        // 服务器忽略 Range 返回整包 → .tail 即完整文件，替换 .part
        try { await RNFS.unlink(tmp); } catch (_) {}
        await RNFS.moveFile(tail, tmp);
      }
    }

    // 完整性校验
    const st = await RNFS.stat(tmp).catch(() => null);
    const size = st ? Number(st.size) : 0;
    if (!size || (expectedBytes && size < expectedBytes)) {
      throw new Error(`E_CORRUPT 模型下载不完整 ${size}/${expectedBytes || '?'}`);
    }
    // 内容校验：头部魔数不对（下成 HTML 错误页 / 文件头损坏）→ 删 .part 强制干净重下，
    // 否则会"大小够就放行"，等到端侧加载模型才崩、还看不出是下载坏了。
    if (!(await verifyModelMagic(tmp, filename))) {
      try { await RNFS.unlink(tmp); } catch (_) {}
      throw new Error('E_CORRUPT 模型文件头校验失败（可能下到错误页或文件损坏），已清除，请重试');
    }
    await RNFS.moveFile(tmp, dest);
    logger.debug(`[classifierModelSource] 大模型完成 ${filename} size=${size}`);
    return asUri(dest);
  } catch (e) {
    // 续传失败保留 .part 供下次继续；清理半成品 .tail
    if (resuming) { try { if (await RNFS.exists(tail)) await RNFS.unlink(tail); } catch (_) {} }
    throw e;
  } finally {
    if (signal) { try { signal.removeEventListener('abort', onAbort); } catch (_) {} }
  }
}

export default {
  modelLocalPath,
  isClassifierModelDownloaded,
  ensureClassifierModel,
  deleteClassifierModel,
  isLargeModelComplete,
  ensureLargeModel,
};
