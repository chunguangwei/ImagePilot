// 全局图片缓存服务 - 单例模式，避免重复加载
import configService from './ConfigService.js';
import { logger, getLocalPath } from '../adapters/WebAdapters';

class GlobalImageCache {
  constructor() {
    this.cache = {
      allImages: [],
      categoryCounts: {},
      cityCounts: {},
      colorCounts: {},
      directoryCounts: {}, // 目录统计
      formatCounts: {}, // 格式统计
      resolutionCounts: {}, // 分辨率统计（完整数据，包含所有分辨率）
      orientationCounts: {}, // 方向统计（横屏、竖屏、全景）
      isoCounts: {}, // ISO统计
      apertureCounts: {}, // 光圈统计
      shutterCounts: {}, // 快门统计
      focalLengthCounts: {}, // 焦距统计
      recentImages: [],
      selectedCategoryCounts: {}, // 选中图片的分类统计
      selectedCityCounts: {}, // 选中图片的城市统计
      selectedSimilarityGroupCounts: {} // 选中图片的相似组统计
    };
    
    // ID到索引的映射，用于快速查找
    this.imageIdToIndex = new Map();
    this.isLoading = false;
    this.isLoaded = false;
    this.listeners = new Set();
    this.imageStorageService = null; // 延迟获取，避免循环依赖
    
    // 选中状态管理
    this.selectionListeners = new Set();
  }
  
  /**
   * 获取存储服务实例（从 UnifiedDataService 获取，避免重复创建）
   */
  getStorageService() {
    if (!this.imageStorageService) {
      // 动态导入避免循环依赖
      const UnifiedDataService = require('./UnifiedDataService.js').default;
      this.imageStorageService = UnifiedDataService.imageStorageService;
    }
    return this.imageStorageService;
  }

  // 添加监听器
  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  // 通知所有监听器
  notifyListeners() {
    this.listeners.forEach(callback => callback(this.cache));
  }

  /** 内置分类显示/隐藏变化后：重算分类统计（隐藏分类归 NA）+ 通知监听者，首页即时反映，无需重扫 */
  rebuildCategoryCountsAndNotify() {
    this._rebuildCategoryCounts();
    this.notifyListeners();
  }

  // 构建缓存
  async buildCache() {
    if (this.isLoading) {
      // 如果正在加载，等待完成（不打印日志，避免日志污染）
      return new Promise((resolve) => {
        const checkLoaded = () => {
          if (this.isLoaded) {
            resolve(this.cache);
          } else {
            setTimeout(checkLoaded, 100);
          }
        };
        checkLoaded();
      });
    }

    if (this.isLoaded) {
      // 已加载，直接返回，不打印日志（避免日志污染）
      return this.cache;
    }

    // 只在真正开始构建时打印
    this.isLoading = true;

    try {
      // 确保 ConfigService 已初始化
      if (!configService.isConfigLoaded()) {
        logger.debug('⏳ ConfigService 未加载，开始初始化...');
        await configService.initialize();
        logger.debug('✅ ConfigService 初始化完成');
      }
      
      
      // 获取存储服务实例（共享 UnifiedDataService 的实例）
      const storageService = this.getStorageService();
      
      // 获取所有图片的精简数据（ImageStorageService已经做了数据转换）
      const allImages = await storageService.getImages();
      
      // 检查返回的数据类型
      if (!Array.isArray(allImages)) {
        logger.error(`buildCache: getImages() 返回的不是数组! 类型: ${typeof allImages}, 值:`, allImages);
      }
      
      // 确保 allImages 是数组
      if (!Array.isArray(allImages)) {
        logger.warn('allImages 不是数组，初始化为空数组');
        this.cache.allImages = [];
      } else {
        // 🆕 在构建缓存时，从 imageDimensions 提取 width 和 height 到精简信息中
        this.cache.allImages = allImages.map(img => {
          let processedImg = { ...img };
          
          // 从 imageDimensions 字段提取尺寸信息，赋值到 width 和 height
          if (img.imageDimensions) {
            // imageDimensions 可能是对象或 JSON 字符串
            let dimensions = img.imageDimensions;
            if (typeof dimensions === 'string') {
              try {
                dimensions = JSON.parse(dimensions);
              } catch (e) {
                logger.debug('解析 imageDimensions JSON 失败:', e);
                dimensions = null;
              }
            }
            
            if (dimensions && typeof dimensions === 'object') {
              processedImg.width = dimensions.width || img.width || null;
              processedImg.height = dimensions.height || img.height || null;
            }
          }
          
          // 🔥 解析 cameraSettings JSON 字符串
          if (img.cameraSettings && typeof img.cameraSettings === 'string') {
            try {
              processedImg.cameraSettings = JSON.parse(img.cameraSettings);
            } catch (e) {
              logger.debug('解析 cameraSettings JSON 失败:', e);
              processedImg.cameraSettings = null;
            }
          }
          
          // 🔥 确保分类字段被包含在精简信息中（这些字段可能直接从数据库读取，不需要解析）
          // isoCategory, apertureCategory, shutterCategory, focalLengthCategory 已经是字符串，直接保留
          if (img.isoCategory !== undefined) processedImg.isoCategory = img.isoCategory;
          if (img.apertureCategory !== undefined) processedImg.apertureCategory = img.apertureCategory;
          if (img.shutterCategory !== undefined) processedImg.shutterCategory = img.shutterCategory;
          if (img.focalLengthCategory !== undefined) processedImg.focalLengthCategory = img.focalLengthCategory;
          
          return processedImg;
        });
      }
      
      // 验证数据完整性
      let missingCategoryCount = 0;
      this.cache.allImages.forEach(img => {
        if (!img.category) {
          missingCategoryCount++;
          logger.warn(`图片 ${img.id} 缺少分类信息:`, {
            id: img.id,
            fileName: img.fileName,
            category: img.category,
            hasCategory: 'category' in img
          });
        }
      });
      
      if (missingCategoryCount > 0) {
        logger.warn(`发现 ${missingCategoryCount} 张图片缺少分类信息`);
      }
      
      // 更新ID到索引的映射
      this._rebuildImageIdIndex();
      
      // 不再维护 imagesByCategory 和 imagesByCity 索引
      // 直接通过过滤 allImages 来获取数据
      
      // 计算统计信息
      this._rebuildCategoryCounts();
      this._rebuildCityCounts();
      this._rebuildColorCounts();
      this._rebuildDirectoryCounts();
      this._rebuildFormatCounts();
      this._rebuildResolutionCounts();
      this._rebuildOrientationCounts();
      this._rebuildCameraSettingsCounts();
      
      // 加载相似组数据到图片对象中
      await this._loadSimilarityGroupData();
      
      // 获取最近图片（从缓存中取前20张）
      this.cache.recentImages = this.cache.allImages
        .sort((a, b) => {
          const timeA = a.takenAt ? new Date(a.takenAt).getTime() : a.timestamp;
          const timeB = b.takenAt ? new Date(b.takenAt).getTime() : b.timestamp;
          return timeB - timeA;
        })
        .slice(0, 20);
      
      this.isLoaded = true;
      this.isLoading = false;
      
      // 通知所有监听器
      this.notifyListeners();
      
      return this.cache;
    } catch (error) {
      console.error('❌ 构建图片缓存失败:', error);
      this.isLoading = false;
      throw error;
    }
  }

  // 获取缓存数据
  getCache() {
    return this.cache;
  }

  // 刷新缓存
  async refreshCache() {
    this.isLoaded = false;
    this.isLoading = false;
    return this.buildCache();
  }

  // 增量添加图片到缓存
  addImageToCache(image) {
    try {
      // 检查图片是否已存在
      const existingIndex = this.cache.allImages.findIndex(img => img.id === image.id);
      if (existingIndex !== -1) {
        logger.debug('📝 图片已存在于缓存中:', image.id);
        return false;
      }

      // 添加到主列表
      this.cache.allImages.push(image);
      
      // 更新ID索引映射
      this.imageIdToIndex.set(image.id, this.cache.allImages.length - 1);
      
      // 更新统计信息（隐藏分类归 NA）
      const normalizedCategory = this._effectiveCategoryId(image.category);
      this.cache.categoryCounts[normalizedCategory] = (this.cache.categoryCounts[normalizedCategory] || 0) + 1;
      // 城市统计
      if (image.city) {
        this.cache.cityCounts[image.city] = (this.cache.cityCounts[image.city] || 0) + 1;
      }
      // 颜色统计（排除 null、undefined 和空字符串）
      if (image.background_color && 
          typeof image.background_color === 'string' && 
          image.background_color.trim() !== '') {
        this.cache.colorCounts[image.background_color] = (this.cache.colorCounts[image.background_color] || 0) + 1;
      }
      // 目录统计
      const dirPath = this._extractDirectoryPath(image);
      if (dirPath) {
        this.cache.directoryCounts[dirPath] = (this.cache.directoryCounts[dirPath] || 0) + 1;
      }
      // 格式统计
      const format = this._extractImageFormat(image);
      if (format && format !== 'UNKNOWN') {
        this.cache.formatCounts[format] = (this.cache.formatCounts[format] || 0) + 1;
      }
      // 分辨率统计
      // 🆕 直接使用 width 和 height（如果新图片有 imageDimensions，需要先提取）
      let width = image.width;
      let height = image.height;
      
      // 如果 width/height 不存在，尝试从 imageDimensions 提取
      if ((!width || !height) && image.imageDimensions) {
        let dimensions = image.imageDimensions;
        if (typeof dimensions === 'string') {
          try {
            dimensions = JSON.parse(dimensions);
          } catch (e) {
            dimensions = null;
          }
        }
        if (dimensions && typeof dimensions === 'object') {
          width = dimensions.width || width;
          height = dimensions.height || height;
        }
      }
      
      if (width && height && width > 0 && height > 0) {
        const resolution = this._getResolutionCategory(width, height);
        if (resolution && resolution !== 'UNKNOWN') {
          this.cache.resolutionCounts[resolution] = (this.cache.resolutionCounts[resolution] || 0) + 1;
        }
        
        // 方向统计
        const orientation = this._getOrientationCategory(width, height);
        if (orientation && orientation !== 'UNKNOWN') {
          this.cache.orientationCounts[orientation] = (this.cache.orientationCounts[orientation] || 0) + 1;
        }
      }
      
      // 🔥 拍摄参数统计
      if (image.isoCategory) {
        this.cache.isoCounts[image.isoCategory] = (this.cache.isoCounts[image.isoCategory] || 0) + 1;
      }
      if (image.apertureCategory) {
        this.cache.apertureCounts[image.apertureCategory] = (this.cache.apertureCounts[image.apertureCategory] || 0) + 1;
      }
      if (image.shutterCategory) {
        this.cache.shutterCounts[image.shutterCategory] = (this.cache.shutterCounts[image.shutterCategory] || 0) + 1;
      }
      if (image.focalLengthCategory) {
        this.cache.focalLengthCounts[image.focalLengthCategory] = (this.cache.focalLengthCounts[image.focalLengthCategory] || 0) + 1;
      }
      
      // 更新最近图片列表（保持前20张）
      this.cache.recentImages = this.cache.allImages
        .sort((a, b) => {
          const timeA = a.takenAt ? new Date(a.takenAt).getTime() : a.timestamp;
          const timeB = b.takenAt ? new Date(b.takenAt).getTime() : b.timestamp;
          return timeB - timeA;
        })
        .slice(0, 20);
      
      logger.debug('📝 图片已增量添加到缓存:', image.id);
      
      // 通知监听器
      this.notifyListeners();
      
      return true;
      
    } catch (error) {
      console.error('❌ 添加图片到缓存失败:', error);
      return false;
    }
  }

  // 按需加载图片详细信息
  async getImageDetails(imageId) {
    try {
      const fullImage = await this.imageStorageService.getImageById(imageId);
      return fullImage;
    } catch (error) {
      console.error('加载图片详细信息失败:', error);
      return null;
    }
  }

  // 更新单个图片的分类
  updateImageClassification(imageId, newCategory, additionalData = {}) {
    try {
      logger.debug(`🔄 更新图片分类: ${imageId} -> ${newCategory}`);
      
      // 找到要更新的图片
      const imageIndex = this.cache.allImages.findIndex(img => img.id === imageId);
      if (imageIndex === -1) {
        logger.debug(`⚠️ 未找到图片: ${imageId}`);
        return false;
      }
      
      const oldCategory = this.cache.allImages[imageIndex].category;
      
      // 更新图片分类，同时保留其他检测结果信息
      this.cache.allImages[imageIndex] = {
        ...this.cache.allImages[imageIndex], // 保留原有数据
        category: newCategory,               // 更新分类
        ...additionalData                   // 合并额外数据（如检测结果）
      };
      
      // 重新构建分类索引
      // 不再需要重建索引，直接通过过滤获取数据
      
      // 重新构建分类统计和城市统计（城市统计需要排除tobecleaned）
      this._rebuildCategoryCounts();
      this._rebuildCityCounts();
      this._rebuildColorCounts();
      this._rebuildDirectoryCounts();
      this._rebuildFormatCounts();
      this._rebuildResolutionCounts();
      this._rebuildCameraSettingsCounts();
    
      
      logger.debug(`✅ 图片分类更新完成: ${oldCategory} -> ${newCategory}`);
      
      // 通知监听器
      this.notifyListeners();
      
      return true;
      
    } catch (error) {
      console.error('❌ 更新图片分类失败:', error);
      return false;
    }
  }
  
  /**
   * 🔥 批量更新图片分类（优化版本：只重建一次统计）
   * @param {Array} updates - 更新数组，每个元素包含 { imageId, newCategory, additionalData }
   */
  batchUpdateImageClassification(updates) {
    try {
      if (!updates || updates.length === 0) {
        return { success: true, processed: 0 };
      }
      
      logger.debug(`🔄 批量更新图片分类: ${updates.length} 张图片`);
      
      let processed = 0;
      const errors = [];
      
      // 批量更新图片分类（不重建统计）
      for (const update of updates) {
        const { imageId, newCategory, additionalData = {} } = update;
        
        const imageIndex = this.cache.allImages.findIndex(img => img.id === imageId);
        if (imageIndex === -1) {
          logger.debug(`⚠️ 未找到图片: ${imageId}`);
          errors.push({ imageId, error: '图片不存在' });
          continue;
        }
        
        // 更新图片分类，同时保留其他检测结果信息
        this.cache.allImages[imageIndex] = {
          ...this.cache.allImages[imageIndex], // 保留原有数据
          category: newCategory,               // 更新分类
          ...additionalData                   // 合并额外数据（如检测结果）
        };
        
        processed++;
      }
      
      // 🔥 批量更新完成后，只重建一次统计（性能优化）
      this._rebuildCategoryCounts();
      this._rebuildCityCounts();
      this._rebuildColorCounts();
      this._rebuildDirectoryCounts();
      this._rebuildFormatCounts();
      this._rebuildResolutionCounts();
      this._rebuildCameraSettingsCounts();
      
      logger.debug(`✅ 批量更新图片分类完成: ${processed} 张成功`);
      
      // 通知监听器
      this.notifyListeners();
      
      return { success: errors.length === 0, processed, errors: errors.length > 0 ? errors : undefined };
      
    } catch (error) {
      console.error('❌ 批量更新图片分类失败:', error);
      return { success: false, processed: 0, errors: [{ error: error.message }] };
    }
  }
  
  // 重新构建ID到索引的映射
  _rebuildImageIdIndex(forceLog = false) {
    if (forceLog) {
      logger.debug(`🔄 重新构建ID映射表，图片数量: ${this.cache.allImages.length}`);
    } else {
    }
    this.imageIdToIndex.clear();
    this.cache.allImages.forEach((img, index) => {
      this.imageIdToIndex.set(img.id, index);
    });
    if (forceLog) {
      logger.debug(`✅ ID映射表构建完成，映射条目数: ${this.imageIdToIndex.size}`);
    }
  }

  // 通过ID快速获取图片对象（O(1)复杂度）
  _getImageById(imageId) {
    const index = this.imageIdToIndex.get(imageId);
    
    // 调试：检查映射表状态
    if (index === undefined) {
      // 映射表中找不到，尝试直接查找
      const image = this.cache.allImages.find(img => img.id === imageId);
      if (image) {
        // 找到了说明映射表过期
        // 但如果正在构建缓存，不重建映射表，直接返回
        if (this.isLoading) {
          return image; // 安全：buildCache已经设置好完整的allImages
        }
        // 不在构建中，重建映射表
        this._rebuildImageIdIndex(false);
        return image;
      }
      
      // 确实没找到
      return null;
    }
    
    const image = this.cache.allImages[index];
    
    // 索引处没有对象
    if (!image) {
      // 如果正在构建缓存，直接返回null，不要重建
      if (this.isLoading) {
        return null;
      }
      this._rebuildImageIdIndex(false);
      return null;
    }
    
    // 验证ID匹配
    if (image.id !== imageId) {
      // 如果正在构建缓存，使用find查找，不要重建
      if (this.isLoading) {
        return this.cache.allImages.find(img => img.id === imageId) || null;
      }
      
      // 不在构建中，重建映射表
      this._rebuildImageIdIndex(false);
      const correctImage = this.cache.allImages.find(img => img.id === imageId);
      return correctImage || null;
    }
    
    return image;
  }

  // 重新构建分类统计
  _rebuildCategoryCounts() {
    this.cache.categoryCounts = {};
    this.cache.allImages.forEach((img, index) => {
      if (img.category) {
        // 使用「有效分类ID」作为键（隐藏的内置分类归 NA）
        const normalizedCategory = this._effectiveCategoryId(img.category);
        this.cache.categoryCounts[normalizedCategory] = (this.cache.categoryCounts[normalizedCategory] || 0) + 1;
      }
    });
  }

  // 标准化分类ID（直接使用ConfigService）
  _normalizeCategoryId(categoryInput) {
    // 确保配置服务已加载
    if (!configService || !configService.isConfigLoaded()) {
      throw new Error('ConfigService未初始化或配置未加载');
    }
    
    const categoryMap = configService.getCategoryNameMap();
    
    // 如果输入已经是键名，直接返回
    if (categoryMap[categoryInput]) {
      return categoryInput;
    }
    
    // 如果是显示名称，查找对应的键名
    for (const [key, category] of Object.entries(categoryMap)) {
      if (category.chinese === categoryInput || category.english === categoryInput) {
        return key;
      }
    }
    
    // 如果都没找到，返回原值（支持 'NA' 等未配置的分类）
    return categoryInput;
  }

  /**
   * 「有效分类」= 标准化分类，但若该内置分类被用户删除(隐藏)，则在统计/取图上归到「待分类(NA)」。
   * 为什么放展示层：截图/二维码/证件照等是元数据检测分类（不走 CLIP，绕过候选集剔除），
   * 删该分类后新图仍被打成原分类；隐藏后这些图既不在(隐藏的)原分类、也不在 NA → "消失"。
   * 这里把库里属于隐藏分类的图，在展示/统计时映射到 NA；**不改库**，恢复分类后自动回到原类（可逆）。
   * NA / other 是系统档，永不隐藏。
   */
  _effectiveCategoryId(rawCategory) {
    const norm = this._normalizeCategoryId(rawCategory);
    if (norm === 'NA' || norm === 'other') return norm;
    if (configService && typeof configService.isBuiltinCategoryHidden === 'function'
        && configService.isBuiltinCategoryHidden(norm)) {
      return 'NA';
    }
    return norm;
  }

  /**
   * 判断图片是否为手机截图
   * @param {Object} image - 图片对象
   * @returns {boolean} 是否为手机截图
   */
  _isScreenshot(image) {
    if (!image || !image.category) {
      return false;
    }
    // 标准化分类ID后判断
    const normalizedCategory = this._normalizeCategoryId(image.category);
    return normalizedCategory === 'screenshot';
  }

  // 更新选中统计 - 添加图片
  _updateSelectedStatsAdd(image) {
    if (!image.category) {
      console.error(`❌ 图片 ${image.id} 缺少分类信息:`, image);
      throw new Error(`图片 ${image.id} 缺少分类信息`);
    }
    const category = this._normalizeCategoryId(image.category);
    this.cache.selectedCategoryCounts[category] = (this.cache.selectedCategoryCounts[category] || 0) + 1;
    
    // 更新城市统计（如果有）
    if (image.city) {
      this.cache.selectedCityCounts[image.city] = (this.cache.selectedCityCounts[image.city] || 0) + 1;
    }
    
    // 更新相似组统计（如果有）
    if (image.similarityGroupIndex) {
      // 确保selectedSimilarityGroupCounts对象存在
      if (!this.cache.selectedSimilarityGroupCounts) {
        this.cache.selectedSimilarityGroupCounts = {};
      }
      this.cache.selectedSimilarityGroupCounts[image.similarityGroupIndex] = (this.cache.selectedSimilarityGroupCounts[image.similarityGroupIndex] || 0) + 1;
    }
  }

  // 更新选中统计 - 移除图片
  _updateSelectedStatsRemove(image) {
    if (!image.category) {
      console.error(`❌ 图片 ${image.id} 缺少分类信息:`, image);
      throw new Error(`图片 ${image.id} 缺少分类信息`);
    }
    const category = this._normalizeCategoryId(image.category);
    if (this.cache.selectedCategoryCounts[category] > 0) {
      this.cache.selectedCategoryCounts[category]--;
      if (this.cache.selectedCategoryCounts[category] === 0) {
        delete this.cache.selectedCategoryCounts[category];
      }
    }
    
    if (image.city && this.cache.selectedCityCounts[image.city] > 0) {
      this.cache.selectedCityCounts[image.city]--;
      if (this.cache.selectedCityCounts[image.city] === 0) {
        delete this.cache.selectedCityCounts[image.city];
      }
    }
    
    if (image.similarityGroupIndex) {
      // 确保selectedSimilarityGroupCounts对象存在
      if (!this.cache.selectedSimilarityGroupCounts) {
        this.cache.selectedSimilarityGroupCounts = {};
      }
      if (this.cache.selectedSimilarityGroupCounts[image.similarityGroupIndex] > 0) {
        this.cache.selectedSimilarityGroupCounts[image.similarityGroupIndex]--;
        if (this.cache.selectedSimilarityGroupCounts[image.similarityGroupIndex] === 0) {
          delete this.cache.selectedSimilarityGroupCounts[image.similarityGroupIndex];
        }
      }
    }
  }

  // 清空选中统计
  _clearSelectedStats() {
    this.cache.selectedCategoryCounts = {};
    this.cache.selectedCityCounts = {};
    this.cache.selectedSimilarityGroupCounts = {};
  }

  // 加载相似组数据到图片对象中
  async _loadSimilarityGroupData() {
    try {
      // 获取相似组索引
      const similarityGroupIndex = await this.imageStorageService.getSimilarityGroupIndex();
      
      if (!similarityGroupIndex || Object.keys(similarityGroupIndex).length === 0) {
        return;
      }
      
      // 为每个图片设置相似组信息
      for (const [groupId, imageIds] of Object.entries(similarityGroupIndex)) {
        if (Array.isArray(imageIds)) {
          for (const imageId of imageIds) {
            const image = this._getImageById(imageId);
            if (image) {
              image.similarityGroupIndex = groupId;
            }
          }
        }
      }
      
    } catch (error) {
      console.error('❌ 加载相似组数据失败:', error);
    }
  }

  // 重新构建选中统计
  _rebuildSelectedStats() {
    logger.debug('📊 开始重新计算选中统计...');
    this.cache.selectedCategoryCounts = {};
    this.cache.selectedCityCounts = {};
    this.cache.selectedSimilarityGroupCounts = {};
    
    this.cache.allImages.forEach(img => {
      if (img.selected) {
        if (img.category) {
          const category = this._normalizeCategoryId(img.category);
          this.cache.selectedCategoryCounts[category] = (this.cache.selectedCategoryCounts[category] || 0) + 1;
        }
        if (img.city) {
          this.cache.selectedCityCounts[img.city] = (this.cache.selectedCityCounts[img.city] || 0) + 1;
        }
        if (img.similarityGroupIndex) {
          // 确保selectedSimilarityGroupCounts对象存在
          if (!this.cache.selectedSimilarityGroupCounts) {
            this.cache.selectedSimilarityGroupCounts = {};
          }
          this.cache.selectedSimilarityGroupCounts[img.similarityGroupIndex] = (this.cache.selectedSimilarityGroupCounts[img.similarityGroupIndex] || 0) + 1;
        }
      }
    });
    
    logger.debug('📊 选中统计重建完成:', {
      selectedCategoryCounts: this.cache.selectedCategoryCounts,
      selectedCityCounts: this.cache.selectedCityCounts,
      selectedSimilarityGroupCounts: this.cache.selectedSimilarityGroupCounts
    });
  }

  // 获取选中图片的分类统计
  getSelectedCategoryCounts() {
    return { ...this.cache.selectedCategoryCounts };
  }

  // 获取选中图片的城市统计
  getSelectedCityCounts() {
    return { ...this.cache.selectedCityCounts };
  }

  // 获取选中图片的相似组统计
  getSelectedSimilarityGroupCounts() {
    return { ...this.cache.selectedSimilarityGroupCounts };
  }

  // 手动更新相似组统计（用于相似组模式）
  _updateSimilarityGroupStats(groupId, isSelected) {
    if (isSelected) {
      this.cache.selectedSimilarityGroupCounts[groupId] = (this.cache.selectedSimilarityGroupCounts[groupId] || 0) + 1;
    } else {
      if (this.cache.selectedSimilarityGroupCounts[groupId] > 0) {
        this.cache.selectedSimilarityGroupCounts[groupId]--;
        if (this.cache.selectedSimilarityGroupCounts[groupId] === 0) {
          delete this.cache.selectedSimilarityGroupCounts[groupId];
        }
      }
    }
    logger.debug(`🔍 手动更新相似组统计: ${groupId} = ${this.cache.selectedSimilarityGroupCounts[groupId] || 0}`);
  }
  
  // 删除单个图片
  removeImage(imageId) {
    try {
      logger.debug(`🗑️ 删除图片: ${imageId}`);
      
      // 找到要删除的图片
      const imageIndex = this.cache.allImages.findIndex(img => img.id === imageId);
      if (imageIndex === -1) {
        logger.debug(`⚠️ 未找到图片: ${imageId}`);
        return false;
      }
      
      const imageToDelete = this.cache.allImages[imageIndex];
      
      // 从 allImages 中删除
      this.cache.allImages.splice(imageIndex, 1);
      
      // 重新构建ID索引映射（因为数组索引发生了变化）
      this._rebuildImageIdIndex();
      
      // 重新构建统计信息
      this._rebuildCategoryCounts();
      this._rebuildCityCounts();
      this._rebuildColorCounts();
      this._rebuildDirectoryCounts();
      this._rebuildFormatCounts();
      this._rebuildResolutionCounts();
      this._rebuildOrientationCounts();
      this._rebuildCameraSettingsCounts();
      this._rebuildRecentImages();
      
      logger.debug(`✅ 图片删除完成: ${imageToDelete.fileName}`);
      
      // 通知监听器
      this.notifyListeners();
      this.notifySelectionListeners();
      
      return true;
      
    } catch (error) {
      console.error('❌ 删除图片失败:', error);
      return false;
    }
  }
  
  // 重新构建城市统计
  _rebuildCityCounts() {
    this.cache.cityCounts = {};
    let cityImageCount = 0;
    
    this.cache.allImages.forEach(img => {
      if (img.city) {
        this.cache.cityCounts[img.city] = (this.cache.cityCounts[img.city] || 0) + 1;
        cityImageCount++;
      }
    });
    
  }

  // 重新构建颜色统计
  _rebuildColorCounts() {
    this.cache.colorCounts = {};
    
    this.cache.allImages.forEach(img => {
      // 只统计有背景颜色的图片（排除 null、undefined 和空字符串）
      // 检查 background_color 是否存在且不为空
      if (img.background_color && 
          typeof img.background_color === 'string' && 
          img.background_color.trim() !== '') {
        this.cache.colorCounts[img.background_color] = (this.cache.colorCounts[img.background_color] || 0) + 1;
      }
    });
  }

  // 从图片URI中提取目录路径
  _extractDirectoryPath(image) {
    try {
      const localPath = getLocalPath(image);
      if (!localPath || typeof localPath !== 'string') {
        return null;
      }
      
      // 规范化路径（统一使用正斜杠）
      const normalizedPath = localPath.replace(/\\/g, '/');
      
      // 找到最后一个路径分隔符的位置
      const lastSeparatorIndex = normalizedPath.lastIndexOf('/');
      if (lastSeparatorIndex === -1) {
        // 没有路径分隔符，说明是根目录或文件名
        return null;
      }
      
      // 提取目录路径
      const dirPath = normalizedPath.substring(0, lastSeparatorIndex);
      
      // 如果目录路径为空，返回 null
      if (!dirPath || dirPath.trim() === '') {
        return null;
      }
      
      return dirPath;
    } catch (error) {
      logger.debug('提取目录路径失败:', error);
      return null;
    }
  }

  // 重新构建目录统计
  _rebuildDirectoryCounts() {
    this.cache.directoryCounts = {};
    
    this.cache.allImages.forEach(img => {
      const dirPath = this._extractDirectoryPath(img);
      if (dirPath) {
        this.cache.directoryCounts[dirPath] = (this.cache.directoryCounts[dirPath] || 0) + 1;
      }
    });
  }

  // 从图片中提取格式
  _extractImageFormat(image) {
    // 优先从 mimeType 提取
    if (image.mimeType) {
      const mimeType = image.mimeType.toLowerCase();
      if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'JPEG';
      if (mimeType.includes('png')) return 'PNG';
      if (mimeType.includes('heic') || mimeType.includes('heif')) return 'HEIC';
      if (mimeType.includes('webp')) return 'WEBP';
      if (mimeType.includes('gif')) return 'GIF';
      if (mimeType.includes('bmp')) return 'BMP';
      // 提取通用格式
      const parts = mimeType.split('/');
      if (parts.length === 2 && parts[0] === 'image') {
        return parts[1].toUpperCase();
      }
    }
    
    // 从 fileName 扩展名提取
    if (image.fileName) {
      const fileName = image.fileName.toLowerCase();
      if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) return 'JPEG';
      if (fileName.endsWith('.png')) return 'PNG';
      if (fileName.endsWith('.heic') || fileName.endsWith('.heif')) return 'HEIC';
      if (fileName.endsWith('.webp')) return 'WEBP';
      if (fileName.endsWith('.gif')) return 'GIF';
      if (fileName.endsWith('.bmp')) return 'BMP';
    }
    
    return 'UNKNOWN';
  }

  // 重新构建格式统计
  _rebuildFormatCounts() {
    this.cache.formatCounts = {};
    this.cache.allImages.forEach(img => {
      const format = this._extractImageFormat(img);
      if (format && format !== 'UNKNOWN') {
        this.cache.formatCounts[format] = (this.cache.formatCounts[format] || 0) + 1;
      }
    });
  }

  // 获取分辨率分类
  _getResolutionCategory(width, height) {
    if (!width || !height || width <= 0 || height <= 0) {
      return 'UNKNOWN';
    }
    
    // 标准化分辨率（允许10%误差）
    const tolerance = 0.1;
    
    // 4K: 3840x2160
    if (Math.abs(width - 3840) / 3840 <= tolerance && 
        Math.abs(height - 2160) / 2160 <= tolerance) {
      return '4K';
    }
    
    // 1080p: 1920x1080
    if (Math.abs(width - 1920) / 1920 <= tolerance && 
        Math.abs(height - 1080) / 1080 <= tolerance) {
      return '1080p';
    }
    
    // 720p: 1280x720
    if (Math.abs(width - 1280) / 1280 <= tolerance && 
        Math.abs(height - 720) / 720 <= tolerance) {
      return '720p';
    }
    
    // 根据像素数分类
    const pixels = width * height;
    if (pixels >= 8000000) return '4K+';  // 800万像素以上
    if (pixels >= 2000000) return '1080p+'; // 200万像素以上
    if (pixels >= 1000000) return '720p+';  // 100万像素以上
    
    // 其他情况返回具体分辨率
    return `${Math.round(width)}x${Math.round(height)}`;
  }

  // 重新构建分辨率统计（统计所有分辨率）
  _rebuildResolutionCounts() {
    this.cache.resolutionCounts = {};
    let imagesWithDimensions = 0;
    let imagesWithoutDimensions = 0;
    let sampleImageWithoutDimensions = null; // 用于调试
    
    this.cache.allImages.forEach(img => {
      // 🆕 直接使用 width 和 height（已在 buildCache 时从 imageDimensions 提取）
      if (img.width && img.height && img.width > 0 && img.height > 0) {
        imagesWithDimensions++;
        const resolution = this._getResolutionCategory(img.width, img.height);
        if (resolution && resolution !== 'UNKNOWN') {
          this.cache.resolutionCounts[resolution] = (this.cache.resolutionCounts[resolution] || 0) + 1;
        }
      } else {
        imagesWithoutDimensions++;
        // 记录第一个没有尺寸的图片用于调试
        if (!sampleImageWithoutDimensions) {
          sampleImageWithoutDimensions = {
            id: img.id,
            fileName: img.fileName,
            hasImageDimensions: !!img.imageDimensions,
            hasWidth: 'width' in img,
            hasHeight: 'height' in img,
            width: img.width,
            height: img.height,
            imageDimensions: img.imageDimensions
          };
        }
      }
    });
    
    logger.debug(`📐 分辨率统计完成: 有尺寸=${imagesWithDimensions}, 无尺寸=${imagesWithoutDimensions}, 分辨率种类=${Object.keys(this.cache.resolutionCounts).length}`);
    if (imagesWithoutDimensions > 0 && sampleImageWithoutDimensions) {
      logger.warn(`⚠️ 发现 ${imagesWithoutDimensions} 张图片缺少尺寸信息，示例:`, sampleImageWithoutDimensions);
    }
    if (Object.keys(this.cache.resolutionCounts).length > 0) {
      logger.debug(`📐 分辨率统计详情: ${Object.keys(this.cache.resolutionCounts).length} 种分辨率`);
    } else if (this.cache.allImages.length > 0) {
      logger.warn(`⚠️ 所有 ${this.cache.allImages.length} 张图片都缺少尺寸信息，无法生成分辨率统计`);
    }
  }

  // 获取前N个最多的分辨率（用于展示）
  getTopResolutions(limit = 7) {
    const allResolutions = Object.entries(this.cache.resolutionCounts || {});
    
    // 按数量降序排序
    const sorted = allResolutions.sort(([, countA], [, countB]) => countB - countA);
    
    // 取前N个
    const topResolutions = sorted.slice(0, limit);
    
    // 计算"其他"的数量
    const otherCount = sorted.slice(limit).reduce((sum, [, count]) => sum + count, 0);
    
    // 构建返回对象
    const result = {};
    topResolutions.forEach(([resolution, count]) => {
      result[resolution] = count;
    });
    
    // 如果有"其他"，添加到结果中
    if (otherCount > 0) {
      result['其他'] = otherCount;
    }
    
    return result;
  }

  // 获取前N个分辨率列表（用于查询"其他"时排除）
  getTopResolutionList(limit = 7) {
    const allResolutions = Object.entries(this.cache.resolutionCounts || {});
    const sorted = allResolutions.sort(([, countA], [, countB]) => countB - countA);
    return sorted.slice(0, limit).map(([resolution]) => resolution);
  }

  // 根据格式获取图片
  getImagesByFormat(format) {
    if (!format) return [];
    return this.cache.allImages.filter(img => {
      const imgFormat = this._extractImageFormat(img);
      return imgFormat === format;
    });
  }

  // 根据分辨率获取图片
  getImagesByResolution(resolution) {
    if (!resolution) return [];
    
    // 如果查询"其他"，返回所有不在前7个中的图片
    if (resolution === '其他') {
      const topResolutions = this.getTopResolutionList(7);
      const topResolutionSet = new Set(topResolutions);
      
      return this.cache.allImages.filter(img => {
        // 🆕 直接使用 width 和 height（已在 buildCache 时从 imageDimensions 提取）
        if (!img.width || !img.height || img.width <= 0 || img.height <= 0) return false;
        const imgResolution = this._getResolutionCategory(img.width, img.height);
        return imgResolution !== 'UNKNOWN' && !topResolutionSet.has(imgResolution);
      });
    }
    
    // 正常查询指定分辨率
    return this.cache.allImages.filter(img => {
      // 🆕 直接使用 width 和 height（已在 buildCache 时从 imageDimensions 提取）
      if (!img.width || !img.height || img.width <= 0 || img.height <= 0) return false;
      const imgResolution = this._getResolutionCategory(img.width, img.height);
      return imgResolution === resolution;
    });
  }

  // 🔥 根据ISO分类获取图片
  getImagesByISO(isoCategory) {
    if (!isoCategory) return [];
    return this.cache.allImages.filter(img => img.isoCategory === isoCategory);
  }

  // 🔥 根据光圈分类获取图片
  getImagesByAperture(apertureCategory) {
    if (!apertureCategory) return [];
    return this.cache.allImages.filter(img => img.apertureCategory === apertureCategory);
  }

  // 🔥 根据快门分类获取图片
  getImagesByShutter(shutterCategory) {
    if (!shutterCategory) return [];
    return this.cache.allImages.filter(img => img.shutterCategory === shutterCategory);
  }

  // 🔥 根据焦距分类获取图片
  getImagesByFocalLength(focalLengthCategory) {
    if (!focalLengthCategory) return [];
    return this.cache.allImages.filter(img => img.focalLengthCategory === focalLengthCategory);
  }

  // 获取图片方向分类（横屏、竖屏、全景、正方形）
  _getOrientationCategory(width, height) {
    if (!width || !height || width <= 0 || height <= 0) {
      return 'UNKNOWN';
    }
    
    const aspectRatio = width / height;
    
    // 全景：宽高比 >= 2:1 或 <= 1:2（超宽或超高）
    if (aspectRatio >= 2.0 || aspectRatio <= 0.5) {
      return '全景';
    }
    
    // 正方形：宽高比接近 1:1（允许5%误差）
    if (Math.abs(aspectRatio - 1.0) < 0.05) {
      return '正方形';
    }
    
    // 横屏：width > height
    if (width > height) {
      return '横屏';
    }
    
    // 竖屏：height > width
    return '竖屏';
  }

  // 重新构建方向统计
  _rebuildOrientationCounts() {
    this.cache.orientationCounts = {};
    let imagesWithDimensions = 0;
    let imagesWithoutDimensions = 0;
    
    this.cache.allImages.forEach(img => {
      // 🆕 过滤掉手机截图（方向分类只针对照片，手机截图没有意义）
      if (this._isScreenshot(img)) {
        return;
      }
      
      // 🆕 直接使用 width 和 height（已在 buildCache 时从 imageDimensions 提取）
      if (img.width && img.height && img.width > 0 && img.height > 0) {
        imagesWithDimensions++;
        const orientation = this._getOrientationCategory(img.width, img.height);
        if (orientation && orientation !== 'UNKNOWN') {
          this.cache.orientationCounts[orientation] = (this.cache.orientationCounts[orientation] || 0) + 1;
        }
      } else {
        imagesWithoutDimensions++;
      }
    });
    
    logger.debug(`🔄 方向统计完成: 有尺寸=${imagesWithDimensions}, 无尺寸=${imagesWithoutDimensions}, 方向种类=${Object.keys(this.cache.orientationCounts).length}`);
    if (Object.keys(this.cache.orientationCounts).length > 0) {
      logger.debug(`🔄 方向统计详情:`, this.cache.orientationCounts);
    }
  }

  // 🔥 重新构建拍摄参数统计
  _rebuildCameraSettingsCounts() {
    this.cache.isoCounts = {};
    this.cache.apertureCounts = {};
    this.cache.shutterCounts = {};
    this.cache.focalLengthCounts = {};
    
    let imagesWithCameraSettings = 0;
    let imagesWithCategories = 0;
    
    this.cache.allImages.forEach(img => {
      if (img.isoCategory) {
        this.cache.isoCounts[img.isoCategory] = (this.cache.isoCounts[img.isoCategory] || 0) + 1;
        imagesWithCameraSettings++;
      }
      if (img.apertureCategory) {
        this.cache.apertureCounts[img.apertureCategory] = (this.cache.apertureCounts[img.apertureCategory] || 0) + 1;
      }
      if (img.shutterCategory) {
        this.cache.shutterCounts[img.shutterCategory] = (this.cache.shutterCounts[img.shutterCategory] || 0) + 1;
      }
      if (img.focalLengthCategory) {
        this.cache.focalLengthCounts[img.focalLengthCategory] = (this.cache.focalLengthCounts[img.focalLengthCategory] || 0) + 1;
      }
      
      // 统计有分类字段的图片数量
      if (img.isoCategory || img.apertureCategory || img.shutterCategory || img.focalLengthCategory) {
        imagesWithCategories++;
      }
    });
  }

  // 根据方向获取图片
  getImagesByOrientation(orientation) {
    if (!orientation) return [];
    
    return this.cache.allImages.filter(img => {
      // 🆕 过滤掉手机截图（方向分类只针对照片，手机截图没有意义）
      if (this._isScreenshot(img)) {
        return false;
      }
      
      // 🆕 直接使用 width 和 height（已在 buildCache 时从 imageDimensions 提取）
      if (!img.width || !img.height || img.width <= 0 || img.height <= 0) return false;
      const imgOrientation = this._getOrientationCategory(img.width, img.height);
      return imgOrientation === orientation;
    });
  }

  // 根据目录获取图片
  getImagesByDirectory(directory) {
    if (!directory || typeof directory !== 'string') {
      return [];
    }
    
    // 规范化目录路径（统一使用正斜杠）
    const normalizedDir = directory.replace(/\\/g, '/');
    
    return this.cache.allImages.filter(img => {
      const imgDir = this._extractDirectoryPath(img);
      if (!imgDir) {
        return false;
      }
      
      // 规范化图片目录路径
      const normalizedImgDir = imgDir.replace(/\\/g, '/');
      
      // 精确匹配：只返回直接属于该目录的图片（不包含子目录）
      return normalizedImgDir === normalizedDir;
    });
  }
  
  // 重新构建最近图片
  _rebuildRecentImages() {
    this.cache.recentImages = this.cache.allImages
      .sort((a, b) => new Date(b.createdAt || b.updatedAt) - new Date(a.createdAt || a.updatedAt))
      .slice(0, 20);
  }
  
  // 批量删除图片
  removeImages(imageIds) {
    try {
      logger.debug(`🗑️ 批量删除图片: ${imageIds.length} 张`);
      
      // 创建要删除的图片ID集合，提高查找效率
      const imageIdSet = new Set(imageIds);
      
      // 一次遍历找到所有要删除的图片
      const imagesToDelete = [];
      const remainingImages = [];
      
      this.cache.allImages.forEach(img => {
        if (imageIdSet.has(img.id)) {
          imagesToDelete.push(img);
        } else {
          remainingImages.push(img);
        }
      });
      
      if (imagesToDelete.length === 0) {
        console.warn('⚠️ 没有找到任何要删除的图片');
        return false;
      }
      
      // 更新 allImages 数组
      this.cache.allImages = remainingImages;
      
      // 重新构建ID索引映射（因为数组内容发生了变化）
      this._rebuildImageIdIndex();
      
      // 重新构建统计信息
      this._rebuildCategoryCounts();
      this._rebuildCityCounts();
      this._rebuildColorCounts();
      this._rebuildDirectoryCounts();
      this._rebuildFormatCounts();
      this._rebuildResolutionCounts();
      this._rebuildOrientationCounts();
      this._rebuildCameraSettingsCounts();
      this._rebuildSelectedStats();
      this._rebuildRecentImages();
      
      logger.debug(`✅ 批量删除完成: ${imagesToDelete.length}/${imageIds.length} 张图片`);
      
      // 通知监听器
      this.notifyListeners();
      this.notifySelectionListeners();
      
      return true;
      
    } catch (error) {
      console.error('❌ 批量删除图片失败:', error);
      return false;
    }
  }

  // ==================== 选中状态管理 ====================
  
  // 添加选中状态监听器
  addSelectionListener(callback) {
    this.selectionListeners.add(callback);
    return () => this.selectionListeners.delete(callback);
  }

  // 通知选中状态变化
  notifySelectionListeners() {
    const selectedImages = this.getSelectedImages();
    this.selectionListeners.forEach(callback => callback(selectedImages));
  }

  // 获取选中的图片对象数组
  getSelectedImages(category = null, city = null, similarityGroupId = null) {
    let filteredImages = this.cache.allImages.filter(img => img.selected);
    
    // 如果指定了分类，按分类过滤
    if (category) {
      const normalizedCategory = this._normalizeCategoryId(category);
      filteredImages = filteredImages.filter(img => {
        if (!img.category) {
          console.error(`❌ 图片 ${img.id} 缺少分类信息:`, img);
          throw new Error(`图片 ${img.id} 缺少分类信息`);
        }
        const imgCategory = this._normalizeCategoryId(img.category);
        return imgCategory === normalizedCategory;
      });
    }
    
    // 如果指定了城市，按城市过滤
    if (city) {
      filteredImages = filteredImages.filter(img => img.city === city);
    }
    
    // 如果指定了相似组，按相似组过滤
    if (similarityGroupId) {
      filteredImages = filteredImages.filter(img => img.similarityGroupIndex === similarityGroupId);
    }
    
    return filteredImages;
  }

  // 获取指定分类的所有图片
  getImagesByCategory(category) {
    const normalizedCategory = this._normalizeCategoryId(category);
    
    // 调试：统计分类分布
    if (category === 'NA') {
      const categoryStats = {};
      this.cache.allImages.forEach(img => {
        const cat = img?.category || 'null';
        categoryStats[cat] = (categoryStats[cat] || 0) + 1;
      });
      logger.debug(`🔍 [NA查询] 缓存中图片分类统计:`, categoryStats);
      logger.debug(`🔍 [NA查询] 标准化后的分类ID: ${normalizedCategory}, 缓存总数: ${this.cache.allImages.length}`);
    }
    
    const result = this.cache.allImages.filter(img => {
      // 🆕 添加空值检查
      if (!img || typeof img !== 'object') {
        console.warn(`⚠️ 发现无效的图片对象:`, img);
        return false;
      }
      
      if (!img.category) {
        console.error(`❌ 图片 ${img.id || 'unknown'} 缺少分类信息:`, img);
        return false; // 改为返回false而不是抛出错误
      }
      
      const imgCategory = this._effectiveCategoryId(img.category);
      return imgCategory === normalizedCategory;
    });
    
    if (category === 'NA') {
      logger.debug(`🔍 [NA查询] 找到 ${result.length} 张NA分类图片`);
    }
    
    return result;
  }

  // 获取指定城市的所有图片
  getImagesByCity(city) {
    return this.cache.allImages.filter(img => {
      // 🆕 添加空值检查
      if (!img || typeof img !== 'object') {
        console.warn(`⚠️ 发现无效的图片对象:`, img);
        return false;
      }
      return img.city === city;
    });
  }

  // 获取指定相似组的所有图片
  getImagesBySimilarityGroup(groupId) {
    return this.cache.allImages.filter(img => {
      // 🆕 添加空值检查
      if (!img || typeof img !== 'object') {
        console.warn(`⚠️ 发现无效的图片对象:`, img);
        return false;
      }
      return img.similarityGroupIndex === groupId;
    });
  }

  // 检查图片是否被选中
  isImageSelected(imageId) {
    const image = this._getImageById(imageId);
    return image ? image.selected === true : false;
  }

  // 切换图片选中状态
  toggleImageSelection(imageId) {
    logger.debug(`🔄 GlobalImageCache 切换图片选择状态: ${imageId}`);
    
    // 使用快速查找获取图片对象
    const image = this._getImageById(imageId);
    if (!image) {
      logger.debug(`⚠️ 未找到图片: ${imageId}`);
      return;
    }
    
    // 调试：检查图片对象的分类信息
    logger.debug(`🔍 图片对象详情:`, {
      id: image.id,
      fileName: image.fileName,
      category: image.category,
      hasCategory: 'category' in image,
      categoryType: typeof image.category
    });
    
    if (image.selected) {
      image.selected = false;
      this._updateSelectedStatsRemove(image);
    } else {
      image.selected = true;
      this._updateSelectedStatsAdd(image);
    }
    logger.debug(`🔄 GlobalImageCache 新的选中状态: ${imageId} = ${image.selected}`);
    this.notifySelectionListeners();
  }

  // 设置图片选中状态
  setImageSelection(imageId, selected) {
    const image = this._getImageById(imageId);
    if (!image) {
      logger.debug(`⚠️ 未找到图片: ${imageId}`);
      return;
    }

    if (image.selected !== selected) {
      image.selected = selected;
      if (selected) {
        this._updateSelectedStatsAdd(image);
      } else {
        this._updateSelectedStatsRemove(image);
      }
      this.notifySelectionListeners();
    }
  }

  // 批量设置图片选中状态（不触发通知）
  setImageSelectionBatch(imageIds, selected) {
    imageIds.forEach(id => {
      const image = this._getImageById(id);
      if (image && image.selected !== selected) {
        image.selected = selected;
        if (selected) {
          this._updateSelectedStatsAdd(image);
        } else {
          this._updateSelectedStatsRemove(image);
        }
      }
    });
    // 不立即通知，等待外部调用 notifySelectionListeners
  }

  

  // 添加到选中状态 - 不清空现有选中
  addToSelection(imageIds) {
    imageIds.forEach(id => {
      const image = this._getImageById(id);
      if (image && !image.selected) {
        image.selected = true;
        this._updateSelectedStatsAdd(image);
      }
    });
    this.notifySelectionListeners();
  }

  // 批量添加到选中状态 - 优化版本，避免创建大数组
  addToSelectionBatch(imageObjects) {
    imageObjects.forEach(img => {
      if (!img.selected) {
        img.selected = true;
        this._updateSelectedStatsAdd(img);
      }
    });
    this.notifySelectionListeners();
  }

  // 批量取消选择（优化版本）- 取消指定图片的选中状态
  deselectBatch(imageIds) {
    // 使用O(1)快速查找，避免遍历整个数组
    imageIds.forEach(id => {
      const image = this._getImageById(id);
      if (image && image.selected) {
        image.selected = false;
        this._updateSelectedStatsRemove(image);
      }
    });
    this.notifySelectionListeners();
  }




  // 获取选中数量
  getSelectedCount() {
    return this.cache.allImages.filter(img => img.selected).length;
  }

  // 清空缓存
  clearCache() {
    this.cache = {
      allImages: [],
      categoryCounts: {},
      cityCounts: {},
      colorCounts: {},
      directoryCounts: {},
      formatCounts: {},
      resolutionCounts: {},
      orientationCounts: {},
      isoCounts: {},
      apertureCounts: {},
      shutterCounts: {},
      focalLengthCounts: {},
      recentImages: [],
      selectedCategoryCounts: {},
      selectedCityCounts: {},
      selectedSimilarityGroupCounts: {}
    };
    this.imageIdToIndex.clear();
    // 不要清空监听器，保持现有的监听器
    // this.listeners = new Set();
    // this.selectionListeners = new Set();
    
    // 通知所有监听器缓存已清空
    this.notifyListeners();
    this.notifySelectionListeners();
    logger.debug('🗑️ 缓存已清空');
  }
}

// 导出单例实例
export default new GlobalImageCache();

