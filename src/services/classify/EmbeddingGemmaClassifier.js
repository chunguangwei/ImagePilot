import { NativeModules, Platform } from 'react-native';
import { categoryDescription, categoryEmbeddingTexts } from './categorySemantics';
import { getCategoryList, currentLang, prepareImageFile, cleanupTmp } from './vlmShared';

// Keep native requests and disposal ordered, including simultaneous single-photo requests.
let pending = Promise.resolve();
let categoryCache = null;
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
        for (const references of texts) {
          const encoded = [];
          for (const text of references) encoded.push(normalize(await native.embed(modelPath, text, '')));
          vectors.push(encoded);
        }
        // Publish only a fully encoded cache; failed encodes must be retried.
        categoryCache = { key, vectors };
      }
      const vector = normalize(await native.embed(modelPath, '', imagePath));
      const rank = vector => categories.map((category, index) => {
        const scores = categoryCache.vectors[index].map(reference => {
          if (reference.length !== vector.length) throw new Error('Embedding dimension mismatch');
          return Math.max(-1, Math.min(1, vector.reduce((sum, v, i) => sum + v * reference[i], 0)));
        });
        const similarity = Math.max(...scores);
        return { name: category.id, appCategory: category.id, similarity };
      }).sort((a, b) => b.similarity - a.similarity);
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
      const margin = predictions.length > 1 ? top.similarity - predictions[1].similarity : null;
      // Reject a non-match or numerical tie; do not invent an uncalibrated probability threshold.
      const accepted = top.similarity > 0 && (margin === null || margin > 1e-6);
      const selected = categories.find((c) => c.id === top.appCategory);
      return {
        classificationMode, imageOnlyCategory: imagePredictions[0]?.appCategory, fusionError,
        success: true, engine: 'embeddinggemma2', model: 'embeddinggemma-2-text-vision-440m',
        topPrediction: accepted ? top : null, predictions: predictions.slice(0, 5),
        // This is cosine similarity, not a calibrated probability. Do not apply ImageNet's threshold.
        confidence: Math.max(0, top.similarity), similarity: top.similarity,
        classificationAccepted: accepted, margin,
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
