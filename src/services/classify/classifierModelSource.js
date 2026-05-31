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
 * 确保分类模型在本地，否则从 url 下载。返回本地 file:// URI 供 ONNX 加载。
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
  if (!url) throw new Error('E_NO_MODEL 未配置分类模型下载地址');

  const { signal } = opts;
  if (signal && signal.aborted) throw new Error('E_ABORTED 下载已取消');

  await RNFS.mkdir(MODELS_DIR).catch(() => {});
  const tmp = `${dest}.part`;
  try { if (await RNFS.exists(tmp)) await RNFS.unlink(tmp); } catch (_) {}

  logger.debug(`[classifierModelSource] 开始下载: ${filename} from ${url}`);
  const { jobId, promise } = RNFS.downloadFile({
    fromUrl: url,
    toFile: tmp,
    progressInterval: 400,
    progress: (r) => { if (onProgress && r.contentLength > 0) onProgress(Math.min(1, r.bytesWritten / r.contentLength)); },
  });

  // AbortSignal → RNFS.stopDownload(jobId)；abort 后 promise 会以 statusCode 抛错/或正常返回部分文件，
  // 统一交由 cleanup 分支识别并抛 E_ABORTED
  let aborted = false;
  const onAbort = () => {
    aborted = true;
    try { RNFS.stopDownload(jobId); } catch (_) {}
  };
  if (signal) signal.addEventListener('abort', onAbort);

  try {
    const res = await promise.catch((e) => {
      // stopDownload 后 promise 可能 reject，把它当作 abort 路径处理
      if (aborted) return null;
      throw e;
    });
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
    return asUri(dest);
  } finally {
    if (signal) {
      try { signal.removeEventListener('abort', onAbort); } catch (_) {}
    }
  }
}

export async function deleteClassifierModel(filename) {
  try {
    const p = modelLocalPath(filename);
    if (await RNFS.exists(p)) await RNFS.unlink(p);
  } catch (_) { /* 静默 */ }
}

export default {
  modelLocalPath,
  isClassifierModelDownloaded,
  ensureClassifierModel,
  deleteClassifierModel,
};
