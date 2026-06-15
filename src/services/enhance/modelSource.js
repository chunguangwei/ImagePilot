/**
 * modelSource — 设备端 AI 模型「按需下载」管理（APK 不再打包大模型，瘦身）。
 *
 * 模型托管在本产品 GitHub Release（github.com 下载域，该机可达；api.github.com 会 403）。
 * ensureModel：本地(DocumentDirectory/models)有就用，没有就从 url 下载（带进度、.part 原子落盘、大小校验）。
 * 超分(AI增强)模型分 小/大/自定义 三档，用户在设置页选；抠图/消除走固定链接自动下载。
 * 分类模型 mobilenetv3 仍随 APK 打包（核心、扫描即用），不在此下载。
 */

import { logger } from '../../adapters/WebAdapters';
import UnifiedDataService from '../UnifiedDataService';
import { Platform } from 'react-native';

// 注意：adapters 的 RNFS 是裁剪过的子集，没有 downloadFile/moveFile 等；
// 这里直接用原生 react-native-fs（与 UpdateService 一致），否则会 "undefined is not a function"。
// eslint-disable-next-line global-require
const RNFS = require('react-native-fs');

const BASE = 'https://modelscope.cn/models/chunguangwee/ImagePilot-models/resolve/master'; // ModelScope 主源（端侧国内更稳）；GitHub Release 留作兜底（见下载器）

// 超分模型变体（设置页可选）
export const SUPERRES_VARIANTS = {
  small: { filename: 'real_esrgan_x4v3_merged.onnx', url: `${BASE}/real_esrgan_x4v3_merged.onnx`, label: '小（快·约 5MB）', sizeMB: 5 },
  large: { filename: 'Real-ESRGAN-x4plus.onnx', url: `${BASE}/Real-ESRGAN-x4plus.onnx`, label: '大（高质量·约 64MB）', sizeMB: 64 },
};
const CUSTOM_SUPERRES_FILENAME = 'superres_custom.onnx';

// 固定下载模型（无大小变体）
export const FIXED_MODELS = {
  matting: { filename: 'u2netp.onnx', url: `${BASE}/u2netp.onnx` },
  inpaint: { filename: 'migan_pipeline_v2.onnx', url: `${BASE}/migan_pipeline_v2.onnx` },
};

function modelsDir() { return `${RNFS.DocumentDirectoryPath}/models`; }
export function modelLocalPath(filename) { return `${modelsDir()}/${filename}`; }

export async function isModelDownloaded(filename) {
  try {
    const p = modelLocalPath(filename);
    if (!(await RNFS.exists(p))) return false;
    const st = await RNFS.stat(p);
    return Number(st.size) > 100000;
  } catch (_) { return false; }
}

/**
 * 确保模型在本地，否则从 url 下载。返回本地绝对路径。
 * @param {string} filename
 * @param {string} url
 * @param {(p:number)=>void} [onProgress] 0~1 下载进度
 * @param {{ signal?: AbortSignal }} [opts] 可选 AbortSignal；abort 时调 RNFS.stopDownload(jobId)，
 *                                          并清理 .part 临时文件后 throw E_ABORTED
 */
export async function ensureModel(filename, url, onProgress, opts = {}) {
  const dest = modelLocalPath(filename);
  // onnxruntime-react-native 在 Android 需要 file:// 前缀，否则报 "no content provider"。
  // RNFS 文件操作用裸路径(dest)，交给推理引擎的是 file:// URI。
  const asUri = (p) => (p.startsWith('file://') ? p : `file://${p}`);
  if (await isModelDownloaded(filename)) return asUri(dest);
  if (!url) throw new Error('E_NO_MODEL 未配置模型下载地址，请在设置里填写');

  // 按地区选源：本产品模型库的链接换成地区首选源（国内 ModelScope / 海外 GitHub）。
  // 自定义/外部 url 保持原样。
  try {
    const mr = require('../classify/modelRegion');
    if (mr.modelFilenameFromUrl(url)) url = mr.modelPrimaryUrl(filename);
  } catch (_) { /* 取不到地区模块 → 用原 url */ }

  const { signal } = opts;
  if (signal && signal.aborted) throw new Error('E_ABORTED 下载已取消');

  await RNFS.mkdir(modelsDir()).catch(() => {});
  const tmp = `${dest}.part`;
  try { if (await RNFS.exists(tmp)) await RNFS.unlink(tmp); } catch (_) {}
  logger.debug('🟦 开始下载模型', { filename, url });
  // GitHub Release 第一帧 contentLength 可能为 0（302 重定向到 S3），
  // 用 begin 回调拿到真正的总长度；progress 用 begin 拿到的值作分母兜底
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
      else if (r.bytesWritten > 0) onProgress(0.01); // 出 1% 让用户知道在下，不卡 0%
    },
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
      if (aborted) return null;
      throw e;
    });
    if (aborted) {
      try { if (await RNFS.exists(tmp)) await RNFS.unlink(tmp); } catch (_) {}
      throw new Error('E_ABORTED 下载已取消');
    }
    if (res && res.statusCode && res.statusCode >= 400) {
      try { await RNFS.unlink(tmp); } catch (_) {}
      throw new Error('模型下载失败 HTTP ' + res.statusCode);
    }
    const st = await RNFS.stat(tmp).catch(() => null);
    if (!st || Number(st.size) < 100000) {
      try { await RNFS.unlink(tmp); } catch (_) {}
      throw new Error('E_CORRUPT 模型下载不完整，请重试');
    }
    await RNFS.moveFile(tmp, dest);
    logger.debug('✅ 模型下载完成', { filename, size: st.size });
    return asUri(dest);
  } finally {
    if (signal) {
      try { signal.removeEventListener('abort', onAbort); } catch (_) {}
    }
  }
}

/**
 * 读取设置里激活的超分模型变体 → { filename, url, variant }
 *
 * 默认变体平台分桶：
 * - Android 默认 'small'：real_esrgan_x4v3_merged.onnx ~5MB，Qualcomm AI Hub
 *   导出格式，onnxruntime Android 能跑、体积友好
 * - iOS 默认 'large'：Real-ESRGAN-x4plus.onnx ~64MB，标准 ONNX，iOS
 *   onnxruntime-react-native 解析不了 Qualcomm 格式 → 创建会话直接失败
 *   (实测三策略 bare/orig/buf 全 "failed to load model")
 *
 * 用户手动选定的 variant 优先级高于默认；只在 cfg.variant 缺时按平台兜底。
 */
export async function resolveSuperRes() {
  let cfg = {};
  try { const s = await UnifiedDataService.readSettings(); cfg = (s && s.superResModel) || {}; } catch (_) {}
  const defaultVariant = Platform.OS === 'ios' ? 'large' : 'small';
  const variant = cfg.variant || defaultVariant;
  if (variant === 'custom' && cfg.customUrl) {
    return { filename: CUSTOM_SUPERRES_FILENAME, url: cfg.customUrl, variant: 'custom' };
  }
  const v = SUPERRES_VARIANTS[variant] || SUPERRES_VARIANTS[defaultVariant];
  return { ...v, variant: SUPERRES_VARIANTS[variant] ? variant : defaultVariant };
}

/** 删除某模型（用于"重新下载"/换自定义链接） */
export async function deleteModel(filename) {
  try { const p = modelLocalPath(filename); if (await RNFS.exists(p)) await RNFS.unlink(p); } catch (_) {}
}

export const CUSTOM_FILENAME = CUSTOM_SUPERRES_FILENAME;

export default { SUPERRES_VARIANTS, FIXED_MODELS, ensureModel, isModelDownloaded, resolveSuperRes, modelLocalPath, deleteModel };
