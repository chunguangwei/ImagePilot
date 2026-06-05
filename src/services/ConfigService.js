/**
 * ConfigService - 配置管理服务
 * 负责读取和管理 initialSettings.json 配置文件
 */

import { logger, Platform } from '../adapters/WebAdapters';
// 静态导入配置文件（移动端和PC端都支持）
import initialSettingsData from '../../public/initialSettings.json';

class ConfigService {
  constructor() {
    this.config = null;
    this.isLoaded = false;
    // 用户自定义分类名（id→name）。内置分类在 initialSettings.json，自定义分类在用户
    // 设置（settings.aiProvider.customCategories）里，ConfigService 本身读不到——由
    // UnifiedDataService.readSettings/writeSettings 调 setCustomCategories 注入，
    // 使 getCategoryDisplayName 能把自定义 id 解析成配置的名称，而不是裸露 id。
    this.customCategoryNames = {};
    // 用户「删除」的内置分类 id 集合（settings.aiProvider.hiddenBuiltinCategories）。
    // 同样由 UnifiedDataService.readSettings/writeSettings 注入。getAllCategoriesWithUI
    // 据此从展示中剔除，使被删的默认分类不在首页/各列表出现（可一键恢复）。
    this.hiddenBuiltinSet = new Set();
  }

  /**
   * 注入用户自定义分类（供分类名解析用）。传入 [{ id, name }]，仅取合法项。
   * 在 UnifiedDataService 读/写设置时调用，保证名称解析始终用最新配置。
   * @param {Array<{id:string,name:string}>} list
   */
  setCustomCategories(list) {
    const map = {};
    if (Array.isArray(list)) {
      for (const c of list) {
        if (c && typeof c.id === 'string' && c.id.trim() && typeof c.name === 'string' && c.name.trim()) {
          map[c.id.trim()] = c.name.trim();
        }
      }
    }
    this.customCategoryNames = map;
  }

  /**
   * 注入「已删除的内置分类」id 列表。空数组＝全部默认分类可见（恢复默认）。
   * @param {Array<string>} list
   */
  setHiddenBuiltinCategories(list) {
    this.hiddenBuiltinSet = new Set(
      Array.isArray(list) ? list.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : []
    );
  }

  /** 某内置分类是否被用户删除（隐藏） */
  isBuiltinCategoryHidden(categoryId) {
    return this.hiddenBuiltinSet.has(categoryId);
  }

  /**
   * 初始化配置服务
   * @returns {Promise<boolean>} 是否成功加载配置
   */
  async initialize() {
    // 如果已经加载，直接返回
    if (this.isLoaded) {
      logger.debug('配置文件已加载，跳过重复加载');
      return true;
    }
    
    try {
      logger.debug(`开始加载配置文件 (平台: ${Platform.OS})...`);
      
      // 🆕 移动端和PC端：使用静态导入的配置数据
      if (Platform.OS !== 'web') {
        logger.debug('📱 移动端环境，使用静态导入的配置文件');
        
        this.config = initialSettingsData;
        this.isLoaded = true;
        
        logger.debug('✅ 移动端配置文件加载成功');
        logger.debug(`📊 配置统计:`, {
          models: Object.keys(this.config.models || {}).length,
          categories: Object.keys(this.config.categoryNameMap || {}).length,
          yoloObjects: Object.keys(this.config.yoloObjectNameMap || {}).length,
          imagenetClasses: Object.keys(this.config.mobilenetv3Classes || {}).length
        });
        
        return true;
      }
      
      // 💻 PC端：使用 fetch 或 fs 加载
      const configPath = this.getConfigPath();
      logger.debug('💻 PC端配置文件路径:', configPath);
      logger.debug('环境信息:', {
        hasWindow: typeof window !== 'undefined',
        hostname: typeof window !== 'undefined' && window.location ? window.location.hostname : 'N/A',
        origin: typeof window !== 'undefined' && window.location ? window.location.origin : 'N/A'
      });
      
      // 加载配置文件
      let responseText;
      
      if (typeof window !== 'undefined') {
        // 浏览器/Electron环境使用fetch
        const response = await fetch(configPath);
        logger.debug('响应状态:', response.status, response.statusText);
        logger.debug('响应头 Content-Type:', response.headers.get('content-type'));
        
        if (!response.ok) {
          throw new Error(`配置文件加载失败: ${response.status} ${response.statusText}`);
        }
        
        responseText = await response.text();
        logger.debug('🔧 响应内容前200字符:', responseText.substring(0, 200));
        
        // 检查是否是HTML内容
        if (responseText.trim().startsWith('<!DOCTYPE')) {
          throw new Error('获取到HTML内容而不是JSON文件，可能是路径错误或服务器配置问题');
        }
      } else {
        // Node.js环境使用fs模块
        try {
          // 使用动态require避免webpack静态分析
          const fs = eval('require')('fs');
          const path = eval('require')('path');
          const fullPath = path.resolve(configPath);
          logger.debug('🔧 读取文件路径:', fullPath);
          
          responseText = fs.readFileSync(fullPath, 'utf8');
          logger.debug('🔧 文件内容前200字符:', responseText.substring(0, 200));
        } catch (error) {
          console.warn('⚠️ Node.js环境下的文件系统操作在浏览器构建中被跳过');
          throw new Error('Node.js环境在浏览器构建中不支持');
        }
      }
      
      this.config = JSON.parse(responseText);
      this.isLoaded = true;
      
      logger.debug('✅ PC端配置文件加载成功');
      logger.debug(`📊 配置统计:`, {
        models: Object.keys(this.config.models || {}).length,
        categories: Object.keys(this.config.categoryNameMap || {}).length,
        yoloObjects: Object.keys(this.config.yoloObjectNameMap || {}).length,
        imagenetClasses: Object.keys(this.config.mobilenetv3Classes || {}).length
      });
      
      return true;
    } catch (error) {
      console.error('❌ 配置文件加载失败:', error);
      this.isLoaded = false;
      return false;
    }
  }

  /**
   * 获取配置文件路径（仅用于PC端）
   * 注意：移动端在 initialize() 中直接 require JSON，不会调用此方法
   * @returns {string} 配置文件路径
   */
  getConfigPath() {
    // 💻 PC端：在浏览器环境和Electron环境中使用HTTP方式访问
    if (typeof window !== 'undefined' && window.location) {
      logger.debug('🔧 window.location:', {
        hostname: window.location.hostname,
        origin: window.location.origin,
        href: window.location.href
      });
      
      // 检查是否是开发环境
      if (window.location.hostname === 'localhost' && window.location.port === '3000') {
        // 开发环境
        return 'http://localhost:3000/initialSettings.json';
      } else {
        // 生产环境 - 使用相对路径
        return './initialSettings.json';
      }
    }
    // 在纯Node.js环境中使用public目录下的文件
    return './public/initialSettings.json';
  }

  /**
   * 获取模型配置
   * @param {string} modelName - 模型名称
   * @returns {Object|null} 模型配置
   */
  getModelConfig(modelName) {
    if (!this.isLoaded || !this.config?.models) {
      console.warn('⚠️ 配置未加载或模型配置不存在');
      return null;
    }
    return this.config.models[modelName] || null;
  }

  /**
   * 获取所有模型配置
   * @returns {Object} 所有模型配置
   */
  getAllModelConfigs() {
    if (!this.isLoaded || !this.config?.models) {
      console.warn('⚠️ 配置未加载或模型配置不存在');
      return {};
    }
    return this.config.models;
  }

  /**
   * 获取分类名称映射
   * @returns {Object} 分类名称映射
   */
  getCategoryNameMap() {
    if (!this.isLoaded || !this.config?.categoryNameMap) {
      console.warn('⚠️ 配置未加载或分类名称映射不存在');
      return {};
    }
    return this.config.categoryNameMap;
  }

  /**
   * 获取YOLO物体名称映射
   * @returns {Object} YOLO物体名称映射
   */
  getYoloObjectNameMap() {
    if (!this.isLoaded || !this.config?.yoloObjectNameMap) {
      console.warn('⚠️ 配置未加载或YOLO物体名称映射不存在');
      return {};
    }
    return this.config.yoloObjectNameMap;
  }

  /**
   * 获取MobileNetV3类别映射
   * @returns {Object} MobileNetV3类别映射
   */
  getMobileNetV3Classes() {
    if (!this.isLoaded || !this.config?.mobilenetv3Classes) {
      console.warn('⚠️ 配置未加载或MobileNetV3类别映射不存在');
      return {};
    }
    return this.config.mobilenetv3Classes;
  }

  /**
   * 获取物体分类类别映射
   * @returns {Object} 物体分类类别映射
   */
  getObjectCategories() {
    if (!this.isLoaded || !this.config?.objectCategories) {
      console.warn('⚠️ 配置未加载或物体分类类别映射不存在');
      return {};
    }
    return this.config.objectCategories;
  }

  /**
   * 获取分类显示顺序
   * @returns {Array} 分类显示顺序数组
   */
  getCategoryDisplayOrder() {
    if (!this.isLoaded || !this.config?.categoryDisplayOrder) {
      console.warn('⚠️ 配置未加载或分类显示顺序不存在');
      return [];
    }
    return this.config.categoryDisplayOrder;
  }

  /**
   * 获取所有分类信息（按显示顺序排序）
   * @returns {Array} 分类信息数组，按categoryDisplayOrder排序
   */
  getAllCategoriesWithUI() {
    const categoryMap = this.getCategoryNameMap();
    const displayOrder = this.getCategoryDisplayOrder();
    
    // 按显示顺序返回分类信息。剔除被用户删除的内置分类（NA/other 为系统档，永不隐藏）。
    return displayOrder
      .filter(categoryId => categoryMap[categoryId]) // 确保分类存在
      .filter(categoryId => categoryId === 'NA' || categoryId === 'other' || !this.hiddenBuiltinSet.has(categoryId))
      .map(categoryId => ({
        id: categoryId,
        ...categoryMap[categoryId]
      }));
  }

  /**
   * 获取分类的完整信息
   * @param {string} categoryId - 分类ID
   * @returns {Object|null} 分类完整信息
   */
  getCategoryWithUI(categoryId) {
    const categoryMap = this.getCategoryNameMap();
    const category = categoryMap[categoryId];
    
    if (!category) return null;
    
    return {
      id: categoryId,
      ...category
    };
  }

  /**
   * 根据ID获取分类信息
   * @param {string} categoryId - 分类ID
   * @returns {Object|null} 分类信息
   */
  getCategoryById(categoryId) {
    const categoryMap = this.getCategoryNameMap();
    return Object.values(categoryMap).find(category => category.id === categoryId) || null;
  }

  /**
   * 根据分类键名获取分类信息
   * @param {string} categoryKey - 分类键名（如 'single_person', 'pets' 等）
   * @returns {Object|null} 分类信息
   */
  getCategoryByKey(categoryKey) {
    const categoryMap = this.getCategoryNameMap();
    return categoryMap[categoryKey] || null;
  }

  /**
   * 获取分类显示名称
   * @param {string} categoryId - 分类ID
   * @param {string} language - 语言类型 ('chinese' 或 'english')
   * @returns {string} 显示名称
   */
  getCategoryDisplayName(categoryId, language = 'chinese') {
    // 首先尝试通过键名获取分类信息
    const categoryByKey = this.getCategoryByKey(categoryId);
    if (categoryByKey) {
      return categoryByKey[language] || categoryByKey.chinese || categoryByKey.english || categoryId;
    }
    
    // 如果键名找不到，尝试通过ID获取
    const category = this.getCategoryById(categoryId);
    if (category) {
      return category[language] || category.chinese || category.english || categoryId;
    }

    // 内置分类都找不到 → 看是不是用户自定义分类（自定义无中英文之分，统一用 name）
    if (this.customCategoryNames && this.customCategoryNames[categoryId]) {
      return this.customCategoryNames[categoryId];
    }

    // 都找不到，返回原ID
    return categoryId;
  }

  /**
   * 获取所有分类ID列表（按显示顺序）
   * @returns {Array} 分类ID数组
   */
  getAllCategoryIds() {
    return this.getAllCategoriesWithUI().map(category => category.id);
  }

  /**
   * 根据ID获取YOLO物体信息
   * @param {number} objectId - 物体ID
   * @returns {Object|null} 物体信息
   */
  getYoloObjectById(objectId) {
    const objectMap = this.getYoloObjectNameMap();
    return Object.values(objectMap).find(obj => obj.id === objectId) || null;
  }

  /**
   * 根据英文名称获取MobileNetV3类别信息
   * @param {string} englishName - 英文名称
   * @returns {Object|null} 类别信息
   */
  getMobileNetV3ClassByEnglishName(englishName) {
    const classes = this.getMobileNetV3Classes();
    return classes[englishName] || null;
  }

  /**
   * 根据ID获取MobileNetV3类别信息
   * @param {number} classId - 类别ID
   * @returns {Object|null} 类别信息
   */
  getMobileNetV3ClassById(classId) {
    const classes = this.getMobileNetV3Classes();
    return Object.values(classes).find(cls => cls.id === classId) || null;
  }

  /**
   * 获取配置是否已加载
   * @returns {boolean} 是否已加载
   */
  isConfigLoaded() {
    // 如果配置未加载，返回false
    // 让调用方处理初始化逻辑
    return this.isLoaded;
  }

  /**
   * 获取完整配置对象
   * @returns {Object|null} 完整配置对象
   */
  getFullConfig() {
    if (!this.isLoaded) {
      console.warn('⚠️ 配置未加载');
      return null;
    }
    return this.config;
  }

  /**
   * 获取物体分类到图像分类的映射
   * @returns {Object} 物体映射配置
   */
  getObjectMappings() {
    if (!this.isLoaded || !this.config?.objectMappings) {
      console.warn('⚠️ 配置未加载或物体映射配置不存在');
      return {};
    }
    return this.config.objectMappings;
  }

  /**
   * 重新加载配置
   * @returns {Promise<boolean>} 是否成功重新加载
   */
  async reload() {
    logger.debug('🔄 重新加载配置文件...');
    this.isLoaded = false;
    this.config = null;
    return await this.initialize();
  }
}

// 创建单例实例
const configService = new ConfigService();

// 导出类和实例
export default configService;
export { ConfigService };
