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
import { getUri } from '../adapters/WebAdapters';
import { classifyImageByTier, readActiveTier } from './classify/classifyByTier';

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
    category: systemCat || 'NA',
    confidence: systemCat ? 'system' : null,
    message: null,
    background_color: null,
    latitude: null, longitude: null, altitude: null, accuracy: null,
    address: null, city: null, country: null, province: null, district: null, street: null,
    locationSource: null, cityDistance: null,
    idCardDetections: null, generalDetections: null, mobileNetV3Detections: null,
    imageDimensions: JSON.stringify({ width: asset.width || 0, height: asset.height || 0 }),
    cameraSettings: null,
  };
}

class GalleryScannerService {
  constructor() {
    this.isScanning = false;
    this.scanStartTimestamp = null;
    this.onProgress = null;
    this.imagesClassified = 0;
    this.totalImagesToBeClassified = 0;
    // 共享分类器实例，避免重复加载 ONNX 模型（initialize 是幂等的）
    this.imageClassifier = new ImageClassifierService();
    // 增量监听（PHPhotoLibraryChangeObserver）相关
    this._changeEmitter = null;
    this._changeSub = null;
    this._onIncrementalRefresh = null;
  }

  async initialize() {
    if (!IS_NATIVE_AVAILABLE) {
      logger.warn('[iOS] PhotoKitModule 不可用——可能是 Pods 没装好或原生模块未编进 app');
      return false;
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
      shouldRefresh: stage === 'completed',
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
        emit({ stage: 'completed', message: '相册为空', processed: 0, total: 0, shouldRefresh: true });
        return { success: true, total: 0 };
      }

      // 🔥 关键：保留已分类图的 category / classification 等字段
      // toImageRecord 只从 PHAsset 拿到 category（默认 'NA'，除非有 systemCat 兜底如
      // screenshot/panorama/depth）。如果直接 INSERT OR REPLACE，会把用户手动分类、
      // 云端 LLM 分类、本地 MobileNetV3/CLIP 分类全清成 'NA'。
      //
      // 策略：读现有库，按 id 合并。如果已存在记录的 category 不是 'NA'（已分类过），
      // 保留已有的 category / confidence / idCardDetections / generalDetections /
      // mobileNetV3Detections / message / 位置字段。systemCat（screenshot/panorama）
      // 只在原库还是 'NA' 时才生效。
      const fresh = items.map(toImageRecord);
      const existing = await UnifiedDataService.readAllImages().catch(() => []);
      const existingById = new Map((existing || []).map((e) => [e.id, e]));
      const records = fresh.map((r) => {
        const prev = existingById.get(r.id);
        if (!prev) return r;
        // 已分类 → 完全保留分类相关字段，只更新 PhotoKit 元数据（size/dimensions/takenAt）
        const keepCategory = prev.category && prev.category !== 'NA';
        return {
          ...r,
          category: keepCategory ? prev.category : (r.category || 'NA'),
          confidence: keepCategory ? prev.confidence : r.confidence,
          idCardDetections: prev.idCardDetections || r.idCardDetections,
          generalDetections: prev.generalDetections || r.generalDetections,
          mobileNetV3Detections: prev.mobileNetV3Detections || r.mobileNetV3Detections,
          message: prev.message || r.message,
          background_color: prev.background_color || r.background_color,
          // 位置字段保留（之前已 reverse geocode 出来的城市等）
          latitude: prev.latitude ?? r.latitude,
          longitude: prev.longitude ?? r.longitude,
          altitude: prev.altitude ?? r.altitude,
          accuracy: prev.accuracy ?? r.accuracy,
          address: prev.address || r.address,
          city: prev.city || r.city,
          country: prev.country || r.country,
          province: prev.province || r.province,
          district: prev.district || r.district,
          street: prev.street || r.street,
          locationSource: prev.locationSource || r.locationSource,
          cityDistance: prev.cityDistance ?? r.cityDistance,
        };
      });
      emit({ stage: 'saving', message: `落库 ${records.length} 张…`, processed: 0, total: records.length });
      await UnifiedDataService.writeImageDetailedInfo(records, true);

      const duration = Date.now() - this.scanStartTimestamp.getTime();
      emit({ stage: 'completed', message: `完成（${duration}ms）`, processed: records.length, total: records.length, shouldRefresh: true });
      logger.debug(`[iOS] 扫描 + 落库完成，共 ${records.length} 张，耗时 ${duration}ms`);

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
      // 同 scanGalleryWithProgress：toImageRecord 返回的 category='NA'（除非系统兜底），
      // 这里要按 id 合并已有库的分类相关字段，否则用户 edit 一张已分类图就清空分类。
      const fresh = [...inserted, ...changed].map(toImageRecord);
      const existing = await UnifiedDataService.readAllImages().catch(() => []);
      const existingById = new Map((existing || []).map((e) => [e.id, e]));
      const upserts = fresh.map((r) => {
        const prev = existingById.get(r.id);
        if (!prev) return r;
        const keepCategory = prev.category && prev.category !== 'NA';
        return {
          ...r,
          category: keepCategory ? prev.category : (r.category || 'NA'),
          confidence: keepCategory ? prev.confidence : r.confidence,
          idCardDetections: prev.idCardDetections || r.idCardDetections,
          generalDetections: prev.generalDetections || r.generalDetections,
          mobileNetV3Detections: prev.mobileNetV3Detections || r.mobileNetV3Detections,
          message: prev.message || r.message,
          background_color: prev.background_color || r.background_color,
          latitude: prev.latitude ?? r.latitude,
          longitude: prev.longitude ?? r.longitude,
          altitude: prev.altitude ?? r.altitude,
          accuracy: prev.accuracy ?? r.accuracy,
          address: prev.address || r.address,
          city: prev.city || r.city,
          country: prev.country || r.country,
          province: prev.province || r.province,
          district: prev.district || r.district,
          street: prev.street || r.street,
          locationSource: prev.locationSource || r.locationSource,
          cityDistance: prev.cityDistance ?? r.cityDistance,
        };
      });
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
  async _classifyAllNAImagesByLocalOnnxJS(scanStartTime, imagesToClassify) {
    logger.info('🚀 [iOS] 启动 JS 端离线 AI 分类（MobileNetV3）');
    this.isScanning = true;
    this.scanStartTimestamp = scanStartTime || new Date();

    try {
      let naImages = [];
      if (imagesToClassify && Array.isArray(imagesToClassify) && imagesToClassify.length > 0) {
        naImages = imagesToClassify;
      } else {
        await UnifiedDataService.imageCache.buildCache();
        try { naImages = await UnifiedDataService.readImagesByCategory('NA'); }
        catch (e) { logger.error('❌ 读取 NA 图片失败:', e); naImages = []; }
      }
      this.totalImagesToBeClassified = naImages.length;
      this.imagesClassified = 0;
      logger.info(`📊 [iOS] 离线分类目标：${naImages.length} 张 NA 图片`);

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
      const BATCH = 20;
      for (let i = 0; i < naImages.length; i += BATCH) {
        const batch = naImages.slice(i, i + BATCH);
        const classificationDataArray = [];
        // 当前批次共用一个 tier（每批读 settings 一次，避免单图 IO）
        const activeTier = await readActiveTier();
        for (const image of batch) {
          try {
            const imageUri = getUri(image) || image?.uri;
            if (!imageUri) { failedCount++; continue; }
            // P1: 按 tier 路由（basic→ImageNet / scene→Places365 / clip→未接入回退）
            const r = await classifyImageByTier(imageUri, activeTier, { imageClassifier: this.imageClassifier });
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
              message: null,
              background_color: null,
            });
          } catch (e) {
            logger.warn(`⚠️ [iOS] 离线分类单张失败: ${e?.message || e}`);
            failedCount++;
          }
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
      return { success: true, processedCount, failedCount };
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
  async _classifyAllNAImagesByCloudJS(scanStartTime, imagesToClassify, aiCfg) {
    logger.info(`🚀 [iOS] 启动 JS 端云端 AI 分类（${aiCfg.active}）`);
    this.isScanning = true;
    this.scanStartTimestamp = scanStartTime || new Date();
    try {
      let naImages = [];
      if (imagesToClassify && Array.isArray(imagesToClassify) && imagesToClassify.length > 0) {
        naImages = imagesToClassify;
      } else {
        await UnifiedDataService.imageCache.buildCache();
        try { naImages = await UnifiedDataService.readImagesByCategory('NA'); }
        catch (e) { logger.error('❌ 读取 NA 图片失败:', e); naImages = []; }
      }
      this.totalImagesToBeClassified = naImages.length;
      this.imagesClassified = 0;
      logger.info(`📊 [iOS] 云端分类目标：${naImages.length} 张 NA 图片`);
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
        const batch = naImages.slice(i, i + BATCH);
        const inputs = [];
        const validResults = [];
        for (const image of batch) {
          try {
            const sourceUri = getUri(image) || image?.uri;
            if (!sourceUri) { failedCount++; continue; }
            const resized = await ImageProcessor.resizeImage(sourceUri, 1024, 1024, {
              maintainAspectRatio: true, outputFormat: 'jpeg', quality: 90,
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
          }
        }
        if (inputs.length === 0) continue;

        let batchOut;
        try {
          batchOut = await classifyCloudBatch({
            imageClassifier: this.imageClassifier,
            platform: Platform.OS,
            inputs, validResults, aiCfg,
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
      return await this._classifyAllNAImagesByLocalOnnxJS(scanStartTime, imagesToClassify);
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
      return await this._classifyAllNAImagesByLocalOnnxJS(scanStartTime, imagesToClassify);
    }
    return await this._classifyAllNAImagesByCloudJS(scanStartTime, imagesToClassify, aiCfg);
  }

  /** M2/M3 不做相似检测；返回空让上层流程跑通 */
  async similarityDetectionPhase() {
    return { success: true, groups: [] };
  }

  /** M3 不做位置富化；后续接 EXIF + cityLocationService */
  async enrichLocationInfo() {
    return true;
  }

  getScanVersion() {
    return 'ios-m3-1.0.0';
  }

  isUsingNativeScan() {
    return IS_NATIVE_AVAILABLE;
  }
}

export default GalleryScannerService;
