/**
 * ClipVectorIndexService — CLIP 向量索引（AI 向量维度的以图搜图）
 *
 * 与「颜色维度」（ImageSimilarityService 直方图）互补的第二类相似度：
 *   - 颜色维度：找"长得像"（连拍/翻拍/同场景），零模型依赖
 *   - AI 向量维度：找"内容像"（同是狗，颜色构图无关），需 CLIP 模型（设置→分类模型→CLIP 档下载）
 *
 * 索引：对库内每张图片跑一次 CLIP image encoder（~百毫秒/张），embedding 存 image_embeddings 表。
 * 检索：目标图编码一次 + 全库点积（L2 归一化向量，余弦=点积），毫秒级。
 * 视频也参与：抽中点帧（与分类同策略）编码入索引，「AI 相似」可搜到视频。
 */
import { logger } from '../adapters/WebAdapters';
import UnifiedDataService from './UnifiedDataService';
import i18n from '../i18n';

/** 模型未下载的提示：用设置里的真实档位名（「AI 智能识别」），并跟随界面语言 */
function modelMissingMessage() {
  try {
    return i18n.t('common:search.vectorModelMissing', {
      defaultValue: '需先下载识别模型：设置 → 分类模型 → AI 智能识别',
    });
  } catch (_) {
    return '需先下载识别模型：设置 → 分类模型 → AI 智能识别';
  }
}

class ClipVectorIndexService {
  constructor() {
    this._building = false;
    this._stopRequested = false;
  }

  /** 解析当前 CLIP 模型（用户在设置里选的变体）；未下载返回 null。 */
  async _resolveModel() {
    const { readActiveClipModel } = require('./classify/classifyByTier');
    const { isClassifierModelDownloaded, ensureClassifierModel } = require('./classify/classifierModelSource');
    const clipModel = await readActiveClipModel();
    const downloaded = await isClassifierModelDownloaded(clipModel.filename);
    if (!downloaded) return null;
    const modelPath = await ensureClassifierModel(clipModel.filename, clipModel.url);
    return { clipModel, modelPath };
  }

  /** CLIP 模型是否已下载（决定 UI 是否提供向量检索入口） */
  async isReady() {
    try { return !!(await this._resolveModel()); } catch (_) { return false; }
  }

  /**
   * 取可编码 uri：图片直接用；视频抽中点帧（返回 temp 路径，用后删）。
   * @returns {Promise<{uri:string, temp:string|null}>}
   */
  async _getEncodableUri(img) {
    const { getUri } = require('../adapters/WebAdapters');
    if (!String(img.mimeType || '').startsWith('video/')) {
      return { uri: getUri(img) || img.uri, temp: null };
    }
    const { NativeModules } = require('react-native');
    const pk = NativeModules.PhotoKitModule;
    if (pk && typeof pk.extractVideoFrame === 'function') {
      const localId = String(img.uri || '').replace(/^ph:\/\//, '');
      const p = await pk.extractVideoFrame(localId);
      return { uri: p, temp: p };
    }
    const ms = NativeModules.MediaStoreModule;
    if (ms && typeof ms.extractVideoFrame === 'function') {
      const p = await ms.extractVideoFrame(img.uri || String(img.id || ''));
      return { uri: p, temp: p };
    }
    throw new Error('无可用抽帧模块');
  }

  /** 已建索引数量 / 候选图片总数 */
  async getIndexStats() {
    try {
      const { readActiveClipModel } = require('./classify/classifyByTier');
      const clipModel = await readActiveClipModel();
      const map = await UnifiedDataService.imageStorageService.readAllImageEmbeddings(clipModel.id);
      await UnifiedDataService.imageCache.buildCache();
      const all = UnifiedDataService.imageCache.getCache().allImages || [];
      const candidates = all.filter((i) => i && i.id);   // 视频也参与索引（抽帧编码）
      return { indexed: Object.keys(map).length, total: candidates.length };
    } catch (e) {
      return { indexed: 0, total: 0 };
    }
  }

  requestStop() { this._stopRequested = true; }
  get isBuilding() { return this._building; }

  /** 清空当前模型的向量索引（设置页「重建」用：清空后再 buildIndex 即全量重编） */
  async clearIndex() {
    const { readActiveClipModel } = require('./classify/classifyByTier');
    const clipModel = await readActiveClipModel();
    await UnifiedDataService.imageStorageService.deleteAllImageEmbeddings(clipModel.id);
  }

  /**
   * 建/补向量索引（增量：已有向量的图跳过）。
   * @param {(done:number, total:number)=>void} onProgress
   * @returns {Promise<{indexed:number, skipped:number, failed:number, stopped:boolean}>}
   */
  async buildIndex(onProgress) {
    if (this._building) return { indexed: 0, skipped: 0, failed: 0, stopped: false };
    this._building = true;
    this._stopRequested = false;
    try {
      const resolved = await this._resolveModel();
      if (!resolved) throw new Error(modelMissingMessage());
      const { clipModel, modelPath } = resolved;
      const { getImageEmbedding } = require('./classify/MobileCLIPClassifier');
      const { getUri } = require('../adapters/WebAdapters');

      const existing = await UnifiedDataService.imageStorageService.readAllImageEmbeddings(clipModel.id);
      await UnifiedDataService.imageCache.buildCache();
      const all = UnifiedDataService.imageCache.getCache().allImages || [];
      const todo = all.filter((i) => i && i.id && !existing[i.id]);   // 视频也入索引（抽帧编码）
      const total = todo.length + Object.keys(existing).length;
      let done = Object.keys(existing).length;
      let indexed = 0; let failed = 0; let stopped = false;

      const { RNFS } = require('../adapters/WebAdapters');
      let batch = [];
      for (const img of todo) {
        if (this._stopRequested) { stopped = true; break; }
        let temp = null;
        try {
          const enc = await this._getEncodableUri(img);
          temp = enc.temp;
          if (!enc.uri) { failed++; continue; }
          const vec = await getImageEmbedding(enc.uri, modelPath, clipModel);
          batch.push({ imageId: img.id, vec });
          indexed++;
        } catch (e) {
          failed++;
          logger.debug(`[ClipIndex] 编码失败 ${img.fileName || img.id}: ${e?.message || e}`);
        } finally {
          if (temp) { try { await RNFS.unlink(temp.replace(/^file:\/\//, '')); } catch (_) {} }
        }
        done++;
        if (batch.length >= 20) {
          await UnifiedDataService.imageStorageService.saveImageEmbeddingsBatch(batch, clipModel.id);
          batch = [];
        }
        if (onProgress && (done % 5 === 0 || done === total)) onProgress(done, total);
      }
      if (batch.length > 0) {
        await UnifiedDataService.imageStorageService.saveImageEmbeddingsBatch(batch, clipModel.id);
      }
      logger.info(`[ClipIndex] 建索引完成: +${indexed} 失败 ${failed} 停止=${stopped}`);
      return { indexed, skipped: Object.keys(existing).length, failed, stopped };
    } finally {
      this._building = false;
      this._stopRequested = false;
      // 释放 CLIP ONNX session：避免与本地分类（尤其 Gemma 多模态 2.6GB）并发驻留内存导致
      // 安卓 OOM 崩溃；下次建索引/CLIP 分类时自动重载（~1s 一次性成本）。
      try {
        const { disposeMobileCLIPSession } = require('./classify/MobileCLIPClassifier');
        disposeMobileCLIPSession();
      } catch (_) {}
    }
  }

  /**
   * 向量检索：目标图（库内记录或任意 uri）→ 编码 → 全库余弦排序。
   * @param {{id?:string, uri:string}} image
   * @returns {Promise<{results:Array, indexed:number}>} results 含 vectorScore
   */
  // minScore 0.6：用户真机校准（2026-06-10）——60% 以上才算"像"，以下观感开始跑题。
  // MobileCLIP 图-图余弦量纲：同场景 0.8+、同类不同张 0.5~0.7、无关 <0.3。
  async search(image, { limit = 60, minScore = 0.6 } = {}) {
    const resolved = await this._resolveModel();
    if (!resolved) throw new Error(modelMissingMessage());
    const { clipModel, modelPath } = resolved;
    const { getImageEmbedding, cosineSimilarity } = require('./classify/MobileCLIPClassifier');
    const { getUri } = require('../adapters/WebAdapters');

    const map = await UnifiedDataService.imageStorageService.readAllImageEmbeddings(clipModel.id);
    let target = image.id ? map[image.id] : null;
    if (!target) {
      const uri = getUri(image) || image.uri;
      target = await getImageEmbedding(uri, modelPath, clipModel);
      if (image.id) {
        UnifiedDataService.imageStorageService
          .saveImageEmbeddingsBatch([{ imageId: image.id, vec: target }], clipModel.id).catch(() => {});
      }
    }
    await UnifiedDataService.imageCache.buildCache();
    const all = UnifiedDataService.imageCache.getCache().allImages || [];
    const byId = new Map(all.map((i) => [i.id, i]));
    const scored = [];
    for (const [id, vec] of Object.entries(map)) {
      if (id === image.id) continue;
      const rec = byId.get(id);
      if (!rec) continue;
      const score = cosineSimilarity(target, vec);
      if (score >= minScore) scored.push({ ...rec, vectorScore: score });
    }
    scored.sort((a, b) => b.vectorScore - a.vectorScore);
    return { results: scored.slice(0, limit), indexed: Object.keys(map).length };
  }
}

export default new ClipVectorIndexService();
