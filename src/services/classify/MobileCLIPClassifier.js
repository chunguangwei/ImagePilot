/**
 * MobileCLIPClassifier — P2-lite：CLIP image encoder（设备端） + 9 个 app 类
 * 的 text embeddings（云端预算 / 内嵌 JS）→ 余弦相似度 → 分类。
 *
 * 为什么这么做：CLIP 全套（image + text encoder + BPE tokenizer）在 Hermes 上
 * 跑得起来但是工程量大，且 P2 的"用户自定义类离线生效"在用户侧已经走云端 LLM。
 * P2-lite 只在 inference 时用图编码器，文本侧一次性离线算好 9 类原型（prompt
 * ensemble + L2 normed），让分类质量在不增加设备端 tokenizer/解码复杂度的前提下
 * 比 MobileNetV3-ImageNet 在抽象场景上明显更稳。
 *
 * 期望 ONNX：
 *   input  name='image'    shape=[1,3,H,W]    (H/W 由 EMBED_META.input_size)
 *   output name='embedding' shape=[1, D]       已经 L2 norm 过（导出脚本里做了）
 *
 * 文本侧：clipTextEmbeddings.*.json 是导出脚本的产物，结构：
 *   { _meta: {model, input_size, mean, std, embed_dim, categories[]},
 *     embeddings: { [appCategory]: [float, ...] } }
 */

import { logger } from '../../adapters/WebAdapters';
import { loadOnnxSession } from '../enhance/loadOnnxSession';
import * as ortNS from 'onnxruntime-react-native';
import TEXT_EMBEDS from './clipTextEmbeddings.mobileclip2_s2.json';
import { getClipModel, DEFAULT_CLIP_MODEL } from './clipModels';

const ort = ortNS.default || ortNS;
const { Tensor } = ort;

// eslint-disable-next-line global-require
const RNFS = require('react-native-fs');
let ImageResizer = null;
try { ImageResizer = require('react-native-image-resizer').default || require('react-native-image-resizer'); }
catch (_) { ImageResizer = null; }

// CLIP 档现在按「用户所选模型」动态取配置（embeddings/meta/阈值），而非写死单一模型。
// buildCfg 把一个 clipModel 变体归一成推理需要的配置；不传则用默认（新 MobileCLIP2-S2）。
// 阈值 minSim：top1 cosine ≥ minSim 才采纳，否则落 other。MobileCLIP 系 cosine 量纲 ~0.20，
// 由 clipModels.js 提供（不同模型若量纲不同需各自标定）。
function buildCfg(clipModel) {
  const emb = (clipModel && clipModel.embeddings) || TEXT_EMBEDS;
  const meta = emb._meta || {};
  return {
    textEmbeds: emb,
    inputSize: meta.input_size || 256,
    mean: meta.mean || [0, 0, 0],
    std: meta.std || [1, 1, 1],
    embedDim: meta.embed_dim || 512,
    categories: meta.categories || Object.keys(emb.embeddings || {}),
    minSim: (clipModel && typeof clipModel.minSim === 'number') ? clipModel.minSim : 0.20,
  };
}

const DEFAULT_CFG = buildCfg(getClipModel(DEFAULT_CLIP_MODEL));

let _session = null;
let _sessionPath = null;
let _inputName = null;
let _outputName = null;

/** 用户重新下载模型 / 换 tier 时释放缓存的 session */
export function disposeMobileCLIPSession() {
  _session = null;
  _sessionPath = null;
  _inputName = null;
  _outputName = null;
}

async function ensureSession(modelPath) {
  if (_session && _sessionPath === modelPath) return _session;
  logger.debug(`[MobileCLIP] 加载 image encoder ${modelPath}`);
  _session = await loadOnnxSession(modelPath);
  _sessionPath = modelPath;
  _inputName = (_session.inputNames && _session.inputNames[0]) || 'image';
  _outputName = (_session.outputNames && _session.outputNames[0]) || 'embedding';
  logger.debug(`[MobileCLIP] session ready in=${_inputName} out=${_outputName}`);
  return _session;
}

/** ph:// / file:// → INPUT_SIZE×INPUT_SIZE CHW float32（CLIP 归一）
 *
 * 关键：CLIP 训练用的是「短边缩放 + 居中裁剪到正方形」，不是拉伸。早期实现用
 * ImageResizer(contain) 缩出非正方形后再 Jimp.resize 拉伸成正方形——既畸变图像，
 * 又因两端原生 resize 的舍入/采样差异让安卓比 iOS 差。现在改为：
 *   1) ImageResizer 仅负责「按 EXIF 摆正 + 降到合理尺寸（cover 模式，保宽高比填满）」；
 *   2) 最终的 cover(居中裁剪到 INPUT_SIZE 正方形) 在纯 JS 的 Jimp 里做，两端完全一致，
 *      消除平台差异，并与 CLIP 预处理对齐。
 */
async function preprocessImage(imageUri, cfg) {
  const INPUT_SIZE = cfg.inputSize, MEAN = cfg.mean, STD = cfg.std;
  if (!ImageResizer) throw new Error('react-native-image-resizer 不可用');
  // mode:'cover' → 输出短边≥INPUT_SIZE、保宽高比（不拉伸）；原生只做摆正+降采样。
  const resized = await ImageResizer.createResizedImage(
    imageUri, INPUT_SIZE, INPUT_SIZE, 'JPEG', 95, 0, undefined, false, { mode: 'cover' },
  );
  const path = (resized.uri || '').replace(/^file:\/\//, '');
  const b64 = await RNFS.readFile(path, 'base64');
  // eslint-disable-next-line global-require
  const Jimp = require('../enhance/jimpCustom').default || require('../enhance/jimpCustom');
  // eslint-disable-next-line global-require
  const { Buffer } = require('buffer');
  const img = await Jimp.read(Buffer.from(b64, 'base64'));
  const srcW = img.bitmap.width, srcH = img.bitmap.height;
  // cover：缩放填满目标尺寸后居中裁剪 → 正方形，保宽高比不拉伸（纯 JS，两端一致）。
  if (srcW !== INPUT_SIZE || srcH !== INPUT_SIZE) {
    img.cover(INPUT_SIZE, INPUT_SIZE);
  }
  const data = img.bitmap.data; // RGBA Uint8
  const chw = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  const HW = INPUT_SIZE * INPUT_SIZE;
  let sum0 = 0, sum1 = 0, sum2 = 0; // 诊断：每通道归一后均值
  for (let i = 0; i < HW; i++) {
    for (let c = 0; c < 3; c++) {
      const v = data[i * 4 + c] / 255;
      const nv = (v - MEAN[c]) / STD[c];
      chw[c * HW + i] = nv;
      if (c === 0) sum0 += nv; else if (c === 1) sum1 += nv; else sum2 += nv;
    }
  }
  logger.debug(`[MobileCLIP] preprocess src=${srcW}x${srcH}→${INPUT_SIZE} chwMean=[${(sum0 / HW).toFixed(3)},${(sum1 / HW).toFixed(3)},${(sum2 / HW).toFixed(3)}]`);
  return chw;
}

/** 余弦相似度（两侧都假设已 L2 norm，直接点积） */
function cosineSim(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * 单张图 → top1 app 类。
 * @returns {Promise<{success, predictions, topPrediction, confidence, model, processingTime}>}
 */
export async function classifyImageWithMobileCLIP(imageUri, modelPath, clipModel, opts = {}) {
  const t0 = Date.now();
  // 按用户所选模型解析配置（input_size/mean/std/embed_dim/categories/minSim/embeddings）。
  const cfg = clipModel ? buildCfg(clipModel) : DEFAULT_CFG;
  // 被用户删除的内置分类：从候选集中剔除，避免把图归进已删分类（最优剩余仍 < 阈值则落 NA/待分类）。
  const exclude = opts.excludeCategories instanceof Set
    ? opts.excludeCategories
    : new Set(Array.isArray(opts.excludeCategories) ? opts.excludeCategories : []);
  try {
    const session = await ensureSession(modelPath);
    const chw = await preprocessImage(imageUri, cfg);
    const feeds = { [_inputName]: new Tensor('float32', chw, [1, 3, cfg.inputSize, cfg.inputSize]) };
    const out = await session.run(feeds);
    const embT = out[_outputName] || out[Object.keys(out)[0]];
    if (!embT || !embT.data) throw new Error('CLIP 图编码器输出为空');
    const emb = Array.from(embT.data);
    if (emb.length !== cfg.embedDim) {
      logger.warn(`[MobileCLIP] embed_dim mismatch: ONNX=${emb.length} JSON=${cfg.embedDim}`);
    }

    // 各 app 类相似度 → 排序。多原型：embeddings[cat] 是「一组原型向量」，取该类所有原型
    // 的最大余弦（任一子概念命中即归该类，召回更高）；兼容旧的「单向量」格式。
    const scored = cfg.categories
      .filter((cat) => !exclude.has(cat))   // 跳过被删除的内置分类
      .map((cat) => {
        const ref = cfg.textEmbeds.embeddings[cat];
        let sim = -1;
        if (Array.isArray(ref) && Array.isArray(ref[0])) {
          for (let k = 0; k < ref.length; k++) { const s = cosineSim(emb, ref[k]); if (s > sim) sim = s; }
        } else if (Array.isArray(ref)) {
          sim = cosineSim(emb, ref);
        }
        return { index: cfg.categories.indexOf(cat), name: cat, probability: sim, appCategory: cat };
      }).sort((a, b) => b.probability - a.probability);

    // 全部候选被删除（极端情况）→ 直接落 NA/待分类，避免空数组取 [0] 崩溃。
    if (scored.length === 0) {
      return {
        success: true,
        predictions: [],
        topPrediction: { index: -1, name: 'NA', appCategory: 'NA', probability: 0 },
        confidence: 0,
        model: 'mobileclip',
        processingTime: Date.now() - t0,
      };
    }

    const top = scored[0];
    const adopt = top.probability >= cfg.minSim ? top : {
      ...top,
      name: 'other',
      appCategory: 'other',
    };

    logger.debug(`[MobileCLIP] ${imageUri.slice(-30)} → ${adopt.appCategory} sim=${top.probability.toFixed(3)} in ${Date.now() - t0}ms`);

    return {
      success: true,
      predictions: scored.slice(0, 5),
      topPrediction: adopt,
      confidence: top.probability,
      model: 'mobileclip',
      processingTime: Date.now() - t0,
    };
  } catch (e) {
    logger.error(`[MobileCLIP] 推理失败: ${e?.message || e}`);
    return {
      success: false,
      error: e?.message || String(e),
      predictions: [],
      topPrediction: null,
      confidence: 0,
      model: 'mobileclip',
      processingTime: Date.now() - t0,
    };
  }
}

export default { classifyImageWithMobileCLIP, disposeMobileCLIPSession };
