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

// 预设 id → 本地处理器标识。未列出者 isLocalPreset=false，调用方回退云端/占位。
const LOCAL_PRESET_HANDLERS = Object.freeze({
  enhance: 'superres', // 清晰增强 → 超分修复
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
  throw new Error('该预设暂不支持本地处理');
}

/** Real-ESRGAN 超分：预处理→读 base64→分块推理→data URL */
async function runSuperRes(imageUri, onProgress) {
  // content:// / 组合路径不可靠，先用 ImageProcessor 产出干净 file:// 再读字节
  // （与 FilterEditorScreen 的读图方式一致，避免 getLocalPath 给出无效路径）。
  const resized = await ImageProcessor.resizeImage(imageUri, 1024, 1024, {
    maintainAspectRatio: true,
    outputFormat: 'jpeg',
    quality: 90,
  });
  const uri = resized?.uri;
  if (!uri) throw new Error('图片预处理失败');
  const path = uri.startsWith('file://') ? uri.replace(/^file:\/\//, '') : uri;
  const base64 = await RNFS.readFile(path, 'base64');

  await ModelPathAdapter.ensureModelExists(SR_MODEL);
  const modelPath = ModelPathAdapter.getModelPath(SR_MODEL);
  // 懒加载推理引擎（仅在实际增强时才载入 onnxruntime/jimp）
  const mod = await import('./superResRunner.js');
  const createSuperResRunner = mod.createSuperResRunner || mod.default;
  const runner = createSuperResRunner({ modelPath });
  logger.debug('🟦 本地超分开始', { imageUri });
  return runner.enhance(base64, onProgress); // data URL（image/jpeg）
}

export default { isLocalPreset, enhanceImageLocally };
