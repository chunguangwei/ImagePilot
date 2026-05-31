/**
 * Places365Classifier — 场景识别（Places365 365 类），独立于 MobileNetV3-ImageNet。
 *
 * 模型期望：Places365 标准训练（CSAILVision），输入 NCHW [1,3,224,224] float32，
 * ImageNet 归一（mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]），
 * 输出 [1, 365] logits。
 *
 * 模型加载走 loadOnnxSession（与 superRes 一致的 iOS 三策略 fallback）。
 * 预处理走 react-native-image-resizer + base64 → CHW float32 张量；与
 * ImageClassifierService.preprocessImageForMobileNetV3 共用思路但独立实现，
 * 不依赖 MobileNetV3 链路（解耦，方便后续 P2 同样 pattern 接 CLIP）。
 *
 * 输出形状（跟 MobileNetV3 链路对齐，方便上层无感切换）：
 *   { success, predictions:[{index,name,probability,appCategory}], topPrediction, confidence }
 */

import { logger } from '../../adapters/WebAdapters';
import { loadOnnxSession } from '../enhance/loadOnnxSession';
import { PLACES365_CLASSES } from './places365Classes';
import * as ortNS from 'onnxruntime-react-native';

const ort = ortNS.default || ortNS;
const { Tensor } = ort;

// eslint-disable-next-line global-require
const RNFS = require('react-native-fs');
// react-native-image-resizer 用法跟 enhance / classifier 一致
let ImageResizer = null;
try { ImageResizer = require('react-native-image-resizer').default || require('react-native-image-resizer'); }
catch (_) { ImageResizer = null; }

const INPUT_SIZE = 224;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

let _session = null;
let _sessionPath = null;
let _inputName = null;
let _outputName = null;

/** 销毁缓存的 session（用户重新下载模型/换 tier 时调用） */
export function disposePlaces365Session() {
  _session = null;
  _sessionPath = null;
  _inputName = null;
  _outputName = null;
}

async function ensureSession(modelPath) {
  if (_session && _sessionPath === modelPath) return _session;
  logger.debug(`[Places365] 加载模型 ${modelPath}`);
  _session = await loadOnnxSession(modelPath);
  _sessionPath = modelPath;
  // 自动取模型的 input/output 名（防止用户上传的 ONNX 命名不一致）
  _inputName = (_session.inputNames && _session.inputNames[0]) || 'input';
  _outputName = (_session.outputNames && _session.outputNames[0]) || 'output';
  logger.debug(`[Places365] session ready: in=${_inputName} out=${_outputName}`);
  return _session;
}

/** ph:// 或 file:// → 224×224 RGB CHW float32 */
async function preprocessImage(imageUri) {
  if (!ImageResizer) throw new Error('react-native-image-resizer 不可用');
  // resize 到 224×224（直接拉伸；Places365 用方形输入）
  const resized = await ImageResizer.createResizedImage(
    imageUri, INPUT_SIZE, INPUT_SIZE, 'JPEG', 95, 0, undefined, false,
  );
  const path = (resized.uri || '').replace(/^file:\/\//, '');
  const b64 = await RNFS.readFile(path, 'base64');
  // 用 jimp 解 base64 → RGBA pixels
  // eslint-disable-next-line global-require
  const Jimp = require('../enhance/jimpCustom').default || require('../enhance/jimpCustom');
  // eslint-disable-next-line global-require
  const { Buffer } = require('buffer');
  const img = await Jimp.read(Buffer.from(b64, 'base64'));
  const W = img.bitmap.width;
  const H = img.bitmap.height;
  if (W !== INPUT_SIZE || H !== INPUT_SIZE) {
    // 兜底：万一 ImageResizer 没严格 224×224
    img.resize(INPUT_SIZE, INPUT_SIZE);
  }
  const data = img.bitmap.data; // RGBA Uint8
  const chw = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  const HW = INPUT_SIZE * INPUT_SIZE;
  for (let i = 0; i < HW; i++) {
    for (let c = 0; c < 3; c++) {
      const v = data[i * 4 + c] / 255;
      chw[c * HW + i] = (v - MEAN[c]) / STD[c];
    }
  }
  return chw;
}

function softmaxAndTopK(logits, k = 5) {
  const max = Math.max(...logits);
  const exp = new Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) { exp[i] = Math.exp(logits[i] - max); sum += exp[i]; }
  const probs = exp.map((e) => e / sum);
  // top-k by probability
  const idx = probs.map((_, i) => i).sort((a, b) => probs[b] - probs[a]).slice(0, k);
  return idx.map((i) => ({ index: i, probability: probs[i] }));
}

/**
 * 对单张图分类。modelPath 由上层 ensureClassifierModel 解析后传入。
 * @returns {Promise<{success, predictions, topPrediction, confidence, model}>}
 */
export async function classifyImageWithPlaces365(imageUri, modelPath) {
  const t0 = Date.now();
  try {
    const session = await ensureSession(modelPath);
    const chw = await preprocessImage(imageUri);
    const feeds = { [_inputName]: new Tensor('float32', chw, [1, 3, INPUT_SIZE, INPUT_SIZE]) };
    const out = await session.run(feeds);
    const logits = out[_outputName] || out[Object.keys(out)[0]];
    if (!logits || !logits.data) throw new Error('Places365 模型输出为空');

    // logits 长度应为 365
    const arr = Array.from(logits.data);
    if (arr.length !== PLACES365_CLASSES.length) {
      logger.warn(`[Places365] logits 长度 ${arr.length} ≠ 365；按可用数量截断`);
    }
    const top5 = softmaxAndTopK(arr, 5).map((p) => {
      const cls = PLACES365_CLASSES[p.index] || { name: `class_${p.index}`, category: 'other' };
      return {
        index: p.index,
        name: cls.name,
        probability: p.probability,
        appCategory: cls.category,
      };
    });
    const top = top5[0];
    logger.debug(`[Places365] ${imageUri.slice(-30)} → ${top.name}(${top.appCategory}) conf=${top.probability.toFixed(3)} in ${Date.now() - t0}ms`);
    return {
      success: true,
      predictions: top5,
      topPrediction: top,
      confidence: top.probability,
      model: 'places365',
      processingTime: Date.now() - t0,
    };
  } catch (e) {
    logger.error(`[Places365] 推理失败: ${e?.message || e}`);
    return {
      success: false,
      error: e?.message || String(e),
      predictions: [],
      topPrediction: null,
      confidence: 0,
      model: 'places365',
      processingTime: Date.now() - t0,
    };
  }
}

export default { classifyImageWithPlaces365, disposePlaces365Session };
