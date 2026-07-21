/**
 * GalleryScannerService.ios.js — iOS 端相册扫描 + AI 分类
 *
 * 对应 Android 的 GalleryScannerService.android.js（同 API、同输出形状）；
 * 区别在于数据源：iOS 走 PhotoKit（PHAsset），通过原生 PhotoKitModule 暴露给 JS。
 *
 * 范围
 *   - M2：authorize → fetchAllPhotos → 落 SQLite → 刷 GlobalImageCache
 *   - M3：aiImageClassifyByContent 路由（同 Android）：
 *     · forceLocal=true / active='local-onnx'  → 设备端 MobileNetV3
 *     · active=云端 Provider                    → 自配 LLM（wireLLMRouting / orchestrator）
 *     图像数据流：ph:// URI → react-native-image-resizer（iOS 原生支持 PhotoKit）
 *                  → JPEG → ONNX tensor / base64
 *
 * 不在 M3 范围（后续）：增量扫描（PHPhotoLibraryChangeObserver）、相似组、EXIF 富化、城市反解
 *
 * 隐私承诺与 Android 一致：分类阶段绝不调任何第三方/作者服务器，仅本地 ONNX 或用户自配 Provider。
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import { logger, RNFS } from '../adapters/WebAdapters';
import UnifiedDataService from './UnifiedDataService';
import ImageClassifierService from './ImageClassifierService';
import ImageProcessor from './ImageProcessor';
import ImageSimilarityService from './ImageSimilarityService';
import cityLocationService from './CityLocationService';
import { similarityDetectionPhase as sharedSimilarityDetection } from './similarityDetectionPhase';
import { getUri } from '../adapters/WebAdapters';
import { classifyImageByTier, readActiveTier } from './classify/classifyByTier';
import { mergeScannerRecords } from './classify/mergeScannerRecord';

const { PhotoKitModule } = NativeModules;

const IS_NATIVE_AVAILABLE = !!(PhotoKitModule && PhotoKitModule.fetchAllPhotos);

/**
 * MobileNetV3 top-1 → 应用分类的最低置信度门槛。
 * 0.15：实测低于此值（5~10% conf 接近 1/1000 类随机猜）映射出来错得离谱，
 * 用户体感"全错"比"全 other"更差。提升分类准度的路子在改善 1000→9 映射表 +
 * 后续换 Places365 权重的模型，不在调阈值上。
 */
const MOBILENET_MAP_THRESHOLD = 0.15;

/**
 * 云端 LLM 分类的图片上传规格：长边 768px / JPEG q85（与 Android 端一致）。
 * 视觉 LLM 内部本就把图降采样到 ~768 tile 再编码，传更大几乎不增准度、纯浪费带宽。
 * 768/q85 比原来的 1024/q90 上传体积小近一半，识别准度实测基本不变。
 */
const CLOUD_LLM_MAX_EDGE = 768;
const CLOUD_LLM_JPEG_QUALITY = 85;

/**
 * PHAsset mediaSubtypes → 应用分类映射（系统给的硬信号，比 ML 模型更可靠）
 * - photoScreenshot → screenshot（已有）
 * - photoPanorama   → travel_scenery（全景照基本都是风景/建筑）
 * - photoDepthEffect → single_person（人像模式默认拍人）
 *
 * HDR / Live / Burst 不直接映射 category（题材不固定），仅作为 image record 标记
 * 供后续可能用到（如优先级排序、筛选等）。
 */
function categoryFromSubtype(asset) {
  if (asset.isScreenshot) return 'screenshot';
  if (asset.isPanorama) return 'travel_scenery';
  if (asset.isDepthEffect) return 'single_person';
  return null;
}

/** PHAsset → 业务层 image 记录（与 Android 形状对齐，category 默认 'NA'）*/
function toImageRecord(asset) {
  const systemCat = categoryFromSubtype(asset);
  // PhotoKit 已从原图 EXIF 解出 GPS 并缓存在 Photos DB 里——native 直接读出来传上来，
  // 比 JS 侧再解 EXIF 快几个数量级。null 表示这张图本来就没 GPS 元数据。
  const lat = (typeof asset.latitude === 'number') ? asset.latitude : null;
  const lng = (typeof asset.longitude === 'number') ? asset.longitude : null;
  const alt = (typeof asset.altitude === 'number') ? asset.altitude : null;
  const acc = (typeof asset.accuracy === 'number') ? asset.accuracy : null;
  return {
    id: asset.id,
    uri: asset.uri, // "ph://<localIdentifier>" —— RN <Image> 与 react-native-image-resizer 都能消费
    fileName: asset.fileName,
    size: asset.size || 0,
    takenAt: asset.takenAt || 0,
    timestamp: asset.takenAt || 0,
    width: asset.width || 0,
    height: asset.height || 0,
    mimeType: asset.mimeType || 'image/jpeg',
    duration: (typeof asset.duration === 'number' && asset.duration > 0) ? asset.duration : 0,   // 视频时长（秒），图片 0
    // 视频单独归入「待分类视频」(NA_video)，与未分类图片(NA)分开；手动分类后移到目标类。
    category: systemCat || ((asset.isVideo || String(asset.mimeType || '').startsWith('video/')) ? 'NA_video' : 'NA'),
    confidence: systemCat ? 'system' : null,
    message: null,
    background_color: null,
    latitude: lat, longitude: lng, altitude: alt, accuracy: acc,
    address: null, city: null, country: null, province: null, district: null, street: null,
    locationSource: (lat != null && lng != null) ? 'photokit' : null, cityDistance: null,
    idCardDetections: null, generalDetections: null, mobileNetV3Detections: null,
    imageDimensions: JSON.stringify({ width: asset.width || 0, height: asset.height || 0 }),
    cameraSettings: null,
  };
}

class GalleryScannerService {
  constructor() {
    this.isScanning = false;
    this._stopRequested = false;   // 用户请求停止 JS 分类循环（见 requestStop）
    this.scanStartTimestamp = null;
    this.onProgress = null;
    this.imagesClassified = 0;
    this.totalImagesToBeClassified = 0;
    // 共享分类器实例，避免重复加载 ONNX 模型（initialize 是幂等的）
    this.imageClassifier = new ImageClassifierService();
    // 相似度检测共享实例——initialize 幂等，特征向量缓存在内部
    this.similarityService = new ImageSimilarityService();
    // 增量监听（PHPhotoLibraryChangeObserver）相关
    this._changeEmitter = null;
    this._changeSub = null;
    this._onIncrementalRefresh = null;
  }

  /**
   * 优雅停止"JS 离线/云端分类"循环（如 VLM 大模型逐张分类太慢时）。
   * 只置停止标志，不动 onProgress —— 让循环检测后 break，仍走完 refreshCache + 完成事件，
   * 使已分类的（每张已即时落库）立刻归位、UI 可见；剩余 NA 图下次扫描自动续。
   */
  requestStop() {
    if (this.isScanning) {
      logger.info('🛑 [iOS] 用户请求停止分类（保留已分类结果，剩余下次续扫）');
      this._stopRequested = true;
    }
  }

  async initialize() {
    if (!IS_NATIVE_AVAILABLE) {
      logger.warn('[iOS] PhotoKitModule 不可用——可能是 Pods 没装好或原生模块未编进 app');
      return false;
    }
    try {
      await this.similarityService.initialize();
    } catch (e) {
      // 相似度检测初始化失败不阻断扫描；similarityDetectionPhase 调用时会再次尝试
      logger.warn('[iOS] similarityService.initialize 失败（相似度检测会受影响）:', e?.message || e);
    }
    logger.debug('[iOS] GalleryScannerService.initialize OK');
    return true;
  }

  /** 内部：拿一次相册访问权限（弹系统对话框；用户拒绝直接抛错由上层提示）*/
  async _ensureAuthorization() {
    if (!IS_NATIVE_AVAILABLE) throw new Error('PhotoKitModule 不可用');
    let current = 'notDetermined';
    try {
      const r = await PhotoKitModule.getAuthorizationStatus();
      current = (r && r.status) || 'notDetermined';
    } catch (_) { /* 视作未定 */ }

    if (current === 'authorized' || current === 'limited') return current;
    if (current === 'denied' || current === 'restricted') {
      const e = new Error('iOS 相册访问被拒绝（系统设置 → ImagePilot → 照片）');
      e.code = 'E_PERMISSION_DENIED';
      throw e;
    }
    const granted = await PhotoKitModule.requestAuthorization();
    const status = (granted && granted.status) || 'denied';
    if (status === 'authorized' || status === 'limited') return status;
    const e = new Error('iOS 相册访问未授权');
    e.code = 'E_PERMISSION_DENIED';
    throw e;
  }

  /** 进度回调统一入口 */
  _emit(progress, onProgress) {
    const cb = onProgress || this.onProgress;
    if (cb) cb(progress);
  }

  /** sendProgressMessage —— 对齐 Android 同名方法，让 HomeScreen.handleScan 复用既有处理逻辑 */
  async sendProgressMessage(stage, processedThisPhase, totalFoundThisPhase, imagesClassified = this.imagesClassified, totalImagesToBeClassified = this.totalImagesToBeClassified) {
    const cb = this.onProgress;
    if (!cb) return;
    cb({
      stage,
      processedThisPhase,
      totalFoundThisPhase,
      processed: processedThisPhase,
      total: totalFoundThisPhase,
      imagesClassified,
      totalImagesToBeClassified,
      message: `${stage}: ${processedThisPhase}/${totalFoundThisPhase}`,
      simpleMessage: stage === 'completed'
        ? `完成（已分类 ${imagesClassified}/${totalImagesToBeClassified}）`
        : `${stage} ${processedThisPhase}/${totalFoundThisPhase}`,
      // 分类中每 20 张也刷一次 UI：分好的图边跑边归位，不用等全部完成（"分类没反应"体感修复）
      shouldRefresh: stage === 'completed'
        || (processedThisPhase > 0 && processedThisPhase % 20 === 0),
    });
  }

  /** 全量扫描（M2 不做增量） */
  async scanGalleryWithProgress(onProgress = null, _compareLimitOrOptions = null) {
    const emit = (p) => this._emit(p, onProgress);
    try {
      this.isScanning = true;
      this.scanStartTimestamp = new Date();
      this.onProgress = onProgress || this.onProgress;

      emit({ stage: 'authorizing', message: '请求相册访问授权…', processed: 0, total: 0 });
      const authStatus = await this._ensureAuthorization();
      logger.debug('[iOS] 相册授权:', authStatus);

      emit({ stage: 'fetching', message: '读取相册中…', processed: 0, total: 0 });
      const result = await PhotoKitModule.fetchAllPhotos();
      const items = (result && result.items) || [];
      logger.debug(`[iOS] PhotoKit 返回 ${items.length} 张照片`);

      if (items.length === 0) {
        // 即便相册为空也要记 lastScanTime，否则 hasScanned 永远 false（HomeScreen
        // 会以为没扫过，把"按城市/相似照片"section 整段跳过，连引导 CTA 都看不见）
        try {
          await this._saveScanCompletionInfo(Date.now() - this.scanStartTimestamp.getTime());
        } catch (_) { /* 不阻断收尾 */ }
        emit({ stage: 'completed', message: '相册为空', processed: 0, total: 0, shouldRefresh: true });
        return { success: true, total: 0 };
      }

      // 保留已分类图的 category / classification 等字段（见 mergeScannerRecord 注释）。
      const fresh = items.map(toImageRecord);
      const existing = await UnifiedDataService.readAllImages().catch(() => []);
      const records = mergeScannerRecords(fresh, existing);
      emit({ stage: 'saving', message: `落库 ${records.length} 张…`, processed: 0, total: records.length });
      await UnifiedDataService.writeImageDetailedInfo(records, true);

      // 把旧版已扫进 NA 的视频迁到「待分类视频」NA_video（幂等；新扫的视频 toImageRecord 已直接落 NA_video）。
      try { await UnifiedDataService.migrateUnclassifiedVideos(); } catch (_) {}

      const duration = Date.now() - this.scanStartTimestamp.getTime();
      // 标记本次扫描完成 —— HomeScreen 通过 settings.lastScanTime 判断 hasScanned，
      // 决定要不要渲染「按城市」「相似照片」section 的入口（即便为空也给 CTA 引导用户启动）。
      // 之前 iOS 漏写这个字段，导致两段 section 永远跳过渲染，用户根本没有触发入口。
      try {
        await this._saveScanCompletionInfo(duration);
      } catch (e) {
        logger.warn('[iOS] 保存扫描完成时间失败（不阻断扫描收尾）:', e?.message || e);
      }
      emit({ stage: 'completed', message: `完成（${duration}ms）`, processed: records.length, total: records.length, shouldRefresh: true });
      logger.debug(`[iOS] 扫描 + 落库完成，共 ${records.length} 张，耗时 ${duration}ms`);

      // 向量索引自动维护：CLIP 模型已下载时，后台增量补新照片的 embedding（fire-and-forget，
      // 不阻塞扫描收尾；已索引的跳过，无新图时秒返）。手动建索引入口仍保留（带进度）。
      try {
        const clipIndex = require('./ClipVectorIndexService').default;
        clipIndex.isReady().then((ok) => {
          if (ok && !clipIndex.isBuilding) {
            clipIndex.buildIndex().catch(() => {});
          }
        }).catch(() => {});
      } catch (_) { /* 服务不可用不影响扫描 */ }

      return { success: true, total: records.length };
    } catch (e) {
      logger.warn('[iOS] 扫描失败:', e?.message || e);
      const cb = onProgress || this.onProgress;
      if (cb) cb({ stage: 'error', message: e?.message || String(e), processed: 0, total: 0, error: e });
      return { success: false, error: e?.message || String(e) };
    } finally {
      this.isScanning = false;
    }
  }

  async startScan(_options = {}, onProgress = null) {
    return this.scanGalleryWithProgress(onProgress);
  }

  /**
   * 记录本次扫描完成时间到 settings（与 Android saveScanCompletionInfo 对齐）。
   *
   * HomeScreen 在 _checkScanInfo 里读 settings.lastScanTime 决定：
   *   - hasScanned 标志位（控制「按城市/相似照片」section 是否渲染入口）
   *   - 顶部最近扫描耗时信息条
   *
   * iOS 端原本漏写——城市/相似两段 section 永远 return null，连 CTA 都看不到。
   */
  async _saveScanCompletionInfo(totalScanDurationMs) {
    const settings = await UnifiedDataService.readSettings();
    // 记录上一次扫描时间：「新发现照片」=自上上次扫描以来的新增（否则刚扫完就清空，两次扫描间拍的永远看不到）
    if (settings.lastScanTime) settings.prevScanTime = settings.lastScanTime;
    settings.lastScanTime = new Date().toISOString();
    settings.lastScanDuration = totalScanDurationMs;
    settings.lastScanDurationSeconds = Math.round(totalScanDurationMs / 1000);
    settings.lastScanDurationMinutes = Math.round(totalScanDurationMs / 1000 / 60);
    await UnifiedDataService.writeSettings(settings);
    logger.info(`💾 [iOS] 已保存扫描完成信息: 耗时 ${settings.lastScanDurationSeconds}秒`);
  }

  /** ============ 增量监听（PHPhotoLibraryChangeObserver）============
   *
   * 启动后只要 PhotoKit 有变化（新增/删除/编辑），native 会 emit 'PhotoLibraryDidChange'
   * 事件，载荷形如 { inserted: [asset], changed: [asset], removed: [localId] }。
   * 我们把 inserted/changed 走 toImageRecord 落库（INSERT OR REPLACE），removed 直接
   * UnifiedDataService.deleteImagesByIds 清掉，最后回调让上层刷 GlobalImageCache。
   *
   * 启动时机：HomeScreen 完成首次全量扫描后调一次。RN 会基于"是否还有 JS 订阅者"
   * 自动调原生 startObserving/stopObserving；这里幂等且只装一次。
   */
  startIncrementalSync(onRefresh = null) {
    if (!IS_NATIVE_AVAILABLE) return false;
    if (this._changeSub) {
      // 已订阅；只更新回调
      if (onRefresh) this._onIncrementalRefresh = onRefresh;
      return true;
    }
    try {
      this._onIncrementalRefresh = onRefresh || this._onIncrementalRefresh;
      this._changeEmitter = new NativeEventEmitter(PhotoKitModule);
      this._changeSub = this._changeEmitter.addListener(
        'PhotoLibraryDidChange',
        (payload) => this._handlePhotoLibraryChange(payload).catch((e) => {
          logger.warn('[iOS] 增量变更处理失败:', e?.message || e);
        })
      );
      logger.debug('[iOS] PhotoLibraryDidChange 订阅成功');
      return true;
    } catch (e) {
      logger.warn('[iOS] 订阅 PhotoLibraryDidChange 失败:', e?.message || e);
      this._changeEmitter = null;
      this._changeSub = null;
      return false;
    }
  }

  stopIncrementalSync() {
    try {
      if (this._changeSub) {
        this._changeSub.remove();
      }
    } catch (_) { /* 忽略 */ }
    this._changeSub = null;
    this._changeEmitter = null;
    this._onIncrementalRefresh = null;
  }

  async _handlePhotoLibraryChange(payload) {
    const inserted = Array.isArray(payload?.inserted) ? payload.inserted : [];
    const changed  = Array.isArray(payload?.changed)  ? payload.changed  : [];
    const removed  = Array.isArray(payload?.removed)  ? payload.removed  : [];
    if (inserted.length === 0 && changed.length === 0 && removed.length === 0) return;

    logger.debug(`[iOS] 增量变更 +${inserted.length} ~${changed.length} -${removed.length}`);

    if (inserted.length || changed.length) {
      // 同 scanGalleryWithProgress：按 id 合并已有库的分类字段（防 edit 清空分类）。
      const fresh = [...inserted, ...changed].map(toImageRecord);
      const existing = await UnifiedDataService.readAllImages().catch(() => []);
      const upserts = mergeScannerRecords(fresh, existing);
      await UnifiedDataService.writeImageDetailedInfo(upserts, false);
    }
    if (removed.length) {
      try {
        // 物理文件由 PhotoKit 那边已删；这里只清 DB 记录（同 Android 系统对话框删后收尾的路径）
        await UnifiedDataService.purgeDeletedImageRecords(removed);
      } catch (e) {
        logger.warn('[iOS] 增量删除 DB 记录失败:', e?.message || e);
      }
    }

    // 通知上层刷新 GlobalImageCache + 重渲染
    if (this._onIncrementalRefresh) {
      try {
        await this._onIncrementalRefresh({
          inserted: inserted.length,
          changed: changed.length,
          removed: removed.length,
        });
      } catch (_) { /* 回调失败不阻断 */ }
    }
  }

  /** ============ M3：AI 分类 ============ */

  /**
   * 设备端 ONNX（MobileNetV3）—— 直接复用 Android 实现，区别只在数据源是 ph:// URI。
   * react-native-image-resizer 在 iOS 上原生支持 ph:// → tmp jpeg 的转换，
   * 所以 imageClassifier.classifyImageWithMobileNetV3(imageUri) 链路无需改动。
   */
  async _classifyAllNAImagesByLocalOnnxJS(scanStartTime, imagesToClassify, clsOpts = {}) {
    // 🛡️ 防 OOM：分类期间停掉后台向量索引构建（CLIP 推理与分类引擎并发驻留内存
    // 在安卓上易触发 OOM 崩溃）；索引下次扫描完成后自动续建。
    try { require('./ClipVectorIndexService').default.requestStop(); } catch (_) {}

    logger.info('🚀 [iOS] 启动 JS 端离线 AI 分类（MobileNetV3）');
    this.isScanning = true;
    this._stopRequested = false;   // 用户停止标志（requestStop 置 true，循环逐张检测后优雅退出）
    this.scanStartTimestamp = scanStartTime || new Date();

    try {
      let naImages = [];
      if (imagesToClassify && Array.isArray(imagesToClassify) && imagesToClassify.length > 0) {
        naImages = imagesToClassify;
      } else {
        await UnifiedDataService.imageCache.buildCache();
        try { naImages = await UnifiedDataService.readImagesByCategory('NA'); }
        catch (e) { logger.error('❌ 读取 NA 图片失败:', e); naImages = []; }
        // 待分类视频也纳入自动分类：抽中间帧走同一图片分类链路（抽帧失败保持 NA_video）
        try {
          const naVideos = await UnifiedDataService.readImagesByCategory('NA_video');
          if (naVideos && naVideos.length > 0) naImages = naImages.concat(naVideos);
        } catch (_) {}
      }
      this.totalImagesToBeClassified = naImages.length;
      this.imagesClassified = 0;
      logger.info(`📊 [iOS] 离线分类目标：${naImages.length} 张 NA 图片（含待分类视频）`);

      await this.sendProgressMessage('initializing', 0, naImages.length, 0, naImages.length);
      if (naImages.length === 0) {
        await this.sendProgressMessage('completed', 0, 0, 0, 0);
        return { success: true, processedCount: 0, failedCount: 0 };
      }

      try {
        await this.imageClassifier.initialize();
      } catch (e) {
        logger.error('❌ ImageClassifierService 初始化失败:', e);
        await this.sendProgressMessage('error', 0, naImages.length);
        throw new Error(`离线模型加载失败：${e?.message || e}`);
      }

      let processedCount = 0;
      let failedCount = 0;
      // VLM（多模态大模型）秒级/张，太慢：用 BATCH=1，让进度条与落库都「一张一张」推进，
      // 用户能实时看到百分比走动、结果逐张出现；基础/CLIP 等快引擎保持 20 批量以省 IO。
      const preTier = await readActiveTier();
      const BATCH = (preTier && preTier.engine === 'vlm') ? 1 : 20;
      let stoppedByUser = false;
      for (let i = 0; i < naImages.length; i += BATCH) {
        // 用户停止：逐批检测，已分类的（每张已即时落库）保留，剩余 NA 图下次扫描自动续。
        if (this._stopRequested) {
          stoppedByUser = true;
          logger.info(`🛑 [iOS] 用户停止分类：已处理 ${processedCount}，剩余 ${naImages.length - i} 张保持待分类`);
          break;
        }
        const batch = naImages.slice(i, i + BATCH);
        const classificationDataArray = [];
        let perImageDone = i;   // 批内逐张进度计数（进度平滑滚动）
        // 当前批次共用一个 tier（每批读 settings 一次，避免单图 IO）
        const activeTier = await readActiveTier();
        for (const image of batch) {
          // 批内逐张可停（快引擎 BATCH=20 时也能即时停，不必等整批跑完）。
          if (this._stopRequested) { stoppedByUser = true; break; }
          const isVideo = String(image.mimeType || '').startsWith('video/');
          let frameTemp = null;
          try {
            let imageUri;
            if (isVideo) {
              // 视频自动分类：抽中间帧 → 走同一图片分类链路（封面帧常黑场，中点更具代表性）
              try {
                const localId = String(image.uri || '').replace(/^ph:\/\//, '');
                frameTemp = await NativeModules.PhotoKitModule.extractVideoFrame(localId);
              } catch (fe) {
                logger.warn(`⚠️ [iOS] 视频抽帧失败（保持待分类视频）: ${fe?.message || fe}`);
                failedCount++; continue;
              }
              imageUri = frameTemp;
            } else {
              imageUri = getUri(image) || image?.uri;
            }
            if (!imageUri) { failedCount++; continue; }
            // P1: 按 tier 路由（basic→ImageNet / scene→Places365 / clip→未接入回退）
            const r = await classifyImageByTier(imageUri, activeTier, { imageClassifier: this.imageClassifier, detailed: !!clsOpts.detailed });
            const top = r?.topPrediction || null;
            const conf = (typeof r?.confidence === 'number') ? r.confidence : 0;
            let category;
            // basic 引擎的 appCategory 经 mapMobileNetV3ToAppCategory 已得到；
            // places365 引擎的 appCategory 直接来自 PLACES365_CLASSES 表。
            // 两端都低于阈值时落 other（仅 basic 需要阈值，places365 准度更高，
            // 但保留同阈值兼容）。
            if (top && conf >= MOBILENET_MAP_THRESHOLD) {
              category = top.appCategory || 'other';
            } else {
              if (top && conf < MOBILENET_MAP_THRESHOLD) {
                logger.debug(`[iOS] ${r?.engine || '?'} conf=${conf.toFixed(3)} < ${MOBILENET_MAP_THRESHOLD}，top="${top?.name}" 落 other`);
              }
              category = 'other';
            }
            classificationDataArray.push({
              uri: image?.uri || imageUri,
              id: image.id,
              category,
              confidence: conf || 0.5,
              idCardDetections: [],
              generalDetections: [],
              mobileNetV3Detections: null,
              // VLM 开放式打标：归不进已有类的图落 other，但把模型自拟标签存到 message
              // （用于在图上展示，并在用户日后建同名自定义类时自动并入）。
              message: r?.vlmLabel || null,
              background_color: null,
            });
          } catch (e) {
            logger.warn(`⚠️ [iOS] 离线分类单张失败: ${e?.message || e}`);
            failedCount++;
          } finally {
            // 删抽帧临时文件（失败无妨，tmp 系统会自清）
            if (frameTemp) { try { await RNFS.unlink(frameTemp.replace(/^file:\/\//, '')); } catch (_) {} }
          }
          // 批内逐张发进度：百分比平滑滚动，不再 20 张跳一次（界面数据刷新仍按每 20 张节流）
          perImageDone++;
          await this.sendProgressMessage('classifying_local', Math.min(perImageDone, naImages.length), naImages.length, this.imagesClassified, naImages.length);
        }
        if (classificationDataArray.length > 0) {
          try {
            const updateResult = await UnifiedDataService.batchUpdateClassification(classificationDataArray, false);
            if (updateResult && updateResult.success) {
              processedCount += updateResult.updatedCount;
              this.imagesClassified += updateResult.updatedCount;
            } else {
              failedCount += classificationDataArray.length;
            }
          } catch (e) {
            logger.error(`❌ [iOS] 离线分类批量落库失败: ${e?.message || e}`);
            failedCount += classificationDataArray.length;
          }
        }
        const done = Math.min(i + BATCH, naImages.length);
        await this.sendProgressMessage('classifying_local', done, naImages.length, this.imagesClassified, naImages.length);
      }

      logger.info(`✅ [iOS] 离线分类完成：成功 ${processedCount}，失败 ${failedCount}`);
      // 分类完所有 batch 后统一刷一次 GlobalImageCache，否则上层 HomeScreen 读到的
      // 仍是分类前 NA 的 categoryCounts，UI 显示「待分类|12」而 DB 实际已是 other|12。
      try {
        await UnifiedDataService.imageCache.refreshCache();
      } catch (e) {
        logger.warn('[iOS] 分类后刷新 GlobalImageCache 失败:', e?.message || e);
      }
      await this.sendProgressMessage('completed', processedCount, naImages.length, this.imagesClassified, naImages.length);
      return { success: true, processedCount, failedCount, stopped: stoppedByUser };
    } catch (error) {
      logger.error('❌ [iOS] 离线分类失败:', error);
      throw error;
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * 云端 LLM —— 同 Android：每张图压成 1024 长边 JPEG → base64 → 用户自配 Provider。
   * 不会连接任何第三方/作者服务器。
   */
  async _classifyAllNAImagesByCloudJS(scanStartTime, imagesToClassify, aiCfg, clsOpts = {}) {
    // 🛡️ 防 OOM：分类期间停掉后台向量索引构建（CLIP 推理与分类引擎并发驻留内存
    // 在安卓上易触发 OOM 崩溃）；索引下次扫描完成后自动续建。
    try { require('./ClipVectorIndexService').default.requestStop(); } catch (_) {}

    logger.info(`🚀 [iOS] 启动 JS 端云端 AI 分类（${aiCfg.active}）`);
    this.isScanning = true;
    this._stopRequested = false;
    this.scanStartTimestamp = scanStartTime || new Date();
    try {
      let naImages = [];
      if (imagesToClassify && Array.isArray(imagesToClassify) && imagesToClassify.length > 0) {
        naImages = imagesToClassify;
      } else {
        await UnifiedDataService.imageCache.buildCache();
        try { naImages = await UnifiedDataService.readImagesByCategory('NA'); }
        catch (e) { logger.error('❌ 读取 NA 图片失败:', e); naImages = []; }
        // 待分类视频也纳入云端分类（抽中间帧上传）
        try {
          const naVideos = await UnifiedDataService.readImagesByCategory('NA_video');
          if (naVideos && naVideos.length > 0) naImages = naImages.concat(naVideos);
        } catch (_) {}
      }
      this.totalImagesToBeClassified = naImages.length;
      this.imagesClassified = 0;
      logger.info(`📊 [iOS] 云端分类目标：${naImages.length} 张 NA 图片（含待分类视频）`);
      await this.sendProgressMessage('initializing', 0, naImages.length, 0, naImages.length);

      if (naImages.length === 0) {
        await this.sendProgressMessage('completed', 0, 0, 0, 0);
        return { success: true, processedCount: 0, failedCount: 0 };
      }

      // 与 Android 一致，使用新一代 LLMClassifyOrchestrator
      const { classifyCloudBatchV2 } = await import('./llm/llmClassifyOrchestrator.js');
      const classifyCloudBatch = classifyCloudBatchV2;

      let processedCount = 0;
      let failedCount = 0;
      const BATCH = 10;
      for (let i = 0; i < naImages.length; i += BATCH) {
        if (this._stopRequested) {
          logger.info(`🛑 [iOS] 用户停止云端分类：已处理 ${processedCount}，剩余 ${naImages.length - i} 张保持待分类`);
          break;
        }
        const batch = naImages.slice(i, i + BATCH);
        const inputs = [];
        const validResults = [];
        for (const image of batch) {
          let frameTemp = null;
          try {
            let sourceUri = getUri(image) || image?.uri;
            // 视频：抽中间帧 → 压缩上传（与设备端分类同策略；抽帧失败保持待分类视频）
            if (String(image.mimeType || '').startsWith('video/')) {
              try {
                const localId = String(image.uri || '').replace(/^ph:\/\//, '');
                frameTemp = await NativeModules.PhotoKitModule.extractVideoFrame(localId);
                sourceUri = frameTemp;
              } catch (fe) {
                logger.warn(`⚠️ [iOS] 云端分类视频抽帧失败: ${fe?.message || fe}`);
                failedCount++; continue;
              }
            }
            if (!sourceUri) { failedCount++; continue; }
            const resized = await ImageProcessor.resizeImage(sourceUri, CLOUD_LLM_MAX_EDGE, CLOUD_LLM_MAX_EDGE, {
              maintainAspectRatio: true, outputFormat: 'jpeg', quality: CLOUD_LLM_JPEG_QUALITY,
            });
            const resizedUri = resized?.uri;
            if (!resizedUri) { failedCount++; continue; }
            const localPath = resizedUri.startsWith('file://') ? resizedUri.replace(/^file:\/\//, '') : resizedUri;
            const base64 = await RNFS.readFile(localPath, 'base64');
            inputs.push({ id: image.id || image.hash || sourceUri, imageBase64: base64 });
            validResults.push({ imageData: image, hash: image.hash || image.id });
          } catch (e) {
            logger.warn(`⚠️ [iOS] 云端分类预处理失败: ${e?.message || e}`);
            failedCount++;
          } finally {
            if (frameTemp) { try { await RNFS.unlink(frameTemp.replace(/^file:\/\//, '')); } catch (_) {} }
          }
        }
        if (inputs.length === 0) continue;

        let batchOut;
        try {
          batchOut = await classifyCloudBatch({
            imageClassifier: this.imageClassifier,
            platform: Platform.OS,
            inputs, validResults, aiCfg, detailed: !!clsOpts.detailed,
          });
        } catch (e) {
          logger.error(`❌ [iOS] 云端 LLM 调用失败: ${e?.message || e}`);
          failedCount += inputs.length;
          continue;
        }

        const classificationDataArray = [];
        for (const item of (batchOut?.items || [])) {
          if (!item.success || !item.data) { failedCount++; continue; }
          classificationDataArray.push({
            uri: item.imageData?.uri,
            id: item.imageData?.id,
            category: item.data.category,
            confidence: item.data.confidence || 0.9,
            idCardDetections: [],
            generalDetections: [],
            mobileNetV3Detections: null,
            message: item.data.description || null,
            background_color: item.data.background_color || null,
          });
        }
        if (classificationDataArray.length > 0) {
          try {
            const updateResult = await UnifiedDataService.batchUpdateClassification(classificationDataArray, false);
            if (updateResult && updateResult.success) {
              processedCount += updateResult.updatedCount;
              this.imagesClassified += updateResult.updatedCount;
            } else {
              failedCount += classificationDataArray.length;
            }
          } catch (e) {
            logger.error(`❌ [iOS] 云端分类落库失败: ${e?.message || e}`);
            failedCount += classificationDataArray.length;
          }
        }
        const done = Math.min(i + BATCH, naImages.length);
        await this.sendProgressMessage('classifying_cloud', done, naImages.length, this.imagesClassified, naImages.length);
      }

      logger.info(`✅ [iOS] 云端分类完成：成功 ${processedCount}，失败 ${failedCount}`);
      try {
        await UnifiedDataService.imageCache.refreshCache();
      } catch (e) {
        logger.warn('[iOS] 云端分类后刷新 GlobalImageCache 失败:', e?.message || e);
      }
      await this.sendProgressMessage('completed', processedCount, naImages.length, this.imagesClassified, naImages.length);
      return { success: true, processedCount, failedCount };
    } catch (error) {
      logger.error('❌ [iOS] 云端分类失败:', error);
      throw error;
    } finally {
      this.isScanning = false;
    }
  }

  /** 路由器（与 Android 一致）：forceLocal / active 决定走本地 ONNX 还是云端 LLM */
  async aiImageClassifyByContent(scanStartTime = null, imagesToClassify = null, opts = {}) {
    if (this.isScanning) {
      throw new Error('已有扫描在进行中');
    }
    if (opts && opts.forceLocal === true) {
      return await this._classifyAllNAImagesByLocalOnnxJS(scanStartTime, imagesToClassify, { detailed: !!(opts && opts.detailed) });
    }
    let aiCfg = null;
    try {
      const cfgSvc = (await import('./llm/adapters/UnifiedDataConfigService.js')).default;
      aiCfg = await cfgSvc.getAIProviderConfig();
    } catch (e) {
      logger.warn('读取 aiProvider 配置失败，按 local-onnx 处理:', e?.message || e);
    }
    const isCloud = !!(aiCfg && aiCfg.active && aiCfg.active !== 'local-onnx');
    if (!isCloud) {
      return await this._classifyAllNAImagesByLocalOnnxJS(scanStartTime, imagesToClassify, { detailed: !!(opts && opts.detailed) });
    }
    return await this._classifyAllNAImagesByCloudJS(scanStartTime, imagesToClassify, aiCfg, { detailed: !!(opts && opts.detailed) });
  }

  /**
   * 相似度检测——和 Android 共享 similarityDetectionPhase 模块（颜色直方图 + 滑窗比对）。
   * GPS/相似都是 iOS 端首版没接的，现在补齐保持双端一致。
   */
  async similarityDetectionPhase(opts = {}) {
    const mode = opts && opts.mode === 'incremental' ? 'incremental' : 'full';
    const settings = await UnifiedDataService.readSettings();
    let similarityThreshold = (settings.similarityThreshold != null
        && settings.similarityThreshold >= 0
        && settings.similarityThreshold <= 1)
      ? settings.similarityThreshold
      : 0.8;
    // 下限 0.8——再低的阈值在 ImageSimilarityService 里会触发 spammy false-positive，
    // Android 端也是同样兜底；不重复推理 UX，保持双端一致。
    if (similarityThreshold < 0.8) similarityThreshold = 0.8;

    try {
      await this.similarityService.initialize();
    } catch (e) {
      logger.warn('[iOS] similarityService.initialize 失败:', e?.message || e);
    }

    await sharedSimilarityDetection({
      sendProgressMessage: this.sendProgressMessage.bind(this),
      similarityService: this.similarityService,
      similarityThreshold,
      similarityMode: mode,
      totalImagesToBeClassified: this.totalImagesToBeClassified,
    });
    return { success: true };
  }

  /**
   * 位置信息补全——把 PhotoKit 已带的 GPS 反查成 city/country 并落库。
   *
   * 与 Android 实现的区别：Android 在同一阶段交错跑 MobileNetV3 推理流水线，
   * 因为 Android 的扫描+分类是一条线；iOS 把分类拆到了 _classifyAllNAImagesByLocalOnnxJS
   * 里独立跑，所以这里只做位置反查，不再嵌推理——代码短一截，逻辑更清晰。
   *
   * 反查走 cityLocationService.getLocationsBatch：先查本地 SQLite 缓存，本地没的离线
   * 用内置 cityData 做最近城市估算（CityLocationService 已彻底切到离线，不会再连
   * api.aifuture.net.cn——iOS 端同样遵循"分类阶段绝不连第三方服务器"的承诺）。
   */
  async enrichLocationInfo() {
    logger.info('📍 [iOS] 开始位置信息补全');
    try {
      const allImages = await UnifiedDataService.readAllImages();

      // 排除截图 / 二维码——这两类即便有 GPS 也不该按城市归档
      const validImages = (allImages || []).filter((img) => {
        const c = img.category || 'NA';
        return c !== 'screenshot' && c !== 'qrcode';
      });

      const needLocation = validImages.filter((img) => {
        if (typeof img.latitude !== 'number' || typeof img.longitude !== 'number') return false;
        const hasCity = img.city && String(img.city).trim() !== '';
        const hasCountry = img.country && String(img.country).trim() !== '';
        return !hasCity || !hasCountry;
      });

      const totalFoundThisPhase = validImages.length;
      logger.info(`📍 [iOS] 位置补全统计: 总图=${allImages?.length || 0}, 有效=${validImages.length}, 待补全=${needLocation.length}`);
      await this.sendProgressMessage('location_enrichment', 0, totalFoundThisPhase, this.imagesClassified, this.totalImagesToBeClassified);

      if (needLocation.length === 0) {
        logger.info('📍 [iOS] 没有需要补全位置的图片，跳过');
        await this.sendProgressMessage('location_enrichment', totalFoundThisPhase, totalFoundThisPhase, this.imagesClassified, this.totalImagesToBeClassified);
        return true;
      }

      // 接口最多支持 500 个坐标——分批 400 与 Android 端一致，给 IO/解析留余量
      const BATCH = 400;
      let processed = 0;
      let savedTotal = 0;
      for (let i = 0; i < needLocation.length; i += BATCH) {
        const slice = needLocation.slice(i, i + BATCH);
        const coords = slice.map((img) => ({
          id: img.uri, // cityLocationService 用 id 回填，下游按 uri 关联回图片
          latitude: img.latitude,
          longitude: img.longitude,
        }));
        let results = [];
        try {
          results = await cityLocationService.getLocationsBatch(coords, { skipRemote: false });
        } catch (e) {
          logger.warn(`⚠️ [iOS] 位置批量查询失败 (${i}-${i + slice.length}):`, e?.message || e);
        }

        const uriToLocId = new Map();
        for (const r of results || []) {
          const locId = r?.location_id || r?.city?.location_id || null;
          if (r?.success && locId && r.id) uriToLocId.set(r.id, locId);
        }

        const cityDataArray = [];
        for (const img of slice) {
          const locId = uriToLocId.get(img.uri);
          if (locId) {
            cityDataArray.push({
              uri: img.uri,
              id: img.id,
              city: locId,
              latitude: img.latitude,
              longitude: img.longitude,
            });
          }
        }
        if (cityDataArray.length > 0) {
          try {
            const r = await UnifiedDataService.updateImagesCity(cityDataArray, false);
            if (r && r.success) {
              savedTotal += r.updatedCount || cityDataArray.length;
            }
          } catch (e) {
            logger.warn('[iOS] 批量落库 city 失败:', e?.message || e);
          }
        }
        processed += slice.length;
        await this.sendProgressMessage('location_enrichment', Math.min(processed, totalFoundThisPhase), totalFoundThisPhase, this.imagesClassified, this.totalImagesToBeClassified);
      }

      // 一次性刷 GlobalImageCache，避免上层 HomeScreen 读到老数据看不到新城市分布
      try {
        await UnifiedDataService.imageCache.refreshCache();
      } catch (e) {
        logger.warn('[iOS] 位置补全后刷新 GlobalImageCache 失败:', e?.message || e);
      }
      logger.info(`✅ [iOS] 位置信息补全完成：共补全 ${savedTotal} 张`);
      await this.sendProgressMessage('completed', totalFoundThisPhase, totalFoundThisPhase, this.imagesClassified, this.totalImagesToBeClassified);
      return true;
    } catch (e) {
      logger.error('❌ [iOS] 位置信息补全失败:', e?.message || e);
      await this.sendProgressMessage('error', 0, 0, this.imagesClassified, this.totalImagesToBeClassified);
      throw e;
    }
  }

  /**
   * EXIF 拍参提取（ISO/光圈/快门/焦距）——与 Android scanner 的拍参提取对齐。
   *
   * 背景：PHAsset 本身不暴露拍参字段（不像 GPS 那样 system 缓存好了）；要拿到拍参必须
   * 读原图字节再用 CGImageSource 解 EXIF。所以这是一个相对耗时的阶段，独立于扫描，
   * 用户从 Settings 主动触发（v1.5.6 在 Settings 加入口）。一次提完入库后未来扫描复用，
   * 新照片由本方法过滤"没拍参"再增量提。
   *
   * 流程：
   *   1) readAllImages → 筛 cameraSettings 为空 + 非 screenshot 的（截图 EXIF 不含拍参）
   *   2) 按 BATCH 调 PhotoKitModule.fetchAssetsExif，拿 { iso, aperture, shutterSpeed, focalLength }
   *   3) 把 cameraSettings 字符串化 + 算 isoCategory/apertureCategory/... 写回 DB
   *   4) 刷 GlobalImageCache，让 HomeScreen「按拍参」section 显示
   */
  async enrichExifInfo() {
    logger.info('📸 [iOS] 开始 EXIF 拍参提取');
    if (!PhotoKitModule || typeof PhotoKitModule.fetchAssetsExif !== 'function') {
      const e = new Error('PhotoKitModule.fetchAssetsExif 不可用（请重装 app 让 iOS 拿到新版原生模块）');
      e.code = 'E_NATIVE_UNAVAILABLE';
      throw e;
    }
    try {
      const all = await UnifiedDataService.readAllImages();
      // 截图/二维码没拍参（系统截屏 EXIF 通常空）；已经有 cameraSettings 的也跳过
      const need = (all || []).filter((img) => {
        const c = img.category || 'NA';
        if (c === 'screenshot' || c === 'qrcode') return false;
        const cs = img.cameraSettings;
        if (!cs) return true;
        if (typeof cs === 'string') {
          try {
            const parsed = JSON.parse(cs);
            return !parsed || Object.keys(parsed).length === 0;
          } catch (_) { return true; }
        }
        return typeof cs === 'object' && Object.keys(cs).length === 0;
      });

      const total = need.length;
      logger.info(`📸 [iOS] EXIF 提取统计: 总图=${all?.length || 0}, 待提取=${total}`);
      await this.sendProgressMessage('exif_enrichment', 0, total, this.imagesClassified, this.totalImagesToBeClassified);

      if (total === 0) {
        await this.sendProgressMessage('completed', 0, 0, this.imagesClassified, this.totalImagesToBeClassified);
        return true;
      }

      // BATCH 50：单张约 30~100ms，50/批是「能看到进度」与「调原生开销低」的折中
      const BATCH = 50;
      let processed = 0;
      let savedTotal = 0;
      for (let i = 0; i < need.length; i += BATCH) {
        const batch = need.slice(i, i + BATCH);
        const ids = batch.map((img) => img.id);
        let result;
        try {
          result = await PhotoKitModule.fetchAssetsExif(ids);
        } catch (e) {
          logger.warn(`⚠️ [iOS] EXIF 批量提取失败 (${i}-${i + batch.length}):`, e?.message || e);
          processed += batch.length;
          await this.sendProgressMessage('exif_enrichment', Math.min(processed, total), total, this.imagesClassified, this.totalImagesToBeClassified);
          continue;
        }
        const exifMap = (result && result.results) || {};

        // 给有结果的图组装"更新记录"——按 writeImageDetailedInfo 的 schema（含全部已有字段
        // 不丢分类/位置/相似度等已落库数据）。cameraSettings 字符串化以匹配 SQL TEXT 列。
        const updates = [];
        for (const img of batch) {
          const exif = exifMap[img.id];
          if (!exif || Object.keys(exif).length === 0) continue;
          // ⚠️ 必须剥掉 4 个 *Category 字段：ImageStorageService 落库时若发现记录已带
          // isoCategory/apertureCategory（哪怕是 null），就直接沿用、不从 cameraSettings
          // 重算分类。而「按拍摄参数」section 读的正是这几个 *Category 列。{...img} 会把
          // DB 里的 null category 带进来 → 分类永远算不出 → section 一直空（这就是用户
          // 反馈"提取拍摄参数没用"的根因）。剥掉后 storage 走 calculateCameraSettingsCategories。
          const { isoCategory, apertureCategory, shutterCategory, focalLengthCategory, ...rest } = img;
          updates.push({
            ...rest,
            cameraSettings: JSON.stringify(exif),
          });
        }
        if (updates.length > 0) {
          try {
            await UnifiedDataService.writeImageDetailedInfo(updates, false);
            savedTotal += updates.length;
          } catch (e) {
            logger.warn('[iOS] EXIF 落库失败:', e?.message || e);
          }
        }
        processed += batch.length;
        await this.sendProgressMessage('exif_enrichment', Math.min(processed, total), total, this.imagesClassified, this.totalImagesToBeClassified);
      }

      // 一次性刷 GlobalImageCache，让 HomeScreen「按拍参」section 出现
      try {
        await UnifiedDataService.imageCache.refreshCache();
      } catch (e) {
        logger.warn('[iOS] EXIF 提取后刷新 GlobalImageCache 失败:', e?.message || e);
      }
      logger.info(`✅ [iOS] EXIF 拍参提取完成：共补 ${savedTotal} 张`);
      await this.sendProgressMessage('completed', total, total, this.imagesClassified, this.totalImagesToBeClassified);
      return true;
    } catch (e) {
      logger.error('❌ [iOS] EXIF 提取失败:', e?.message || e);
      await this.sendProgressMessage('error', 0, 0, this.imagesClassified, this.totalImagesToBeClassified);
      throw e;
    }
  }

  getScanVersion() {
    return 'ios-m5-1.0.0'; // M5：补 EXIF 拍参提取
  }

  isUsingNativeScan() {
    return IS_NATIVE_AVAILABLE;
  }
}

export default GalleryScannerService;
