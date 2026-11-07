import { BUILD_VERSION } from '../../config/BuildInfo';
import { rankGroupedEvidence, selectHighestDecision } from './embeddingGroups';
import { rankEmbeddingEvidence, embeddingDecision } from './embeddingRanking';
import { NativeModules, Platform } from 'react-native';
import { categoryDescription, categoryEmbeddingTexts, categoryEmbeddingGroups, normalizeCustomMatching } from './categorySemantics';
import { getCategoryList, currentLang, prepareImageFile, cleanupTmp } from './vlmShared';

// Keep native requests and disposal ordered, including simultaneous single-photo requests.
let pending = Promise.resolve();
let categoryCache = null;
// Historical comparison diagnostics only; this margin no longer gates acceptance.
export const EMBEDDING_MIN_MARGIN = 0.005;
// Operational low-match floor, not a calibrated accuracy probability.
export const EMBEDDING_MIN_SIMILARITY = 0.50;
export const EMBEDDING_SCORING_VERSION = 'highest-score-v1';
function serial(work) {
  const result = pending.then(work);
  pending = result.catch(() => {});
  return result;
}
function nativeEngine() {
  const mod = Platform.OS === 'ios' ? NativeModules.LiteRTLMModule : NativeModules.GemmaModule;
  if (!mod || typeof mod.embed !== 'function') {
    throw new Error('Gemma 2 requires the updated native app (LiteRT-LM 0.18.0)');
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
    const groups = categories.map(c => {
      const positive = categoryEmbeddingGroups(c, lang);
      const {exclusions} = normalizeCustomMatching(c);
      const all = exclusions ? [...positive, {id:'exclusion', exclude:true, texts:[exclusions]}] : positive;
      return all.map(g => ({...g, texts:g.texts.map(text => `task: classification | query: ${text}`)}));
    });
    const key = JSON.stringify([modelPath, categories.map((c) => c.id), texts, groups]);
    let imagePath;
    try {
      imagePath = await prepareImageFile(imageUri);
      if (!categoryCache || categoryCache.key !== key) {
        const encodedTexts = new Map();
        const encode = async text => {
          if (!encodedTexts.has(text)) encodedTexts.set(text, normalize(await native.embed(modelPath, text, '')));
          return encodedTexts.get(text);
        };
        const vectors = [];
        const prototypes = [];
        for (const references of texts) {
          const encoded = [];
          for (const text of references) encoded.push(await encode(text));
          prototypes.push(encoded);
          // Equal-weight normalized prototypes avoid one generic reference winning by itself.
          vectors.push(normalize(encoded[0].map((_, index) => encoded.reduce((sum, reference) => sum + reference[index], 0))));
        }
        // Publish only a fully encoded cache; failed encodes must be retried.
        const encodedGroups = [];
        for (const categoryGroups of groups) {
          const encoded = [];
          for (const group of categoryGroups) {
            const references = [];
            for (const text of group.texts) references.push(await encode(text));
            encoded.push({id:group.id,exclude:group.exclude,vectors:references});
          }
          encodedGroups.push(encoded);
        }
        categoryCache = { key, vectors, prototypes, groups:encodedGroups };
      }
      const vector = normalize(await native.embed(modelPath, '', imagePath));
      const rank = vector => {
        const legacy = rankEmbeddingEvidence(vector, categories, categoryCache.vectors, categoryCache.prototypes);
        const legacyDecision = embeddingDecision(legacy, EMBEDDING_MIN_MARGIN);
        const grouped = rankGroupedEvidence(vector, categories, categoryCache.groups);
        return {legacy,legacyDecision,grouped,...selectHighestDecision(grouped,EMBEDDING_MIN_SIMILARITY)};
      };
      const imageAnalysis = rank(vector);
      let analysis = imageAnalysis;
      let classificationMode = 'image';
      let fusionError;
      const caption = typeof options.caption === 'string' ? options.caption.trim() : '';
      if (caption) {
        try {
          // Native multimodal input retains the original pixels; no text-only replacement or invented weights.
          const joint = normalize(await native.embed(modelPath, caption, imagePath));
          analysis = rank(joint);
          classificationMode = 'image-caption';
        } catch (error) {
          fusionError = String(error?.message || error).slice(0, 300);
        }
      }
      const {predictions, margin, rejectionReason} = analysis;
      const {supportMargin,supportCategory,strongestCategory,strongestMargin} = analysis.legacyDecision;
      const top = analysis.candidate;
      const accepted = rejectionReason === null;
      const selected = categories.find((c) => c.id === top?.appCategory);
      return {
        classificationMode, imageOnlyCategory: imageAnalysis.rejectionReason === null ? imageAnalysis.candidate?.appCategory : 'other', fusionError,
        success: true, engine: 'embeddinggemma2', model: 'embeddinggemma-2-text-vision-440m',
        topPrediction: accepted ? top : null, predictions: predictions.filter(p => p.appCategory !== 'other' && !analysis.excludedCategories.includes(p.appCategory)).slice(0, 5),
        // This is cosine similarity, not a calibrated probability. Do not apply ImageNet's threshold.
        confidence: Math.max(0, top?.similarity ?? 0), similarity: top?.similarity ?? 0,
        classificationAccepted: accepted, margin, rejectionReason,
        diagnostics: { appVersion: BUILD_VERSION, platform: Platform.OS, language: lang, inputMaxEdge: 768, visionTokensPerImage: 140,
          scoringVersion: EMBEDDING_SCORING_VERSION, minimumSimilarity: EMBEDDING_MIN_SIMILARITY, excludedCategories: analysis.excludedCategories, supportMargin, supportCategory, strongestCategory, strongestMargin,
          decisionMethod: analysis.method, groupedMargin: analysis.grouped.length > 1 ? analysis.grouped[0].similarity-analysis.grouped[1].similarity : null,
          legacyCategory: analysis.legacy[0].appCategory, legacyRejectionReason: analysis.legacyDecision.rejectionReason,
          categories: predictions.map(p => {
            const index=categories.findIndex(c=>c.id===p.appCategory);
            const legacy=analysis.legacy.find(c=>c.appCategory===p.appCategory);
            const grouped=analysis.grouped.find(c=>c.appCategory===p.appCategory);
            return {id:p.appCategory,similarity:p.similarity,legacySimilarity:legacy.similarity,
              groupedSimilarity:grouped.similarity,matchedGroup:grouped.matchedGroup,
              supportSimilarity:legacy.supportSimilarity,
              references:texts[index].map((text,i)=>({text,similarity:legacy.referenceScores[i]})),
              groups:grouped.groups.map(g=>({id:g.id,exclude:g.exclude,similarity:g.similarity,
                references:groups[index].find(x=>x.id===g.id).texts.map((text,i)=>({text,similarity:g.referenceScores[i]}))}))};
          }) },
        minimumMargin: null, minimumSimilarity: EMBEDDING_MIN_SIMILARITY, scoringVersion: EMBEDDING_SCORING_VERSION,
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
