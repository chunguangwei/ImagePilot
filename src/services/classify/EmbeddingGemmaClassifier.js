import { BUILD_VERSION } from '../../config/BuildInfo';
import { rankEmbeddingEvidence, embeddingDecision } from './embeddingRanking';
import { NativeModules, Platform } from 'react-native';
import { categoryDescription, categoryEmbeddingTexts } from './categorySemantics';
import { getCategoryList, currentLang, prepareImageFile, cleanupTmp } from './vlmShared';

// Keep native requests and disposal ordered, including simultaneous single-photo requests.
let pending = Promise.resolve();
let categoryCache = null;
// Conservative ambiguity band, not a calibrated accuracy/probability threshold.
export const EMBEDDING_MIN_MARGIN = 0.005;
export const EMBEDDING_SCORING_VERSION = 'prototype-consensus-v3';
function serial(work) {
  const result = pending.then(work);
  pending = result.catch(() => {});
  return result;
}
function nativeEngine() {
  const mod = Platform.OS === 'ios' ? NativeModules.LiteRTLMModule : NativeModules.GemmaModule;
  if (!mod || typeof mod.embed !== 'function') {
    throw new Error('EmbeddingGemma 2 requires the updated native app (LiteRT-LM 0.18.0)');
  }
  return mod;
}
function normalize(vector) {
  if (!Array.isArray(vector) || !vector.length || vector.some((v) => !Number.isFinite(v))) {
    throw new Error('Invalid embedding vector');
  }
  const norm = Math.hypot(...vector);
  if (!(norm > 0)) throw new Error('Empty embedding vector');
  return vector.map((v) => v / norm);
}

export function classifyWithEmbeddingGemma(imageUri, modelPath, options = {}) {
  return serial(async () => {
    const started = Date.now();
    const native = nativeEngine();
    const lang = currentLang();
    const categories = getCategoryList();
    if (!categories.length) throw new Error('No categories available');
    const texts = categories.map((c) => categoryEmbeddingTexts(c, lang).map(text => `task: classification | query: ${text}`));
    const key = JSON.stringify([modelPath, categories.map((c) => c.id), texts]);
    let imagePath;
    try {
      imagePath = await prepareImageFile(imageUri);
      if (!categoryCache || categoryCache.key !== key) {
        const vectors = [];
        const prototypes = [];
        for (const references of texts) {
          const encoded = [];
          for (const text of references) encoded.push(normalize(await native.embed(modelPath, text, '')));
          prototypes.push(encoded);
          // Equal-weight normalized prototypes avoid one generic reference winning by itself.
          vectors.push(normalize(encoded[0].map((_, index) => encoded.reduce((sum, reference) => sum + reference[index], 0))));
        }
        // Publish only a fully encoded cache; failed encodes must be retried.
        categoryCache = { key, vectors, prototypes };
      }
      const vector = normalize(await native.embed(modelPath, '', imagePath));
      const rank = vector => rankEmbeddingEvidence(vector, categories, categoryCache.vectors, categoryCache.prototypes);
      const imagePredictions = rank(vector);
      let predictions = imagePredictions;
      let classificationMode = 'image';
      let fusionError;
      const caption = typeof options.caption === 'string' ? options.caption.trim() : '';
      if (caption) {
        try {
          // Native multimodal input retains the original pixels; no text-only replacement or invented weights.
          const joint = normalize(await native.embed(modelPath, caption, imagePath));
          predictions = rank(joint);
          classificationMode = 'image-caption';
        } catch (error) {
          fusionError = String(error?.message || error).slice(0, 300);
        }
      }
      const top = predictions[0];
      const { margin, supportMargin, supportCategory, strongestCategory, strongestMargin, rejectionReason } = embeddingDecision(predictions, EMBEDDING_MIN_MARGIN);
      const accepted = rejectionReason === null;
      const selected = categories.find((c) => c.id === top.appCategory);
      return {
        classificationMode, imageOnlyCategory: imagePredictions[0]?.appCategory, fusionError,
        success: true, engine: 'embeddinggemma2', model: 'embeddinggemma-2-text-vision-440m',
        topPrediction: accepted ? top : null, predictions: predictions.slice(0, 5),
        // This is cosine similarity, not a calibrated probability. Do not apply ImageNet's threshold.
        confidence: Math.max(0, top.similarity), similarity: top.similarity,
        classificationAccepted: accepted, margin, rejectionReason,
        diagnostics: { appVersion: BUILD_VERSION, platform: Platform.OS, language: lang, inputMaxEdge: 768,
          scoringVersion: EMBEDDING_SCORING_VERSION, supportMargin, supportCategory, strongestCategory, strongestMargin,
          categories: predictions.map(p => ({ id: p.appCategory, similarity: p.similarity,
            supportSimilarity: p.supportSimilarity, references: texts[categories.findIndex(c => c.id === p.appCategory)]
              .map((text, i) => ({ text, similarity: p.referenceScores[i] })) })) },
        minimumMargin: EMBEDDING_MIN_MARGIN, scoringVersion: EMBEDDING_SCORING_VERSION,
        categoryDescription: accepted ? categoryDescription(selected, lang) : '',
        processingTime: Date.now() - started,
      };
    } finally {
      if (imagePath) await cleanupTmp(imagePath);
    }
  });
}

export function disposeEmbeddingGemma() {
  return serial(async () => {
    categoryCache = null;
    const mod = Platform.OS === 'ios' ? NativeModules.LiteRTLMModule : NativeModules.GemmaModule;
    if (mod && typeof mod.release === 'function') await mod.release();
  });
}
