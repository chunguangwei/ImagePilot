import { NativeModules, Platform } from 'react-native';
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

export function classifyWithEmbeddingGemma(imageUri, modelPath) {
  return serial(async () => {
    const started = Date.now();
    const native = nativeEngine();
    const lang = currentLang();
    const categories = getCategoryList();
    if (!categories.length) throw new Error('No categories available');
    const texts = categories.map((c) => {
      const name = lang === 'en' ? (c.en || c.zh || c.id) : (c.zh || c.en || c.id);
      return `task: classification | text: ${name}${c.rule ? `. ${c.rule.trim()}` : ''}`;
    });
    const key = JSON.stringify([modelPath, categories.map((c) => c.id), texts]);
    let imagePath;
    try {
      imagePath = await prepareImageFile(imageUri);
      if (!categoryCache || categoryCache.key !== key) {
        const vectors = [];
        for (const text of texts) {
          vectors.push(normalize(await native.embed(modelPath, text, '')));
        }
        // Publish only a fully encoded cache; failed encodes must be retried.
        categoryCache = { key, vectors };
      }
      const vector = normalize(await native.embed(modelPath, '', imagePath));
      const predictions = categories.map((category, index) => {
        const reference = categoryCache.vectors[index];
        if (reference.length !== vector.length) throw new Error('Embedding dimension mismatch');
        const similarity = Math.max(-1, Math.min(1, vector.reduce((sum, v, i) => sum + v * reference[i], 0)));
        return { name: category.id, appCategory: category.id, similarity, probability: Math.max(0, similarity) };
      }).sort((a, b) => b.similarity - a.similarity);
      const top = predictions[0];
      return {
        success: true, engine: 'embeddinggemma2', model: 'embeddinggemma-2-text-vision-440m',
        topPrediction: top, predictions: predictions.slice(0, 5),
        // This is cosine similarity, not a calibrated probability. Do not apply ImageNet's threshold.
        confidence: Math.max(0, top.similarity), similarity: top.similarity,
        classificationAccepted: true, processingTime: Date.now() - started,
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
