// 导入WebAdapters统一适配器
import { 
  logger, 
  readImageFileAsBlob, 
  normalizeFilePath, 
  pathToFileUri,  // 🆕 用于正确处理路径中的特殊字符（包括冒号）
  readFileForExif, 
  getFileStats,
  RNFS,
  Platform,  // 🆕 使用统一的Platform对象
  getLocalPath,
  getContentUri,
  getFileUri,  // 🔥 用于将文件路径转换为 file:// URI
  getUri
} from '../adapters/WebAdapters';

import ImageClassifierService from './ImageClassifierService';
import cityLocationService from './CityLocationService';
import ImageProcessor from './ImageProcessor';
import { similarityDetectionPhase as sharedSimilarityDetection } from './similarityDetectionPhase';
import { getCurrentLanguageAsync } from '../i18n';
import i18n from '../i18n';



// 默认位置信息结构

const createDefaultLocationInfo = (source = 'none') => ({

  latitude: null,

  longitude: null,

  altitude: null,

  accuracy: null,

  address: null,

  city: null,

  country: null,

  province: null,

  district: null,

  street: null,

  source

});

/**
 * 根据GPS坐标丰富位置信息（包括城市信息）
 * @param {number} latitude - 纬度
 * @param {number} longitude - 经度
 * @param {number} altitude - 海拔（可选）
 * @param {boolean} useRemoteApi - 是否使用远程API
 * @param {Object} baseLocationInfo - 基础位置信息对象（可选）
 * @returns {Promise<Object>} 包含城市信息的完整位置信息
 */
const enrichLocationInfoWithCity = async (latitude, longitude, altitude = null, useRemoteApi = true, baseLocationInfo = null) => {
  if (!latitude || !longitude) {
    return baseLocationInfo || createDefaultLocationInfo('none');
  }

  // 构建基础位置信息
  const locationInfo = baseLocationInfo || createDefaultLocationInfo();
  locationInfo.latitude = latitude;
  locationInfo.longitude = longitude;
  if (altitude !== null) {
    locationInfo.altitude = altitude;
  }

  // 获取当前语言设置（异步读取，确保获取到最新的语言设置）
  const currentLanguage = await getCurrentLanguageAsync();

  // 查找最近的城市信息
  try {
    const nearestCity = await cityLocationService.findNearestCityAsync(
      latitude,
      longitude,
      200,
      useRemoteApi,
      currentLanguage  // 传递当前语言设置
    );

    if (nearestCity) {
      locationInfo.city = nearestCity.location_id || nearestCity.name; // city 列存 location_id
      locationInfo.province = nearestCity.admin1_zh || nearestCity.admin1_en || null;
      locationInfo.district = nearestCity.admin2_zh || nearestCity.admin2_en || null;
      locationInfo.country = nearestCity.country || '中国';
      locationInfo.cityDistance = nearestCity.distance || null;
    }
  } catch (error) {
    logger.warn(`⚠️ 城市信息查找失败: ${error.message}`);
  }

  return locationInfo;
};

const extractOriginalUri = (input) => {
  if (!input) {
    throw new Error('缺少 uri');
  }
  if (typeof input === 'string') {
    return input;
  }
  // 优先使用 uri 字段，如果没有则使用 originalUri（兼容旧数据）
  if (typeof input.uri === 'string') {
    return input.uri;
  }
  if (typeof input.originalUri === 'string') {
    return input.originalUri;
  }
  throw new Error('对象缺少 uri 字段');
};



// 验证EXIF时间戳是否合理（避免文件名数字被误用）
const isValidExifTimestamp = (timestamp) => {
  if (!timestamp || typeof timestamp !== 'number') {
    return false;
  }
  
  // 检查是否是文件名中的数字（通常是15位数字）
  if (timestamp > 999999999999999) {
    logger.warn(`⚠️ 检测到可能的文件名数字被误用为时间戳: ${timestamp}`);
    return false;
  }
  
  // 检查时间戳是否在合理范围内（1970年到2100年）
  const year = new Date(timestamp * 1000).getFullYear();
  return year >= 1970 && year <= 2100;
};

// 从exif-parser数据中提取GPS信息（只提取GPS坐标，不获取城市信息）

const extractGPSFromExifParser = async (exifData, fileName = '') => {
  if (!exifData?.tags) {
    return null;
  }

  const { GPSLatitude, GPSLongitude, GPSAltitude, GPSHPositioningError } = exifData.tags;

  if (!GPSLatitude || !GPSLongitude) {
    return null;
  }

  return {

    latitude: GPSLatitude,

    longitude: GPSLongitude,

    altitude: GPSAltitude || null,

    accuracy: GPSHPositioningError || null,

    source: 'exif-parser'

  };

};



// 从react-native-exif数据中提取GPS信息（只提取GPS坐标，不获取城市信息）

const extractGPSFromNativeExif = async (exifData, fileName = '') => {

  if (!exifData?.GPSLatitude || !exifData?.GPSLongitude) return null;

  

  const latitude = parseFloat(exifData.GPSLatitude);

  const longitude = parseFloat(exifData.GPSLongitude);

  

  return {

    latitude,

    longitude,

    altitude: exifData.GPSAltitude ? parseFloat(exifData.GPSAltitude) : null,

    accuracy: exifData.GPSHPositioningError ? parseFloat(exifData.GPSHPositioningError) : null,

    source: 'react-native-exif'

  };

};



// 使用exif-parser库提取GPS信息

const tryExifParser = async (filePath) => {

  try {

    const ExifParser = require('exif-parser');

    const arrayBuffer = await readFileForExif(filePath);

    const parser = ExifParser.create(arrayBuffer);

    const exifData = parser.parse();

    

    return await extractGPSFromExifParser(exifData, fileName, useRemoteApi);

  } catch (error) {

    // exif-parser failed

    return null;

  }

};



// 使用react-native-exif库提取GPS信息

const tryNativeExif = async (normalizedPath) => {

  try {

    const RNExif = eval('require("react-native-exif")');

    const exifData = await RNExif.getExif(normalizedPath);

    

    return await extractGPSFromNativeExif(exifData, fileName, useRemoteApi);

  } catch (error) {

    return null;

  }

};



// 合并函数：一次读取文件同时提取拍照时间和GPS信息

const extractExifData = async (filePath, fileName, contentUri) => {

  try {
    // 判断平台：移动端使用MediaStore，PC端使用exif-parser
    const isMobile = Platform.OS === 'android' || Platform.OS === 'ios';
    
    // 移动端只需要 contentUri，PC端需要 filePath
    if (isMobile) {
      // 移动端：contentUri 是必需的
      if (!contentUri || typeof contentUri !== 'string' || contentUri.trim() === '') {
        throw new Error(`extractExifData: contentUri 参数无效，必须是非空字符串，实际值: ${contentUri}`);
      }
    } else {
      // PC端：filePath 是必需的
      if (!filePath || typeof filePath !== 'string' || filePath.trim() === '') {
        throw new Error(`extractExifData: filePath 参数无效，必须是非空字符串，实际值: ${filePath}`);
      }
    }
    
    // fileName 在所有平台都是必需的
    if (!fileName || typeof fileName !== 'string' || fileName.trim() === '') {
      throw new Error(`extractExifData: fileName 参数无效，必须是非空字符串，实际值: ${fileName}`);
    }
    
    // 环境检测：在Web环境下提前返回，避免执行后续不必要的处理
    if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window.require) {
      return {
        takenTime: null,
        locationInfo: createDefaultLocationInfo('web_unsupported'),
        imageDimensions: { width: null, height: null }
      };
    }
    
    // 使用传入的 fileName
    const finalFileName = fileName;
    
    // ========== 移动端：只使用 MediaStore ==========
    if (isMobile) {
      let takenTime = null;
      let locationInfo = createDefaultLocationInfo('none');
      let imageDimensions = { width: null, height: null };
      
      // 尝试使用MediaStore获取EXIF信息
      if (Platform.OS === 'android' && MediaStoreService.checkAvailability()) {
        try {
          const mediaStoreExif = await MediaStoreService.getImageExif(contentUri);
          
          // 构建位置信息
          if (mediaStoreExif.gps?.latitude != null && mediaStoreExif.gps?.longitude != null) {
            locationInfo.latitude = mediaStoreExif.gps.latitude;
            locationInfo.longitude = mediaStoreExif.gps.longitude;
            locationInfo.altitude = mediaStoreExif.gps.altitude ?? null;
          }
          
          takenTime = mediaStoreExif.takenTime;
          imageDimensions = {
            width: mediaStoreExif.width ?? null,
            height: mediaStoreExif.height ?? null
          };
        } catch (error) {
          logger.warn(`⚠️ MediaStore EXIF提取失败: ${error.message}, 文件: ${finalFileName}`);
        }
      }
      
      // 如果MediaStore没有获取到尺寸信息，使用ImageProcessor获取
      if (!imageDimensions.width || !imageDimensions.height) {
        try {
          // 移动端使用contentUri
          const dimensions = await ImageProcessor.getImageDimensions(contentUri);
          if (dimensions) {
            imageDimensions = {
              width: dimensions.width,
              height: dimensions.height
            };
          }
        } catch (error) {
          logger.warn(`⚠️ ImageProcessor 获取尺寸失败: ${error.message}, 文件: ${finalFileName}`);
        }
      }
      
      return {
        takenTime,
        locationInfo,
        imageDimensions
      };
    }
    
    // ========== PC端：只使用 exif-parser ==========
    // 文件验证（桌面端）
    try {
      await getFileStats(filePath);
    } catch (statsError) {
      logger.warn(`⚠️ 文件验证失败（可能文件不存在）: ${statsError.message}, 文件: ${finalFileName}`);
      // 继续执行，让后续的readFileForExif来处理文件读取
    }

    // 使用 exif-parser 库提取EXIF信息
    try {
      const ExifParser = require('exif-parser');
      const arrayBuffer = await readFileForExif(filePath);
      const parser = ExifParser.create(arrayBuffer);
      const exifData = parser.parse();
      
      // 提取拍照时间
      let takenTime = null;

      if (exifData && exifData.tags && exifData.tags.DateTimeOriginal) {
        let exifTime = exifData.tags.DateTimeOriginal;
        if (isValidExifTimestamp(exifTime)) {
          if (exifTime > 9999999999999) {
            exifTime = Math.floor(exifTime / 1000); // 转换为秒级
          }
          takenTime = new Date(exifTime * 1000).getTime();
        } else {
          logger.warn(`⚠️ EXIF DateTimeOriginal 无效: ${exifTime}, 文件: ${finalFileName}`);
        }
      } else if (exifData && exifData.tags && exifData.tags.DateTime) {
        let exifTime = exifData.tags.DateTime;
        if (isValidExifTimestamp(exifTime)) {
          if (exifTime > 9999999999999) {
            exifTime = Math.floor(exifTime / 1000); // 转换为秒级
          }
          takenTime = new Date(exifTime * 1000).getTime();
        } else {
          logger.warn(`⚠️ EXIF DateTime 无效: ${exifTime}, 文件: ${finalFileName}`);
        }
      }

      // 提取GPS信息
      let gpsInfo = null;
      try {
        gpsInfo = await extractGPSFromExifParser(exifData, finalFileName);
      } catch (gpsError) {
        logger.warn(`⚠️ GPS信息提取失败: ${gpsError.message}, 文件: ${finalFileName}`);
        gpsInfo = null;
      }

      const locationInfo = gpsInfo ? { ...createDefaultLocationInfo(), ...gpsInfo } : createDefaultLocationInfo('none');

      // 提取图片尺寸信息（优先使用 EXIF 中的尺寸）
      let imageDimensions = {
        width: exifData.imageSize?.width || null,
        height: exifData.imageSize?.height || null
      };

      // 如果 EXIF 中没有尺寸信息，使用 ImageProcessor 获取
      if (!imageDimensions.width || !imageDimensions.height) {
        try {
          const imageUri = getFileUri(filePath);
          if (imageUri) {
            const dimensions = await ImageProcessor.getImageDimensions(imageUri);
            if (dimensions) {
              imageDimensions = {
                width: dimensions.width,
                height: dimensions.height
              };
            }
          }
        } catch (error) {
          logger.warn(`⚠️ ImageProcessor 获取尺寸失败: ${error.message}`);
        }
      }

      // 🔥 提取拍摄参数（ISO、光圈、快门、焦距）
      const cameraSettings = {
        iso: exifData.tags?.ISOSpeedRatings || exifData.tags?.ISO || null,
        aperture: exifData.tags?.FNumber || null, // f-stop值，如 2.8
        shutterSpeed: exifData.tags?.ExposureTime || null, // 秒，如 0.008 (1/125秒)
        focalLength: exifData.tags?.FocalLength || null // 毫米，如 50
      };


      return { 
        takenTime, 
        locationInfo, 
        imageDimensions,
        cameraSettings
      };

    } catch (parseError) {
      logger.warn(`⚠️ exif-parser 提取失败: ${parseError.message}, 文件: ${finalFileName}`);
      
      // 即使 EXIF 读取失败，也尝试用 ImageProcessor 获取尺寸
      let imageDimensions = { width: null, height: null };
      try {
        const imageUri = getFileUri(filePath);
        if (imageUri) {
          const dimensions = await ImageProcessor.getImageDimensions(imageUri);
          if (dimensions) {
            imageDimensions = {
              width: dimensions.width,
              height: dimensions.height
            };
          }
        }
      } catch (error) {
        // 忽略尺寸获取失败的错误
      }

      return {
        takenTime: null,
        locationInfo: createDefaultLocationInfo('none'),
        imageDimensions
      };
    }

    

  } catch (error) {

    logger.error(`EXIF extraction failed:`, error);

    // 即使所有EXIF提取方法都失败，也尝试获取图片尺寸
    let imageDimensions = { width: null, height: null };
    try {
      const imageUri = getFileUri(filePath);
      if (imageUri) {
        const dimensions = await ImageProcessor.getImageDimensions(imageUri);
        if (dimensions) {
          imageDimensions = {
            width: dimensions.width,
            height: dimensions.height
          };
        }
      }
    } catch (dimensionError) {
      // 忽略尺寸获取失败的错误
    }

    return {

      takenTime: null,

      locationInfo: createDefaultLocationInfo('none'),

      imageDimensions

    };

  }

};








import UnifiedDataService from './UnifiedDataService';
import ParallelHashCalculator from './ParallelHashCalculator.js';
import configService from './ConfigService.js';
import ImageSimilarityService from './ImageSimilarityService.js';
import MediaStoreService from './MediaStoreService.js';
const { ScanService } = require('../adapters/ScanServiceAdapter');
import { AppState } from '../adapters/WebAdapters';


class GalleryScannerService {

  constructor() {
    // 🆕 标识：这是JS层扫描版本
    this.isNativeScanVersion = false;
    this.scanVersion = 'js-implementation';

    this.isInitialized = false;

    this.imageClassifier = new ImageClassifierService();
    
    // 初始化并行哈希计算器
    this.parallelHashCalculator = new ParallelHashCalculator(4); // 使用4个Worker

    // 初始化相似度检测服务
    this.similarityService = new ImageSimilarityService();

    this.galleryPaths = [];
    
    // 用于跟踪上次的进度消息，避免重复发送
    this.lastProgressMessage = null;
    
    
    // 核心指标（与 Android 版本命名一致）
    this.totalImagesToBeClassified = 0; // 总分类目标
    this.imagesClassified = 0; // 已分类数量
    this.lastRefreshCount = 0; // 上次刷新时的分类成功数
    this.lastSimilarityRefreshCount = 0; // 上次相似度检测刷新时的相似组数
    this.lastScreenshotRefreshCount = 0; // 上次截图检测刷新时的处理数量
    
    // AppState 监听器，用于保持后台执行
    this.appStateSubscription = null;
    this.isScanning = false;
    
    // Android平台：监听应用状态，确保后台时继续执行
    if (Platform.OS === 'android') {
      this.setupAppStateListener();
    }
    
    // 输出版本信息，方便调试
    logger.info(`📱 GalleryScannerService (${this.scanVersion}) 已创建`);
  }
  
  /**
   * 检查是否使用原生扫描
   * @returns {boolean} 是否使用原生扫描
   */
  isUsingNativeScan() {
    return this.isNativeScanVersion === true;
  }
  
  /**
   * 获取扫描版本信息
   * @returns {string} 扫描版本信息
   */
  getScanVersion() {
    return this.scanVersion;
  }
  
  /**
   * 设置 AppState 监听器，确保在后台时任务继续执行
   */
  setupAppStateListener() {
    if (!AppState || !AppState.addEventListener) {
      logger.warn('⚠️ AppState 不可用，无法监听应用状态');
      return;
    }
    
    this.appStateSubscription = AppState.addEventListener('change', (nextAppState) => {
      if (this.isScanning) {
        if (nextAppState === 'background' || nextAppState === 'inactive') {
          logger.debug('📱 应用进入后台，但扫描任务将继续执行（前台服务 + WakeLock）');
        } else if (nextAppState === 'active') {
          logger.debug('📱 应用回到前台');
        }
      }
    });
  }
  
  /**
   * 清理 AppState 监听器
   */
  cleanupAppStateListener() {
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
  }




  async initialize() {

    if (this.isInitialized) return;

    

    try {

      // 从UnifiedDataService获取配置
      const settings = await UnifiedDataService.readSettings();
      this.galleryPaths = settings.scanPaths || [];
      
      // 初始化相似度检测服务
      await this.similarityService.initialize();
      
      // 不再处理权限，假设权限已经在APP级别处理
      this.isInitialized = true;

      // Gallery scanner service initialized successfully

    } catch (error) {

      logger.error('Gallery scanner service initialization failed:', error);

      throw error;

    }

  }







  // 核心扫描接口 - 统一的扫描方法
  // 处理扫描进度数据，生成用户友好的提示信息
  // 参数：stage（阶段ID），filesProcessed（阶段已处理数），filesFound（阶段总处理数），imagesClassified（已分类数量），totalImagesToBeClassified（总分类目标）
  async processProgressData(rawProgress) {
    const { stage, filesProcessed, filesFound, imagesClassified = this.imagesClassified, totalImagesToBeClassified = this.totalImagesToBeClassified } = rawProgress;
    
    let simpleMessage = '';
    let shouldRefresh = false;
    
    // 根据阶段生成简单的提示信息（使用 i18n 翻译）
    switch (stage) {
      case 'initializing':
        simpleMessage = i18n.t('home.initScanning');
        // 记录扫描开始时间（Date 对象，用于增量相似度检测）
        // 如果已经设置过，则不覆盖（scanWithIndependentThread 中已设置）
        if (!this.scanStartTimestamp || !(this.scanStartTimestamp instanceof Date)) {
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
        simpleMessage = i18n.t('home.scanProgress.photoScanning', { 
          processed: filesProcessed || 0, 
          total: filesFound || 0 
        });
        break;
      
      case 'cache_checking':
        simpleMessage = i18n.t('home.scanProgress.categoryQuery', { 
          processed: filesProcessed || 0, 
          total: filesFound || 0 
        });
        break;
          
        
      case 'remote_inference':
        simpleMessage = i18n.t('home.scanProgress.smartRecognition', { 
          processed: filesProcessed || 0, 
          total: filesFound || 0 
        });
        break;
        
      case 'local_inference':
        simpleMessage = i18n.t('home.scanProgress.localRecognition', { 
          processed: filesProcessed || 0, 
          total: filesFound || 0 
        });
        break;
        
        
      case 'removing_files':
        simpleMessage = i18n.t('home.scanProgress.removingFiles', { count: filesProcessed || 0 });
        break;
        
      case 'location_enrichment':
        if (filesFound > 0 && filesProcessed === 0) {
          simpleMessage = i18n.t('home.scanProgress.locationEnrichmentStart', { count: filesFound });
        } else {
          simpleMessage = i18n.t('home.scanProgress.locationEnrichment', { processed: filesProcessed || 0, total: filesFound || 0 });
        }
        break;
        
      case 'similarity_detection':
        if (filesFound && filesProcessed !== undefined) {
          // 相似度检测阶段显示时间窗口进度和动态相似组数量
          // 🔥 使用传入的 imagesClassified 参数（在相似度检测阶段，这个参数实际上是相似组数量）
          const groupsCount = imagesClassified !== undefined ? imagesClassified : 0;
          simpleMessage = i18n.t('home.scanProgress.similarityDetectionProgress', {
            processed: filesProcessed,
            total: filesFound,
            groups: groupsCount
          });
        } else {
          simpleMessage = i18n.t('home.scanProgress.similarityDetectionStart');
        }
        break;
        
     
      case 'completed':
        simpleMessage = i18n.t('home.scanProgress.scanCompleted', { count: filesProcessed || 0 });
        // 计算和保存扫描耗时
        if (this.scanStartTimestamp) {
          const scanEndTimestamp = Date.now();
          // scanStartTimestamp 可能是 Date 对象或数字时间戳
          const scanStartTime = this.scanStartTimestamp instanceof Date 
            ? this.scanStartTimestamp.getTime() 
            : this.scanStartTimestamp;
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
        // 不在这里更新 imagesClassified，它已经在各个阶段的保存成功时累加了
        break;
        
      default:
        simpleMessage = i18n.t('home.processing');
    }
    
    // 添加全局统计信息到消息中
    let finalMessage = simpleMessage;
    
    // totalImagesToBeClassified 在缓存检查阶段（cache_checking）设置为 NA 图片数量，不再在截图检测阶段设置
    
    // 分类成功数现在在各个阶段的保存成功时直接累加，不再在这里处理
    
    // 统一处理 shouldRefresh 标记
    if (stage === 'similarity_detection') {
      // 相似度检测阶段：每发现3个相似组刷新一次
      // 🔥 使用传入的 imagesClassified 参数（在相似度检测阶段，这个参数实际上是相似组数量）
      const groupsCount = imagesClassified !== undefined ? imagesClassified : 0;
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
    } else if (this.imagesClassified > 0 && this.imagesClassified - this.lastRefreshCount >= 50) {
      // 其他阶段：每50张成功分类的图片刷新一次
      shouldRefresh = true;
      this.lastRefreshCount = this.imagesClassified;
    }
    
    if (stage === 'completed') {
      // 扫描完成时刷新
      shouldRefresh = true;
    } else if (filesProcessed && filesFound && filesProcessed === filesFound) {
      // 每个阶段完成时刷新：已处理总数等于待处理总数
      shouldRefresh = true;
    }
    
    // 如果需要刷新，同步重建缓存
    if (shouldRefresh) {
      try {
        logger.debug('🔄 开始重建缓存...');
        await UnifiedDataService.imageCache.refreshCache();
        logger.debug('✅ 缓存重建完成');
        
        // 🔥 调试：检查缓存中的拍摄参数统计
        const cache = UnifiedDataService.imageCache.getCache();
        logger.debug(`📷 [缓存刷新后] ISO统计: ${JSON.stringify(cache.isoCounts)}, 光圈统计: ${JSON.stringify(cache.apertureCounts)}, 快门统计: ${JSON.stringify(cache.shutterCounts)}, 焦距统计: ${JSON.stringify(cache.focalLengthCounts)}`);
      } catch (error) {
        logger.error('❌ 缓存重建失败:', error);
      }
    }
    
    // 显示统计信息（除了相似度检测阶段，其他阶段都显示总进度统计）
    if (stage !== 'similarity_detection') {
      // 确定显示的总数：如果 totalImagesToBeClassified 已设置则用它，否则在截图检测阶段使用 filesFound
      const totalCount = this.totalImagesToBeClassified > 0 
        ? this.totalImagesToBeClassified 
        : (stage === 'screenshot_detection' && filesFound ? filesFound : 0);
      
      if (totalCount > 0) {
        finalMessage += ` | ${i18n.t('home.scanProgress.classificationSuccess', { 
          classified: this.imagesClassified, 
          total: totalCount 
        })}`;
      }
    }
    
    return {
      stage,
      message: finalMessage,
      isComplete: stage === 'completed',
      shouldRefresh // 🆕 返回刷新标记
    };
  }

  async scanGalleryWithProgress(onProgress = null, options = null) {
    try {
      logger.debug('Starting full scan of local gallery...');
      
      // 设置全局扫描状态（简单方案）
      if (typeof window !== 'undefined') {
        window.isScanning = true;
      }
      
      // 处理可选项（例如非会员比较限制）
      this.compareLimit = options && typeof options.compareLimit === 'number' ? options.compareLimit : null;

      // 确保使用最新的配置
      const settings = await UnifiedDataService.readSettings();
      let scanPaths = settings.scanPaths || [];
      
      // 如果没有指定扫描路径，扫描整个设备（使用MediaStore）
      if (scanPaths.length === 0) {
        scanPaths = []; // 空数组表示扫描整个设备
        logger.debug('没有指定扫描路径，将扫描整个设备');
      } else {
        logger.debug('使用指定的扫描路径:', scanPaths);
      }
      
      this.galleryPaths = scanPaths;
      const scanStartTime = new Date().toLocaleTimeString();
      
      // 重置全局统计变量
      this.totalImagesToBeClassified = 0;
      this.imagesClassified = 0;
      this.lastRefreshCount = 0;
      this.lastSimilarityRefreshCount = 0;
      this.lastScreenshotRefreshCount = 0;

      // 使用独立扫描线程方案，避免阻塞UI
      return await this.scanWithIndependentThread(this.galleryPaths, onProgress, scanStartTime);
    } catch (error) {
      logger.error('Full scan failed:', error);
      throw error;
    } finally {
      // 重置全局扫描状态（简单方案）
      if (typeof window !== 'undefined') {
        window.isScanning = false;
      }
    }
  }


      



  // 优化的扫描函数，只返回URI和基本信息，用于双Set比对

  async scanDirectoryForUris(dirPath, onProgress = null, totalFoundSoFar = 0) {
    try {
      // 规范化路径：移除 file:// 前缀等，确保路径格式正确
      const normalizedDirPath = normalizeFilePath(dirPath);
      
      const exists = await RNFS.exists(normalizedDirPath);

      if (!exists) {
        logger.warn(`⚠️ 目录不存在: ${normalizedDirPath}`);
        return [];

      }

      

      const items = await RNFS.readDir(normalizedDirPath);

      const images = [];

      let imageCount = 0;

      let dirCount = 0;


      

      for (let i = 0; i < items.length; i++) {

        const item = items[i];
        
        // 调试：显示每个文件的处理过程
        if (!item.isDirectory()) {
          const isImage = this.isImageFile(item.name);
          // 检查文件是否为图片
        }

        // 每处理200个文件就更新进度并让出主进程控制权
        if (i % 200 === 0) {
          // 更新进度信息（只有在发现图片时才发送进度消息）
          if (onProgress && imageCount > 0) {
            onProgress({

              current: 0,

              total: 0,

              message: `directory_scanning: ${dirPath.split('/').pop() || dirPath.split('\\').pop()}`,

              filesFound: totalFoundSoFar + imageCount,
              filesProcessed: 0,

              filesFailed: 0

            });

          }

          

          // 在更新进度后让出主进程控制权

          await new Promise(resolve => setTimeout(resolve, 0));

        }

        

        if (item.isDirectory()) {

          dirCount++;

          const subImages = await this.scanDirectoryForUris(item.path, onProgress, totalFoundSoFar + imageCount);
          images.push(...subImages);

        } else if (this.isImageFile(item.name)) {

          // 规范化路径：normalizeFilePath 已经返回标准化的 URI 格式（使用正斜杠）
          const originalUri = normalizeFilePath(item.path);

          imageCount++;
          

          // 调试信息：每1000个文件输出一次

          if (imageCount % 1000 === 0) {

            // 已发现图片文件

          }

          

          try {

            const stats = await RNFS.stat(item.path);

            

            // 检测并转换微秒时间戳
            let mtime = null;
            if (stats.mtime) {
              let mtimeValue = stats.mtime;
              
              // 调试日志：检查文件系统时间戳
              if (mtimeValue > 9999999999999) {
                logger.debug(`🔍 检测到微秒时间戳 mtime: ${mtimeValue}, 文件: ${item.name}`);
              }
              
              // 检查是否是微秒级时间戳（大于 13 位数字）
              if (typeof mtimeValue === 'number' && mtimeValue > 9999999999999) {
                mtimeValue = Math.floor(mtimeValue / 1000); // 转换为毫秒级
                logger.debug(`🔍 转换后的 mtime: ${mtimeValue}, 日期: ${new Date(mtimeValue).toISOString()}`);
              }
              mtime = new Date(mtimeValue).getTime();
            }

            let ctime = null;
            if (stats.ctime) {
              let ctimeValue = stats.ctime;
              
              // 调试日志：检查文件系统时间戳
              if (ctimeValue > 9999999999999) {
                logger.debug(`🔍 检测到微秒时间戳 ctime: ${ctimeValue}, 文件: ${item.name}`);
              }
              
              // 检查是否是微秒级时间戳（大于 13 位数字）
              if (typeof ctimeValue === 'number' && ctimeValue > 9999999999999) {
                ctimeValue = Math.floor(ctimeValue / 1000); // 转换为毫秒级
                logger.debug(`🔍 转换后的 ctime: ${ctimeValue}, 日期: ${new Date(ctimeValue).toISOString()}`);
              }
              ctime = new Date(ctimeValue).getTime();
            }

            const currentTime = Date.now();

            const fileTime = ctime || mtime || currentTime;

            

            // 目录扫描阶段只收集基本信息，不提取EXIF数据
            
            // 验证必要字段
            if (!item.path) {
              // 使用静态计数器限制错误日志数量，避免大量输出
              if (!this.invalidPathCount) this.invalidPathCount = 0;
              this.invalidPathCount++;
              
              if (this.invalidPathCount <= 5) { // 只记录前5个错误
                logger.error('❌ 发现没有路径的文件项:', {
                  name: item.name,
                  dirPath: dirPath,
                  count: this.invalidPathCount
                });
              } else if (this.invalidPathCount === 6) {
                logger.error('❌ 发现更多没有路径的文件项，后续错误将不再记录...');
              }
              continue; // 跳过这个无效的文件项
            }

            const imageData = {
              uri: originalUri, // 原始uri
              fileName: item.name,
              size: stats.size,
              timestamp: fileTime
              // takenAt, locationInfo 等EXIF数据在后续阶段提取
            };

           

            images.push(imageData);

            

            // 每找到50个图片文件就更新一次进度（只有在发现图片时才发送进度消息）
            if (images.length % 50 === 0 && onProgress && images.length > 0) {
              onProgress({

                current: 0,

                total: 0,

                message: i18n.t('home.scanProgress.scanningDirectory', { 
                  directory: dirPath.split('/').pop() || dirPath.split('\\').pop() 
                }),

                filesFound: images.length,

                filesProcessed: 0,

                filesFailed: 0

              });

            }

          } catch (error) {

            console.error(`Failed to get file ${item.name} info:`, error);

          }

        }

      }

      

      // 确保所有异步操作都完成

      await new Promise(resolve => setTimeout(resolve, 0));

      

      // 目录扫描完成
      logger.debug(`📁 目录扫描完成: ${dirPath}, 发现 ${imageCount} 张图片, 总项目数: ${items.length}`);
      
      // 如果有无效路径的文件，记录总结信息
      if (this.invalidPathCount > 0) {
        logger.warn(`⚠️ 目录 ${dirPath} 中发现 ${this.invalidPathCount} 个没有路径的文件项，已跳过处理`);
      }

      return images;

    } catch (error) {

      console.error(`Optimized scan directory ${dirPath} failed:`, error);

      return [];

    }

  }



  isImageFile(fileName) {

    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];

    const lowerFileName = fileName.toLowerCase();

    return imageExtensions.some(ext => lowerFileName.endsWith(ext));

  }



 




  async ensureInitialized() {

    if (!this.isInitialized) {

      await this.initialize();

    }

  }






  // ==================== 独立扫描线程方案 ====================
  

  /**
   * 发送进度消息的简化函数
   * @param {string} stage - 扫描阶段
   * @param {number} filesProcessed - 已处理的文件数
   * @param {number} filesFound - 总文件数
   */
  /**
   * 发送进度消息（与 Android 版本签名一致）
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
    
    // 检查消息是否与上次相同，避免重复发送（相似度检测阶段不过滤）
    const messageKey = `${stage}_${totalFoundThisPhase}_${processedThisPhase}`;
    if (this.lastProgressMessage === messageKey && stage !== 'similarity_detection') {
      return;
    }
    
    this.lastProgressMessage = messageKey;
    
    // 生成进度数据并直接调用 onProgress
    const progressData = await this.processProgressData({
      stage,
      filesFound: totalFoundThisPhase,
      filesProcessed: processedThisPhase,
      imagesClassified,
      totalImagesToBeClassified,
    });
    
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
   * 独立扫描线程方案 - 分阶段处理，避免UI阻塞
   */
  async scanWithIndependentThread(scanPaths, onProgress, scanStartTime, maxImages = null) {
    try {
      // 保存onProgress为实例变量
      this.onProgress = onProgress;
      
      // 标记正在扫描
      this.isScanning = true;
      
      // 记录扫描开始时间（Date 对象，用于增量相似度检测）
      this.scanStartTimestamp = new Date();
      
      // 发送初始化进度消息
      this.sendProgressMessage('initializing', 0, 0);
      
      // 阶段1: 目录扫描（Desktop端使用文件系统扫描）
      logger.info('🚀 使用文件系统扫描');
      const allImages = await this.scanDirectoriesPhase(scanPaths, scanStartTime);
      
      // 阶段2: 文件比对
      const { deletedUris, newImages } = await this.compareFilesPhase(allImages, scanStartTime);
      
      // 删除的文件已经确定，不需要等待后续处理，早点删除可以释放资源
      await this.removeFilesPhase(deletedUris, scanStartTime);
      
      // 设置总处理数量（基础扫描阶段只处理新发现的图片）
      this.totalImagesToBeClassified = newImages.length;
      logger.info(`📊 设置总处理数量: ${this.totalImagesToBeClassified} 张图片（新发现: ${newImages.length}）`);
      
      // 阶段3: 基础扫描（EXIF提取、位置获取、规则性分类）
      let processedCount = 0;
      let failedCount = 0;
      if (newImages.length > 0) {
        logger.info(`🔄 开始基础扫描：共 ${newImages.length} 张图片`);
        const { processedCount: basicScanCount, failedCount: basicScanFailed, screenshotCount } = 
          await this.basicImageScanPhase(newImages, scanStartTime);
        processedCount += basicScanCount;
        failedCount += basicScanFailed;
        logger.info(`✅ 基础扫描完成：处理 ${basicScanCount} 张，截图 ${screenshotCount} 张，待AI分类 ${basicScanCount - screenshotCount} 张`);
      }
      
      // 基础扫描完成（AI分类需要用户手动触发）
      this.sendProgressMessage('completed', processedCount, processedCount, processedCount, this.totalImagesToBeClassified);
      
      // 标记扫描完成
      this.isScanning = false;
      
      return {
        success: true,
        deleted: deletedUris.length,
        newImages: newImages.length,
        processed: processedCount,
        failed: failedCount
      };
      
    } catch (error) {
      console.error('❌ 独立扫描线程方案失败:', error);
      
      // 标记扫描完成（即使出错）
      this.isScanning = false;
      
      throw error;
    }
  }
  
  
  /**
   * 阶段1: 目录扫描（Android系统相册版本）
   * 使用Android系统相册API扫描，性能更好且符合Android规范
   * Android 5+ 都支持，无需降级策略
   * @param {Array} scanPaths - 扫描路径数组，空数组表示扫描整个设备
   * @param {string} scanStartTime - 扫描开始时间
   */
  /**
   * 将绝对路径转换为相对路径（相对于外部存储根目录）
   * @param {string} absolutePath - 绝对路径，例如：/storage/emulated/0/DCIM/Camera
   * @param {string} externalStoragePath - 外部存储根目录，例如：/storage/emulated/0
   * @returns {string|null} 相对路径，例如：DCIM/Camera
   */

  /**
   * 阶段1: 目录扫描（文件系统版本）
   * 用于非Android平台（iOS、Web等）
   * 异步扫描所有目录，收集文件列表
   */
  async scanDirectoriesPhase(scanPaths, scanStartTime) {
    logger.debug('📁 阶段1: 开始文件系统目录扫描...');
    
    // 只显示目录数量，不显示具体路径
    this.sendProgressMessage('directory_scanning', 0, 0);
    
    const allImages = [];
    
    // 直接使用 scanDirectoryForUris 扫描每个目录
    for (const path of scanPaths) {
      try {
        const images = await this.scanDirectoryForUris(path, (progress) => {
          this.sendProgressMessage('directory_scanning', 0, allImages.length + progress.filesFound);
        }, allImages.length);
        
        allImages.push(...images);
        
        // 让出控制权，避免阻塞UI
        await new Promise(resolve => setTimeout(resolve, 0));
        
      } catch (error) {
        console.error(`Scan path ${path} failed:`, error);
      }
    }
    
    // 阶段1完成
    return allImages;
  }
  
  /**
   * 阶段2: 文件比对
   * 对比现有数据库，找出新增和删除的文件
   */
  async compareFilesPhase(allImages, scanStartTime) {
    // 阶段2: 文件比对
    // 如果设置了比较限制，只在提示中显示被限制后的数量
    const effectiveAllImages = (() => {
      if (this.compareLimit && Array.isArray(allImages) && allImages.length > this.compareLimit) {
        const sorted = [...allImages].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        return sorted.slice(0, this.compareLimit);
      }
      return allImages;
    })();

    this.sendProgressMessage('file_comparison', 0, effectiveAllImages.length);
    
    // 让出控制权，让UI有机会显示进度提示
    await new Promise(resolve => setTimeout(resolve, 0));
    
    // 获取现有图片URI集合（数据库中的原始值）
    const rawExistingUris = await UnifiedDataService.getImageUris();
    const existingUriSet = new Set(rawExistingUris.filter(Boolean));
    logger.debug(`🔍 增量扫描调试: 数据库中发现 ${existingUriSet.size} 个现有图片URI`);
    
    if (existingUriSet.size > 0) {
      const existingArray = Array.from(existingUriSet).slice(0, 5);
      logger.debug(`🔍 现有URI示例:`, existingArray);
    }
    
    await new Promise(resolve => setTimeout(resolve, 0));
    
    // 获取当前文件URI集合（可比较 key）
    const currentFileUris = new Set();
    effectiveAllImages.forEach(img => {
      const uri = extractOriginalUri(img);
      if (uri) {
        currentFileUris.add(uri);
      }
    });
    
    logger.debug(`🔍 增量扫描调试: 扫描发现 ${currentFileUris.size} 个文件URI key`);
    if (currentFileUris.size > 0) {
      const currentArray = Array.from(currentFileUris).slice(0, 5);
      logger.debug(`🔍 扫描URI示例:`, currentArray);
    }
    
    await new Promise(resolve => setTimeout(resolve, 0));
    
    // 找出被删除的文件（数据库有，扫描没有）
    const fullFileUriSet = new Set();
    allImages.forEach(img => {
      const uri = extractOriginalUri(img);
      if (uri) {
        fullFileUriSet.add(uri);
      }
    });
    
    const deletedUris = [];
    for (const uri of existingUriSet.values()) {
      if (!fullFileUriSet.has(uri)) {
        deletedUris.push(uri);
      }
    }
    
    // 找出需要处理的新文件（扫描有，数据库没有）
    const newUriSet = new Set();
    for (const uri of currentFileUris) {
      if (!existingUriSet.has(uri)) {
        newUriSet.add(uri);
      }
    }
    
    const newImages = effectiveAllImages.filter(img => {
      const uri = extractOriginalUri(img);
      return uri ? newUriSet.has(uri) : false;
    });
    
    logger.debug(`🔍 增量扫描结果: 删除 ${deletedUris.length} 个文件，新增 ${newImages.length} 个文件`);
    
    return { deletedUris, newImages };
  }
  
  // 验证EXIF时间，只返回有效的EXIF时间或null
  validateTakenTime(exifTime) {
    // 如果有EXIF时间且有效，返回它
    if (exifTime && this.isValidTimestamp(exifTime)) {
      return exifTime;
    }
    
    // 如果没有EXIF时间或无效，返回null
    return null;
  }
  
  // 验证时间戳是否合理
  isValidTimestamp(timestamp) {
    if (!timestamp || typeof timestamp !== 'number') {
      return false;
    }
    
    // 检查时间戳是否在合理范围内（1900年到2100年）
    const year = new Date(timestamp).getFullYear();
    return year >= 1900 && year <= 2100;
  }
  
  // 验证EXIF时间戳是否合理（避免文件名数字被误用）
  isValidExifTimestamp(timestamp) {
    if (!timestamp || typeof timestamp !== 'number') {
      return false;
    }
    
    // 检查是否是文件名中的数字（通常是15位数字）
    if (timestamp > 999999999999999) {
      logger.warn(`⚠️ 检测到可能的文件名数字被误用为时间戳: ${timestamp}`);
      return false;
    }
    
    // 检查时间戳是否在合理范围内（1970年到2100年）
    const year = new Date(timestamp * 1000).getFullYear();
    return year >= 1970 && year <= 2100;
  }

  /**
   * 批量保存图片分类结果
   * @param {Array} results - 图片结果数组，每个元素包含 {imageData, classification, exifData}
   * @param {boolean} updateCache - 是否立即更新缓存，默认false
   * @returns {Promise<Object>} 保存结果统计
   */
  async saveImageResults(results, updateCache = false) {
    try {
      if (!results || results.length === 0) {
        return { success: true, processedCount: 0, failedCount: 0 };
      }

      logger.debug(`🔄 开始批量保存 ${results.length} 个图片结果`);
      
      const saveDataArray = [];
      let processedCount = 0;
      let failedCount = 0;

      // 批量转换数据格式
      for (const result of results) {
        try {
          const { imageData, classification, exifData } = result;
          
          if (!imageData || !classification) {
            logger.warn('⚠️ 跳过无效的图片结果数据:', result);
            failedCount++;
            continue;
          }

          // 如果 exifData 为 null，说明是缓存检查阶段，只更新分类相关字段
          const isCacheCheckUpdate = exifData === null;
          
          // 调试日志：检查分类值
          const categoryValue = classification.categoryId || classification.category;
          if (saveDataArray.length < 5) {
            logger.debug(`🔍 保存分类: uri=${extractOriginalUri(imageData)}, categoryId=${classification.categoryId}, category=${classification.category}, 最终category=${categoryValue}`);
          }
          
          let saveData;
          if (isCacheCheckUpdate) {
            // 缓存检查阶段：只更新分类相关字段
            saveData = {
              uri: extractOriginalUri(imageData),
              category: categoryValue,
              confidence: classification.confidence || 1.0,
              // 保存检测结果字段
              idCardDetections: classification.idCardDetections || [],
              generalDetections: classification.generalDetections || [],
              mobileNetV3Detections: classification.mobileNetV3Detections || null,
              // 保存大模型推理描述
              message: classification.message || null,
              // 保存背景颜色
              background_color: classification.background_color || null
            };
          } else {
            // 其他阶段：保存完整信息（包括 EXIF 数据）
            // 直接使用exifData中的位置信息，不再获取位置信息（位置信息应在基础扫描阶段获取）
            const locationInfo = exifData?.locationInfo || createDefaultLocationInfo('none');
            
            // 🔥 提取拍摄参数（分类将在 ImageStorageService 中计算）
            const cameraSettings = exifData?.cameraSettings || {};
            
            // 位置信息：只保存 GPS 坐标和 location_id（存储在 city 字段）
            saveData = {
              uri: extractOriginalUri(imageData),
              category: categoryValue,
              confidence: classification.confidence || 1.0,
              timestamp: imageData.timestamp,
              takenAt: this.validateTakenTime(exifData?.takenTime),
              fileName: imageData.fileName,
              size: imageData.size,
              latitude: locationInfo.latitude,
              longitude: locationInfo.longitude,
              altitude: locationInfo.altitude,
              accuracy: locationInfo.accuracy,
              city: locationInfo.location_id || null, // 将 location_id 存储到 city 字段
              width: exifData?.imageDimensions?.width,
              height: exifData?.imageDimensions?.height,
              // 保存检测结果字段
              idCardDetections: classification.idCardDetections || [],
              generalDetections: classification.generalDetections || [],
              mobileNetV3Detections: classification.mobileNetV3Detections || null,
              // 保存图像尺寸信息
              imageDimensions: exifData?.imageDimensions || null,
              // 🔥 保存拍摄参数（分类将在 ImageStorageService 中根据 cameraSettings 计算）
              cameraSettings: cameraSettings,
              // 保存大模型推理描述
              message: classification.message || null,
              // 保存背景颜色
              background_color: classification.background_color || null
            };
          }
          
          saveDataArray.push(saveData);
          processedCount++;
          
        } catch (error) {
          logger.error('❌ 转换单个图片数据失败:', error);
          failedCount++;
        }
      }

      // 批量保存到数据库
      if (saveDataArray.length > 0) {
        await UnifiedDataService.writeImageDetailedInfo(saveDataArray, updateCache);
        logger.debug(`✅ 批量保存完成: 成功${processedCount}个, 失败${failedCount}个`);
      }

      return {
        success: true,
        processedCount,
        failedCount,
        totalCount: results.length
      };

    } catch (error) {
      logger.error('❌ 批量保存图片结果失败:', error);
      return { 
        success: false, 
        error,
        processedCount: 0,
        failedCount: results?.length || 0
      };
    }
  }

  /**
   * 基础图片扫描阶段 - 提取基础信息，规则性分类
   * 优化：完整流水线并发处理 - EXIF提取 → 位置获取 → 分类检测 → 保存
   * @param {Array} newImages - 新图片数组
   * @param {string} scanStartTime - 扫描开始时间
   * @returns {Promise<Object>} 扫描结果
   */
  async basicImageScanPhase(newImages, scanStartTime) {
    if (newImages.length === 0) {
      return { processedCount: 0, failedCount: 0, screenshotCount: 0, pendingAICount: 0 };
    }
    
    logger.info(`📸 基础扫描：处理 ${newImages.length} 张图片`);
    this.sendProgressMessage('screenshot_detection', 0, newImages.length);
    
    // 🔥 提前初始化模型（如果需要MobileNetV3分类）
    const settings = await UnifiedDataService.readSettings();
    const enableMobileNetV3 = settings.enableMobileNetV3Classification === true;
    
    if (enableMobileNetV3) {
      try {
        if (!this.imageClassifier.isInitialized) {
          await this.imageClassifier.initialize();
          logger.debug(`✅ ImageClassifierService初始化完成`);
        }
        // 预加载MobileNetV3模型（避免后续批次重复加载）
        if (!this.imageClassifier.models.mobilenetv3?.model) {
          await this.imageClassifier.loadMobileNetV3Model();
          logger.debug(`✅ MobileNetV3模型预加载完成`);
        }
      } catch (error) {
        logger.error(`❌ ImageClassifierService初始化失败: ${error.message}`);
        // 初始化失败时禁用MobileNetV3分类
      }
    }
    
    let totalProcessedCount = 0;
    let totalFailedCount = 0;
    let totalScreenshotCount = 0;
    
    const batchSize = 100;
    const totalBatches = Math.ceil(newImages.length / batchSize);
    const maxConcurrentBatches = 3; // 限制同时进行的批次数量（流水线并发）
    logger.info(`🚀 开始流水线并发处理: ${newImages.length} 张图片，批次大小: ${batchSize}，共 ${totalBatches} 批，最大并发批次: ${maxConcurrentBatches}`);
    
    // 并发控制：使用信号量模式限制同时进行的批次数量
    let runningCount = 0;
    const waitingQueue = [];
    
    const executeWithConcurrencyLimit = async (taskFn) => {
      return new Promise((resolve, reject) => {
        const execute = async () => {
          runningCount++;
          try {
            const result = await taskFn();
            resolve(result);
          } catch (error) {
            reject(error);
          } finally {
            runningCount--;
            // 从队列中取出下一个任务执行
            if (waitingQueue.length > 0) {
              const nextTask = waitingQueue.shift();
              nextTask();
            }
          }
        };
        
        if (runningCount < maxConcurrentBatches) {
          execute();
        } else {
          waitingQueue.push(execute);
        }
      });
    };
    
    // 存储所有任务的Promise（用于最后等待和统计）
    const allTasks = [];
    
    // 遍历每个批次
    for (let i = 0; i < newImages.length; i += batchSize) {
      const batch = newImages.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      
      // ========== 完整流水线任务（批次内顺序处理，批次间并发）==========
      const pipelineTask = executeWithConcurrencyLimit(async () => {
        let batchProcessedCount = 0;
        let batchFailedCount = 0;
        let batchScreenshotCount = 0;
        
        // ========== 节点1: EXIF提取（批次内顺序处理）==========
        logger.debug(`🔄 批次 ${batchNumber}: 开始EXIF提取 ${batch.length} 张图片`);
        
        const batchExifMap = new Map();
        
        // 🔥 批次内顺序处理，不并发
        for (const image of batch) {
          try {
            const originalUri = extractOriginalUri(image);
            const localPath = getLocalPath(originalUri);
            
            if (!localPath) {
              throw new Error(`无法获取文件路径: ${image.fileName}`);
            }
            
            // 提取EXIF数据
            const exifData = await extractExifData(localPath, image.fileName, null);
            const width = exifData.imageDimensions?.width || null;
            const height = exifData.imageDimensions?.height || null;
            
            const hasGPS = exifData?.locationInfo && 
                          exifData.locationInfo.latitude && 
                          exifData.locationInfo.longitude;
            
            batchExifMap.set(originalUri, {
              imageData: image,
              exifData: exifData,
              width: width,
              height: height,
              hasGPS: hasGPS
            });
          } catch (error) {
            logger.error(`❌ EXIF提取失败: ${image.fileName}`, error);
            batchFailedCount++;
          }
        }
        
        logger.debug(`✅ 批次 ${batchNumber}: EXIF提取完成 ${batchExifMap.size} 张`);
        
        // ========== 节点2: 位置获取（依赖EXIF提取的结果）==========
        const batchLocationMap = new Map();
        
        const imagesWithGPS = Array.from(batchExifMap.values()).filter(result => result.hasGPS);
        
        if (imagesWithGPS.length > 0) {
          logger.debug(`📍 批次 ${batchNumber}: 开始批量获取位置信息 ${imagesWithGPS.length} 张图片`);
          
          // 准备批量查询的坐标数组
          const coordinates = imagesWithGPS.map(result => ({
            id: extractOriginalUri(result.imageData),
            latitude: result.exifData.locationInfo.latitude,
            longitude: result.exifData.locationInfo.longitude
          }));
          
          // 批量获取位置信息（不需要语言判断，界面显示时会基于 location_id 查询不同名称）
          try {
            const locationResultsArray = await cityLocationService.getLocationsBatch(
              coordinates,
              { skipRemote: false }
            );
            
            // 存储位置信息结果（只需要 location_id）
            for (const locationResult of locationResultsArray) {
              // 判断 success 和 location_id 是否存在
              const locationId = locationResult.location_id || 
                                locationResult.city?.location_id || 
                                null;
              
              if (locationResult.success && locationId) {
                batchLocationMap.set(locationResult.id, {
                  location_id: locationId
                });
              } else {
                // 调试日志：记录为什么没有保存位置信息
                if (!locationResult.success) {
                  logger.debug(`⚠️ 位置查询失败: id=${locationResult.id}, success=false, error=${locationResult.error || 'unknown'}`);
                } else if (!locationId) {
                  logger.debug(`⚠️ 位置ID为空: id=${locationResult.id}, location_id=${locationResult.location_id}, city.location_id=${locationResult.city?.location_id}`);
                }
              }
            }
            
            logger.debug(`✅ 批次 ${batchNumber}: 位置信息获取完成 ${batchLocationMap.size} 张`);
          } catch (error) {
            logger.warn(`⚠️ 批次 ${batchNumber}: 批量获取位置信息失败: ${error.message}`);
          }
        }
        
        // ========== 节点3: 分类检测和结果合并（批次内顺序处理）==========
        logger.debug(`🔍 批次 ${batchNumber}: 开始规则性分类检测`);
        
        const batchSaveResults = [];
        
        // 🔥 批次内顺序处理，不并发
        // 🔥 每处理20张图片就让出控制权，避免阻塞UI线程
        let classificationProcessedCount = 0;
        for (const [imageUri, exifResult] of batchExifMap.entries()) {
          try {
            const { imageData, exifData, width, height, hasGPS } = exifResult;
            const localPath = getLocalPath(imageUri);
            const safeWidth = width || 0;
            const safeHeight = height || 0;
            
            // 规则性截图检测
            let isScreenshot = false;
            if (!hasGPS) {
              isScreenshot = await this.imageClassifier.identifyMobileScreenshot(
                imageData.fileName,
                safeWidth,
                safeHeight,
                localPath
              );
            }
            
            // 合并位置信息到exifData（只需要 location_id）
            const locationInfo = batchLocationMap.get(imageUri);
            if (locationInfo && locationInfo.location_id) {
              exifData.locationInfo = {
                ...exifData.locationInfo,
                location_id: locationInfo.location_id
              };
            } else if (hasGPS) {
              // 调试日志：有GPS但没有位置信息
              logger.debug(`⚠️ 有GPS但未找到位置信息: imageUri=${imageUri}, batchLocationMap.size=${batchLocationMap.size}, hasLocationInfo=${!!locationInfo}`);
              // 检查 batchLocationMap 中是否有类似的 key
              const allKeys = Array.from(batchLocationMap.keys());
              if (allKeys.length > 0) {
                logger.debug(`  batchLocationMap keys示例: ${allKeys.slice(0, 3).join(', ')}`);
              }
            }
            
            // 分类：截图或待分类
            const classification = isScreenshot ? {
              categoryId: 'screenshot',
              confidence: 1.0
            } : {
              categoryId: 'NA',
              confidence: 0.0
            };
            
            // 调试日志：记录分类结果
            if (batchSaveResults.length < 5) {
              logger.debug(`🔍 分类结果: ${imageData.fileName}, isScreenshot=${isScreenshot}, categoryId=${classification.categoryId}, hasGPS=${hasGPS}`);
            }
            
            if (isScreenshot) {
              batchScreenshotCount++;
            }
            
            batchSaveResults.push({
              imageData: imageData,
              classification: classification,
              exifData: exifData
            });
            
            classificationProcessedCount++;
            
            // 🔥 每处理20张图片就让出控制权，避免阻塞UI线程
            if (classificationProcessedCount % 20 === 0) {
              await new Promise(resolve => setTimeout(resolve, 0));
            }
            
          } catch (error) {
            logger.error(`❌ 分类检测失败: ${imageUri}`, error);
            batchFailedCount++;
          }
        }
        
        logger.debug(`✅ 批次 ${batchNumber}: 分类检测完成 (截图: ${batchScreenshotCount}, 待分类: ${batchSaveResults.length - batchScreenshotCount})`);
        
        // ========== 节点4: MobileNetV3分类（批次内顺序处理）==========
        if (enableMobileNetV3 && this.imageClassifier.isInitialized) {
          logger.debug(`🔍 批次 ${batchNumber}: 开始MobileNetV3分类 ${batchSaveResults.length} 张图片`);
          
          // 🔥 批次内顺序处理，不并发（模型已在开始阶段加载）
          // 🔥 每处理5张图片就让出控制权，避免阻塞UI线程
          let processedCount = 0;
          for (const saveResult of batchSaveResults) {
            try {
              // 🔥 使用 getUri 获取正确的 URI 格式（与本地识别阶段保持一致）
              // getUri 会自动处理 file:// URI 转换，确保 Electron 环境能正确加载
              const imageUri = getUri(saveResult.imageData);
              if (!imageUri) {
                logger.warn(`⚠️ 无法获取图片URI: ${saveResult.imageData.fileName}`);
                continue;
              }
              
              const mobileNetV3Result = await this.imageClassifier.classifyImageWithMobileNetV3(imageUri);
              
              // 将MobileNetV3分类结果添加到classification对象中
              if (!saveResult.classification.mobileNetV3Detections) {
                saveResult.classification.mobileNetV3Detections = mobileNetV3Result.success ? mobileNetV3Result : null;
              }
              
              processedCount++;
              
              // 🔥 每处理5张图片就让出控制权，避免阻塞UI线程
              if (processedCount % 5 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
              }
            } catch (error) {
              logger.error(`❌ MobileNetV3分类失败: ${extractOriginalUri(saveResult.imageData)}`, error);
              // 即使失败也继续，不阻塞后续流程
            }
          }
          
          logger.debug(`✅ 批次 ${batchNumber}: MobileNetV3分类完成`);
        } else if (enableMobileNetV3) {
          logger.debug(`⏭️ 批次 ${batchNumber}: MobileNetV3分类已禁用（初始化失败），跳过`);
        } else {
          logger.debug(`⏭️ 批次 ${batchNumber}: MobileNetV3分类已禁用，跳过`);
        }
        
        // ========== 节点5: 批量保存（当前批次的结果）==========
        if (batchSaveResults.length > 0) {
          logger.debug(`💾 批次 ${batchNumber}: 开始批量保存 ${batchSaveResults.length} 张图片到数据库`);
          
          try {
            const batchSaveResult = await this.saveImageResults(batchSaveResults, false);
            
            if (batchSaveResult.success) {
              batchProcessedCount = batchSaveResult.processedCount;
              logger.debug(`✅ 批次 ${batchNumber}: 批量保存成功 ${batchProcessedCount} 张`);
            } else {
              batchFailedCount += batchSaveResults.length;
              logger.error(`❌ 批次 ${batchNumber}: 批量保存失败`);
            }
          } catch (error) {
            logger.error(`❌ 批次 ${batchNumber}: 批量保存异常: ${error.message}`);
            batchFailedCount += batchSaveResults.length;
          }
        }
        
        // 更新进度（在照片信息保存后）
        const currentProcessed = Math.min(i + batchSize, newImages.length);
        this.sendProgressMessage('screenshot_detection', currentProcessed, newImages.length);
        
        // ========== 返回批次统计结果 ==========
        return {
          processedCount: batchProcessedCount,
          failedCount: batchFailedCount,
          screenshotCount: batchScreenshotCount
        };
      });
      
      // 将任务添加到数组（受并发限制控制）
      allTasks.push(pipelineTask);
    }
    
    // ========== 等待所有批次完成并汇总统计 ==========
    logger.info('⏳ 等待所有批次处理完成（流水线并发执行）...');
    const batchResults = await Promise.all(allTasks);
    
    // 汇总所有批次的统计结果
    for (const result of batchResults) {
      totalProcessedCount += result.processedCount;
      totalFailedCount += result.failedCount;
      totalScreenshotCount += result.screenshotCount;
    }
    
    logger.info(`✅ 所有批次处理完成: 成功 ${totalProcessedCount} 张，失败 ${totalFailedCount} 张，截图 ${totalScreenshotCount} 张`);
    
    const pendingAICount = totalProcessedCount - totalScreenshotCount;
    
    return {
      processedCount: totalProcessedCount,
      failedCount: totalFailedCount,
      screenshotCount: totalScreenshotCount,
      pendingAICount: pendingAICount
    };
  }



  /**
   * 远程推理预处理：将图片数组转换为推理所需的格式
   * @param {Array} images - 图片数组
   * @returns {Array} 预处理后的数据数组
   */
  async preprocessImagesForRemoteInference(images) {
    // 并行处理所有图片
    const promises = images.map(async (image) => {
      try {
        const originalUri = extractOriginalUri(image);
        const sourceUri = getUri(originalUri);
        if (!sourceUri) {
          throw new Error(`无法获取有效的图片URI: ${image.fileName || originalUri || 'unknown'}`);
        }

        if (Platform.OS === 'web') {
          // PC端：缩放并获取 Blob
          const result = await ImageProcessor.resizeImageAndGetBlob(
            sourceUri,
            1024,
            1024,
            {
              maintainAspectRatio: true,
              outputFormat: 'jpeg',
              quality: 90
            }
          );
          
          return {
            resizedUri: result.uri,
            hash: image.hash,
            blob: result.blob,
            blobSize: result.blob.size,
            fileName: image.fileName,
            imageData: image
          };
        } else {
          // 移动端：只缩放，不创建Blob（FormData直接使用文件URI）
          const result = await ImageProcessor.resizeImage(
            sourceUri,
            1024,
            1024,
            {
              maintainAspectRatio: true,
              outputFormat: 'jpeg',
              quality: 90
            }
          );
          
          // ImageProcessor.resizeImage 返回的是 { uri, width, height }
          // 注意：result.uri 是缩放后的文件URI（file:// 格式）
          if (!result || !result.uri) {
            logger.error(`❌ 图片缩放返回结果异常:`, { result, fileName: image.fileName, sourceUri });
            throw new Error(`图片缩放失败：未返回有效的URI，result: ${JSON.stringify(result)}`);
          }
          
          // 获取文件大小（用于统计）
          // result.uri 应该是 file:// 格式的路径，getLocalPath 会提取本地路径
          const resizedLocalPath = getLocalPath(result.uri);
          if (!resizedLocalPath) {
            logger.error(`❌ 无法获取缩放图片的本地路径:`, { 
              resizedUri: result.uri, 
              fileName: image.fileName,
              sourceUri,
              resultKeys: Object.keys(result || {})
            });
            throw new Error(`无法获取缩放图片的本地路径: ${result.uri}`);
          }
          const stat = await RNFS.stat(resizedLocalPath);
          
          return {
            resizedUri: result.uri,  // 使用 result.uri，不是 result.resizedUri
            hash: image.hash,
            blob: null,  // 移动端不需要Blob
            blobSize: stat.size,  // 用于日志统计
            fileName: image.fileName,
            imageData: image
          };
        }
      } catch (error) {
        logger.error(`❌ 图片预处理失败: ${image.fileName}`, error);
        return null;
      }
    });
    
    // 等待所有预处理完成
    const results = await Promise.all(promises);
    
    // 过滤掉失败的结果
    return results.filter(result => result !== null);
  }

  /**
   * 阶段3c: 批量远程推理
   * 远程分类并立即保存成功的结果
   */
  /**
   * 优化：流水线并发处理 - 准备数据 → 远程推理 → 保存结果
   * @param {Array} remainingImages - 待处理的图片数组
   * @param {string} scanStartTime - 扫描开始时间
   * @returns {Promise<Object>} 处理结果
   */
  /**
   * 设备端 ONNX（MobileNetV3）本地分类一批 NA 图片并落库。
   * 本地推理吃 imageUri（非 base64），故不复用云端 base64 管线，直接逐张推理 + 批量保存，
   * 复用与云端一致的持久化（UnifiedDataService.batchUpdateClassification）。
   * @param {Array<object>} naImages
   * @returns {Promise<{processedCount:number, failedCount:number}>}
   */
  async classifyImagesByLocalOnnx(naImages, scanStartTime) {
    let processedCount = 0;
    let failedCount = 0;
    if (!naImages || naImages.length === 0) {
      return { processedCount, failedCount };
    }
    logger.info(`📱 本地 ONNX 分类：处理 ${naImages.length} 张待分类图片`);

    const BATCH = 20;
    for (let i = 0; i < naImages.length; i += BATCH) {
      const batch = naImages.slice(i, i + BATCH);
      const classificationDataArray = [];
      for (const image of batch) {
        try {
          const imageUri = getUri(image);
          if (!imageUri) { failedCount++; continue; }
          const r = await this.imageClassifier.classifyImageWithMobileNetV3(imageUri);
          const top = r && r.success ? r.topPrediction : null;
          const category =
            top && typeof this.imageClassifier.mapMobileNetV3ToAppCategory === 'function'
              ? (this.imageClassifier.mapMobileNetV3ToAppCategory(top.class) || 'other')
              : 'other';
          classificationDataArray.push({
            uri: extractOriginalUri(image),
            id: image.id,
            category,
            confidence: (r && r.confidence) || 0.5,
            idCardDetections: [],
            generalDetections: [],
            mobileNetV3Detections: null,
            message: null,
            background_color: null,
          });
        } catch (e) {
          logger.warn(`⚠️ 本地分类失败: ${e?.message || e}`);
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
        } catch (saveError) {
          logger.error(`❌ 本地分类批量保存异常: ${saveError.message}`);
          failedCount += classificationDataArray.length;
        }
      }
      // 进度：直接经 onProgress 推 simpleMessage（避免 processProgressData 对未知 stage 的处理差异）
      const done = Math.min(i + BATCH, naImages.length);
      if (this.onProgress) {
        try {
          this.onProgress({
            simpleMessage: i18n.t('home.localClassificationInProgress', { done, total: naImages.length }),
            filesProcessed: done,
            filesFound: naImages.length,
            shouldRefresh: true,
          });
        } catch (_) { /* 进度失败不阻断分类 */ }
      }
    }
    logger.info(`✅ 本地 ONNX 分类完成：成功 ${processedCount}，失败 ${failedCount}`);
    // 跑完所有 batch 后统一刷 GlobalImageCache，避免 HomeScreen 拿到陈旧 categoryCounts
    try {
      await UnifiedDataService.imageCache.refreshCache();
    } catch (e) {
      logger.warn('legacy scanner 本地分类后刷新 GlobalImageCache 失败:', e?.message || e);
    }
    return { processedCount, failedCount };
  }

  async classifyImagesbyLLM(remainingImages, scanStartTime) {
    if (remainingImages.length === 0) {
      return { remainingImages: [], processedCount: 0, failedCount: 0 };
    }
    
    logger.info(`☁️ 第3层：批量远程推理，处理 ${remainingImages.length} 张图片`);
    this.sendProgressMessage('remote_inference', 0, remainingImages.length);
    
    let totalProcessedCount = 0;
    let totalFailedCount = 0;
    const allFailedImages = [];
    
    try {
      const clientId = await UnifiedDataService.getClientId();
      const batchSize = this.imageClassifier.BATCH_CONFIG.UPLOAD_BATCH_SIZE; // 统一使用20张/批
      const totalBatches = Math.ceil(remainingImages.length / batchSize);
      const maxConcurrentRequests = 1; // 限制同时进行的HTTP请求数量（避免内存压力）
      logger.info(`🚀 开始流水线并发处理: ${remainingImages.length} 张图片，批次大小: ${batchSize}，共 ${totalBatches} 批，最大并发请求: ${maxConcurrentRequests}`);
      
      // 并发控制：使用信号量模式限制同时进行的HTTP请求数量
      let runningCount = 0;
      const waitingQueue = [];
      
      const executeWithConcurrencyLimit = async (taskFn) => {
        return new Promise((resolve, reject) => {
          const execute = async () => {
            runningCount++;
            try {
              const result = await taskFn();
              resolve(result);
            } catch (error) {
              reject(error);
            } finally {
              runningCount--;
              // 从队列中取出下一个任务执行
              if (waitingQueue.length > 0) {
                const nextTask = waitingQueue.shift();
                nextTask();
              }
            }
          };
          
          if (runningCount < maxConcurrentRequests) {
            execute();
          } else {
            waitingQueue.push(execute);
          }
        });
      };
      
      // 存储所有任务的Promise（用于最后等待和统计）
      const allTasks = [];
      
      // 遍历每个批次
      for (let i = 0; i < remainingImages.length; i += batchSize) {
        const batch = remainingImages.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        
        // ========== 流水线任务 ==========
        const pipelineTask = executeWithConcurrencyLimit(async () => {
          let batchProcessedCount = 0;
          let batchFailedCount = 0;
          const batchFailedImages = [];
          
          try {
            // ========== 节点1: 准备数据 ==========
            logger.debug(`🔄 批次 ${batchNumber}: 开始准备数据 ${batch.length} 张图片`);
            
            const validResults = await this.preprocessImagesForRemoteInference(batch);
            
            if (validResults.length === 0) {
              logger.debug(`⚠️ 批次 ${batchNumber}: 没有有效数据，跳过`);
              return {
                processedCount: 0,
                failedCount: batch.length,
                failedImages: batch
              };
            }
            
            // ========== 节点2: 云端 LLM 推理 ==========
            // 本方法仅在 active 为云端 Provider 时被调用（见 aiImageClassifyByContent），
            // 故直接走用户配置的 LLM；不再调用原作者后端 batchClassifyRemote。
            logger.debug(`✅ 批次 ${batchNumber}: 数据准备完成，开始云端 LLM 推理 ${validResults.length} 张图片`);

            const aiCfg = await this._getAIProviderConfigSafe();
            const batchResult = await this._classifyBatchWithLLM(validResults, aiCfg, clientId);

            logger.debug(`✅ 批次 ${batchNumber}: 云端 LLM 推理完成`);
            
            // ========== 节点3: 处理结果并保存 ==========
            const classificationDataArray = [];
            
            for (const item of batchResult.items) {
              const imageData = item.imageData;
              
              if (item.success && item.data) {
                // 判断是大模型还是小模型推理
                let classification;
                
                if (item.data.category && item.data.category !== '') {
                  // 大模型推理
                  classification = {
                    categoryId: item.data.category,
                    confidence: item.data.confidence || 0.9,
                    idCardDetections: [],
                    generalDetections: [],
                    mobileNetV3Detections: null,
                    message: item.data.description || item.data.message || null,
                    background_color: item.data.background_color || null
                  };
                } else if (item.data.local_inference_result) {
                  // 小模型推理：只保存检测结果，分类保持为NA，让漏斗到下个阶段处理
                  const localResult = item.data.local_inference_result;
                  
                  classification = {
                    categoryId: 'NA', // 保持为NA，让漏斗到下个阶段（本地推理）处理
                    confidence: 0.8,
                    idCardDetections: localResult.idCardDetections || [],
                    generalDetections: localResult.generalDetections || [],
                    mobileNetV3Detections: localResult.mobileNetV3Detections || null,
                    message: null
                  };
                } else {
                  logger.warn(`⚠️ 批次 ${batchNumber}: 分类结果构建失败: category=${item.data.category}, hasLocalResult=${!!item.data.local_inference_result}`);
                  batchFailedImages.push(imageData);
                  batchFailedCount++;
                  continue;
                }
                
                // 转换为批量更新分类信息的格式
                classificationDataArray.push({
                  uri: extractOriginalUri(imageData),
                  id: imageData.id,
                  category: classification.categoryId || classification.category,
                  confidence: classification.confidence,
                  idCardDetections: classification.idCardDetections,
                  generalDetections: classification.generalDetections,
                  mobileNetV3Detections: classification.mobileNetV3Detections,
                  message: classification.message,
                  background_color: classification.background_color || null
                });
              } else {
                // 处理错误或数据缺失情况
                const originalUri = extractOriginalUri(imageData);
                const errorDetails = {
                  success: item.success,
                  hasData: !!item.data,
                  data: item.data,
                  error: item.error,
                  fileName: imageData.fileName,
                  uri: originalUri,
                  uriFormat: originalUri?.includes('||') ? 'combined' : (originalUri?.startsWith('content://') ? 'content-only' : 'file-only')
                };
                
                // 区分真正的失败和成功但无数据的情况
                if (!item.success || item.error) {
                  // 真正的失败：success为false或存在error
                  const isTimeoutError = item.error?.includes('超时') || 
                                        item.error?.includes('timeout') ||
                                        item.error === 'Aborted';
                  
                  if (isTimeoutError) {
                    logger.warn(`❌ 批次 ${batchNumber}: 远程推理失败（超时）:`, errorDetails);
                  } else {
                    logger.warn(`❌ 批次 ${batchNumber}: 远程推理失败:`, errorDetails);
                  }
                } else {
                  // 成功但无数据：success为true但data为空
                  logger.debug(`⚠️ 批次 ${batchNumber}: 远程推理成功但无有效数据:`, errorDetails);
                }
                
                batchFailedImages.push(imageData);
                batchFailedCount++;
              }
            }
            
            // ========== 节点4: 批量保存 ==========
            if (classificationDataArray.length > 0) {
              logger.debug(`💾 批次 ${batchNumber}: 开始批量保存 ${classificationDataArray.length} 张图片到数据库`);
              
              try {
                const updateResult = await UnifiedDataService.batchUpdateClassification(classificationDataArray, false);
                
                if (updateResult.success) {
                  batchProcessedCount = updateResult.updatedCount;
                  this.imagesClassified += updateResult.updatedCount;
                  logger.debug(`✅ 批次 ${batchNumber}: 批量保存成功 ${batchProcessedCount} 张`);
                } else {
                  batchFailedCount += classificationDataArray.length;
                  logger.error(`❌ 批次 ${batchNumber}: 批量保存失败`);
                }
              } catch (saveError) {
                logger.error(`❌ 批次 ${batchNumber}: 批量保存异常: ${saveError.message}`);
                batchFailedCount += classificationDataArray.length;
              }
            }
            
            // 更新进度（每批次完成后）
            const currentProcessed = Math.min(i + batchSize, remainingImages.length);
            this.sendProgressMessage(
              'remote_inference',
              currentProcessed,
              remainingImages.length
            );
            
            // 🔥 批次处理完成，释放内存并给GC时间
            const result = {
              processedCount: batchProcessedCount,
              failedCount: batchFailedCount,
              failedImages: batchFailedImages
            };
            
            // 清理临时变量引用（在返回结果后）
            validResults = null;
            batchResult = null;
            classificationDataArray = null;
            
            // 添加短暂延迟，给GC时间回收内存
            if (batchNumber % 5 === 0) {
              // 每5批添加稍长延迟
              await new Promise(resolve => setTimeout(resolve, 200));
            } else {
              await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            return result;
            
          } catch (batchError) {
            logger.error(`❌ 批次 ${batchNumber}: 流水线处理异常:`, batchError);
            // 异常情况下也添加延迟
            await new Promise(resolve => setTimeout(resolve, 100));
            return {
              processedCount: 0,
              failedCount: batch.length,
              failedImages: batch
            };
          }
        });
        
        // 将任务添加到数组（受并发限制控制）
        allTasks.push(pipelineTask);
      }
      
      logger.info('⏳ 等待所有批次处理完成（流水线并发执行）...');
      
      // 等待所有批次完成
      const batchResults = await Promise.all(allTasks);
      
      // 汇总所有批次的结果
      for (const batchResult of batchResults) {
        totalProcessedCount += batchResult.processedCount || 0;
        totalFailedCount += batchResult.failedCount || 0;
        if (batchResult.failedImages && batchResult.failedImages.length > 0) {
          allFailedImages.push(...batchResult.failedImages);
        }
      }
      
      logger.info(`✅ 第3层完成：远程推理成功 ${totalProcessedCount} 张，失败 ${allFailedImages.length} 张`);
      // 所有 batch 跑完后统一刷 GlobalImageCache，UI 才能拿到最新 categoryCounts
      try {
        await UnifiedDataService.imageCache.refreshCache();
      } catch (e) {
        logger.warn('legacy scanner 云端分类后刷新 GlobalImageCache 失败:', e?.message || e);
      }

      return { remainingImages: allFailedImages, processedCount: totalProcessedCount, failedCount: totalFailedCount };

    } catch (error) {
      // 处理超时和取消请求的情况
      if (error.name === 'AbortError' || error.message === 'The user aborted a request.') {
        logger.warn('⚠️ 远程推理超时或被取消，将降级到本地推理');
        return { remainingImages: remainingImages, processedCount: 0, failedCount: 0 };
      }
      
      logger.error('❌ 批量远程推理失败:', error);
      // 失败时，剩余图片都需要本地推理
      return { remainingImages: remainingImages, processedCount: 0, failedCount: remainingImages.length };
    }
  }


  /**
   * 阶段6: 相似度检测（增量检测：只处理本次扫描更新的图片）
   * 对所有已分类的图片进行相似度检测
   */
  async similarityDetectionPhase(scanStartTime, candidateImages = []) {
    const settings = await UnifiedDataService.readSettings();
    let similarityThreshold = (settings.similarityThreshold != null && settings.similarityThreshold >= 0 && settings.similarityThreshold <= 1)
      ? settings.similarityThreshold
      : 0.8;
    if (similarityThreshold < 0.8) similarityThreshold = 0.8;
    await sharedSimilarityDetection({
      sendProgressMessage: this.sendProgressMessage.bind(this),
      similarityService: this.similarityService,
      similarityThreshold,
      // PC 版本不传递 totalImagesToBeClassified
    });
  }

  /**
   * AI分类处理阶段 - 从数据库读取NA分类图片进行AI分类
   * @param {string} scanStartTime - 扫描开始时间
   * @returns {Promise<Object>} 处理结果
   */
  /**
   * AI分类处理阶段 - 对指定图片或所有NA分类图片进行AI分类
   * @param {string} scanStartTime - 扫描开始时间
   * @param {Array} imagesToClassify - 可选，指定需要分类的照片数组。如果未指定，则读取所有NA分类的照片
   * @returns {Promise<Object>} 处理结果 { processedCount, failedCount, similarityCandidates }
   */
  async aiImageClassifyByContent(scanStartTime, imagesToClassify = null, opts = {}) {
    let totalProcessed = 0;
    let totalFailed = 0;
    // forceLocal=true：忽略云端配置，强制走设备端 ONNX。
    // 用于「未配置大模型的默认离线分类」与「大模型分类失败的兜底」两种场景。
    const forceLocal = !!opts.forceLocal;

    // 是否走云端 LLM 分类：完全由用户配置的 aiProvider.active 决定，
    // 不再探测/依赖原作者后端（api.aifuture.net.cn 相关逻辑已移除）。
    // active 为云端 Provider（openai/azure/claude/gemini/kimi/custom…）→ 走 LLM；
    // active=local-onnx（或未配置）→ 仅靠扫描阶段的设备端 MobileNetV3，跳过云端。
    try {
      const aiCfg = await this._getAIProviderConfigSafe();
      this.useRemoteInference = !!(aiCfg && aiCfg.active && aiCfg.active !== 'local-onnx');
      if (this.useRemoteInference) {
        logger.info(`✅ 将使用云端 LLM 分类（${aiCfg.active}）`);
      } else {
        logger.debug('⚠️ 未配置云端模型（local-onnx），跳过云端分类，依赖设备端 MobileNetV3');
      }
    } catch (error) {
      logger.debug('读取 aiProvider 配置失败，跳过云端分类:', error.message);
      this.useRemoteInference = false;
    }
    if (forceLocal) {
      this.useRemoteInference = false; // 强制离线：无论是否配置云端，都走设备端 ONNX
    }

    // 提取需要分类的图片
    let naImages = [];
    
    if (imagesToClassify && Array.isArray(imagesToClassify) && imagesToClassify.length > 0) {
      // 如果指定了图片数组，直接使用
      naImages = imagesToClassify;
      logger.info(`📊 使用指定的 ${naImages.length} 张图片进行AI分类`);
    } else {
      // 如果没有指定，读取所有NA分类的图片
      // 🔧 修复竞态条件：确保缓存刷新完成后再读取
      // processProgressData 中的 refreshCache() 是异步的，但可能还没完成
      // 需要等待缓存构建完成后再读取 NA 分类图片
      logger.debug('🔄 等待缓存刷新完成...');
      try {
        // 强制等待缓存构建完成（如果正在构建则等待，如果已构建则直接返回）
        await UnifiedDataService.imageCache.buildCache();
        logger.debug('✅ 缓存刷新完成');
      } catch (error) {
        logger.error('❌ 等待缓存刷新失败:', error);
        // 不阻断流程，继续尝试读取
      }
      
      try {
        naImages = await UnifiedDataService.readImagesByCategory('NA');
        logger.info(`📊 提取到 ${naImages.length} 张未分类图片（NA），作为后续漏斗处理的输入数据源`);
      } catch (error) {
        logger.error('❌ 读取 NA 分类图片失败:', error);
        return { processedCount: totalProcessed, failedCount: totalFailed, similarityCandidates: [] };
      }
    }
    
    // 初始化总分类目标数量（用于进度显示）
    this.totalImagesToBeClassified = naImages.length;
    this.imagesClassified = 0; // 重置已分类数量
    logger.info(`📊 设置总分类目标: ${this.totalImagesToBeClassified} 张图片`);
    
    // NA 图片在漏斗流程后将完成分类，这里直接复用列表
    
    if (naImages.length === 0) {
      logger.info('✅ 没有未分类图片，跳过后续处理');
      // 发送完成消息（没有需要处理的图片）
      this.sendProgressMessage('completed', totalProcessed, totalProcessed, totalProcessed, this.totalImagesToBeClassified);
      return { processedCount: totalProcessed, failedCount: totalFailed, similarityCandidates: [] };
    }
    
    // 强制本地：用设备端 ONNX 对 NA 图片分类并落库
    //（未配大模型时的默认离线分类 / 大模型分类失败后的兜底）
    if (forceLocal) {
      const { processedCount: localCount, failedCount: localFailed } =
        await this.classifyImagesByLocalOnnx(naImages, scanStartTime);
      totalProcessed += localCount;
      totalFailed += localFailed;
      this.sendProgressMessage('completed', totalProcessed, totalProcessed, totalProcessed, this.totalImagesToBeClassified);
      return { processedCount: totalProcessed, failedCount: totalFailed, similarityCandidates: naImages };
    }

    // 云端 LLM 分类（已移除原作者后端的远程缓存查询层）
    if (this.useRemoteInference) {
      // 批量云端推理：处理全部 NA 图片（不再有后端缓存预筛）
      const { remainingImages: afterRemote, processedCount: remoteCount, failedCount: remoteFailed } =
        await this.classifyImagesbyLLM(naImages, scanStartTime);
      totalProcessed += remoteCount;
      totalFailed += remoteFailed;
      
      if (afterRemote.length === 0) {
        logger.info(`✅ 漏斗处理完成：远程推理已覆盖，已处理 ${totalProcessed} 张`);
        // 发送完成消息
        this.sendProgressMessage('completed', totalProcessed, totalProcessed, totalProcessed, this.totalImagesToBeClassified);
        return { processedCount: totalProcessed, failedCount: totalFailed, similarityCandidates: naImages };
      }
      
      // 如果还有剩余图片（远程推理失败），这些图片将继续保持为NA分类
      if (afterRemote.length > 0) {
        logger.info(`⚠️ 远程推理完成，但仍有 ${afterRemote.length} 张图片分类失败，将继续保持为待分类（NA）状态`);
      }
    } else {
      logger.info(`⚠️ 远程服务不可用，跳过远程缓存查询和远程推理，${naImages.length} 张NA分类图片将继续保持为待分类状态`);
    }
    
    logger.info(`✅ 漏斗处理完成：总共处理 ${totalProcessed} 张，失败 ${totalFailed} 张，剩余图片保持为待分类状态`);
    
    // 发送完成消息
    this.sendProgressMessage('completed', totalProcessed, totalProcessed, totalProcessed, this.totalImagesToBeClassified);
    
    // 阶段3-4完成
    return { processedCount: totalProcessed, failedCount: totalFailed, similarityCandidates: naImages };
  }

  /**
   * 位置信息补全
   * 对已有GPS坐标但没有位置信息（city/country）的图片，查询并更新位置信息
   * 注意：PC端扫描时已经提取过EXIF GPS信息，这里直接使用已有的坐标
   * 使用v2批量接口提高效率
   * 与移动端实现保持一致
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
   * 阶段6: 移除文件处理
   * 处理已删除的文件
   */
  async removeFilesPhase(deletedUris, scanStartTime) {
    if (deletedUris.length === 0) {
      // 阶段6: 没有文件需要移除
      return;
    }
    
    // 阶段6: 开始移除已删除文件
    
    this.sendProgressMessage('removing_files', 0, 0);
    
    const deleteResult = await UnifiedDataService.removeImagesByUris(deletedUris, false);
    if (deleteResult.success) {
      // 阶段6完成
    } else {
      console.error('❌ 阶段6失败: 移除文件失败:', deleteResult.error);
    }
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

  /**
   * 将图像缩放到1024x1024，保持宽高比
   * @param {Blob} imageBlob - 原始图像blob
   * @param {string} fileName - 文件名
   * @returns {Promise<Blob>} - 缩放后的图像blob
   */

  // ==================== 🆕 云端 LLM 路由（可配置个人 API Key 的在线分类）====================

  /**
   * 安全读取 aiProvider 配置。任何异常都按 local-onnx 处理（不影响默认离线分类）。
   * 动态 import，避免把 LLM 配置模块带进默认路径的打包。
   */
  async _getAIProviderConfigSafe() {
    try {
      const mod = await import('./llm/adapters/UnifiedDataConfigService.js');
      return await mod.default.getAIProviderConfig();
    } catch (error) {
      logger.warn('读取 aiProvider 配置失败，按 local-onnx 处理:', error?.message || error);
      return null;
    }
  }

  /**
   * 云端 LLM 批量分类。把 validResults 转 base64 后交给 wireLLMRouting，
   * 返回 { success,total,success_count,fail_count,items } 形状供下游落库。
   * 任何失败 → 相关图片标记未成功，保持 NA（不再回退原作者后端）。
   */
  async _classifyBatchWithLLM(validResults, aiCfg, clientId) {
    try {
      const inputs = await Promise.all(
        validResults.map(async (vr) => ({
          id: vr.hash,
          imageBase64: await this._validResultToBase64(vr),
        })),
      );
      const { classifyCloudBatch } = await import('./llm/wireLLMRouting.js');
      const platform = Platform.OS === 'web' ? 'pc' : Platform.OS;
      return await classifyCloudBatch({
        imageClassifier: this.imageClassifier,
        platform,
        inputs,
        validResults,
        aiCfg,
      });
    } catch (error) {
      // 不再回退原作者后端：失败的图片标记为未成功，保持 NA 由后续/下次处理。
      logger.warn('云端 LLM 分类失败，相关图片保持待分类(NA):', error?.message || error);
      return {
        success: false,
        total: validResults.length,
        success_count: 0,
        fail_count: validResults.length,
        items: validResults.map((v) => ({
          imageData: v.imageData,
          success: false,
          error: error?.message || 'LLM classify failed',
        })),
      };
    }
  }

  /**
   * 把 preprocessImagesForRemoteInference 产出的 validResult 转成无前缀 base64。
   * Web/PC：result.blob（FileReader 读 dataURL 后切掉前缀）；移动端：RNFS 读 resizedUri。
   */
  async _validResultToBase64(vr) {
    if (vr.blob) {
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = reject;
        reader.readAsDataURL(vr.blob);
      });
    }
    const localPath = getLocalPath(vr.resizedUri);
    if (!localPath) throw new Error(`无法获取缩放图片本地路径: ${vr.resizedUri}`);
    return RNFS.readFile(localPath, 'base64');
  }

}

export default GalleryScannerService;