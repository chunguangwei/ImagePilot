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
import { ensureClassifierModel, isClassifierModelDownloaded } from './classifierModelSource';

let _places365Mod = null;
let _mobileClipMod = null;
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
    const downloaded = await isClassifierModelDownloaded(tierCfg.filename);
    if (!downloaded) {
      logger.warn(`[classifyByTier] clip tier 模型未下载，回退 basic`);
      const r = await runImageNet(imageUri, sharedClassifier);
      return { ...r, fallback: 'no-model' };
    }
    try {
      const modelPath = await ensureClassifierModel(tierCfg.filename, tierCfg.url);
      if (!_mobileClipMod) {
        // eslint-disable-next-line global-require
        _mobileClipMod = require('./MobileCLIPClassifier');
      }
      const r = await _mobileClipMod.classifyImageWithMobileCLIP(imageUri, modelPath);
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
