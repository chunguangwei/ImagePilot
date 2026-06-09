/**
 * classifyByTier — 按用户在 Settings 选的分类模型档位路由到对应 classifier。
 *
 * 三档（见 classifierModelTiers.js）：
 *   - basic  → MobileNetV3-ImageNet（沿用现有 ImageClassifierService.classifyImageWithMobileNetV3）
 *   - scene  → Places365Classifier.classifyImageWithPlaces365（P1）
 *   - clip   → MobileCLIPClassifier.classifyImageWithMobileCLIP（P2-lite：image encoder + 9 类 precomputed text embeds）
 *
 * 模型下载/缺失时回退 basic（confidence 改 'fallback'，方便上层显示提示）。
 *
 * 返回形状统一：
 *   {
 *     engine: 'imagenet' | 'places365' | 'clip',
 *     topPrediction: { name, appCategory } | null,  // appCategory 是 9 app 类
 *     confidence: number,                            // 0~1
 *     fallback?: 'no-model' | 'engine-error'         // 若回退基础档，标明原因
 *   }
 *
 * 上层（GalleryScanner）拿 topPrediction.appCategory 直接落 DB，不再过
 * mapMobileNetV3ToAppCategory（对 places365/clip 没意义）。basic 引擎仍走老
 * mapping 链路（兼容）。
 */

import { logger } from '../../adapters/WebAdapters';
import UnifiedDataService from '../UnifiedDataService';
import { CLASSIFIER_TIERS, DEFAULT_CLASSIFIER_TIER } from './classifierModelTiers';
import { getClipModel, DEFAULT_CLIP_MODEL } from './clipModels';
import { getVlmModel, DEFAULT_VLM_MODEL, VLM_MODEL_ORDER } from './vlmModels';
import { ensureClassifierModel, isClassifierModelDownloaded, ensureLargeModel, isLargeModelComplete } from './classifierModelSource';

let _places365Mod = null;
let _mobileClipMod = null;
let _vlmMod = null;
let _imageClassifierSingleton = null;

/** 优先用 scanner 传入的现有实例（避免重复加载 ONNX 模型）；没传退回单例 */
function getImageClassifier(maybeShared) {
  if (maybeShared) return maybeShared;
  if (_imageClassifierSingleton) return _imageClassifierSingleton;
  // eslint-disable-next-line global-require
  const Mod = require('../ImageClassifierService').default || require('../ImageClassifierService');
  _imageClassifierSingleton = new Mod();
  return _imageClassifierSingleton;
}

/** 从 settings 读取用户选的 tier；缺/无效都兜底 basic */
export async function readActiveTier() {
  try {
    const s = await UnifiedDataService.readSettings();
    const t = s?.classifierModelTier || DEFAULT_CLASSIFIER_TIER;
    return CLASSIFIER_TIERS[t] ? t : DEFAULT_CLASSIFIER_TIER;
  } catch (_) {
    return DEFAULT_CLASSIFIER_TIER;
  }
}

/** 从 settings 读取用户选的 CLIP 模型变体；缺/无效兜底默认（新 MobileCLIP2-S2） */
export async function readActiveClipModel() {
  try {
    const s = await UnifiedDataService.readSettings();
    return getClipModel(s?.classifierClipModel || DEFAULT_CLIP_MODEL);
  } catch (_) {
    return getClipModel(DEFAULT_CLIP_MODEL);
  }
}

/** 从 settings 读取用户选的 VLM 模型变体；缺/无效兜底默认（SmolVLM-500M） */
export async function readActiveVlmModel() {
  try {
    const s = await UnifiedDataService.readSettings();
    return getVlmModel(s?.classifierVlmModel || DEFAULT_VLM_MODEL);
  } catch (_) {
    return getVlmModel(DEFAULT_VLM_MODEL);
  }
}

/**
 * 对单张图分类，按 tier 路由。
 * @param imageUri  ph:// 或 file:// URI
 * @param tier      'basic' / 'scene' / 'clip'；null 则读 settings
 * @param opts.imageClassifier  scanner 现有 ImageClassifierService 实例（避免重复加载 ONNX 模型）
 */
export async function classifyImageByTier(imageUri, tier = null, opts = {}) {
  const activeTier = tier || (await readActiveTier());
  const tierCfg = CLASSIFIER_TIERS[activeTier] || CLASSIFIER_TIERS[DEFAULT_CLASSIFIER_TIER];
  const sharedClassifier = opts.imageClassifier;

  if (tierCfg.engine === 'imagenet') {
    // basic 现在也走 Release 按需下载（同 scene/clip 一致；APK/.ipa 不打包模型）
    const downloaded = await isClassifierModelDownloaded(tierCfg.filename);
    if (!downloaded) {
      logger.warn(`[classifyByTier] basic 档模型未下载`);
      return {
        engine: 'imagenet',
        topPrediction: null,
        confidence: 0,
        predictions: [],
        fallback: 'no-model',
      };
    }
    return await runImageNet(imageUri, sharedClassifier);
  }
  if (tierCfg.engine === 'places365') {
    const downloaded = await isClassifierModelDownloaded(tierCfg.filename);
    if (!downloaded) {
      logger.warn(`[classifyByTier] scene tier 模型未下载，回退 basic`);
      const r = await runImageNet(imageUri, sharedClassifier);
      return { ...r, fallback: 'no-model' };
    }
    try {
      const modelPath = await ensureClassifierModel(tierCfg.filename, tierCfg.url);
      if (!_places365Mod) {
        // eslint-disable-next-line global-require
        _places365Mod = require('./Places365Classifier');
      }
      const r = await _places365Mod.classifyImageWithPlaces365(imageUri, modelPath);
      if (!r.success) {
        const fb = await runImageNet(imageUri, sharedClassifier);
        return { ...fb, fallback: 'engine-error' };
      }
      return {
        engine: 'places365',
        topPrediction: r.topPrediction ? {
          name: r.topPrediction.name,
          appCategory: r.topPrediction.appCategory,
        } : null,
        confidence: r.confidence,
        predictions: r.predictions,
      };
    } catch (e) {
      logger.warn(`[classifyByTier] places365 失败回退 basic: ${e?.message || e}`);
      const fb = await runImageNet(imageUri, sharedClassifier);
      return { ...fb, fallback: 'engine-error' };
    }
  }
  if (tierCfg.engine === 'clip') {
    // clip 档具体用哪个模型由用户在设置里选（默认新 MobileCLIP2-S2）；下载/推理都按所选变体。
    const clipModel = await readActiveClipModel();
    const downloaded = await isClassifierModelDownloaded(clipModel.filename);
    if (!downloaded) {
      logger.warn(`[classifyByTier] clip 模型(${clipModel.id})未下载，回退 basic`);
      const r = await runImageNet(imageUri, sharedClassifier);
      return { ...r, fallback: 'no-model' };
    }
    try {
      const modelPath = await ensureClassifierModel(clipModel.filename, clipModel.url);
      if (!_mobileClipMod) {
        // eslint-disable-next-line global-require
        _mobileClipMod = require('./MobileCLIPClassifier');
      }
      // 分类一律落真实分类；被删内置分类的隐藏由展示层统一映射到「待分类」（可逆）。
      const r = await _mobileClipMod.classifyImageWithMobileCLIP(imageUri, modelPath, clipModel);
      if (!r.success) {
        const fb = await runImageNet(imageUri, sharedClassifier);
        return { ...fb, fallback: 'engine-error' };
      }
      return {
        engine: 'clip',
        topPrediction: r.topPrediction ? {
          name: r.topPrediction.name,
          appCategory: r.topPrediction.appCategory,
        } : null,
        confidence: r.confidence,
        predictions: r.predictions,
      };
    } catch (e) {
      logger.warn(`[classifyByTier] clip 失败回退 basic: ${e?.message || e}`);
      const fb = await runImageNet(imageUri, sharedClassifier);
      return { ...fb, fallback: 'engine-error' };
    }
  }
  if (tierCfg.engine === 'vlm') {
    // vlm 档：优先用所选变体；若所选变体没下全（如刚切到 Qwen 还在下），自动改用另一个已下好的变体，
    // 避免静默回退到 basic（那样 VLM 完全不生效、也没 AI 描述）。
    // 就绪 = 该变体所有文件都下全。Gemma 单文件（无 mmproj）/ Qwen 双文件，统一按 files 数组判断。
    const filesOf = (vm) => [vm && vm.model, vm && vm.mmproj].filter(Boolean);
    const isReady = async (vm) => {
      if (!vm) return false;
      for (const f of filesOf(vm)) {
        // eslint-disable-next-line no-await-in-loop
        if (!(await isLargeModelComplete(f.filename, f.bytes))) return false;
      }
      return true;
    };
    let vlmModel = await readActiveVlmModel();
    if (!(await isReady(vlmModel))) {
      let alt = null;
      for (const id of VLM_MODEL_ORDER) {
        const cand = getVlmModel(id);
        // eslint-disable-next-line no-await-in-loop
        if (await isReady(cand)) { alt = cand; break; }
      }
      if (alt) {
        logger.warn(`[classifyByTier] vlm 所选变体(${vlmModel.id})未下全，改用已就绪的 ${alt.id}`);
        vlmModel = alt;
      } else {
        logger.warn(`[classifyByTier] vlm 无任何变体下载齐，回退 basic`);
        const r = await runImageNet(imageUri, sharedClassifier);
        return { ...r, fallback: 'no-model' };
      }
    }
    try {
      const modelUri = await ensureLargeModel(vlmModel.model.filename, vlmModel.model.url, undefined, { expectedBytes: vlmModel.model.bytes });
      // Gemma 无 mmproj；仅 Qwen 需要
      let mmprojUri;
      if (vlmModel.mmproj) {
        mmprojUri = await ensureLargeModel(vlmModel.mmproj.filename, vlmModel.mmproj.url, undefined, { expectedBytes: vlmModel.mmproj.bytes });
      }
      if (!_vlmMod) {
        // eslint-disable-next-line global-require
        _vlmMod = require('./VLMClassifier');
      }
      const r = await _vlmMod.classifyImageWithVLM(imageUri, { model: modelUri, mmproj: mmprojUri }, vlmModel);
      if (!r.success) {
        const fb = await runImageNet(imageUri, sharedClassifier);
        return { ...fb, fallback: 'engine-error' };
      }
      return {
        engine: 'vlm',
        topPrediction: r.topPrediction ? {
          name: r.topPrediction.name,
          appCategory: r.topPrediction.appCategory,
        } : null,
        confidence: r.confidence,
        predictions: r.predictions,
        vlmLabel: r.vlmLabel || null,   // 归不进已有类时模型自拟的标签（落 other + 打标签）
      };
    } catch (e) {
      logger.warn(`[classifyByTier] vlm 失败回退 basic: ${e?.message || e}`);
      const fb = await runImageNet(imageUri, sharedClassifier);
      return { ...fb, fallback: 'engine-error' };
    }
  }
  const fb = await runImageNet(imageUri, sharedClassifier);
  return { ...fb, fallback: 'engine-error' };
}

async function runImageNet(imageUri, sharedClassifier) {
  const ic = getImageClassifier(sharedClassifier);
  let r;
  try {
    r = await ic.classifyImageWithMobileNetV3(imageUri);
  } catch (e) {
    // 下载失败 / 模型损坏 / 推理崩 — 统一空结果，上层 scanner 会落 unclassified
    logger.warn(`[classifyByTier] basic 推理失败: ${e?.message || e}`);
    return { engine: 'imagenet', topPrediction: null, confidence: 0, predictions: [], fallback: 'engine-error' };
  }
  if (!r || !r.success) {
    return { engine: 'imagenet', topPrediction: null, confidence: 0, predictions: [] };
  }
  // 给 top1 求 appCategory（沿用既有映射）
  const top = r.topPrediction;
  const appCat = top && typeof ic.mapMobileNetV3ToAppCategory === 'function'
    ? (ic.mapMobileNetV3ToAppCategory(top.class) || 'other')
    : 'other';
  return {
    engine: 'imagenet',
    topPrediction: top ? { name: top.class, appCategory: appCat } : null,
    confidence: r.confidence,
    predictions: r.predictions,
  };
}

export default { classifyImageByTier, readActiveTier };
