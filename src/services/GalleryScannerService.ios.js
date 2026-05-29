/**
 * GalleryScannerService.ios.js — iOS 端骨架（M1 占位）
 *
 * 目的：让 App 在 iOS 上能启动，进首页/分类页/设置页都不崩；
 * 真正的 PhotoKit 扫描在 M2 里实现（写 PhotoKitModule.swift + 调 PHFetchResult）。
 *
 * 方法签名严格对齐 .android.js（HomeScreen 等业务层用同一套 API），M1 阶段：
 *   - initialize() / enrichLocationInfo() / similarityDetectionPhase()：no-op
 *   - scanGalleryWithProgress / startScan：弹"iOS 扫描功能开发中"，不真正扫
 *   - aiImageClassifyByContent：返回 success:false，让上层界面平稳处理
 *   - getScanVersion / isUsingNativeScan：返回标识性常量
 *
 * 见 [[imagepilot-modernization]] iOS 端落地计划 M2 节。
 */

import { logger } from '../adapters/WebAdapters';

class GalleryScannerService {
  constructor() {
    this.isScanning = false;
    this.scanStartTimestamp = null;
    this.onProgress = null;
    this.imagesClassified = 0;
    this.totalImagesToBeClassified = 0;
  }

  async initialize() {
    logger.debug('[iOS][stub] GalleryScannerService.initialize（M1 占位，无实质动作）');
    return true;
  }

  /** M1 不真扫 —— 进度回调一句话告知，立即结束 */
  async scanGalleryWithProgress(onProgress = null, _compareLimitOrOptions = null) {
    const cb = onProgress || this.onProgress;
    if (cb) cb({ stage: 'ios_stub', message: 'iOS 端扫描功能开发中（M2）', processed: 0, total: 0 });
    return { success: false, error: 'iOS 扫描功能开发中（M2）', images: [] };
  }

  async startScan(_options = {}, onProgress = null) {
    return this.scanGalleryWithProgress(onProgress);
  }

  async similarityDetectionPhase() {
    return { success: true, groups: [] };
  }

  async enrichLocationInfo() {
    return true;
  }

  /**
   * M1 不分类。上层（HomeScreen handleAIClassifyNA）会把 result.success===false
   * 当作普通失败提示，不崩。
   */
  async aiImageClassifyByContent(_scanStartTime = null, _imagesToClassify = null, _opts = {}) {
    return { success: false, error: 'iOS 端 AI 分类功能开发中（M2）' };
  }

  getScanVersion() {
    return 'ios-stub-1.0.0';
  }

  isUsingNativeScan() {
    return false;
  }
}

export default GalleryScannerService;
