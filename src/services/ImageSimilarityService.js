/**
 * 图片相似度检测服务
 * 负责图片相似度检测的核心逻辑和API接口
 * 包含时间窗口 + 颜色直方图的相似度检测算法
 */

import ColorHistogramExtractor from './ColorHistogramExtractor.js';
import { logger, getUri } from '../adapters/WebAdapters';

class ImageSimilarityService {
  constructor() {
    this.unifiedDataService = null; // 延迟初始化
    this.isInitialized = false;
    
    // 相似度检测配置
    this.defaultOptions = {
      timeWindow: 300,        // 5分钟
      similarityThreshold: 0.8,
      groupType: 'similar',
      histogramBins: 256,     // RGB直方图bin数量
      
      // 简化算法配置（基于推理结果）
      useSimplifiedAlgorithm: true,       // 是否启用简化算法
      globalImageCountThreshold: 300,     // 全局图片总数阈值，超过此值所有窗口都使用简化算法
      textSimilarityThreshold: 0.6,       // 文本相似度阈值（大模型message字段）
      objectSimilarityThreshold: 0.65     // 物体检测相似度阈值（小模型generalDetections）
    };
    
    this.histogramExtractor = new ColorHistogramExtractor();
  }

  /**
   * 获取UnifiedDataService实例（延迟导入避免循环依赖）
   */
  getUnifiedDataService() {
    if (!this.unifiedDataService) {
      // 动态导入避免循环依赖
      const UnifiedDataService = require('./UnifiedDataService.js').default;
      this.unifiedDataService = UnifiedDataService;
    }
    return this.unifiedDataService;
  }

  /**
   * 判断图片是否应该被排除在相似度检测之外
   * @param {Object} image - 图片对象
   * @returns {boolean} 如果应该排除返回true，否则返回false
   */
  shouldExcludeFromSimilarityDetection(image) {
    if (!image) return false;
    // 视频不参与相似度检测（直方图等图片算法对视频 uri 无意义/会失败）
    if (String(image.mimeType || '').startsWith('video/')) return true;
    if (!image.category) return false;
    // 排除以下分类：手机截图、二维码、证件照
    const excludedCategories = ['screenshot', 'qrcode', 'idcard'];
    return excludedCategories.includes(image.category);
  }

  /**
   * 获取被排除分类的统计信息
   * @param {Array} images - 图片数组
   * @returns {Object} 统计信息对象
   */
  getExcludedCategoryStats(images) {
    const stats = {
      screenshot: 0,
      qrcode: 0,
      idcard: 0,
      total: 0
    };
    
    images.forEach(img => {
      if (img && img.category) {
        if (stats.hasOwnProperty(img.category)) {
          stats[img.category]++;
          stats.total++;
        }
      }
    });
    
    return stats;
  }

  /**
   * 初始化服务
   */
  async initialize() {
    try {
      logger.debug('ImageSimilarityService 开始初始化...');
      // 获取UnifiedDataService实例
      this.getUnifiedDataService();
      this.isInitialized = true;
      logger.debug('ImageSimilarityService 初始化成功');
    } catch (error) {
      logger.error('ImageSimilarityService 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 检测相似图片
   * @param {Object} options - 检测选项
   * @param {number} options.timeWindow - 时间窗口（秒），默认300秒（5分钟）
   * @param {number} options.similarityThreshold - 相似度阈值，默认0.8
  
   * @returns {Object} 检测结果
   */
  async detectSimilarImages(options = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const {
      timeWindow = 300, // 5分钟
      similarityThreshold = 0.8,
      onProgress = null, // 进度回调函数
      images = null,
      clearExisting = images == null,
      useSimplifiedAlgorithm = undefined, // 是否使用简化算法（undefined时使用默认值）
    } = options;

    logger.debug(`开始相似图片检测: 时间窗口=${timeWindow}秒, 阈值=${similarityThreshold}, 输入图片=${images ? images.length : '全量'}`);

    try {
      const unifiedService = this.getUnifiedDataService();
      // 获取需要处理的图片数据
      let allImages = images && Array.isArray(images) && images.length > 0
        ? images
        : await unifiedService.readAllImages();
      
      if (!allImages || allImages.length === 0) {
        logger.debug('⚠️ 没有找到图片数据');
        return { success: true, groups: [], processed: 0 };
      }
      
      // 过滤掉不需要进行相似度检测的分类（手机截图、二维码、证件照）
      const beforeFilterCount = allImages.length;
      const excludedStats = this.getExcludedCategoryStats(allImages);
      allImages = allImages.filter(image => !this.shouldExcludeFromSimilarityDetection(image));
      const filteredCount = beforeFilterCount - allImages.length;
      if (filteredCount > 0) {
        const statsParts = [];
        if (excludedStats.screenshot > 0) statsParts.push(`screenshot: ${excludedStats.screenshot}`);
        if (excludedStats.qrcode > 0) statsParts.push(`qrcode: ${excludedStats.qrcode}`);
        if (excludedStats.idcard > 0) statsParts.push(`idcard: ${excludedStats.idcard}`);
        logger.debug(`📊 相似度检测：已排除 ${filteredCount} 张图片（${statsParts.join(', ')}）`);
      }

      if (clearExisting) {
        // 每次检测都清空现有相似度数据，完全重新检测
        logger.debug('🧹 清空所有相似度数据，开始完全重新检测');
        await unifiedService.clearSimilarityData();
      } else if (images && images.length > 0) {
        const idsToClear = images
          .map(img => img?.id)
          .filter(id => typeof id === 'string' || typeof id === 'number');
        if (idsToClear.length > 0) {
          logger.debug(`🧹 清除 ${idsToClear.length} 张图片的旧相似度数据`);
          await unifiedService.clearSimilarityData(idsToClear);
        }
      }
     
      logger.debug(`📊 参与相似度检测的图片数: ${allImages.length}`);

      // 执行相似度检测
      const detectionResult = await this.detectSimilarityGroups(
        allImages,
        {
          timeWindow,
          similarityThreshold,
          groupType: 'similar',
          onProgress, // 传递进度回调
          ...(useSimplifiedAlgorithm !== undefined && { useSimplifiedAlgorithm }), // 如果指定了则传递，否则使用默认值
        }
      );

      // 检测结果已在窗口级实时保存，无需再次保存
      logger.debug(`✅ 相似度检测完成: 发现${detectionResult.groups.length}个相似组, 处理${detectionResult.processed}张图片`);
      
      // 异步清理临时文件（不阻塞返回，延迟5秒确保文件释放）
      // 使用 setImmediate 或 setTimeout 都是异步的，不影响性能
      setTimeout(() => {
        this._cleanupTempFiles().catch(err => {
          logger.debug('后台清理临时文件出错:', err.message);
        });
      }, 5000);

      return {
        success: true,
        groups: detectionResult.groups,
        processed: detectionResult.processed,
        total: allImages.length,
        windows: detectionResult.windows // 窗口数量
      };

    } catch (error) {
      console.error('❌ 相似度检测失败:', error);
      return {
        success: false,
        error: error.message,
        groups: [],
        processed: 0
      };
    }
  }

  /**
   * 保存窗口相似组数据（实时保存）
   * @param {Array} windowGroups - 窗口相似组数组
   * @private
   */
  async _saveWindowGroups(windowGroups) {
    try {
      // 从窗口相似组中提取所有处理过的图片
      const processedImages = [];
      for (const group of windowGroups) {
        processedImages.push(...group.images);
      }

      // 准备批量更新的相似度数据
      const imageSimilarityArray = processedImages.map(imageData => ({
        imageId: imageData.id,
        similarityInfo: {
          similarity_group_id: imageData.similarity_group_id,
          similarity_group_type: imageData.similarity_group_type,
          similarity_score: imageData.similarity_score,
          is_similarity_processed: true
        }
      }));

      // 使用批量更新函数，避免多次读取全部数据
      await this.getUnifiedDataService().updateImagesSimilarity(imageSimilarityArray);
      // logger.debug(`✅ 窗口相似组实时保存完成，更新${imageSimilarityArray.length}张图片`);

    } catch (error) {
      console.error('❌ 窗口相似组保存失败:', error);
      throw error;
    }
  }

  /**
   * 保存检测结果到存储
   * @param {Object} detectionResult - 检测结果
   * @private
   */
  async _saveDetectionResults(detectionResult) {
    try {
      // 从检测结果中提取所有处理过的图片
      const processedImages = [];
      for (const group of detectionResult.groups) {
        processedImages.push(...group.images);
      }

      // 准备批量更新的相似度数据
      const imageSimilarityArray = processedImages.map(imageData => ({
        imageId: imageData.id,
        similarityInfo: {
          similarity_group_id: imageData.similarity_group_id,
          similarity_group_type: imageData.similarity_group_type,
          similarity_score: imageData.similarity_score,
          is_similarity_processed: true
        }
      }));

      // 使用批量更新函数，避免多次读取全部数据
      await this.getUnifiedDataService().updateImagesSimilarity(imageSimilarityArray);

    } catch (error) {
      console.error('❌ 保存检测结果失败:', error);
      throw error;
    }
  }

  // ==================== 相似度检测核心算法方法 ====================

  /**
   * 检测相似图片组
   * @param {Array} images - 图片数据数组
   * @param {Object} options - 检测选项
   * @returns {Object} 检测结果
   */
  async detectSimilarityGroups(images, options = {}) {
    const opts = { ...this.defaultOptions, ...options };
    
    // 1. 过滤掉没有takenAt的图片，以及排除不需要进行相似度检测的分类
    const imagesWithTime = images.filter(image => {
      // 排除不需要进行相似度检测的分类
      if (this.shouldExcludeFromSimilarityDetection(image)) {
        return false;
      }
      // 必须有takenAt
      if (!image.takenAt) return false;
      // 确保takenAt是字符串类型
      const takenAtStr = String(image.takenAt);
      return takenAtStr.trim() !== '';
    });
    
    const excludedCount = images.length - imagesWithTime.length;
    logger.debug(`🔍 开始相似度检测: 输入${images.length}张图片, 排除${excludedCount}张（screenshot/qrcode/idcard/无时间）, 有效${imagesWithTime.length}张图片, 时间窗口=${opts.timeWindow}秒`);
    
    if (imagesWithTime.length === 0) {
      logger.debug('⚠️ 没有有效的图片进行相似度检测');
      return {
        groups: [],
        processed: 0,
        windows: 0,
        options: opts
      };
    }
    
    try {
      // 2. 按时间排序
      const sortedImages = this._sortImagesByTime(imagesWithTime);
      
      // 3. 创建时间窗口
      const timeWindows = this._createTimeWindows(sortedImages, opts.timeWindow);
      
      logger.debug(`📊 创建了${timeWindows.length}个时间窗口`);
      
      // 4. 根据全局图片总数决定算法策略
      const totalImageCount = imagesWithTime.length;
      const useSimplified = opts.useSimplifiedAlgorithm && totalImageCount >= opts.globalImageCountThreshold;
      
      if (useSimplified) {
        logger.info(`✅ 全局图片总数${totalImageCount}张 >= ${opts.globalImageCountThreshold}张，所有窗口使用简化算法`);
      } else {
        logger.info(`📊 全局图片总数${totalImageCount}张 < ${opts.globalImageCountThreshold}张，所有窗口使用颜色直方图算法`);
      }
      
      // 5. 顺序处理时间窗口（支持进度回调）
      logger.debug(`🚀 开始顺序处理${timeWindows.length}个时间窗口`);
      
      const windowResults = [];
      let totalGroups = 0;
      
      for (let index = 0; index < timeWindows.length; index++) {
        const window = timeWindows[index];
        
        let windowGroups;
        
        // ⭐ 根据全局策略选择算法（所有窗口使用相同算法）
        if (useSimplified) {
          // 使用简化算法（基于推理结果）
          // ⭐ 只在简化算法时才加载推理结果
          const windowWithInferenceData = await this._loadInferenceDataForWindow(window);
          windowGroups = this._findSimilarGroupsSimplified(windowWithInferenceData, opts);
        } else {
          // 使用原有颜色直方图算法（需要提取特征）
          const windowWithFeatures = await this._extractFeaturesForWindow(window);
          windowGroups = this._findSimilarGroupsOriginal(windowWithFeatures, opts);
        }
        
        totalGroups += windowGroups.length;
        
        windowResults.push({
          windowGroups,
          processed: window.length,
          windowIndex: index
        });
        
        // 窗口级实时保存：每个窗口处理完立即保存
        if (windowGroups.length > 0) {
          await this._saveWindowGroups(windowGroups);
        }
        
        // 🔥 每个窗口处理完后都更新进度，确保进度实时更新
        // onProgress(processed, total, groups): 已处理窗口数, 总窗口数, 当前发现的相似组数量
        if (opts.onProgress) {
          opts.onProgress(index + 1, timeWindows.length, totalGroups);
        }
      }
      
      // 合并结果
      const allGroups = windowResults.flatMap(result => result.windowGroups);
      const processedCount = windowResults.reduce((sum, result) => sum + result.processed, 0);
      
      // 5. 合并跨窗口的相似组
      const mergedGroups = this._mergeSimilarGroups(allGroups);
      
      // 🔥 合并完成后，更新最终进度（使用合并后的相似组数量）
      // onProgress(processed, total, groups): 已处理窗口数, 总窗口数, 合并后的最终相似组数量
      if (opts.onProgress) {
        opts.onProgress(timeWindows.length, timeWindows.length, mergedGroups.length);
      }
      
      logger.debug(`🎯 相似度检测完成: 发现${mergedGroups.length}个相似组, 处理${processedCount}张图片`);
      
      return {
        groups: mergedGroups,
        processed: processedCount,
        windows: timeWindows.length,
        options: opts
      };
      
    } catch (error) {
      console.error('❌ 相似度检测失败:', error);
      throw error;
    }
  }

  /**
   * 按时间排序图片
   * @param {Array} images - 图片数组
   * @returns {Array} 按时间排序的图片数组
   * @private
   */
  _sortImagesByTime(images) {
    return images.sort((a, b) => {
      const timeA = a.takenAt ? new Date(a.takenAt).getTime() : 0;
      const timeB = b.takenAt ? new Date(b.takenAt).getTime() : 0;
      return timeA - timeB;
    });
  }

  /**
   * 创建时间窗口
   * @param {Array} sortedImages - 按时间排序的图片数组
   * @param {number} timeWindow - 时间窗口大小（秒）
   * @returns {Array} 时间窗口数组
   * @private
   */
  _createTimeWindows(sortedImages, timeWindow) {
    const windows = [];
    const windowMs = timeWindow * 1000; // 转换为毫秒
    
    let currentWindow = [];
    let windowStartTime = null;
    
    for (const image of sortedImages) {
      const imageTime = image.takenAt ? new Date(image.takenAt).getTime() : 0;
      
      if (windowStartTime === null) {
        // 第一个图片，开始新窗口
        windowStartTime = imageTime;
        currentWindow = [image];
      } else if (imageTime - windowStartTime <= windowMs) {
        // 在时间窗口内，添加到当前窗口
        currentWindow.push(image);
      } else {
        // 超出时间窗口：≥2 张就可能构成"相似对"，应当参与相似度检测
        // （之前 ≥3 的门槛会把"连拍两张几乎一样"的常见情况整组丢掉）
        if (currentWindow.length >= 2) {
          windows.push([...currentWindow]);
        }
        windowStartTime = imageTime;
        currentWindow = [image];
      }
    }

    // 保存最后一个窗口（同样放宽到 ≥2）
    if (currentWindow.length >= 2) {
      windows.push(currentWindow);
    }
    
    return windows;
  }

  /**
   * 批量加载窗口内图片的推理结果
   * @param {Array} windowImages - 窗口内的图片（来自缓存，只有基本信息）
   * @returns {Array} 增强后的图片数组（包含推理结果）
   * @private
   */
  async _loadInferenceDataForWindow(windowImages) {
    
    try {
      const storageService = this.getUnifiedDataService().imageStorageService;
      
      // 提取图片ID列表
      const imageIds = windowImages.map(img => img.id);
      
      // ⭐ 一次性批量查询
      const detailedImagesMap = await storageService.getImagesByIds(imageIds);
      
      // 调试：检查返回值类型
      // logger.debug(`🔍 detailedImagesMap类型: ${detailedImagesMap?.constructor?.name}, 是Map: ${detailedImagesMap instanceof Map}`);
      
      // 确保返回的是Map对象
      if (!(detailedImagesMap instanceof Map)) {
        logger.error(`❌ getImagesByIds返回了非Map对象:`, detailedImagesMap);
        throw new Error('getImagesByIds返回了非Map对象');
      }
      
      // 合并推理结果到缓存对象
      const enhancedImages = windowImages.map(cacheImg => {
        const detailedImg = detailedImagesMap.get(cacheImg.id);
        
        if (!detailedImg) {
          logger.warn(`⚠️ 未找到图片详情: ${cacheImg.id}`);
          return {
            ...cacheImg,
            generalDetections: [],
            mobileNetV3Detections: null,
            message: null
          };
        }
        
        return {
          ...cacheImg,
          generalDetections: detailedImg.generalDetections || [],
          mobileNetV3Detections: detailedImg.mobileNetV3Detections || null,
          message: detailedImg.message || null
        };
      });
      
      // logger.debug(`✅ 推理结果加载完成`);
      return enhancedImages;
      
    } catch (error) {
      console.error('❌ 加载推理结果失败:', error);
      // 降级：返回原始图片（不包含推理结果）
      return windowImages.map(img => ({
        ...img,
        generalDetections: [],
        mobileNetV3Detections: null,
        message: null
      }));
    }
  }

  /**
   * 为时间窗口内的图片提取特征
   * @param {Array} windowImages - 时间窗口内的图片数组
   * @returns {Array} 包含特征的图片数组
   * @private
   */
  async _extractFeaturesForWindow(windowImages) {
    // 限制并发数量，避免内存池硬限制错误
    // React Native的内存池硬限制约为192MB，同时加载多张图片会超过限制
    const CONCURRENT_LIMIT = 2; // 同时最多处理2张图片
    const results = [];
    
    // 分批处理，避免同时加载太多图片
    for (let i = 0; i < windowImages.length; i += CONCURRENT_LIMIT) {
      const batch = windowImages.slice(i, i + CONCURRENT_LIMIT);
      
      // 并行处理当前批次
      const batchPromises = batch.map(async (image) => {
        try {
          let features = image.similarity_features;
          
          // 如果没有特征或需要重新提取
          if (!features || !features.color_histogram) {
            features = await this._extractColorHistogram(image);
            
            // 保存特征到图片对象
            return {
              ...image,
              similarity_features: features,
              color_histogram: features.color_histogram
            };
          } else {
            return image;
          }
        } catch (error) {
          // 检查是否是内存池错误
          const isMemoryPoolError = error?.message?.includes('Pool hard cap violation') || 
                                   error?.message?.includes('Hard cap');
          
          if (isMemoryPoolError) {
            logger.warn(`⚠️ 图片${image.fileName}特征提取失败（内存池限制），跳过:`, error.message);
          } else {
            logger.warn(`⚠️ 提取图片${image.fileName}特征失败:`, error);
          }
          
          // 返回原图片对象，不包含特征
          return image;
        }
      });
      
      // 等待当前批次完成
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // 批次之间稍作延迟，让内存有时间释放
      if (i + CONCURRENT_LIMIT < windowImages.length) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    // 顺手持久化新提取的特征（image_features 表）：给「以图搜图」建索引，重检测也可复用。
    // 异步 fire-and-forget，不阻塞相似检测主流程。
    try {
      const fresh = results.filter((r) => r && r.id && r.similarity_features && r.similarity_features.color_histogram);
      if (fresh.length > 0) {
        const UnifiedDataService = require('./UnifiedDataService.js').default;
        UnifiedDataService.imageStorageService
          .saveImageFeaturesBatch(fresh.map((r) => ({ imageId: r.id, features: r.similarity_features })))
          .catch(() => {});
      }
    } catch (_) { /* 持久化失败不影响检测 */ }

    return results;
  }

  /** 对单张图提取特征（颜色直方图等）——「以图搜图」目标图无索引时现算。 */
  async extractFeaturesForImage(image) {
    return await this._extractColorHistogram(image);
  }

  /** 比较两个特征对象的相似度（0-1）——「以图搜图」打分用。 */
  scoreFeatureSimilarity(features1, features2) {
    if (!features1 || !features2) return 0;
    return this._calculateSimilarity(
      { similarity_features: features1 },
      { similarity_features: features2 }
    );
  }

  /**
   * 提取颜色直方图特征
   * @param {Object} image - 图片对象
   * @returns {Object} 特征对象
   * @private
   */
  async _extractColorHistogram(image) {
    try {
      // 使用 getUri 获取正确的 URI（PC端：file://，移动端：content://）
      const imageUri = getUri(image);
      if (!imageUri) {
        logger.error('⚠️ 无法获取图片URI:', {
          imageId: image?.id,
          fileName: image?.fileName,
          uri: image?.uri
        });
        return this._generateDefaultFeatures();
      }
      
      // 使用真实的颜色直方图提取器
      const features = await this.histogramExtractor.extractHistogram(imageUri);
      return features;
    } catch (error) {
      logger.error('❌ 提取颜色直方图失败:', error);
      // 如果提取失败，返回默认特征
      return this._generateDefaultFeatures();
    }
  }

  /**
   * 生成默认特征（当提取失败时使用）
   * @returns {Object} 默认特征对象
   * @private
   */
  _generateDefaultFeatures() {
    return {
      color_histogram: {
        rgb: {
          r: new Array(256).fill(0),
          g: new Array(256).fill(0),
          b: new Array(256).fill(0)
        },
        hsv: {
          h: new Array(360).fill(0),
          s: new Array(100).fill(0),
          v: new Array(100).fill(0)
        }
      },
      dominant_colors: [],
      brightness: 0.5,
      contrast: 0.5,
      extracted_at: new Date().toISOString()
    };
  }

  /**
   * 找出窗口内最多的分类
   * @private
   */
  _findDominantCategory(windowImages) {
    const categoryCount = {};
    
    windowImages.forEach(image => {
      const category = image.category || 'other';
      categoryCount[category] = (categoryCount[category] || 0) + 1;
    });
    
    let dominantCategory = null;
    let maxCount = 0;
    
    for (const [category, count] of Object.entries(categoryCount)) {
      if (count > maxCount) {
        maxCount = count;
        dominantCategory = category;
      }
    }
    
    return {
      category: dominantCategory,
      count: maxCount,
      totalImages: windowImages.length,
      percentage: (maxCount / windowImages.length) * 100
    };
  }

  /**
   * 判断图片是大模型还是小模型推理
   * @private
   */
  _getInferenceType(image) {
    // 大模型推理会有message字段（描述文本）
    if (image.message && image.message.trim() !== '') {
      return 'large_model';
    } else {
      return 'small_model';
    }
  }

  /**
   * 在主导分类的图片中，找出最多的推理方式
   * @private
   */
  _findDominantInferenceType(categoryImages) {
    let largeModelCount = 0;
    let smallModelCount = 0;
    
    const largeModelImages = [];
    const smallModelImages = [];
    
    categoryImages.forEach(image => {
      const inferenceType = this._getInferenceType(image);
      
      if (inferenceType === 'large_model') {
        largeModelCount++;
        largeModelImages.push(image);
      } else {
        smallModelCount++;
        smallModelImages.push(image);
      }
    });
    
    if (largeModelCount > smallModelCount) {
      return {
        type: 'large_model',
        count: largeModelCount,
        images: largeModelImages,
        percentage: (largeModelCount / categoryImages.length) * 100
      };
    } else {
      return {
        type: 'small_model',
        count: smallModelCount,
        images: smallModelImages,
        percentage: (smallModelCount / categoryImages.length) * 100
      };
    }
  }

  /**
   * 简化算法：基于最大分类和推理方式
   * @private
   */
  _findSimilarGroupsSimplified(windowImages, options) {
    // logger.debug(`🔍 使用简化算法处理窗口：${windowImages.length}张图片`);
    
    // 步骤1：找最大分类
    const dominantCategory = this._findDominantCategory(windowImages);
    
    // logger.debug(`📊 最大分类: ${dominantCategory.category} (${dominantCategory.count}张, ${dominantCategory.percentage.toFixed(1)}%)`);
    
    // 特殊分类跳过（手机截图、二维码、身份证、待分类）
    if (this.shouldExcludeFromSimilarityDetection({ category: dominantCategory.category })) {
      logger.debug(`⏭️ 最大分类为${dominantCategory.category}，跳过相似度检测`);
      return [];
    }
    
    // 步骤2：筛选最大分类的图片
    const categoryImages = windowImages.filter(img => 
      img.category === dominantCategory.category
    );
    
    if (categoryImages.length < 3) {
      // logger.debug(`⚠️ 最大分类图片${categoryImages.length}张 < 3张，跳过相似度检测`);
      return [];
    }
    
    // 步骤3：找最多的推理方式
    const dominantInference = this._findDominantInferenceType(categoryImages);
    
    // logger.debug(`🤖 最多推理方式: ${dominantInference.type} (${dominantInference.count}张)`);
    
    // 步骤4：只处理"最大分类+最多推理方式"的图片
    const targetImages = dominantInference.images;
    
    // logger.debug(`✅ 最终处理图片数: ${targetImages.length}张（其他${windowImages.length - targetImages.length}张跳过）`);
    
    if (targetImages.length < 3) {
      logger.debug(`⚠️ 目标图片${targetImages.length}张 < 3张，跳过相似度检测`);
      return [];
    }
    
    // 步骤5：根据推理方式检测相似度
    const groups = [];
    const processed = new Set();
    
    for (let i = 0; i < targetImages.length; i++) {
      if (processed.has(i)) continue;
      
      const image1 = targetImages[i];
      const similarImages = [image1];
      processed.add(i);
      
      for (let j = i + 1; j < targetImages.length; j++) {
        if (processed.has(j)) continue;
        
        const image2 = targetImages[j];
        
        // 根据推理方式计算相似度
        let similarity;
        if (dominantInference.type === 'large_model') {
          similarity = this._calculateTextSimilarity(image1, image2);
          
          if (similarity >= options.textSimilarityThreshold) {
            similarImages.push(image2);
            processed.add(j);
          }
        } else {
          similarity = this._calculateObjectSimilarity(image1, image2);
          
          if (similarity >= options.objectSimilarityThreshold) {
            similarImages.push(image2);
            processed.add(j);
            logger.debug(`🔗 物体相似: ${image1.fileName} <-> ${image2.fileName} (${(similarity * 100).toFixed(1)}%)`);
          }
        }
      }
      
      if (similarImages.length > 1) {
        const group = this._createSimilarityGroup(similarImages, 'similar');
        groups.push(group);
      }
    }
    
    // logger.debug(`✅ 简化算法完成: 发现${groups.length}个相似组`);
    
    return groups;
  }

  /**
   * 原始算法：基于颜色直方图
   * @private
   */
  _findSimilarGroupsOriginal(windowImages, options) {
    const groups = [];
    const processed = new Set();
    
    for (let i = 0; i < windowImages.length; i++) {
      if (processed.has(i)) continue;
      
      const image1 = windowImages[i];
      const similarImages = [image1];
      processed.add(i);
      
      // 查找与当前图片相似的图片
      for (let j = i + 1; j < windowImages.length; j++) {
        if (processed.has(j)) continue;
        
        const image2 = windowImages[j];
        const similarity = this._calculateSimilarity(image1, image2);
        
        if (similarity >= options.similarityThreshold) {
          similarImages.push(image2);
          processed.add(j);
        }
      }
      
      // 如果找到相似图片，创建组
      if (similarImages.length > 1) {
        const group = this._createSimilarityGroup(similarImages, options.groupType);
        groups.push(group);
      }
    }
    
    return groups;
  }

  /**
   * 计算文本相似度（大模型message字段）
   * @private
   */
  _calculateTextSimilarity(image1, image2) {
    const message1 = image1.message || '';
    const message2 = image2.message || '';
    
    if (!message1 || !message2) {
      return 0;
    }
    
    // 提取关键词
    const keywords1 = this._extractKeywords(message1);
    const keywords2 = this._extractKeywords(message2);
    
    // 计算Jaccard相似度
    const intersection = keywords1.filter(kw => keywords2.includes(kw)).length;
    const union = new Set([...keywords1, ...keywords2]).size;
    
    if (union === 0) return 0;
    
    return intersection / union;
  }

  /**
   * 提取关键词（简单分词）
   * @private
   */
  _extractKeywords(text) {
    // 移除标点符号，转小写，分词
    const cleaned = text.toLowerCase()
      .replace(/[.,!?;:'"()[\]{}]/g, ' ')
      .trim();
    
    const words = cleaned.split(/\s+/);
    
    // 过滤停用词
    const stopWords = ['the', 'a', 'an', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'of', 'with', '的', '是', '在', '和', '了', '有'];
    const keywords = words.filter(word => 
      word.length > 2 && !stopWords.includes(word)
    );
    
    return keywords;
  }

  /**
   * 计算物体相似度（小模型generalDetections）
   * @private
   */
  _calculateObjectSimilarity(image1, image2) {
    const det1 = image1.generalDetections || [];
    const det2 = image2.generalDetections || [];
    
    // 提取高置信度物体（>0.5）
    const objects1 = new Map();
    det1.forEach(d => {
      if (d.confidence > 0.5) {
        const classId = d.classId;
        const conf = d.confidence;
        if (!objects1.has(classId) || objects1.get(classId) < conf) {
          objects1.set(classId, conf);
        }
      }
    });
    
    const objects2 = new Map();
    det2.forEach(d => {
      if (d.confidence > 0.5) {
        const classId = d.classId;
        const conf = d.confidence;
        if (!objects2.has(classId) || objects2.get(classId) < conf) {
          objects2.set(classId, conf);
        }
      }
    });
    
    // 如果都没检测到物体，尝试用MobileNetV3
    if (objects1.size === 0 && objects2.size === 0) {
      return this._calculateMobileNetV3Similarity(image1, image2);
    }
    
    // 加权Jaccard相似度
    const allClasses = new Set([...objects1.keys(), ...objects2.keys()]);
    
    let intersection = 0;
    let union = 0;
    
    for (const classId of allClasses) {
      const conf1 = objects1.get(classId) || 0;
      const conf2 = objects2.get(classId) || 0;
      
      intersection += Math.min(conf1, conf2);
      union += Math.max(conf1, conf2);
    }
    
    return intersection / union;
  }

  /**
   * MobileNetV3分类相似度（后备方案）
   * @private
   */
  _calculateMobileNetV3Similarity(image1, image2) {
    const mobile1 = image1.mobileNetV3Detections;
    const mobile2 = image2.mobileNetV3Detections;
    
    if (!mobile1 || !mobile2 || !mobile1.predictions || !mobile2.predictions) {
      return 0;
    }
    
    // 提取Top-5类别
    const top5_1 = mobile1.predictions.slice(0, 5).map(p => p.class);
    const top5_2 = mobile2.predictions.slice(0, 5).map(p => p.class);
    
    // 计算重叠度
    const overlap = top5_1.filter(c => top5_2.includes(c)).length;
    
    return overlap / 5;
  }

  /**
   * 计算两张图片的相似度（颜色直方图版本）
   * @param {Object} image1 - 图片1
   * @param {Object} image2 - 图片2
   * @returns {number} 相似度分数 (0-1)
   * @private
   */
  _calculateSimilarity(image1, image2) {
    const features1 = image1.similarity_features;
    const features2 = image2.similarity_features;
    
    if (!features1 || !features2) {
      return 0;
    }
    
    // 计算颜色直方图相似度
    const colorSimilarity = this._calculateHistogramSimilarity(
      features1.color_histogram,
      features2.color_histogram
    );
    
    // 计算其他特征相似度
    const brightnessSimilarity = this._calculateFeatureSimilarity(
      features1.brightness,
      features2.brightness
    );
    
    const contrastSimilarity = this._calculateFeatureSimilarity(
      features1.contrast,
      features2.contrast
    );
    
    // 加权平均
    const similarity = (
      colorSimilarity * 0.7 +
      brightnessSimilarity * 0.15 +
      contrastSimilarity * 0.15
    );
    
    return Math.min(1, Math.max(0, similarity));
  }

  /**
   * 计算直方图相似度
   * @param {Object} hist1 - 直方图1
   * @param {Object} hist2 - 直方图2
   * @returns {number} 相似度分数
   * @private
   */
  _calculateHistogramSimilarity(hist1, hist2) {
    // 计算RGB直方图的余弦相似度
    const rgbSimilarity = this._calculateCosineSimilarity(
      [...hist1.rgb.r, ...hist1.rgb.g, ...hist1.rgb.b],
      [...hist2.rgb.r, ...hist2.rgb.g, ...hist2.rgb.b]
    );
    
    // 计算HSV直方图的余弦相似度
    const hsvSimilarity = this._calculateCosineSimilarity(
      [...hist1.hsv.h, ...hist1.hsv.s, ...hist1.hsv.v],
      [...hist2.hsv.h, ...hist2.hsv.s, ...hist2.hsv.v]
    );
    
    // 加权平均
    return rgbSimilarity * 0.6 + hsvSimilarity * 0.4;
  }

  /**
   * 计算余弦相似度
   * @param {Array} vec1 - 向量1
   * @param {Array} vec2 - 向量2
   * @returns {number} 余弦相似度
   * @private
   */
  _calculateCosineSimilarity(vec1, vec2) {
    if (vec1.length !== vec2.length) return 0;
    
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;
    
    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }
    
    if (norm1 === 0 || norm2 === 0) return 0;
    
    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  /**
   * 计算特征相似度
   * @param {number} val1 - 值1
   * @param {number} val2 - 值2
   * @returns {number} 相似度分数
   * @private
   */
  _calculateFeatureSimilarity(val1, val2) {
    if (val1 === undefined || val2 === undefined) return 0;
    
    const diff = Math.abs(val1 - val2);
    return Math.max(0, 1 - diff);
  }

  /**
   * 创建相似组
   * @param {Array} similarImages - 相似图片数组
   * @param {string} groupType - 组类型
   * @returns {Object} 相似组对象
   * @private
   */
  _createSimilarityGroup(similarImages, groupType) {
    const groupId = this._generateGroupId();
    
    // 为每张图片分配相似组信息
    const processedImages = similarImages.map((image, index) => {
      const similarityScore = index === 0 ? 1.0 : 
        this._calculateSimilarity(similarImages[0], image);
      
      return {
        ...image,
        similarity_group_id: groupId,
        similarity_group_type: groupType,
        similarity_score: similarityScore
      };
    });
    
    const group = {
      id: groupId,
      type: groupType,
      images: processedImages,
      confidence: this._calculateGroupConfidence(processedImages),
      created_at: new Date().toISOString()
    };
    
    return group;
  }

  /**
   * 计算组置信度
   * @param {Array} images - 图片数组
   * @returns {number} 置信度分数
   * @private
   */
  _calculateGroupConfidence(images) {
    if (images.length <= 1) return 0;
    
    const scores = images.slice(1).map(img => img.similarity_score || 0);
    const averageScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    
    return averageScore;
  }

  /**
   * 生成组ID
   * @returns {string} 组ID
   * @private
   */
  _generateGroupId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `group_${timestamp}_${random}`;
  }

  /**
   * 合并相似组
   * @param {Array} groups - 相似组数组
   * @returns {Array} 合并后的相似组数组
   * @private
   */
  _mergeSimilarGroups(groups) {
    // 简化实现，实际应该检查跨窗口的相似性
    return groups;
  }

  /**
   * 清理临时文件（移动端cache目录）
   * 使用重试机制，确保文件被正确清理
   * @private
   */
  async _cleanupTempFiles() {
    try {
      const { Platform, RNFS } = require('../adapters/WebAdapters');
      
      // 只在移动端执行
      if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
        return;
      }
      
      if (!RNFS) {
        return;
      }
      
      // 获取cache目录路径
      const cacheDir = RNFS.CachesDirectoryPath;
      
      // 读取cache目录中的文件
      const files = await RNFS.readDir(cacheDir);
      
      // 过滤出临时JPEG文件
      const tempFiles = files.filter(file => 
        file.name.endsWith('.JPEG') || file.name.endsWith('.jpeg')
      );
      
      if (tempFiles.length === 0) {
        return;
      }
      
      logger.info(`🧹 开始清理 ${tempFiles.length} 个临时文件...`);
      
      let cleanedCount = 0;
      let skippedCount = 0; // 已不存在的文件数量
      let failedFiles = [];
      
      // 第一次尝试：批量删除（先检查文件是否存在）
      for (const file of tempFiles) {
        try {
          // 先检查文件是否存在
          const fileExists = await RNFS.exists(file.path);
          if (!fileExists) {
            skippedCount++;
            continue; // 文件不存在，跳过删除
          }
          
          await RNFS.unlink(file.path);
          cleanedCount++;
        } catch (error) {
          // 如果错误是文件不存在，跳过
          if (error.code === 'ENOENT' || error.message?.includes('does not exist')) {
            skippedCount++;
            continue;
          }
          failedFiles.push(file);
        }
      }
      
      // 如果有失败的文件，延迟3秒后重试
      if (failedFiles.length > 0) {
        logger.debug(`⏳ 等待3秒后重试清理 ${failedFiles.length} 个文件...`);
        
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const retryFailed = [];
        for (const file of failedFiles) {
          try {
            // 重试前再次检查文件是否存在
            const fileExists = await RNFS.exists(file.path);
            if (!fileExists) {
              skippedCount++;
              continue; // 文件不存在，跳过删除
            }
            
            await RNFS.unlink(file.path);
            cleanedCount++;
          } catch (error) {
            // 如果错误是文件不存在，跳过
            if (error.code === 'ENOENT' || error.message?.includes('does not exist')) {
              skippedCount++;
              continue;
            }
            retryFailed.push(file);
          }
        }
        
        if (retryFailed.length > 0) {
          logger.debug(`⚠️ ${retryFailed.length} 个文件清理失败，将在下次扫描时清理`);
        }
      }
      
      // 记录跳过统计（静默处理，不输出警告）
      if (skippedCount > 0) {
        logger.debug(`ℹ️ ${skippedCount} 个文件已不存在，跳过清理`);
      }
      
      if (cleanedCount > 0) {
        logger.info(`✅ 临时文件清理完成: ${cleanedCount}/${tempFiles.length} 个文件`);
      }
      
    } catch (error) {
      // 清理失败不影响主流程，静默处理
      logger.debug('临时文件清理过程出错:', error.message);
    }
  }
}

export default ImageSimilarityService;
