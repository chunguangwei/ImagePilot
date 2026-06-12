/**
 * localEnhance — 设备端（离线）AI 修图：把增强预设接到本地模型，无需云端后端。
 *
 * 复用工程已跑通的 onnxruntime-react-native + Real-ESRGAN 超分（superResRunner），
 * 以及模型按需下载（ModelPathAdapter.ensureModelExists）。
 *
 * 当前已接入的预设见 LOCAL_PRESET_HANDLERS；未列出的预设仍走云端/占位（保持"开发中"），
 * 后续阶段（抠图/消除/美颜）按同样模式逐步加入：新增 handler + 模型名即可。
 */

import { RNFS, logger } from '../../adapters/WebAdapters';
import ImageProcessor from '../ImageProcessor';
import { ensureModel, resolveSuperRes, FIXED_MODELS } from './modelSource';

// 模型不再随 APK 打包（瘦身），改为按需从 GitHub Release 下载（见 modelSource.js）。
// 下载进度通过 onProgress 以 { phase:'download', done, total } 传出，与推理阶段区分。

// 预设 id → 本地处理器标识。未列出者 isLocalPreset=false，调用方回退云端/占位。
const LOCAL_PRESET_HANDLERS = Object.freeze({
  enhance: 'superres', // 清晰增强 → 超分修复
  cutout: 'matting',   // 背景移除/抠图 → U2Net 显著性分割
  portrait: 'beauty',  // 人像美颜 → 全局磨皮（一期，纯 jimp，免模型）
  color: 'colorize',   // 色彩优化 → 饱和度/对比/亮度增强（纯 jimp，免模型）
  // 证件处理(document) B 期改为交互式：走独立 DocScan 界面（自动找边+可调四角+透视矫正+扫描增强），
  // 不再在 EnhanceResult 里自动跑，故不列入此表（见 ImagePreview 的 document 特例 + DocScanScreen）。
});

/**
 * 注入到「AI 修图」菜单的本地能力预设（不依赖云端、不写入 settings）。
 * 调用方（ImagePreview）加载预设后合并这些，name 用 i18n 覆盖。
 */
export const LOCAL_EXTRA_PRESETS = Object.freeze({
  cutout: { icon: '✂️', prompt: '', enabled: true, sortOrder: 10 },
  // 物体消除走独立涂抹界面（screen 字段告诉调用方导航到该屏，而非 EnhanceResult）
  inpaint: { icon: '🩹', prompt: '', enabled: true, sortOrder: 11, screen: 'Inpaint' },
});

/** 该预设是否已支持本地（离线）处理 */
export function isLocalPreset(presetId) {
  return !!LOCAL_PRESET_HANDLERS[presetId];
}

/**
 * 给本地处理加超时兜底：CPU/推理在 Hermes 下可能很慢，若卡住超过 ms 就抛错，
 * 避免界面永远停在「处理中」。失败/超时由调用方提示用户。
 */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`E_TIMEOUT ${label || '处理'}超时（图片过大或设备繁忙），请重试或换张图片`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
const LOCAL_TIMEOUT_MS = 60000;

/**
 * 本地增强单张图片，返回 data URL（image/jpeg）。
 * data URL 可直接用于 <Image> 预览，并被 RNFS.saveImageToGallery 接受（其原生侧支持 data:image）。
 * @param {string} imageUri 原图 URI（file:// / content://）
 * @param {string} presetId 预设 id
 * @param {(p:{done:number,total:number})=>void} [onProgress] 分块进度
 * @returns {Promise<string>} data URL
 */
export async function enhanceImageLocally(imageUri, presetId, onProgress) {
  const handler = LOCAL_PRESET_HANDLERS[presetId];
  let p;
  if (handler === 'superres') p = runSuperRes(imageUri, onProgress);
  else if (handler === 'matting') p = runMatting(imageUri, onProgress);
  else if (handler === 'beauty') p = runBeauty(imageUri, onProgress);
  else if (handler === 'colorize') p = runColor(imageUri, onProgress);
  else throw new Error('该预设暂不支持本地处理');
  return withTimeout(p, LOCAL_TIMEOUT_MS, '增强');
}

/**
 * 读图为干净 file:// 后取 base64（限长边）。content:// / 组合路径不可靠，
 * 统一用 ImageProcessor 产出干净 file:// 再读（与 FilterEditorScreen 一致，
 * 避免 getLocalPath 给出无效路径）。
 */
async function readResizedBase64(imageUri, maxEdge) {
  const resized = await ImageProcessor.resizeImage(imageUri, maxEdge, maxEdge, {
    maintainAspectRatio: true,
    outputFormat: 'jpeg',
    quality: 92,
  });
  const uri = resized?.uri;
  if (!uri) throw new Error('图片预处理失败');
  const path = uri.startsWith('file://') ? uri.replace(/^file:\/\//, '') : uri;
  return RNFS.readFile(path, 'base64');
}

/** Real-ESRGAN 超分：选模型(小/大/自定义)→按需下载→读 base64→分块推理→data URL */
async function runSuperRes(imageUri, onProgress) {
  const base64 = await readResizedBase64(imageUri, 1024);
  const { filename, url } = await resolveSuperRes();
  const modelPath = await ensureModel(filename, url, (p) => onProgress && onProgress({ phase: 'download', done: p, total: 1 }));
  // 懒加载推理引擎（仅在实际增强时才载入 onnxruntime/jimp）
  const mod = await import('./superResRunner.js');
  const createSuperResRunner = mod.createSuperResRunner || mod.default;
  const runner = createSuperResRunner({ modelPath });
  logger.debug('🟦 本地超分开始', { imageUri, filename });
  return runner.enhance(base64, onProgress); // data URL（image/jpeg）
}

/**
 * 人像美颜（二期·仅人脸）：先原生人脸检测（iOS Vision / 安卓 FaceDetector，零依赖），
 * 只磨人脸椭圆区域并羽化过渡；未识别到人脸 → 抛错提示（调用方 Alert 展示）。
 */
async function runBeauty(imageUri, onProgress) {
  const base64 = await readResizedBase64(imageUri, 1024); // 控耗时（全分辨率磨皮在 Hermes 下较慢）
  if (onProgress) onProgress({ done: 0, total: 1 });
  // 写临时文件给原生检测（检测与处理用同一张缩放图，坐标天然对齐）
  const { NativeModules, Platform } = require('react-native');
  const { RNFS } = require('../../adapters/WebAdapters');
  const tmp = `${RNFS.CachesDirectoryPath}/beauty_detect_${Date.now()}.jpg`;
  let faces = [];
  try {
    await RNFS.writeFile(tmp, base64.startsWith('data:') ? base64.split(',')[1] : base64, 'base64');
    const native = Platform.OS === 'ios' ? NativeModules.PhotoKitModule : NativeModules.MediaStoreModule;
    if (native && typeof native.detectFaces === 'function') {
      faces = await native.detectFaces(tmp);
    }
  } catch (e) {
    logger.warn('人脸检测失败（按未识别处理）:', e?.message || e);
    faces = [];
  } finally {
    try { await RNFS.unlink(tmp); } catch (_) {}
  }
  if (!faces || faces.length === 0) {
    throw new Error('未识别到人脸，美颜仅对人物照片生效');
  }
  logger.debug(`🟦 检测到 ${faces.length} 张人脸，仅对人脸区域美颜`);
  const mod = await import('./jimpFilters.js');
  const out = await mod.applyBeautyToFacesBase64(base64, 0.8, faces);
  if (onProgress) onProgress({ done: 1, total: 1 });
  logger.debug('🟦 本地美颜完成（仅人脸）', { imageUri });
  return out;
}

/**
 * 色彩优化（纯 jimp，免模型）：饱和度/对比/亮度增强→data URL。
 * 限 1024 长边：色调操作要逐像素做 RGB↔HSL 转换，Hermes 下处理 1536px(~7MP)
 * 容易跑满 CPU 而被 60s 超时打断；1024 与 runBeauty 对齐，~1MP 内能在 <30s 完成。
 */
async function runColor(imageUri, onProgress) {
  const base64 = await readResizedBase64(imageUri, 1024);
  const mod = await import('./jimpFilters.js');
  if (onProgress) onProgress({ done: 0, total: 1 });
  logger.debug('🟦 本地色彩优化：开始 jimp 处理');
  const out = await mod.applyColorEnhanceToBase64(base64, 0.85);
  if (onProgress) onProgress({ done: 1, total: 1 });
  logger.debug('🟦 本地色彩优化完成', { imageUri });
  return out;
}

/**
 * 证件处理 B 期：自动检测文档四角（复用 u2netp），返回归一坐标 [TL,TR,BR,BL] 或 null。
 * 由 DocScanScreen 在进入时调用，用于预填可拖动的四角手柄。
 */
export async function detectDocCorners(imageUri) {
  const run = async () => {
    const base64 = await readResizedBase64(imageUri, 1024);
    const modelPath = await ensureModel(FIXED_MODELS.matting.filename, FIXED_MODELS.matting.url); // 复用 u2netp
    const mod = await import('./docDewarpRunner.js');
    return mod.detectCorners(base64, modelPath);
  };
  // 自动找边失败/超时都不应阻断（调用方用默认框兜底），故吞错返回 null
  try { return await withTimeout(run(), 30000, '检测边缘'); } catch (_) { return null; }
}

/**
 * 证件处理 B 期：按四角(归一坐标)做透视矫正 + 扫描增强，返回 data URL。
 * 纯 jimp（不需模型）。由 DocScanScreen 在「矫正」时调用。
 */
export async function dewarpDocument(imageUri, quadFrac, onProgress) {
  const run = async () => {
    const base64 = await readResizedBase64(imageUri, 1280);
    const mod = await import('./docDewarpRunner.js');
    return mod.dewarp(base64, quadFrac, onProgress);
  };
  return withTimeout(run(), LOCAL_TIMEOUT_MS, '矫正');
}

/**
 * 物体消除/inpaint（MI-GAN）：与上面预设流程不同——需要调用方先在图上涂抹得到 mask，
 * 故单独导出，由 InpaintScreen 直接调用。maskSpec 见 inpaintRunner.inpaint。
 * @param {string} imageUri
 * @param {object} maskSpec { strokes, displayW, displayH, brushRadius }
 * @param {(p:{done:number,total:number})=>void} [onProgress]
 * @returns {Promise<string>} data URL（image/jpeg）
 */
export async function inpaintLocally(imageUri, maskSpec, onProgress) {
  const base64 = await readResizedBase64(imageUri, 1024);
  const modelPath = await ensureModel(FIXED_MODELS.inpaint.filename, FIXED_MODELS.inpaint.url, (p) => onProgress && onProgress({ phase: 'download', done: p, total: 1 }));
  const mod = await import('./inpaintRunner.js');
  const createInpaintRunner = mod.createInpaintRunner || mod.default;
  const runner = createInpaintRunner({ modelPath });
  logger.debug('🟦 本地物体消除开始', { imageUri });
  return runner.inpaint(base64, maskSpec, onProgress);
}

/** U2Net 抠图：按需下载→读 base64→分割→前景合成纯色底→data URL */
async function runMatting(imageUri, onProgress) {
  const base64 = await readResizedBase64(imageUri, 1280);
  const modelPath = await ensureModel(FIXED_MODELS.matting.filename, FIXED_MODELS.matting.url, (p) => onProgress && onProgress({ phase: 'download', done: p, total: 1 }));
  const mod = await import('./mattingRunner.js');
  const createMattingRunner = mod.createMattingRunner || mod.default;
  const runner = createMattingRunner({ modelPath });
  logger.debug('🟦 本地抠图开始', { imageUri });
  return runner.cutout(base64, onProgress); // data URL（image/jpeg）
}

export default { isLocalPreset, enhanceImageLocally, LOCAL_EXTRA_PRESETS };
