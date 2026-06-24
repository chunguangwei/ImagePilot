/**
 * clipImageSearch（桌面端 / Electron）——「CLIP 以图搜图」独立 service
 *
 * 为什么单独一份：移动端的 ClipVectorIndexService / MobileCLIPClassifier 静态 import
 * onnxruntime-react-native / RNFS / ImageResizer / Jimp（桌面被打成空桩，调用即崩），
 * 且向量存在 imageStorage 里。本文件把那套「CLIP 预处理 + ONNX 编码 + 增量建索引 +
 * 点积检索」的逻辑移植到桌面：
 *   - encoder 走 onnxruntime-node/web（ModelPathAdapter.loadOnnxRuntime）；
 *   - 预处理走 ImageProcessor.getPixelData（Canvas，桌面 file:// → blob）；
 *   - 模型下载走 Electron 主进程 IPC（clip-download-model / clip-model-status）；
 *   - 向量存自己独立的 IndexedDB 库（imagepilot-clip），不碰 imageStorage；
 *   - 视频静默跳过（桌面无抽帧）。
 *
 * 严格不改移动端、不改 imageStorage / ClipVectorIndexService / MobileCLIPClassifier /
 * classifierModelSource——它们继续服务移动端。
 */
import { logger, ModelPathAdapter } from '../../adapters/WebAdapters';
import imageProcessor from '../ImageProcessor';
import UnifiedDataService from '../UnifiedDataService';
import { getClipModel, DEFAULT_CLIP_MODEL } from '../classify/clipModels';
// eslint-disable-next-line global-require
const TEXT_EMBEDS = require('../classify/clipTextEmbeddings.mobileclip2_s2.json');

const CLIP_MODEL = getClipModel(DEFAULT_CLIP_MODEL);
const META = TEXT_EMBEDS._meta || {};
const INPUT_SIZE = META.input_size || 256;
const MEAN = META.mean || [0, 0, 0];
const STD = META.std || [1, 1, 1];

const DB_NAME = 'imagepilot-clip';
const STORE = 'embeddings';

/** 余弦相似度（两侧已 L2 归一 → 点积即余弦） */
function cosineSim(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function getIpcRenderer() {
  // 照 SettingsScreen.desktop.js：window.require('electron')
  const { ipcRenderer } = window.require('electron');
  return ipcRenderer;
}

function isVideoRecord(img) {
  return String((img && img.mimeType) || '').startsWith('video/');
}

class ClipImageSearchDesktop {
  constructor() {
    this._building = false;
    this._stopRequested = false;
    // ONNX session 单例缓存
    this._session = null;
    this._inputName = null;
    this._outputName = null;
    this._ort = null;
    // IndexedDB 句柄缓存
    this._db = null;
  }

  get isBuilding() { return this._building; }
  requestStop() { this._stopRequested = true; }

  // ───────────────────────── 模型下载 / 就绪 ─────────────────────────

  /** 模型是否已下载（决定是否提供入口 / 是否需要先下载） */
  async isReady() {
    try {
      const ipc = getIpcRenderer();
      const res = await ipc.invoke('clip-model-status', { filename: CLIP_MODEL.filename });
      return !!(res && res.exists);
    } catch (e) {
      logger.warn(`[ClipDesktop] isReady 失败: ${e && e.message ? e.message : e}`);
      return false;
    }
  }

  /**
   * 确保模型已下载，返回模型绝对路径。
   * @param {(ratio:number)=>void} onProgress 0~1
   * @returns {Promise<string>} absPath
   */
  async ensureModel(onProgress) {
    const ipc = getIpcRenderer();
    const status = await ipc.invoke('clip-model-status', { filename: CLIP_MODEL.filename });
    if (status && status.exists && status.path) return status.path;

    return new Promise((resolve, reject) => {
      const onProg = (_event, payload) => {
        if (onProgress && payload && typeof payload.ratio === 'number') {
          try { onProgress(payload.ratio); } catch (_) {}
        }
      };
      const onResult = (_event, payload) => {
        ipc.removeListener('clip-download-progress', onProg);
        ipc.removeListener('clip-download-result', onResult);
        if (payload && payload.success && payload.path) resolve(payload.path);
        else reject(new Error((payload && payload.error) || '模型下载失败'));
      };
      ipc.on('clip-download-progress', onProg);
      ipc.on('clip-download-result', onResult);
      ipc.send('clip-download-model', { url: CLIP_MODEL.url, filename: CLIP_MODEL.filename });
    });
  }

  // ───────────────────────── ONNX 编码 ─────────────────────────

  /** 懒加载 ONNX session（buffer 方式：模型在 userData 不在 public，web ort 不能读文件路径） */
  async _ensureSession() {
    if (this._session) return this._session;
    const absPath = await this.ensureModel();
    // eslint-disable-next-line global-require
    const fs = window.require('fs');
    const buf = fs.readFileSync(absPath);
    const ort = await ModelPathAdapter.loadOnnxRuntime();
    this._ort = ort;
    this._session = await ort.InferenceSession.create(new Uint8Array(buf), {
      executionProviders: ModelPathAdapter.getExecutionProviders(),
    });
    this._inputName = (this._session.inputNames && this._session.inputNames[0]) || 'image';
    this._outputName = (this._session.outputNames && this._session.outputNames[0]) || 'embedding';
    logger.debug(`[ClipDesktop] session ready in=${this._inputName} out=${this._outputName} from ${absPath}`);
    return this._session;
  }

  /**
   * 桌面 CLIP encoder：uri → L2 归一化 embedding（number[]）。
   * 预处理 = cover 到 INPUT_SIZE 正方形 + 每像素 (v/255 - mean[c])/std[c] + CHW。
   */
  async getEmbedding(uri) {
    const session = await this._ensureSession();
    const ort = this._ort;

    // RGBA Uint8ClampedArray，cover 模式（保宽高比填满 + 居中裁剪）
    const px = await imageProcessor.getPixelData(uri, INPUT_SIZE, INPUT_SIZE, { mode: 'cover' });
    const HW = INPUT_SIZE * INPUT_SIZE;
    const chw = new Float32Array(3 * HW);
    for (let i = 0; i < HW; i++) {
      for (let c = 0; c < 3; c++) {
        chw[c * HW + i] = (px[i * 4 + c] / 255 - MEAN[c]) / STD[c];
      }
    }

    const tensor = new ort.Tensor('float32', chw, [1, 3, INPUT_SIZE, INPUT_SIZE]);
    const out = await session.run({ [this._inputName]: tensor });
    const embT = out[this._outputName] || out[Object.keys(out)[0]];
    if (!embT || !embT.data) throw new Error('CLIP 图编码器输出为空');
    const vec = Array.from(embT.data);

    // 诊断：输出维度 + L2 范数（已归一应 ≈1），便于真机定位
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm);
    logger.debug(`[ClipDesktop] embed dim=${vec.length} L2=${norm.toFixed(4)} uri=${String(uri).slice(-30)}`);
    return vec;
  }

  // ───────────────────────── 独立 IndexedDB 向量库 ─────────────────────────

  /** 打开/缓存独立向量库（imagepilot-clip / embeddings keyPath=imageId） */
  _openDb() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'imageId' });
        }
      };
      req.onsuccess = (event) => { this._db = event.target.result; resolve(this._db); };
      req.onerror = () => reject(req.error || new Error('打开向量库失败'));
    });
  }

  /** 批量写入向量条目 [{imageId, vec}] */
  async _saveVecs(entries) {
    if (!entries || entries.length === 0) return;
    const db = await this._openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE], 'readwrite');
      const store = tx.objectStore(STORE);
      for (const e of entries) store.put({ imageId: e.imageId, vec: e.vec });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('写入向量失败'));
    });
  }

  /** 读全库向量 → { [imageId]: number[] } */
  async _readAllVecs() {
    const db = await this._openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE], 'readonly');
      const store = tx.objectStore(STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        const map = {};
        const rows = req.result || [];
        for (const r of rows) { if (r && r.imageId) map[r.imageId] = r.vec; }
        resolve(map);
      };
      req.onerror = () => reject(req.error || new Error('读取向量失败'));
    });
  }

  /** 删除指定 id 的向量 */
  async _deleteVecs(ids) {
    if (!ids || ids.length === 0) return;
    const db = await this._openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE], 'readwrite');
      const store = tx.objectStore(STORE);
      for (const id of ids) store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('删除向量失败'));
    });
  }

  /** 清空向量库 */
  async _clearVecs() {
    const db = await this._openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE], 'readwrite');
      const store = tx.objectStore(STORE);
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('清空向量失败'));
    });
  }

  // ───────────────────────── 候选图源 ─────────────────────────

  /** 候选图 = 库内非视频且有 id 的图 */
  async _getCandidates() {
    await UnifiedDataService.imageCache.buildCache();
    const all = UnifiedDataService.imageCache.getCache().allImages || [];
    return all.filter((i) => i && i.id && !isVideoRecord(i));
  }

  // ───────────────────────── 统计 / 建索引 / 检索 ─────────────────────────

  /** 已建索引数量 / 候选图片总数 */
  async getIndexStats() {
    try {
      const candidates = await this._getCandidates();
      const map = await this._readAllVecs();
      const indexed = candidates.reduce((n, i) => (map[i.id] ? n + 1 : n), 0);
      return { indexed, total: candidates.length };
    } catch (e) {
      logger.warn(`[ClipDesktop] getIndexStats 失败: ${e && e.message ? e.message : e}`);
      return { indexed: 0, total: 0 };
    }
  }

  /**
   * 建/补向量索引（增量：已有向量的图跳过；视频静默跳过；清理 stale；每 20 条批量存）。
   * @param {(done:number, total:number)=>void} onProgress
   * @returns {Promise<{indexed,skipped,failed,stopped,total}>}
   */
  async buildIndex(onProgress) {
    if (this._building) return { indexed: 0, skipped: 0, failed: 0, stopped: false, total: 0 };
    this._building = true;
    this._stopRequested = false;
    try {
      const { getUri } = require('../../adapters/WebAdapters');
      const candidates = await this._getCandidates();
      const existing = await this._readAllVecs();
      const liveIds = new Set(candidates.map((i) => i.id));

      // 清理残留：向量库里有、当前相册已没有的图（删图后留下的向量）
      const stale = Object.keys(existing).filter((id) => !liveIds.has(id));
      if (stale.length > 0) {
        try { await this._deleteVecs(stale); } catch (_) {}
      }

      const todo = candidates.filter((i) => !existing[i.id]);
      const alreadyLive = candidates.length - todo.length;
      const total = candidates.length;
      let done = alreadyLive;
      let indexed = 0; let failed = 0; let stopped = false;

      let batch = [];
      for (const img of todo) {
        if (this._stopRequested) { stopped = true; break; }
        try {
          const uri = getUri(img) || img.uri;
          if (!uri) { failed++; done++; continue; }
          const vec = await this.getEmbedding(uri);
          batch.push({ imageId: img.id, vec });
          indexed++;
        } catch (e) {
          failed++;
          logger.debug(`[ClipDesktop] 编码失败 ${img.fileName || img.id}: ${e && e.message ? e.message : e}`);
        }
        done++;
        if (batch.length >= 20) { await this._saveVecs(batch); batch = []; }
        if (onProgress && (done % 5 === 0 || done === total)) onProgress(done, total);
      }
      if (batch.length > 0) await this._saveVecs(batch);
      logger.info(`[ClipDesktop] 建索引完成: +${indexed} 失败 ${failed} 清理残留 ${stale.length} 停止=${stopped}`);
      return { indexed, skipped: alreadyLive, failed, stopped, total };
    } finally {
      this._building = false;
      this._stopRequested = false;
    }
  }

  /**
   * 向量检索：目标图（库内记录或任意 uri）→ 编码 → 全库点积排序。
   * @param {{id?:string, uri:string}} image
   * @returns {Promise<{results:Array, indexed:number}>} results 含 vectorScore
   */
  async search(image, { limit = 60, minScore = 0.6 } = {}) {
    const { getUri } = require('../../adapters/WebAdapters');
    const map = await this._readAllVecs();

    // target embedding：库内有记录则复用，否则现编
    let target = (image && image.id) ? map[image.id] : null;
    if (!target) {
      const uri = getUri(image) || image.uri;
      target = await this.getEmbedding(uri);
      if (image && image.id) {
        this._saveVecs([{ imageId: image.id, vec: target }]).catch(() => {});
      }
    }

    const candidates = await this._getCandidates();
    const byId = new Map(candidates.map((i) => [i.id, i]));
    const scored = [];
    for (const id of Object.keys(map)) {
      if (image && id === image.id) continue;
      const rec = byId.get(id);
      if (!rec) continue;
      const score = cosineSim(target, map[id]);
      if (score >= minScore) scored.push({ ...rec, vectorScore: score });
    }
    scored.sort((a, b) => b.vectorScore - a.vectorScore);
    return { results: scored.slice(0, limit), indexed: Object.keys(map).length };
  }

  /** 清空向量索引 */
  async clearIndex() {
    await this._clearVecs();
  }
}

export default new ClipImageSearchDesktop();
