/**
 * GalleryScannerService.ios.js — iOS 端相册扫描
 *
 * 对应 Android 的 GalleryScannerService.android.js（同 API、同输出形状）；
 * 区别在于：iOS 数据源是 PhotoKit（PHAsset），通过原生模块 PhotoKitModule 暴露给 JS。
 *
 * M2 范围：
 *   - 系统授权（首次自动弹原生对话框）
 *   - 一次性把所有照片元数据拉回来
 *   - 转成 Android 通用的 image 记录形状（uri = "ph://<localIdentifier>"）
 *   - 批量落 SQLite + 刷新 GlobalImageCache
 *   - 进度回调（仅"扫描"和"完成"两阶段，PhotoKit 太快没必要分段）
 *
 * 不在 M2 范围（M3 / 后续）：
 *   - AI 分类（需要从 ph:// 拉 base64/tensor 给 ONNX，单独工作量）
 *   - 增量扫描（PHPhotoLibraryChangeObserver 订阅）
 *   - 相似组检测、EXIF 富化、城市反解
 */

import { NativeModules } from 'react-native';
import { logger } from '../adapters/WebAdapters';
import UnifiedDataService from './UnifiedDataService';

const { PhotoKitModule } = NativeModules;

const IS_NATIVE_AVAILABLE = !!(PhotoKitModule && PhotoKitModule.fetchAllPhotos);

/** PHAsset → 业务层 image 记录（与 Android 形状对齐，category 默认 'NA'）*/
function toImageRecord(asset) {
  return {
    // 业务层主键：直接复用 PHAsset.localIdentifier（稳定、且后续删除/拉数据都靠它）
    id: asset.id,
    // RN <Image> 在 iOS 端能直接消费 ph:// URI；统一存这个，预览/缩略都不需要再绕
    uri: asset.uri, // "ph://<localIdentifier>"
    fileName: asset.fileName,
    size: asset.size || 0,
    // takenAt 是 ms；timestamp 也用同一个时间做兜底（很多查询按 timestamp 排序）
    takenAt: asset.takenAt || 0,
    timestamp: asset.takenAt || 0,
    width: asset.width || 0,
    height: asset.height || 0,
    mimeType: asset.mimeType || 'image/jpeg',
    // 截图直接打上 'screenshot' 分类，跳过 AI（与 Android 同款规则）；其它先留待分类
    category: asset.isScreenshot ? 'screenshot' : 'NA',
    confidence: asset.isScreenshot ? 'system' : null,
    // 业务期望的标签 / 颜色等字段在 M2 阶段都留空，等 M3 真扫起 AI 再补
    message: null,
    background_color: null,
    // 位置 / EXIF 在 M3 补
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
  }

  async initialize() {
    if (!IS_NATIVE_AVAILABLE) {
      logger.warn('[iOS] PhotoKitModule 不可用——可能是 Pods 没装好或原生模块未编进 app');
      return false;
    }
    logger.debug('[iOS] GalleryScannerService.initialize OK（PhotoKitModule 已挂上）');
    return true;
  }

  /** 内部：拿一次相册访问权限（弹系统对话框；用户拒绝直接抛错由上层提示）*/
  async _ensureAuthorization() {
    if (!IS_NATIVE_AVAILABLE) {
      throw new Error('PhotoKitModule 不可用');
    }
    let current = 'notDetermined';
    try {
      const r = await PhotoKitModule.getAuthorizationStatus();
      current = (r && r.status) || 'notDetermined';
    } catch (_) { /* getAuthorizationStatus 失败就视作未定 */ }

    if (current === 'authorized' || current === 'limited') return current;
    if (current === 'denied' || current === 'restricted') {
      const e = new Error('iOS 相册访问被拒绝（系统设置 → ImagePilot → 照片）');
      e.code = 'E_PERMISSION_DENIED';
      throw e;
    }
    // notDetermined → 弹对话框
    const granted = await PhotoKitModule.requestAuthorization();
    const status = (granted && granted.status) || 'denied';
    if (status === 'authorized' || status === 'limited') return status;
    const e = new Error('iOS 相册访问未授权');
    e.code = 'E_PERMISSION_DENIED';
    throw e;
  }

  /**
   * 全量扫描（M2 不做增量）。
   * @param {(progress:object) => void} onProgress
   */
  async scanGalleryWithProgress(onProgress = null, _compareLimitOrOptions = null) {
    const emit = (progress) => {
      const cb = onProgress || this.onProgress;
      if (cb) cb(progress);
    };

    try {
      this.isScanning = true;
      this.scanStartTimestamp = new Date();

      emit({ stage: 'authorizing', message: '请求相册访问授权…', processed: 0, total: 0 });
      const authStatus = await this._ensureAuthorization();
      logger.debug('[iOS] 相册授权:', authStatus);

      emit({ stage: 'fetching', message: '读取相册中…', processed: 0, total: 0 });
      const result = await PhotoKitModule.fetchAllPhotos();
      const items = (result && result.items) || [];
      logger.debug(`[iOS] PhotoKit 返回 ${items.length} 张照片`);

      if (items.length === 0) {
        emit({ stage: 'complete', message: '相册为空', processed: 0, total: 0 });
        return { success: true, total: 0, images: [] };
      }

      // 1) 批量转 → image 记录
      const records = items.map(toImageRecord);

      // 2) 批量写 SQLite + 刷新 GlobalImageCache（同 Android 路径）
      emit({ stage: 'saving', message: `落库 ${records.length} 张…`, processed: 0, total: records.length });
      await UnifiedDataService.writeImageDetailedInfo(records, true);

      const duration = Date.now() - this.scanStartTimestamp.getTime();
      emit({ stage: 'complete', message: `完成（${duration}ms）`, processed: records.length, total: records.length });
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

  /** M2 不做相似检测；返回空组即可，让上层流程跑通 */
  async similarityDetectionPhase() {
    return { success: true, groups: [] };
  }

  /** M2 不做位置富化；M3 时用 EXIF + cityLocationService 补 */
  async enrichLocationInfo() {
    return true;
  }

  /** M2 不做 AI 分类；上层 HomeScreen.handleAIClassifyNA 看到 success:false 会平稳提示 */
  async aiImageClassifyByContent(_scanStartTime = null, _imagesToClassify = null, _opts = {}) {
    return { success: false, error: 'iOS 端 AI 分类功能开发中（M3）' };
  }

  getScanVersion() {
    return 'ios-m2-1.0.0';
  }

  isUsingNativeScan() {
    return IS_NATIVE_AVAILABLE;
  }
}

export default GalleryScannerService;
