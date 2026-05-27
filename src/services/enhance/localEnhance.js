/**
 * localEnhance — 设备端（离线）AI 修图：把增强预设接到本地模型，无需云端后端。
 *
 * 复用工程已跑通的 onnxruntime-react-native + Real-ESRGAN 超分（superResRunner），
 * 以及模型按需下载（ModelPathAdapter.ensureModelExists）。
 *
 * 当前已接入的预设见 LOCAL_PRESET_HANDLERS；未列出的预设仍走云端/占位（保持"开发中"），
 * 后续阶段（抠图/消除/美颜）按同样模式逐步加入：新增 handler + 模型名即可。
 */

import { RNFS, ModelPathAdapter, logger } from '../../adapters/WebAdapters';
import ImageProcessor from '../ImageProcessor';

// 单文件 Real-ESRGAN x4（权重内嵌）；与 FilterEditor 的 AI 增强同一模型。
const SR_MODEL = 'real_esrgan_x4v3_merged.onnx';
const MATTING_MODEL = 'u2netp.onnx'; // 轻量抠图（显著性分割），打包在 public/models
const INPAINT_MODEL = 'migan_pipeline_v2.onnx'; // MI-GAN 物体消除（自带预/后处理），打包在 public/models

// 预设 id → 本地处理器标识。未列出者 isLocalPreset=false，调用方回退云端/占位。
const LOCAL_PRESET_HANDLERS = Object.freeze({
  enhance: 'superres', // 清晰增强 → 超分修复
  cutout: 'matting',   // 背景移除/抠图 → U2Net 显著性分割
  portrait: 'beauty',  // 人像美颜 → 全局磨皮（一期，纯 jimp，免模型）
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
 * 本地增强单张图片，返回 data URL（image/jpeg）。
 * data URL 可直接用于 <Image> 预览，并被 RNFS.saveImageToGallery 接受（其原生侧支持 data:image）。
 * @param {string} imageUri 原图 URI（file:// / content://）
 * @param {string} presetId 预设 id
 * @param {(p:{done:number,total:number})=>void} [onProgress] 分块进度
 * @returns {Promise<string>} data URL
 */
export async function enhanceImageLocally(imageUri, presetId, onProgress) {
  const handler = LOCAL_PRESET_HANDLERS[presetId];
  if (handler === 'superres') return runSuperRes(imageUri, onProgress);
  if (handler === 'matting') return runMatting(imageUri, onProgress);
  if (handler === 'beauty') return runBeauty(imageUri, onProgress);
  throw new Error('该预设暂不支持本地处理');
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

/** Real-ESRGAN 超分：读 base64→分块推理→data URL */
async function runSuperRes(imageUri, onProgress) {
  const base64 = await readResizedBase64(imageUri, 1024);
  await ModelPathAdapter.ensureModelExists(SR_MODEL);
  const modelPath = ModelPathAdapter.getModelPath(SR_MODEL);
  // 懒加载推理引擎（仅在实际增强时才载入 onnxruntime/jimp）
  const mod = await import('./superResRunner.js');
  const createSuperResRunner = mod.createSuperResRunner || mod.default;
  const runner = createSuperResRunner({ modelPath });
  logger.debug('🟦 本地超分开始', { imageUri });
  return runner.enhance(base64, onProgress); // data URL（image/jpeg）
}

/** 人像美颜（一期·全局磨皮，纯 jimp，免模型）：读 base64→磨皮→data URL */
async function runBeauty(imageUri, onProgress) {
  const base64 = await readResizedBase64(imageUri, 1024); // 控耗时（全分辨率磨皮在 Hermes 下较慢）
  const mod = await import('./jimpFilters.js');
  if (onProgress) onProgress({ done: 0, total: 1 });
  const out = await mod.applyBeautyToBase64(base64, 0.8);
  if (onProgress) onProgress({ done: 1, total: 1 });
  logger.debug('🟦 本地美颜完成', { imageUri });
  return out;
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
  await ModelPathAdapter.ensureModelExists(INPAINT_MODEL);
  const modelPath = ModelPathAdapter.getModelPath(INPAINT_MODEL);
  const mod = await import('./inpaintRunner.js');
  const createInpaintRunner = mod.createInpaintRunner || mod.default;
  const runner = createInpaintRunner({ modelPath });
  logger.debug('🟦 本地物体消除开始', { imageUri });
  return runner.inpaint(base64, maskSpec, onProgress);
}

/** U2Net 抠图：读 base64→分割→前景合成纯色底→data URL */
async function runMatting(imageUri, onProgress) {
  const base64 = await readResizedBase64(imageUri, 1280);
  await ModelPathAdapter.ensureModelExists(MATTING_MODEL);
  const modelPath = ModelPathAdapter.getModelPath(MATTING_MODEL);
  const mod = await import('./mattingRunner.js');
  const createMattingRunner = mod.createMattingRunner || mod.default;
  const runner = createMattingRunner({ modelPath });
  logger.debug('🟦 本地抠图开始', { imageUri });
  return runner.cutout(base64, onProgress); // data URL（image/jpeg）
}

export default { isLocalPreset, enhanceImageLocally, LOCAL_EXTRA_PRESETS };
