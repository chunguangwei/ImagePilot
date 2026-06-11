/**
 * GalleryScannerService.android.js
 * Android平台专用的扫描服务
 * 
 * 功能：
 * 1. 调用原生层GalleryScanModule启动扫描
 * 2. 监听原生层发送的进度、完成、错误事件
 * 3. 原生层扫描完成后，执行JS层后续处理：
 *    - 位置信息补全
 *    - 本地推理和规则映射（NA分类图片）
 *    - 相似度检测
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import { logger, getUri, RNFS, getLocalPath } from '../adapters/WebAdapters';
import UnifiedDataService from './UnifiedDataService';
import ImageClassifierService from './ImageClassifierService';
import ImageProcessor from './ImageProcessor';
import cityLocationService from './CityLocationService';
import ImageSimilarityService from './ImageSimilarityService';
import { ScanService } from '../adapters/ScanServiceAdapter';
import { similarityDetectionPhase as sharedSimilarityDetection } from './similarityDetectionPhase';
import { classifyImageByTier, readActiveTier } from './classify/classifyByTier';
import i18n from '../i18n';

const { GalleryScanModule } = NativeModules;

/**
 * MobileNetV3 top-1 → 应用分类的最低置信度门槛。
 * 0.15：低于此值映射出来错得离谱（5~10% conf ≈ 1/1000 随机猜），
 * 提升路子在改善 1000→9 映射表 + Places365 模型，不在调阈值上。
 */
const MOBILENET_MAP_THRESHOLD = 0.15;

/**
 * 云端 LLM 分类的图片上传规格：长边 768px / JPEG q85。
 * 视觉 LLM（GPT-4o/Claude/Gemini）内部本就把图降采样到 ~768 的 tile 再编码，传更大几乎不增准度、
 * 纯浪费带宽。768/q85 比原来的 1024/q90 上传体积小近一半，识别准度实测基本不变；
 * 文字/证件类极端场景略糊，但本地 ONNX 档（idcard/screenshot）另有路径。
 */
const CLOUD_LLM_MAX_EDGE = 768;
const CLOUD_LLM_JPEG_QUALITY = 85;

class GalleryScannerService {
  constructor() {
    // 🆕 标识：这是Android原生扫描版本
    this.isNativeScanVersion = true;
    this.scanVersion = 'native-android';
    
    this.isScanning = false;
    this._stopRequested = false;   // 用户请求停止 JS 分类循环（见 requestStop）
    this.currentScanId = null;
    this.onProgress = null;
    this.imageClassifier = new ImageClassifierService();
    this.similarityService = new ImageSimilarityService();
    this.eventEmitter = null;
    this.progressSubscriptions = [];
    
    // 核心指标
    this.totalImagesToBeClassified = 0; // 总分类目标（原生层扫描完成后确定，后续阶段不更新）
    this.imagesClassified = 0; // 已分类数量（原生层扫描完成后确定，后续阶段不更新）
    
    // 进度更新控制
    this.lastRefreshCount = 0; // 上次刷新时的分类成功数
    this.lastSimilarityRefreshCount = 0; // 上次相似度检测刷新时的相似组数
    this.lastScreenshotRefreshCount = 0; // 上次截图检测刷新时的处理数量
    this.lastLocationRefreshCount = 0; // 上次位置信息补全刷新时的处理数量
    this.scanStartTimestamp = null; // 扫描开始时间戳
    
    // 初始化事件监听器
    if (GalleryScanModule) {
      this.eventEmitter = new NativeEventEmitter(GalleryScanModule);
      logger.info('✅ 原生扫描服务已初始化 - GalleryScanModule 可用');
    } else {
      logger.warn('⚠️ GalleryScanModule 不可用，原生扫描功能将无法使用');
    }
    
    // 输出版本信息，方便调试
    logger.info(`📱 GalleryScannerService (${this.scanVersion}) 已创建`);
  }
  
  /**
   * 检查是否使用原生扫描
   * @returns {boolean} 是否使用原生扫描
   */
  isUsingNativeScan() {
    return this.isNativeScanVersion === true && GalleryScanModule !== null && GalleryScanModule !== undefined;
  }
  
  /**
   * 获取扫描版本信息
   * @returns {string} 扫描版本信息
   */
  getScanVersion() {
    return this.scanVersion;
  }

  /**
   * 初始化服务
   * 原生扫描版本不需要复杂的初始化，只需要初始化相似度检测服务
   */
  async initialize() {
    // 原生扫描版本不需要从配置中读取路径（路径由startScan传入）
    // 只需要初始化相似度检测服务
    try {
      await this.similarityService.initialize();
      logger.info('✅ 原生扫描服务初始化完成');
    } catch (error) {
      logger.error('❌ 初始化相似度检测服务失败:', error);
      throw error;
    }
  }

  /**
   * 扫描相册（兼容JS层接口）
   * @param {Function} onProgress - 进度回调函数
   * @param {number|Object} compareLimitOrOptions - 比对限制或选项对象
   * @returns {Promise<Object>} 扫描结果
   */
  async scanGalleryWithProgress(onProgress = null, compareLimitOrOptions = null) {
    try {
      logger.debug('🚀 开始原生扫描（通过scanGalleryWithProgress接口）');
      
      // 处理参数：可能是数字（compareLimit）或对象（options）
      let options = {};
      if (typeof compareLimitOrOptions === 'number') {
        options.compareLimit = compareLimitOrOptions;
      } else if (compareLimitOrOptions && typeof compareLimitOrOptions === 'object') {
        options = compareLimitOrOptions;
      }
      
      // 如果没有指定扫描路径，从配置中读取
      if (!options.scanPaths || options.scanPaths.length === 0) {
        const settings = await UnifiedDataService.readSettings();
        options.scanPaths = settings.scanPaths || [];
      }
      
      // 调用startScan方法
      return await this.startScan(options, onProgress);
    } catch (error) {
      // 如果是"扫描已在进行中"的错误，使用 info 级别而不是 error
      if (error.message && error.message.includes(i18n.t('home.scanAlreadyInProgress'))) {
        logger.info('ℹ️ 扫描已在进行中:', error.message);
      } else {
        logger.error('❌ 扫描失败:', error);
      }
      throw error;
    }
  }

  /**
   * 启动扫描
   * @param {Object} options - 扫描选项
   * @param {string[]} options.scanPaths - 扫描路径数组（相对路径，如 ["DCIM/Camera"]）
   * @param {number} options.compareLimit - 比对限制（0表示不限制，推荐值：100用于快速测试，1000用于正常使用）
   * @param {Function} onProgress - 进度回调函数
   * @returns {Promise<Object>} 扫描结果
   */
  async startScan(options = {}, onProgress = null) {
    // 检查是否已经在扫描中（JS层标志）
    if (this.isScanning) {
      const errorMsg = i18n.t('home.scanAlreadyInProgress');
      logger.warn(`⚠️ ${errorMsg}`);
      throw new Error(errorMsg);
    }

    // 检查原生模块是否可用
    if (!GalleryScanModule) {
      logger.error('❌ GalleryScanModule 不可用，无法使用原生扫描');
      throw new Error(i18n.t('home.galleryScanModuleUnavailable'));
    }
    
    // 🔥 检查原生服务是否正在运行，如果正在运行则拒绝新扫描（保护正在进行的扫描任务）
    try {
      const isRunning = await ScanService.isRunning();
      if (isRunning) {
        const errorMsg = i18n.t('home.scanAlreadyInProgress');
        logger.info(`ℹ️ 检测到扫描服务正在运行，拒绝新扫描请求: ${errorMsg}`);
        throw new Error(errorMsg);
      }
    } catch (error) {
      // 如果检查服务状态失败，但错误不是我们主动抛出的，记录警告但继续
      if (error.message === i18n.t('home.scanAlreadyInProgress')) {
        // 这是我们主动抛出的错误，直接重新抛出
        throw error;
      }
      logger.warn('⚠️ 检查服务状态失败，但继续启动扫描:', error);
    }
    
    // 确认使用原生扫描
    logger.info('🚀 启动原生扫描服务 (Native Android Scan)');
    logger.info(`📋 扫描版本: ${this.scanVersion}`);
    logger.info(`✅ 原生模块状态: ${GalleryScanModule ? '可用' : '不可用'}`);

    // 设置扫描状态和回调
    this.isScanning = true;
    this.onProgress = onProgress;
    
    // 记录扫描开始时间（用于阶段6相似度检测）
    this.scanStartTimestamp = new Date();
    
    // 重置统计变量
    this.lastRefreshCount = 0;
    this.lastSimilarityRefreshCount = 0;
    this.lastScreenshotRefreshCount = 0;
    this.lastLocationRefreshCount = 0;
    this.currentScanId = null;

    // 创建 Promise 来等待扫描完成
    let scanResolve, scanReject;
    const scanPromise = new Promise((resolve, reject) => {
      scanResolve = resolve;
      scanReject = reject;
    });
    this.scanResolve = scanResolve;
    this.scanReject = scanReject;

    try {
      // 先设置事件监听器，确保能接收到所有事件
      this.setupEventListeners();
      
      // Android平台：启动前台服务，支持后台扫描
      ScanService.start();

      // 发送初始化进度消息
      await this.sendProgressMessage('initializing', 0, 0);

      // 🆕 启动基础扫描（阶段1、2、3a：目录扫描、文件比对、截图检测）
      logger.info('🚀 启动基础扫描服务...');
      const result = await GalleryScanModule.startBasicImageScan({
        scanPaths: options.scanPaths || [],
        compareLimit: options.compareLimit || 0,
      });

      this.currentScanId = result.scanId;
      this.totalImagesToBeClassified = result.totalImagesToBeClassified || 0;
      const hasNewImages = result.hasNewImages !== false; // 默认为true，如果没有这个字段
      
      logger.info(`✅ 基础扫描已启动: ${result.scanId}, 总数量: ${this.totalImagesToBeClassified}, 是否有新增照片: ${hasNewImages}`);

      // 🔥 如果没有新增照片，直接结束扫描，不执行后续流程
      if (!hasNewImages) {
        logger.info('✅ 没有新增照片，直接结束扫描');
        // 清理扫描状态
        this._cleanupScanState();
        // 通知等待的 Promise 扫描已完成（无新照片）
        if (this.scanResolve) {
          this.scanResolve();
          this.scanResolve = null;
          this.scanReject = null;
        }
        // 返回结果，不发送任何进展消息
        return {
          success: true,
          scanId: result.scanId,
          totalImagesToBeClassified: 0,
          hasNewImages: false
        };
      }

      // 等待基础扫描完成（通过事件监听器 resolve/reject）
      await scanPromise;


      

      // 返回扫描结果
      return {
        success: true,
        scanId: result.scanId,
        totalImagesToBeClassified: this.totalImagesToBeClassified,
      };

    } catch (error) {
      logger.error('❌ 启动扫描失败:', error);
      // 确保在错误时清理状态
      this._cleanupScanState();
      // 如果 Promise 还没有 resolve/reject，reject 它
      if (this.scanReject) {
        this.scanReject(error);
        this.scanResolve = null;
        this.scanReject = null;
      }
      throw error;
    }
  }

  /**
   * 清理扫描状态（内部方法）
   * @private
   */
  _cleanupScanState() {
    this.isScanning = false;
    this.currentScanId = null;
    this.onProgress = null;
    this.removeEventListeners();
    ScanService.stop();
    // 注意：不在这里清理 scanResolve/scanReject，让事件处理器来清理
  }

  /**
   * 设置事件监听器
   */
  setupEventListeners() {
    if (!this.eventEmitter) {
      logger.warn('⚠️ eventEmitter 未初始化，无法设置事件监听器');
      return;
    }

    logger.info('📡 设置事件监听器...');

    // 监听进度事件
    const progressSubscription = this.eventEmitter.addListener(
      'GalleryScanProgress',
      async (event) => {
        await this.handleProgressEvent(event);
      }
    );

    // 监听错误事件
    const errorSubscription = this.eventEmitter.addListener(
      'GalleryScanError',
      async (event) => {
        await this.handleErrorEvent(event);
      }
    );

    this.progressSubscriptions = [
      progressSubscription,
      errorSubscription,
    ];
  }

  /**
   * 移除事件监听器
   */
  removeEventListeners() {
    this.progressSubscriptions.forEach(subscription => {
      subscription.remove();
    });
    this.progressSubscriptions = [];
  }

  /**
   * 处理进度事件
   */
  async handleProgressEvent(event) {
    const { stage, filesProcessed, filesFound, totalImagesToBeClassified, imagesClassified, scanId } = event;
    
    // 🔥 检查 scanId 是否匹配当前扫描，防止处理旧扫描的事件
    if (scanId && this.currentScanId && scanId !== this.currentScanId) {
      logger.debug(`⚠️ 忽略旧扫描的进度事件: scanId=${scanId}, currentScanId=${this.currentScanId}, stage=${stage}`);
      return; // 忽略旧扫描的事件
    }
    
    // 🆕 如果是基础扫描完成事件，只完成基础扫描，不执行AI分类
    if (stage === 'basic_scan_completed') {
      // 更新核心指标（从原生层进度事件中获取）
      if (imagesClassified !== undefined) {
        this.imagesClassified = imagesClassified;
      }
      if (totalImagesToBeClassified !== undefined) {
        this.totalImagesToBeClassified = totalImagesToBeClassified;
      }
      
      logger.info(`✅ 基础扫描完成: ${scanId}, 已处理: ${this.imagesClassified}/${this.totalImagesToBeClassified}`);
      
      try {
        // 视频从 NA 迁到「待分类视频」NA_video（原生扫描把视频按 NA 入库）。放在"基础扫描完成"里，
        // 不依赖是否触发 AI 分类——只扫描也会迁移。幂等。
        try { await UnifiedDataService.migrateUnclassifiedVideos(); } catch (_) {}

        // 🔥 位置信息补全（在发送 completed 消息之前完成）
        try {
          await this.enrichLocationInfo();
        } catch (error) {
          logger.error('❌ 位置信息补全失败（不影响基础扫描完成）:', error);
          // 位置信息补全失败不影响基础扫描完成，继续执行
        }

        // 发送基础扫描完成消息（AI分类需要用户手动触发）
        // 注意：completed 消息会触发 processProgressData 自动重建缓存
        await this.sendProgressMessage('completed', this.imagesClassified, this.totalImagesToBeClassified, this.imagesClassified, this.totalImagesToBeClassified);

        logger.info('✅ 基础扫描完全结束（AI分类需要用户手动触发）');

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

        // 存量视频时长回填（fire-and-forget，幂等）：旧版扫入库的视频 duration=0，
        // 原生增量扫描不会重写它们——批量取 MediaMetadataRetriever 时长补进 DB（每轮最多 200 条）。
        (async () => {
          try {
            const all = await UnifiedDataService.readAllImages();
            const missing = (Array.isArray(all) ? all : [])
              .filter((i) => String(i.mimeType || '').startsWith('video/') && !(i.duration > 0))
              .slice(0, 200);
            if (missing.length === 0) return;
            const map = await NativeModules.MediaStoreModule.getVideoDurations(missing.map((m) => m.uri));
            const updates = missing
              .filter((m) => map && map[m.uri] > 0)
              .map((m) => ({ id: m.id, duration: map[m.uri] }));
            if (updates.length > 0) {
              await UnifiedDataService.batchUpdateClassification(updates, false);
              try { await UnifiedDataService.imageCache.refreshCache(); } catch (_) {}
              logger.info(`⏱️ 存量视频时长回填 ${updates.length} 条`);
            }
          } catch (e) {
            logger.debug('视频时长回填失败（不影响扫描）:', e?.message || e);
          }
        })();

      } catch (error) {
        logger.error('❌ 后续处理失败:', error);
        await this.sendProgressMessage('error', 0, 0);
      } finally {
        // 清理扫描状态
        this._cleanupScanState();
        // 通知等待的 Promise 基础扫描已完成
        if (this.scanResolve) {
          this.scanResolve();
          this.scanResolve = null;
          this.scanReject = null;
        }
      }
      
      return; // 直接返回，不处理进度更新
    }
    
    // 🆕 如果是AI分类完成事件，完成AI分类流程
    if (stage === 'ai_classification_completed') {
      // 更新核心指标（从原生层进度事件中获取）
      if (imagesClassified !== undefined) {
        this.imagesClassified = imagesClassified;
      }
      if (totalImagesToBeClassified !== undefined) {
        this.totalImagesToBeClassified = totalImagesToBeClassified;
      }
      
      logger.info(`✅ AI分类完成: ${scanId}, 已分类: ${this.imagesClassified}/${this.totalImagesToBeClassified}`);
      
      try {
        // 发送AI分类完成消息
        // 注意：completed 消息会触发 processProgressData 自动重建缓存
        await this.sendProgressMessage('completed', this.imagesClassified, this.totalImagesToBeClassified, this.imagesClassified, this.totalImagesToBeClassified);
        
        logger.info('✅ AI分类完全结束');

      } catch (error) {
        logger.error('❌ AI分类后续处理失败:', error);
        await this.sendProgressMessage('error', 0, 0);
      } finally {
        // 清理扫描状态
        this._cleanupScanState();
        // 通知等待的 Promise AI分类已完成
        if (this.scanResolve) {
          this.scanResolve();
          this.scanResolve = null;
          this.scanReject = null;
        }
      }
      return; // 直接返回，不处理进度更新
    }
    
    // 其他进度事件正常处理
    // 更新核心指标（从原生层进度事件中获取）
    if (imagesClassified !== undefined) {
      this.imagesClassified = imagesClassified;
    }
    if (totalImagesToBeClassified !== undefined) {
      this.totalImagesToBeClassified = totalImagesToBeClassified;
    }
    
    // 调用 sendProgressMessage 统一处理进度更新（包括消息生成、UI更新、前台服务更新）
    try {
      await this.sendProgressMessage(stage, filesProcessed, filesFound, imagesClassified, totalImagesToBeClassified);
    } catch (error) {
      logger.error(`❌ 发送进度消息失败 [${stage}]:`, error);
    }
  }


  /**
   * 处理错误事件
   */
  async handleErrorEvent(event) {
    const { message, stage } = event;
    logger.error(`❌ 扫描错误 [${stage}]: ${message}`);
    
    try {
      await this.sendProgressMessage('error', 0, 0);
    } catch (error) {
      logger.error('❌ 发送错误消息失败:', error);
    } finally {
      // 清理扫描状态
      this._cleanupScanState();
      // 通知等待的 Promise 扫描已出错
      if (this.scanReject) {
        // 如果消息是中文错误消息，使用国际化翻译；否则直接使用原消息
        let errorMessage = message;
        if (message && message.includes('扫描失败')) {
          // 提取原始错误信息（如果有）
          const originalError = message.replace('扫描失败: ', '');
          errorMessage = i18n.t('home.scanFailed', { error: originalError });
        } else if (!message) {
          errorMessage = i18n.t('home.scanFailed', { error: '' });
        }
        this.scanReject(new Error(errorMessage));
        this.scanResolve = null;
        this.scanReject = null;
      }
    }
  }

  /**
   * 停止扫描（手动停止）
   */
  stopScan() {
    if (!this.isScanning) {
      logger.warn('⚠️ 当前没有进行中的扫描');
      return;
    }
    
    logger.info('🛑 手动停止扫描');
    this._cleanupScanState();
  }

  /**
   * 优雅停止"JS 离线分类"循环（如 VLM 大模型逐张分类太慢时）。
   * 只置停止标志，不动 onProgress —— 让循环检测后 break，仍走完 refreshCache + 完成事件，
   * 使已分类的（每张已即时落库）立刻归位、UI 可见；剩余 NA 图下次扫描自动续。
   */
  requestStop() {
    if (this.isScanning) {
      logger.info('🛑 用户请求停止分类（保留已分类结果，剩余下次续扫）');
      this._stopRequested = true;
      // 原生基础扫描阶段（EXIF/截图检测，长循环在 Java）也要能停——通知原生置停止标志
      try {
        if (GalleryScanModule && typeof GalleryScanModule.stopScan === 'function') {
          GalleryScanModule.stopScan().catch(() => {});
        }
      } catch (_) { /* 原生不可用时仅停 JS 循环 */ }
    }
  }

  /**
   * 🆕 AI分类处理阶段 - 对指定图片或所有NA分类图片进行AI分类
   * @param {string} scanStartTime - 扫描开始时间（可选）
   * @param {Array} imagesToClassify - 可选，指定需要分类的照片数组。如果未指定，则读取所有NA分类的照片
   * @returns {Promise<Object>} 处理结果 { processedCount, failedCount }
   */
  /**
   * 纯 JS 离线分类：bypass 原生 scanner，用 ImageClassifierService.classifyImageWithMobileNetV3
   * 直接遍历 NA 图，结果走 UnifiedDataService.batchUpdateClassification 落库。完全离线，飞行模式可用。
   * @param {Date|null} scanStartTime
   * @param {Array|null} imagesToClassify - null 则取所有 NA 分类图片
   */
  async _classifyAllNAImagesByLocalOnnxJS(scanStartTime, imagesToClassify) {
    logger.info('🚀 启动 JS 端离线 AI 分类（MobileNetV3，绕过 native scanner）');
    this.isScanning = true;
    this._stopRequested = false;   // 用户停止标志（requestStop 置 true，循环逐张检测后优雅退出）
    // 视频先从 NA 迁到「待分类视频」NA_video（原生扫描把视频按 NA 入库）→ 不进下面的分类集。
    try { await UnifiedDataService.migrateUnclassifiedVideos(); } catch (_) {}
    this.scanStartTimestamp = scanStartTime || new Date();

    try {
      // 取待分类图片列表
      let naImages = [];
      if (imagesToClassify && Array.isArray(imagesToClassify) && imagesToClassify.length > 0) {
        naImages = imagesToClassify;
      } else {
        await UnifiedDataService.imageCache.buildCache();
        try {
          naImages = await UnifiedDataService.readImagesByCategory('NA');
        } catch (e) {
          logger.error('❌ 读取 NA 图片失败:', e);
          naImages = [];
        }
        // 待分类视频也纳入自动分类：抽中间帧走同一图片分类链路（抽帧失败保持 NA_video）
        try {
          const naVideos = await UnifiedDataService.readImagesByCategory('NA_video');
          if (naVideos && naVideos.length > 0) naImages = naImages.concat(naVideos);
        } catch (_) {}
      }
      this.totalImagesToBeClassified = naImages.length;
      this.imagesClassified = 0;
      logger.info(`📊 JS 离线分类目标：${naImages.length} 张 NA 图片（含待分类视频）`);

      await this.sendProgressMessage('initializing', 0, naImages.length, 0, naImages.length);

      if (naImages.length === 0) {
        await this.sendProgressMessage('completed', 0, 0, 0, 0);
        return { success: true, processedCount: 0, failedCount: 0 };
      }

      // 初始化分类器（首次会从配置加载模型表 + ONNX runtime + 加载 mobilenetv3 模型；幂等）
      try {
        await this.imageClassifier.initialize();
        logger.info('✅ ImageClassifierService 初始化完成');
      } catch (e) {
        logger.error('❌ ImageClassifierService 初始化失败:', e);
        await this.sendProgressMessage('error', 0, naImages.length);
        throw new Error(`离线模型加载失败：${e?.message || e}`);
      }

      let processedCount = 0;
      let failedCount = 0;
      // VLM（多模态大模型）秒级/张：用 BATCH=1，让进度条与落库都「一张一张」推进，
      // 用户能实时看到百分比走动、结果逐张出现；基础/CLIP 等快引擎保持 20 批量以省 IO。
      const preTier = await readActiveTier();
      const BATCH = (preTier && preTier.engine === 'vlm') ? 1 : 20;
      let stoppedByUser = false;
      for (let i = 0; i < naImages.length; i += BATCH) {
        // 用户停止：逐批检测，已分类的（每张已即时落库）保留，剩余 NA 图下次扫描自动续。
        if (this._stopRequested) {
          stoppedByUser = true;
          logger.info(`🛑 用户停止分类：已处理 ${processedCount}，剩余 ${naImages.length - i} 张保持待分类`);
          break;
        }
        const batch = naImages.slice(i, i + BATCH);
        const classificationDataArray = [];
        let perImageDone = i;   // 批内逐张进度计数（进度平滑滚动）
        // 当前批次共用一个 tier（每批读一次 settings，避免单图 IO）
        const activeTier = await readActiveTier();
        for (const image of batch) {
          // 批内逐张可停（快引擎 BATCH=20 时也能即时停，不必等整批 20 张跑完）。
          // 已分类的（本批已累积的 + 之前批次已落库的）保留；剩余 NA 图下次扫描续。
          if (this._stopRequested) { stoppedByUser = true; break; }
          const isVideo = String(image.mimeType || '').startsWith('video/');
          let frameTemp = null;
          try {
            let imageUri;
            if (isVideo) {
              // 视频自动分类：抽中间帧 → 走同一图片分类链路（封面帧常黑场，中点更具代表性）
              try {
                frameTemp = await NativeModules.MediaStoreModule.extractVideoFrame(image?.uri || String(image?.id || ''));
              } catch (fe) {
                logger.warn(`⚠️ 视频抽帧失败（保持待分类视频）: ${fe?.message || fe}`);
                failedCount++; continue;
              }
              imageUri = frameTemp;
            } else {
              imageUri = getUri(image) || image?.uri;
            }
            if (!imageUri) { failedCount++; continue; }
            // P1：按 tier 路由（basic→ImageNet / scene→Places365 / clip→未接入回退）
            const r = await classifyImageByTier(imageUri, activeTier, { imageClassifier: this.imageClassifier, detailed: naImages.length === 1 });
            const top = r?.topPrediction || null;
            const conf = (typeof r?.confidence === 'number') ? r.confidence : 0;
            let category;
            if (top && conf >= MOBILENET_MAP_THRESHOLD) {
              category = top.appCategory || 'other';
            } else {
              if (top && conf < MOBILENET_MAP_THRESHOLD) {
                logger.debug(`[Android] ${r?.engine || '?'} conf=${conf.toFixed(3)} < ${MOBILENET_MAP_THRESHOLD}，top="${top?.name}" 落 other`);
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
              // VLM 开放式打标：归不进已有类的图落 other，但把模型自拟标签存到 message。
              message: r?.vlmLabel || null,
              background_color: null,
            });
          } catch (e) {
            logger.warn(`⚠️ 离线分类单张失败: ${e?.message || e}`);
            failedCount++;
          } finally {
            // 删抽帧临时文件（失败无妨，cacheDir 系统会自清）
            if (frameTemp) { try { await RNFS.unlink(frameTemp.replace(/^file:\/\//, '')); } catch (_) {} }
          }
          // 批内逐张发进度：百分比平滑滚动，不再 20 张跳一次（界面数据刷新仍按每 20 张节流）
          perImageDone++;
          await this.sendProgressMessage('remote_inference', Math.min(perImageDone, naImages.length), naImages.length, this.imagesClassified, naImages.length);
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
            logger.error(`❌ 离线分类批量落库失败: ${e?.message || e}`);
            failedCount += classificationDataArray.length;
          }
        }
        const done = Math.min(i + BATCH, naImages.length);
        await this.sendProgressMessage('remote_inference', done, naImages.length, this.imagesClassified, naImages.length);
      }

      logger.info(`${stoppedByUser ? '🛑 JS 离线分类已停止' : '✅ JS 离线分类完成'}：成功 ${processedCount}，失败 ${failedCount}`);
      // 不论跑完还是中途停止，都刷 GlobalImageCache → 已分类的（每张已落库）立刻归位、UI 可见；
      // 不然 HomeScreen.loadCategories 读到的 categoryCounts 还是分类前 NA 状态，显示「待分类|N」陈旧数据。
      try {
        await UnifiedDataService.imageCache.refreshCache();
      } catch (e) {
        logger.warn('[Android] 分类后刷新 GlobalImageCache 失败:', e?.message || e);
      }
      await this.sendProgressMessage('completed', processedCount, naImages.length, this.imagesClassified, naImages.length);
      return { success: true, processedCount, failedCount, stopped: stoppedByUser };
    } catch (error) {
      logger.error('❌ JS 离线分类失败:', error);
      throw error;
    } finally {
      this.isScanning = false;
      this._cleanupScanState && this._cleanupScanState();
    }
  }

  /**
   * JS 端云端分类：bypass 原生 scanner，调用用户配置的 LLM Provider（wireLLMRouting.classifyCloudBatch）。
   * 图片 1024 长边压成 jpeg → base64 → 走 user 配的 baseURL（OpenAI/Kimi/Anthropic/Gemini/Ollama/Custom）。
   * 绝不会连接 api.aifuture.net.cn。结果落 batchUpdateClassification。
   * @param {Date|null} scanStartTime
   * @param {Array|null} imagesToClassify
   * @param {object} aiCfg - getAIProviderConfig() 结果（已确认 active != 'local-onnx'）
   */
  async _classifyAllNAImagesByCloudJS(scanStartTime, imagesToClassify, aiCfg) {
    logger.info(`🚀 启动 JS 端云端 AI 分类（${aiCfg.active}，绕过 native scanner / 不连 aifuture.net.cn）`);
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
      logger.info(`📊 JS 云端分类目标：${naImages.length} 张 NA 图片（含待分类视频）`);
      await this.sendProgressMessage('initializing', 0, naImages.length, 0, naImages.length);

      if (naImages.length === 0) {
        await this.sendProgressMessage('completed', 0, 0, 0, 0);
        return { success: true, processedCount: 0, failedCount: 0 };
      }

      // 新一代云端分类（LLMClassifyOrchestrator，最佳实践）：
      // 用用户分类清单驱动 prompt，返回富语义 tags/shortLabel/description，落到 message 字段。
      // 旧的 wireLLMRouting 保留给 PC/iOS 兼容，不再被 Android 调用。
      const { classifyCloudBatchV2 } = await import('./llm/llmClassifyOrchestrator.js');
      const classifyCloudBatch = classifyCloudBatchV2;

      let processedCount = 0;
      let failedCount = 0;
      const BATCH = 10; // 串行小批，控内存；并发由 aiCfg.concurrent 控制
      for (let i = 0; i < naImages.length; i += BATCH) {
        if (this._stopRequested) {
          logger.info(`🛑 用户停止云端分类：已处理 ${processedCount}，剩余 ${naImages.length - i} 张保持待分类`);
          break;
        }
        const batch = naImages.slice(i, i + BATCH);
        // 1) 每张图压成 1024 jpeg → base64
        const inputs = [];
        const validResults = [];
        for (const image of batch) {
          let frameTemp = null;
          try {
            let sourceUri = getUri(image) || image?.uri;
            // 视频：抽中间帧 → 压缩上传（与设备端分类同策略；抽帧失败保持待分类视频）
            if (String(image.mimeType || '').startsWith('video/')) {
              try {
                frameTemp = await NativeModules.MediaStoreModule.extractVideoFrame(image?.uri || String(image?.id || ''));
                sourceUri = frameTemp;
              } catch (fe) {
                logger.warn(`⚠️ 云端分类视频抽帧失败: ${fe?.message || fe}`);
                failedCount++; continue;
              }
            }
            if (!sourceUri) { failedCount++; continue; }
            const resized = await ImageProcessor.resizeImage(sourceUri, CLOUD_LLM_MAX_EDGE, CLOUD_LLM_MAX_EDGE, {
              maintainAspectRatio: true, outputFormat: 'jpeg', quality: CLOUD_LLM_JPEG_QUALITY,
            });
            const resizedUri = resized?.uri;
            if (!resizedUri) { failedCount++; continue; }
            // 注意：getLocalPath() 内部的 normalizeFilePath 会把 `file:///data/...` 错切成 `data/...`
            // （三个斜杠全替换 → 丢前导 /），导致 RNFS 打开失败 ENOENT。这里直接安全地去掉 `file://`，保留前导 `/`。
            const localPath = resizedUri.startsWith('file://') ? resizedUri.replace(/^file:\/\//, '') : resizedUri;
            const base64 = await RNFS.readFile(localPath, 'base64');
            inputs.push({ id: image.id || image.hash || sourceUri, imageBase64: base64 });
            validResults.push({ imageData: image, hash: image.hash || image.id });
          } catch (e) {
            logger.warn(`⚠️ 云端分类预处理失败: ${e?.message || e}`);
            failedCount++;
          } finally {
            if (frameTemp) { try { await RNFS.unlink(frameTemp.replace(/^file:\/\//, '')); } catch (_) {} }
          }
        }
        if (inputs.length === 0) continue;

        // 2) 调 wireLLMRouting（用户自配 provider）
        let batchOut;
        try {
          batchOut = await classifyCloudBatch({
            imageClassifier: this.imageClassifier,
            platform: Platform.OS,
            inputs, validResults, aiCfg,
          });
        } catch (e) {
          logger.error(`❌ 云端 LLM 调用失败: ${e?.message || e}`);
          failedCount += inputs.length;
          continue;
        }

        // 3) 落库
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
            logger.error(`❌ 云端分类落库失败: ${e?.message || e}`);
            failedCount += classificationDataArray.length;
          }
        }
        const done = Math.min(i + BATCH, naImages.length);
        await this.sendProgressMessage('remote_inference', done, naImages.length, this.imagesClassified, naImages.length);
      }

      logger.info(`✅ JS 云端分类完成：成功 ${processedCount}，失败 ${failedCount}`);
      try {
        await UnifiedDataService.imageCache.refreshCache();
      } catch (e) {
        logger.warn('[Android] 云端分类后刷新 GlobalImageCache 失败:', e?.message || e);
      }
      await this.sendProgressMessage('completed', processedCount, naImages.length, this.imagesClassified, naImages.length);
      return { success: true, processedCount, failedCount };
    } catch (error) {
      logger.error('❌ JS 云端分类失败:', error);
      throw error;
    } finally {
      this.isScanning = false;
      this._cleanupScanState && this._cleanupScanState();
    }
  }

  async aiImageClassifyByContent(scanStartTime = null, imagesToClassify = null, opts = {}) {
    // 检查是否已经在扫描中
    if (this.isScanning) {
      const errorMsg = i18n.t('home.scanAlreadyInProgress');
      logger.warn(`⚠️ ${errorMsg}`);
      throw new Error(errorMsg);
    }

    // ⚠️ 关键安全/隐私决策：始终绕开 native scanner（GalleryScanService.java）做"AI 分类"。
    // 原作者 Java 层硬编码了 https://api.aifuture.net.cn/api/v2/classify/batch* 的免费缓存/推理端点，
    // 用户即使未配置 LLM 也会"分类成功"——图片实际上传给了第三方。本仓库（fork ImagePilot）的
    // 隐私承诺是：仅设备端 ONNX 或用户自配 Provider，绝不联第三方/作者服务器。
    // 因此 Android 端的"分类阶段"全部走 JS 路径：
    //   - forceLocal=true 或 active='local-onnx' → 设备端 MobileNetV3
    //   - active=云端 Provider                    → JS 端 wireLLMRouting（用户自配）
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

    // 检查原生模块是否可用
    /* eslint-disable no-unreachable */
    if (!GalleryScanModule) {
      logger.error('❌ GalleryScanModule 不可用，无法使用原生AI分类');
      throw new Error(i18n.t('home.galleryScanModuleUnavailable'));
    }

    logger.info('🚀 启动AI分类服务 (Native Android AI Classification)');

    // 设置扫描状态和回调
    this.isScanning = true;
    
    // 记录扫描开始时间
    if (!scanStartTime) {
      scanStartTime = new Date();
    }
    this.scanStartTimestamp = scanStartTime;
    
    // 重置统计变量
    this.lastRefreshCount = 0;
    this.lastSimilarityRefreshCount = 0;
    this.lastScreenshotRefreshCount = 0;
    this.lastLocationRefreshCount = 0;
    this.currentScanId = null;

    // 创建 Promise 来等待AI分类完成
    let scanResolve, scanReject;
    const scanPromise = new Promise((resolve, reject) => {
      scanResolve = resolve;
      scanReject = reject;
    });
    this.scanResolve = scanResolve;
    this.scanReject = scanReject;

    try {
      // 先设置事件监听器，确保能接收到所有事件
      this.setupEventListeners();
      
      // Android平台：启动前台服务，支持后台扫描
      ScanService.start();

      // 发送初始化进度消息
      await this.sendProgressMessage('initializing', 0, 0);

      // 准备图片列表（如果需要转换为ImageInfo格式）
      let imagesToClassifyList = null;
      if (imagesToClassify && Array.isArray(imagesToClassify) && imagesToClassify.length > 0) {
        // 转换为原生层需要的格式
        imagesToClassifyList = imagesToClassify.map(img => ({
          uri: img.uri,
          fileName: img.fileName,
          path: img.path,
          id: img.id
        }));
        logger.info(`📊 使用指定的 ${imagesToClassifyList.length} 张图片进行AI分类`);
      }

      // 🔥 获取客户端ID（用于API请求）
      const clientId = await UnifiedDataService.getClientId();
      
      // 🆕 启动原生层AI分类
      logger.info('🚀 启动原生层AI分类服务...');
      const result = await GalleryScanModule.startAiImageClassifyByContent({
        scanId: null, // 自动生成新的scanId
        imagesToClassify: imagesToClassifyList, // 如果为null，原生层会读取所有NA分类图片
        userId: clientId || null, // 🔥 传递用户ID
      });

      this.currentScanId = result.scanId;
      this.totalImagesToBeClassified = result.totalImagesToBeClassified || 0;
      logger.info(`✅ 原生层AI分类已启动: ${result.scanId}, 总数量: ${this.totalImagesToBeClassified}`);

      // 等待AI分类完成（通过事件监听器 resolve/reject）
      await scanPromise;

      // 返回扫描结果
      return {
        success: true,
        scanId: result.scanId,
        totalImagesToBeClassified: this.totalImagesToBeClassified,
      };

    } catch (error) {
      logger.error('❌ 启动AI分类失败:', error);
      // 确保在错误时清理状态
      this._cleanupScanState();
      // 如果 Promise 还没有 resolve/reject，reject 它
      if (this.scanReject) {
        this.scanReject(error);
        this.scanResolve = null;
        this.scanReject = null;
      }
      throw error;
    }
  }

  /**
   * 位置信息补全
   * 对已有GPS坐标但没有位置信息（city/country）的图片，查询并更新位置信息
   * 注意：原生层扫描时已经提取过EXIF GPS信息，这里直接使用已有的坐标
   * 使用v2批量接口提高效率
   */
  async enrichLocationInfo() {
    logger.info('📍 开始位置信息补全（流水线版本）');

    try {
      // 查询所有图片，找到有坐标但没有位置信息的图片
      const allImages = await UnifiedDataService.readAllImages();
      
      // 🔥 先排除截图和二维码分类的照片
      const validImages = allImages.filter(img => {
        const category = img.category || 'NA';
        return category !== 'screenshot' && category !== 'qrcode';
      });
      
      // 统计信息：用于日志说明
      const naCountValid = validImages.filter(img => (img.category || 'NA') === 'NA').length;
      
      // 🔥 统计：有坐标但没有位置信息的图片（这些是需要处理的）
      const imagesWithCoordinatesButNoLocation = validImages.filter(img => {
        if (!img.latitude || !img.longitude) {
          return false; // 没有坐标，跳过
        }
        const hasCity = img.city && img.city.trim() !== '';
        const hasCountry = img.country && img.country.trim() !== '';
        return !hasCity || !hasCountry; // city或country缺失
      });
      
      // 统计NA分类中需要位置补全的数量
      const naNeedLocation = imagesWithCoordinatesButNoLocation.filter(img => (img.category || 'NA') === 'NA').length;
      const naWithoutCoordinates = naCountValid - naNeedLocation;
      
      logger.debug(`📍 位置信息补全统计: 总图片=${allImages.length}, 有效图片=${validImages.length}（排除截图和二维码）, 界面显示NA=${naCountValid}张, 需要位置补全=${imagesWithCoordinatesButNoLocation.length}张（有坐标但无位置信息）, 其中NA分类=${naNeedLocation}张, NA中无坐标=${naWithoutCoordinates}张`);
      
      if (validImages.length === 0) {
        logger.info('✅ 没有有效图片需要处理，跳过');
        return;
      }

      const totalFoundThisPhase = validImages.length;
      logger.info(`📍 开始处理 ${totalFoundThisPhase} 张有效图片（界面显示NA=${naCountValid}张，其中${naNeedLocation}张需要位置补全，${naWithoutCoordinates}张NA图片无GPS坐标）`);
      await this.sendProgressMessage('location_enrichment', 0, totalFoundThisPhase, this.imagesClassified, this.totalImagesToBeClassified);

      // 🔥 检查设置，判断是否需要MobileNetV3推理
      const settings = await UnifiedDataService.readSettings();
      const enableMobileNetV3 = settings.enableMobileNetV3Classification === true;

      // 确保ImageClassifierService已初始化（如果需要推理）
      // 🔥 只加载MobileNetV3模型，不加载其他模型
      if (enableMobileNetV3) {
        try {
          // 如果还未初始化配置，先初始化配置（但不加载模型）
          if (!this.imageClassifier.isInitialized) {
            await this.imageClassifier.initializeModelConfigs();
            await this.imageClassifier.initializeONNX();
            this.imageClassifier.isInitialized = true; // 标记为已初始化，避免重复初始化
          }
          
          // 只加载MobileNetV3模型
          if (!this.imageClassifier.models.mobilenetv3?.model) {
            await this.imageClassifier.loadMobileNetV3Model();
            logger.debug('✅ MobileNetV3模型加载完成');
          }
        } catch (error) {
          logger.error(`❌ MobileNetV3模型加载失败: ${error.message}`);
          // 加载失败时跳过MobileNetV3推理，继续后续流程
        }
      }

      const batchSize = 50; // 每批处理50张
      const totalBatches = Math.ceil(validImages.length / batchSize);
      logger.info(`🚀 开始流水线处理: ${totalFoundThisPhase} 张图片，批次大小: ${batchSize}，共 ${totalBatches} 批`);

      // 🔥 流水线队列：节点1 -> 节点2（每个节点自己负责保存）
      const inferenceQueue = []; // 节点1输入
      const locationQueue = []; // 节点2输入
      
      // 批次任务定义
      class InferenceTask {
        constructor(batchIndex, batchImages, isLastBatch) {
          this.batchIndex = batchIndex;
          this.batchImages = batchImages;
          this.isLastBatch = isLastBatch;
          this.inferenceResults = null; // 节点1的输出
        }
      }

      class LocationTask {
        constructor(batchIndex, batchImages, isLastBatch, inferenceResults) {
          this.batchIndex = batchIndex;
          this.batchImages = batchImages;
          this.isLastBatch = isLastBatch;
          this.inferenceResults = inferenceResults; // 节点1的输出
          this.locationResults = null; // 节点2的输出
        }
      }
      
      // 🔥 保存MobileNetV3推理结果的辅助函数
      const saveInferenceResults = async (tasks) => {
        const batchResults = [];
        
        for (const task of tasks) {
          if (!task.inferenceResults) continue;
          
          for (let i = 0; i < task.batchImages.length; i++) {
            const image = task.batchImages[i];
            const inferenceResult = task.inferenceResults[i];
            
            if (inferenceResult && inferenceResult.inferenceResult) {
              batchResults.push({
                uri: image.uri,
                id: image.id,
                mobileNetV3Detections: inferenceResult.inferenceResult
              });
            }
          }
        }
        
        if (batchResults.length > 0) {
          await UnifiedDataService.batchUpdateClassification(batchResults, false);
          logger.debug(`✅ [节点1] 批量保存MobileNetV3推理结果: ${batchResults.length} 张`);
        }
      };
      
      // 🔥 保存位置信息的辅助函数
      const saveLocationResults = async (tasks) => {
        const batchResults = [];
        
        for (const task of tasks) {
          if (!task.locationResults) continue;
          
          for (const locationResult of task.locationResults) {
            const image = task.batchImages.find(img => img.uri === locationResult.uri);
            if (image && locationResult.locationId) {
              batchResults.push({
                uri: image.uri,
                id: image.id,
                city: locationResult.locationId,
                latitude: image.latitude,
                longitude: image.longitude
              });
            }
          }
        }
        
        if (batchResults.length > 0) {
          await UnifiedDataService.updateImagesCity(batchResults, false);
          logger.debug(`✅ [节点2] 批量保存位置信息: ${batchResults.length} 张`);
        }
      };

      let processedThisPhase = 0;
      let completedBatches = 0;

      // ========== 节点1：MobileNetV3推理（单线程，每5个批次保存一次）==========
      const inferenceNode = async () => {
        const SAVE_BATCH_COUNT = 5; // 每5个批次保存一次
        const pendingTasks = []; // 待保存的任务列表
        
        let shouldExit = false;
        while (!shouldExit) {
          try {
            // 等待批次任务
            if (inferenceQueue.length === 0 && completedBatches >= totalBatches) {
              // 处理完所有批次，保存剩余的任务
              if (pendingTasks.length > 0) {
                await saveInferenceResults(pendingTasks);
                pendingTasks.length = 0;
              }
              shouldExit = true;
              continue;
            }
            
            if (inferenceQueue.length === 0) {
              await new Promise(resolve => setTimeout(resolve, 10)); // 短暂等待
              continue;
            }

            const task = inferenceQueue.shift();
            const batchNumber = task.batchIndex + 1;

            try {
              if (enableMobileNetV3 && this.imageClassifier.models?.mobilenetv3?.model) {
                logger.debug(`🤖 [节点1] 批次 ${batchNumber}/${totalBatches}: 开始MobileNetV3推理 ${task.batchImages.length} 张图片`);
                
                // 对每张图片进行MobileNetV3推理
                const inferencePromises = task.batchImages.map(async (image) => {
                  try {
                    // 🔥 使用getUri统一处理URI格式（支持content://和file://）
                    const imageUri = getUri(image);
                    if (!imageUri) {
                      throw new Error(`无法获取图片URI: ${image.uri}`);
                    }
                    
                    const mobileNetV3Result = await this.imageClassifier.classifyImageWithMobileNetV3(imageUri);
                    return {
                      success: true,
                      imageUri: image.uri, // 保存原始URI用于后续匹配
                      imageId: image.id,
                      inferenceResult: mobileNetV3Result.success ? mobileNetV3Result : null
                    };
                  } catch (error) {
                    logger.warn(`⚠️ MobileNetV3推理失败: ${image.uri}`, error);
                    return {
                      success: false,
                      imageUri: image.uri,
                      imageId: image.id,
                      error: error.message
                    };
                  }
                });

                const inferenceResults = await Promise.all(inferencePromises);
                task.inferenceResults = inferenceResults;
                
                const successCount = inferenceResults.filter(r => r.success).length;
                logger.debug(`✅ [节点1] 批次 ${batchNumber}: MobileNetV3推理完成 ${successCount}/${task.batchImages.length} 张`);
              } else {
                // 跳过推理，直接传递空结果
                task.inferenceResults = task.batchImages.map(image => ({
                  success: true,
                  imageUri: image.uri,
                  imageId: image.id,
                  inferenceResult: null
                }));
                if (!enableMobileNetV3) {
                  logger.debug(`⏭️ [节点1] 批次 ${batchNumber}: MobileNetV3推理已禁用，跳过`);
                } else {
                  logger.debug(`⏭️ [节点1] 批次 ${batchNumber}: MobileNetV3模型未加载，跳过`);
                }
              }

              // 累积任务
              pendingTasks.push(task);
              
              // 🔥 每5个批次保存一次（不更新进度，只保存数据）
              if (pendingTasks.length >= SAVE_BATCH_COUNT || task.isLastBatch) {
                await saveInferenceResults(pendingTasks);
                pendingTasks.length = 0;
              }

              // 传递给节点2
              const locationTask = new LocationTask(
                task.batchIndex,
                task.batchImages,
                task.isLastBatch,
                task.inferenceResults
              );
              locationQueue.push(locationTask);

            } catch (error) {
              logger.error(`❌ [节点1] 批次 ${batchNumber} 处理异常:`, error);
              // 即使失败也传递给节点2，避免阻塞
              const locationTask = new LocationTask(
                task.batchIndex,
                task.batchImages,
                task.isLastBatch,
                null
              );
              locationQueue.push(locationTask);
            }

            if (task.isLastBatch) {
              shouldExit = true;
            }

          } catch (error) {
            logger.error('[节点1] 外层异常:', error);
          }
        }
        logger.debug('🔍 [节点1] 线程退出');
      };

      // ========== 节点2：位置查询（单线程，累积到400个后批量查询并保存）==========
      const locationNode = async () => {
        const BATCH_SIZE = 400; // 累积到400个坐标后再批量查询（接口最多支持500个）
        const pendingTasks = []; // 待处理的任务列表
        const pendingCoordinates = []; // 累积的坐标列表
        let processedBatches = 0; // 已从队列中取出的批次数量（用于判断是否所有批次都已处理）
        
        let shouldExit = false;
        
        // 执行批量位置查询的辅助函数
        const executeBatchQuery = async () => {
          if (pendingCoordinates.length === 0) {
            return;
          }
          
          logger.debug(`📍 [节点2] 执行批量位置查询: ${pendingCoordinates.length} 个坐标`);
          
          try {
            // 批量获取位置信息
            const locationResultsArray = await cityLocationService.getLocationsBatch(
              pendingCoordinates,
              { skipRemote: false }
            );
            
            // 处理批量查询结果，分配给对应的任务
            const uriToLocationResult = new Map();
            for (const locationResult of locationResultsArray) {
              const locationId = locationResult.location_id || 
                                locationResult.city?.location_id || 
                                null;
              
              if (locationResult.success && locationId && locationResult.id) {
                uriToLocationResult.set(locationResult.id, {
                  locationId: locationId,
                  latitude: locationResult.latitude,
                  longitude: locationResult.longitude
                });
              }
            }
            
            // 将查询结果分配给对应的任务
            for (const task of pendingTasks) {
              const locationResults = [];
              
              // 从任务中找出需要查询的图片
              const imagesNeedLocationQuery = task.batchImages.filter(image => {
                if (!image.latitude || !image.longitude) {
                  return false;
                }
                const hasCity = image.city && image.city.trim() !== '';
                const hasCountry = image.country && image.country.trim() !== '';
                return !hasCity || !hasCountry;
              });
              
              // 为每张需要查询的图片查找结果
              for (const image of imagesNeedLocationQuery) {
                const result = uriToLocationResult.get(image.uri);
                if (result) {
                  locationResults.push({
                    uri: image.uri,
                    id: image.id,
                    locationId: result.locationId,
                    latitude: result.latitude,
                    longitude: result.longitude
                  });
                }
              }
              
              task.locationResults = locationResults;
            }
            
            logger.debug(`✅ [节点2] 批量位置查询完成: ${locationResultsArray.length} 个结果，分配给 ${pendingTasks.length} 个批次`);
            
            // 清空累积的数据
            pendingCoordinates.length = 0;
            
          } catch (error) {
            logger.error(`❌ [节点2] 批量位置查询失败:`, error);
            // 失败时，所有待处理任务都标记为无位置结果
            for (const task of pendingTasks) {
              task.locationResults = [];
            }
            pendingCoordinates.length = 0;
          }
        };
        
        while (!shouldExit) {
          try {
            // 检查是否应该退出：所有批次都已从队列中取出，且没有待处理的任务
            if (locationQueue.length === 0 && processedBatches >= totalBatches) {
              // 处理完所有批次，执行最后一次批量查询并保存
              if (pendingCoordinates.length > 0) {
                await executeBatchQuery();
              }
              
              // 处理所有待处理的任务，按批次索引排序确保顺序正确
              const sortedTasks = [...pendingTasks].sort((a, b) => a.batchIndex - b.batchIndex);
              
              // 🔥 保存位置信息
              await saveLocationResults(sortedTasks);
              
              // 更新进度和完成计数
              const savedCount = sortedTasks.reduce((sum, t) => {
                return sum + (t.locationResults?.length || 0);
              }, 0);
              processedThisPhase += savedCount;
              completedBatches += sortedTasks.length;
              
              await this.sendProgressMessage('location_enrichment', processedThisPhase, totalFoundThisPhase, this.imagesClassified, this.totalImagesToBeClassified);
              
              shouldExit = true;
              continue;
            }
            
            // 如果队列为空，短暂等待
            if (locationQueue.length === 0) {
              await new Promise(resolve => setTimeout(resolve, 10));
              continue;
            }

            const task = locationQueue.shift();
            processedBatches++; // 标记已从队列中取出一个批次
            const batchNumber = task.batchIndex + 1;

            try {
              // 🔥 在节点2中判断：只对有坐标但没有位置信息的照片进行位置查询
              const imagesNeedLocationQuery = task.batchImages.filter(image => {
                // 必须有坐标
                if (!image.latitude || !image.longitude) {
                  return false;
                }
                // 没有位置信息（city或country缺失）
                const hasCity = image.city && image.city.trim() !== '';
                const hasCountry = image.country && image.country.trim() !== '';
                return !hasCity || !hasCountry;
              });

              if (imagesNeedLocationQuery.length === 0) {
                logger.debug(`📍 [节点2] 批次 ${batchNumber}/${totalBatches}: 无需位置查询（所有照片都有位置信息或无坐标）`);
                task.locationResults = [];
                completedBatches++;
                continue;
              }

              logger.debug(`📍 [节点2] 批次 ${batchNumber}/${totalBatches}: 累积位置查询 ${imagesNeedLocationQuery.length}/${task.batchImages.length} 张图片（当前累积: ${pendingCoordinates.length}）`);

              // 准备批量查询的坐标数组（只查询需要查询的照片）
              const coordinates = imagesNeedLocationQuery.map(image => ({
                id: image.uri,
                latitude: image.latitude,
                longitude: image.longitude
              }));

              // 累积坐标和任务
              pendingCoordinates.push(...coordinates);
              pendingTasks.push(task);

              // 🔥 如果累积到400个坐标，或者是最后一个批次，执行批量查询并保存
              if (pendingCoordinates.length >= BATCH_SIZE || task.isLastBatch) {
                await executeBatchQuery();
                
                // 处理已完成查询的任务
                const completedTasks = [...pendingTasks];
                pendingTasks.length = 0;
                
                // 按批次索引排序，确保保存顺序正确
                completedTasks.sort((a, b) => a.batchIndex - b.batchIndex);
                
                // 🔥 保存位置信息
                await saveLocationResults(completedTasks);
                
                // 更新进度和完成计数
                const savedCount = completedTasks.reduce((sum, t) => {
                  return sum + (t.locationResults?.length || 0);
                }, 0);
                processedThisPhase += savedCount;
                completedBatches += completedTasks.length;
                
                await this.sendProgressMessage('location_enrichment', processedThisPhase, totalFoundThisPhase, this.imagesClassified, this.totalImagesToBeClassified);
              }

            } catch (error) {
              logger.error(`❌ [节点2] 批次 ${batchNumber} 处理异常:`, error);
              // 失败时标记为无位置结果
              task.locationResults = [];
              completedBatches++;
            }

            if (task.isLastBatch) {
              // 最后一个批次，但可能还有累积的数据，会在下次循环中处理
            }

          } catch (error) {
            logger.error('[节点2] 外层异常:', error);
          }
        }
        logger.debug('🔍 [节点2] 线程退出');
      };

      // 启动节点1和节点2（每个节点自己负责保存）
      const node1Promise = inferenceNode();
      const node2Promise = locationNode();

      // 提交所有批次到节点1（所有有效照片都进入流水线）
      for (let i = 0; i < validImages.length; i += batchSize) {
        const batch = validImages.slice(i, i + batchSize);
        const batchIndex = Math.floor(i / batchSize);
        const isLastBatch = (batchIndex === totalBatches - 1);
        
        const task = new InferenceTask(batchIndex, batch, isLastBatch);
        inferenceQueue.push(task);
      }

      // 等待节点1和节点2完成
      await Promise.all([node1Promise, node2Promise]);

      logger.info(`✅ 位置信息补全完成（流水线版本）: 补全了 ${processedThisPhase} 张图片的位置信息`);

      // 发送完成消息（会触发 processProgressData 自动重建缓存）
      // 🔥 修复：位置信息补全完成后发送 location_enrichment 阶段消息（与相似度检测保持一致），而不是 completed
      // 这样 sendProgressMessage 中的判断 stage !== 'location_enrichment' 会排除它，不会调用前台服务
      await this.sendProgressMessage('location_enrichment', processedThisPhase, totalFoundThisPhase, this.imagesClassified, this.totalImagesToBeClassified);

    } catch (error) {
      const errorMessage = error?.message || error?.toString() || '未知错误';
      logger.error('❌ 位置信息补全失败:', errorMessage, error);
      if (error instanceof Error) {
        throw error;
      } else {
        throw new Error(errorMessage);
      }
    }
  }

  /**
   * 阶段6: 相似度检测（全量检测）
   * 检测所有图片的相似度
   */
  async phase6_SimilarityDetection() {
    const settings = await UnifiedDataService.readSettings();
    let similarityThreshold = (settings.similarityThreshold != null && settings.similarityThreshold >= 0 && settings.similarityThreshold <= 1)
      ? settings.similarityThreshold
      : 0.8;
    if (similarityThreshold < 0.8) similarityThreshold = 0.8;
    await sharedSimilarityDetection({
      sendProgressMessage: this.sendProgressMessage.bind(this),
      similarityService: this.similarityService,
      similarityThreshold,
      totalImagesToBeClassified: this.totalImagesToBeClassified, // Android 版本需要传递此参数
    });
  }

  /**
   * 相似度检测阶段（兼容PC端接口）
   * 供移动端 HomeScreen 直接调用（全量检测）
   * @param {Date} scanStartTime - 扫描开始时间（可选，已废弃）
   * @param {Array} candidateImages - 候选图片（可选，已废弃）
   */
  async similarityDetectionPhase(scanStartTime = null, candidateImages = []) {
    const settings = await UnifiedDataService.readSettings();
    let similarityThreshold = (settings.similarityThreshold != null && settings.similarityThreshold >= 0 && settings.similarityThreshold <= 1)
      ? settings.similarityThreshold
      : 0.8;
    if (similarityThreshold < 0.8) similarityThreshold = 0.8;
    await sharedSimilarityDetection({
      sendProgressMessage: this.sendProgressMessage.bind(this),
      similarityService: this.similarityService,
      similarityThreshold,
      totalImagesToBeClassified: this.totalImagesToBeClassified, // Android 版本需要传递此参数
    });
  }


  /**
   * 发送进度消息
   * 统一处理进度更新：调用回调函数并更新前台服务
   * @param {string} stage - 阶段名称
   * @param {number} processedThisPhase - 当前阶段已处理数量
   * @param {number} totalFoundThisPhase - 当前阶段总数量
   * @param {number} imagesClassified - 已分类数量（可选，不更新时传当前值）
   * @param {number} totalImagesToBeClassified - 总分类目标（可选，不更新时传当前值）
   */
  async sendProgressMessage(stage, processedThisPhase, totalFoundThisPhase, imagesClassified = this.imagesClassified, totalImagesToBeClassified = this.totalImagesToBeClassified) {
    if (!this.onProgress) {
      logger.warn(`⚠️ onProgress 回调未设置，跳过进度消息: ${stage}`);
      return;
    }
    
    // 🔥 已移除去重逻辑，允许所有进度更新通过（包括更频繁的更新）
    logger.info(`📊 扫描进度: ${stage}, 已处理: ${processedThisPhase}/${totalFoundThisPhase}, 总分类: ${imagesClassified}/${totalImagesToBeClassified}`);
    
    // 生成进度数据并直接调用 onProgress
    const progressData = await this.processProgressData({
      stage,
      filesFound: totalFoundThisPhase,
      filesProcessed: processedThisPhase,
      imagesClassified,
      totalImagesToBeClassified,
    });
    
    // Android平台：更新前台服务通知
    // 🔥 相似度检测和位置信息补全不使用前台服务，因为它们在JS线程运行，不能后台执行
    // 只有原生扫描流程（可以后台运行）才使用前台服务
    if (stage !== 'similarity_detection' && stage !== 'location_enrichment') {
      // progressData.message 已经包含国际化的消息，如果为空则让原生层使用资源文件的默认消息
      // 通知标题也由JS层传递，根据应用内语言设置国际化
      const notificationTitle = i18n.t('home.scanNotificationTitle');
      ScanService.updateProgress(
        progressData.message || null, // 传递null让原生层使用资源文件的默认消息（已国际化）
        processedThisPhase,
        totalFoundThisPhase,
        notificationTitle // 传递国际化的通知标题
      );
    }
    
    // 调用进度回调（UI更新）
    // 注意：在异步操作后再次检查 onProgress，因为它可能在异步期间被设置为 null
    if (!this.onProgress) {
      logger.warn(`⚠️ onProgress 回调未设置，跳过进度消息: ${stage}`);
      return;
    }
    
    try {
      this.onProgress({
        stage: progressData.stage,
        message: progressData.message,
        filesProcessed: processedThisPhase,
        filesFound: totalFoundThisPhase,
        imagesClassified,
        totalImagesToBeClassified,
        isComplete: progressData.isComplete,
        shouldRefresh: progressData.shouldRefresh,
      });
    } catch (error) {
      logger.error(`❌ 调用 onProgress 回调失败: ${error.message}`);
    }
  }

  /**
   * 处理进度数据
   * 包括消息生成、缓存刷新频率控制、统计信息
   */
  async processProgressData(rawProgress) {
    const { stage, filesProcessed, filesFound, imagesClassified, totalImagesToBeClassified } = rawProgress;
    
    let simpleMessage = '';
    let shouldRefresh = false;
    
    // 根据阶段生成简单的提示信息
    switch (stage) {
      case 'initializing':
        simpleMessage = i18n.t('home.initScanning');
        // 如果 scanStartTimestamp 还未设置，设置为当前时间（Date 对象）
        if (!this.scanStartTimestamp) {
          this.scanStartTimestamp = new Date();
        }
        break;
        
      case 'directory_scanning':
        // 如果还没有发现照片，只显示扫描中；否则显示发现数量
        if (filesFound && filesFound > 0) {
          simpleMessage = i18n.t('home.scanProgress.directoryScanningFound', { count: filesFound });
        } else {
          simpleMessage = i18n.t('home.scanProgress.directoryScanning');
        }
        break;
        
      case 'file_comparison':
        const totalFiles = filesFound || 0;
        simpleMessage = i18n.t('home.scanProgress.fileComparison', { count: totalFiles });
        break;
        
      case 'screenshot_detection':
        if (filesFound > 0 && filesProcessed === 0) {
          simpleMessage = i18n.t('home.scanProgress.photoScanningStart', { count: filesFound });
        } else {
          simpleMessage = i18n.t('home.scanProgress.photoScanning', { processed: filesProcessed || 0, total: filesFound || 0 });
        }
        break;
      
      case 'cache_check':
      case 'cache_checking':
        if (filesFound > 0 && filesProcessed === 0) {
          simpleMessage = i18n.t('home.scanProgress.categoryQueryStart', { count: filesFound });
        } else {
          simpleMessage = i18n.t('home.scanProgress.categoryQuery', { processed: filesProcessed || 0, total: filesFound || 0 });
        }
        break;
          
      case 'remote_inference':
        if (filesFound > 0 && filesProcessed === 0) {
          simpleMessage = i18n.t('home.scanProgress.smartRecognitionStart', { count: filesFound });
        } else {
          simpleMessage = i18n.t('home.scanProgress.smartRecognition', { processed: filesProcessed || 0, total: filesFound || 0 });
        }
        break;
        
      case 'local_inference':
        if (filesFound > 0 && filesProcessed === 0) {
          simpleMessage = i18n.t('home.scanProgress.localRecognitionStart', { count: filesFound });
        } else {
          simpleMessage = i18n.t('home.scanProgress.localRecognition', { processed: filesProcessed || 0, total: filesFound || 0 });
        }
        break;
        
        
      case 'location_enrichment':
        if (filesFound > 0 && filesProcessed === 0) {
          simpleMessage = i18n.t('home.scanProgress.locationEnrichmentStart', { count: filesFound });
        } else {
          simpleMessage = i18n.t('home.scanProgress.locationEnrichment', { processed: filesProcessed || 0, total: filesFound || 0 });
        }
        break;
        
      case 'removing_files':
        simpleMessage = i18n.t('home.scanProgress.removingFiles', { count: filesProcessed || 0 });
        break;
        
      case 'similarity_detection':
        if (filesFound && filesProcessed !== undefined) {
          // 相似度检测阶段显示时间窗口进度和动态相似组数量
          const groupsCount = imagesClassified || 0;
          if (filesFound > 0 && filesProcessed === 0) {
            // 开始时：如果 groupsCount === 0，说明是开始消息，filesFound 是图片数
            // 如果 groupsCount > 0，说明是窗口进度更新，filesFound 是窗口数
            if (groupsCount === 0) {
              simpleMessage = i18n.t('home.scanProgress.similarityDetectionStart', { count: filesFound });
            } else {
              simpleMessage = i18n.t('home.scanProgress.similarityDetectionProgress', { processed: filesProcessed, total: filesFound, groups: groupsCount });
            }
          } else {
            // 进度中：filesFound 和 filesProcessed 是窗口数
            simpleMessage = i18n.t('home.scanProgress.similarityDetectionProgress', { processed: filesProcessed, total: filesFound, groups: groupsCount });
          }
        } else {
          simpleMessage = i18n.t('home.scanProgress.similarityDetectionStart', { count: 0 });
        }
        break;
        
      case 'native_scan_completed':
        simpleMessage = i18n.t('home.scanProgress.nativeScanCompleted');
        break;
        
      case 'completed':
        simpleMessage = i18n.t('home.scanProgress.scanCompleted', { count: filesProcessed || 0 });
        // 计算和保存扫描耗时
        if (this.scanStartTimestamp) {
          // 确保 scanStartTimestamp 是 Date 对象
          const scanStartTime = this.scanStartTimestamp instanceof Date 
            ? this.scanStartTimestamp.getTime() 
            : this.scanStartTimestamp;
          const scanEndTimestamp = Date.now();
          const totalScanDuration = scanEndTimestamp - scanStartTime;
          const totalScanDurationSeconds = Math.round(totalScanDuration / 1000);
          
          logger.info(`⏱️ 扫描完成，总耗时: ${totalScanDurationSeconds}秒 (${Math.round(totalScanDuration / 1000 / 60)}分钟)`);
          
          // 异步保存扫描完成时间和耗时信息
          this.saveScanCompletionInfo(totalScanDuration).then(() => {
            logger.debug(`✅ 扫描完成信息保存成功: ${new Date().toISOString()}`);
          }).catch(error => {
            logger.error('❌ 保存扫描完成信息失败:', error);
          });
        }
        break;
        
      default:
        simpleMessage = i18n.t('common.processing');
    }
    
    // 添加全局统计信息到消息中
    let finalMessage = simpleMessage;
    
    // 统一处理 shouldRefresh 标记
    if (stage === 'similarity_detection') {
      // 相似度检测阶段：每发现3个相似组刷新一次
      const groupsCount = imagesClassified || 0;
      logger.debug(`🔍 相似度检测刷新检查: groupsCount=${groupsCount}, lastSimilarityRefreshCount=${this.lastSimilarityRefreshCount}, 差值=${groupsCount - this.lastSimilarityRefreshCount}`);
      if (groupsCount > 0 && groupsCount - this.lastSimilarityRefreshCount >= 3) {
        shouldRefresh = true;
        this.lastSimilarityRefreshCount = groupsCount;
        logger.debug(`🔄 相似度检测刷新: 发现${groupsCount}个相似组, 上次刷新${this.lastSimilarityRefreshCount}个`);
      }
    } else if (stage === 'screenshot_detection' && filesProcessed && filesProcessed > 0) {
      // 截图检测阶段：每处理完100张图片刷新一次（比较差值）
      const lastRefresh = this.lastScreenshotRefreshCount;
      if (filesProcessed - lastRefresh >= 100) {
        shouldRefresh = true;
        this.lastScreenshotRefreshCount = filesProcessed;
        logger.debug(`🔄 截图检测刷新: 已处理 ${filesProcessed} 张图片（上次刷新: ${lastRefresh}）`);
      }
    } else if (stage === 'location_enrichment' && filesProcessed && filesProcessed > 0) {
      // 位置信息补全阶段：每处理完50张图片刷新一次（比较差值）
      const lastRefresh = this.lastLocationRefreshCount;
      if (filesProcessed - lastRefresh >= 50) {
        shouldRefresh = true;
        this.lastLocationRefreshCount = filesProcessed;
        logger.debug(`🔄 位置信息补全刷新: 已处理 ${filesProcessed} 张图片（上次刷新: ${lastRefresh}）`);
      }
    } else if (imagesClassified > 0 && imagesClassified - this.lastRefreshCount >= 20) {
      // 其他阶段：每20张成功分类刷新一次（与 iOS 对齐；分好的图边跑边归位，不用等全部完成）
      shouldRefresh = true;
      this.lastRefreshCount = imagesClassified;
    }
    
    if (stage === 'completed') {
      // 扫描完成时刷新
      shouldRefresh = true;
    } else if (filesProcessed && filesFound && filesProcessed === filesFound) {
      // 每个阶段完成时刷新：已处理总数等于待处理总数
      shouldRefresh = true;
    }
    
    // 如果需要刷新，同步重建缓存（确保数据能够及时更新）
    if (shouldRefresh) {
      try {
        logger.debug('🔄 开始重建缓存...');
        await UnifiedDataService.imageCache.refreshCache();
        logger.debug('✅ 缓存重建完成');
      } catch (error) {
        logger.error('❌ 缓存重建失败:', error);
      }
    }
    
    // 显示统计信息（除了相似度检测阶段，其他阶段都显示总进度统计）
    if (stage !== 'similarity_detection' && totalImagesToBeClassified > 0) {
      finalMessage += ` | ${i18n.t('home.scanProgress.classificationSuccess', { 
        classified: imagesClassified, 
        total: totalImagesToBeClassified 
      })}`;
    }
    
    return {
      stage,
      message: finalMessage,
      isComplete: stage === 'completed',
      shouldRefresh // 返回刷新标记
    };
  }

  /**
   * 保存扫描完成信息（时间和耗时）
   */
  async saveScanCompletionInfo(totalScanDuration) {
    try {
      const settings = await UnifiedDataService.readSettings();
      
      // 检查之前的设置
      logger.debug(`🔍 保存前检查: 之前耗时=${settings.lastScanDurationSeconds}秒`);
      
      // 记录上一次扫描时间：「新发现照片」=自上上次扫描以来的新增（否则刚扫完就清空，两次扫描间拍的永远看不到）
      if (settings.lastScanTime) settings.prevScanTime = settings.lastScanTime;
      settings.lastScanTime = new Date().toISOString();
      settings.lastScanDuration = totalScanDuration; // 毫秒
      settings.lastScanDurationSeconds = Math.round(totalScanDuration / 1000); // 秒
      settings.lastScanDurationMinutes = Math.round(totalScanDuration / 1000 / 60); // 分钟
      
      await UnifiedDataService.writeSettings(settings);
      logger.info(`💾 已保存扫描完成信息: 耗时 ${settings.lastScanDurationSeconds}秒`);
      logger.debug(`🔍 保存详情: 总耗时=${totalScanDuration}ms, 秒数=${settings.lastScanDurationSeconds}, 分钟数=${settings.lastScanDurationMinutes}`);
    } catch (error) {
      logger.error('❌ 保存扫描完成信息失败:', error);
    }
  }
}

export default GalleryScannerService;

