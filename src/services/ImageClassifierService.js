import UnifiedDataService from './UnifiedDataService.js';
import configService from './ConfigService.js';
import { logger, ModelPathAdapter, CanvasAdapter, Platform, getUri } from '../adapters/WebAdapters';
import imageProcessor from './ImageProcessor';

class ImageClassifierService {
  constructor() {
    this.isInitialized = false;
    // Supported categories - 将在初始化时从配置服务获取
    this.categories = [];
    
    // ImageNet-1K类别列表（1000个类别）
    this.imagenetClasses = null; // 延迟加载
    
    // ONNX Runtime实例（统一导入，避免重复导入）
    this.ort = null;
    
    // 配置服务实例
    this.configService = configService;
    
    // 模型配置将在初始化时从配置文件加载
    this.models = {};
    
    // 缓存可用的执行提供者，避免重复检测
    this.cachedProviders = null;
    
    // 批量处理配置
    this.BATCH_CONFIG = {
      CACHE_BATCH_SIZE: 100,      // 批量缓存查询大小
      UPLOAD_BATCH_SIZE: 20,       // 批量上传大小（移动端会在每批次后清理临时文件）
      REMOTE_TIMEOUT: 180000,     // 远程请求超时（毫秒）- 增加到180秒（后台网络可能更慢）
      CACHE_TIMEOUT: 60000,       // 缓存查询超时（毫秒）- 60秒
      HEALTH_CHECK_TIMEOUT: 10000  // 健康检查超时（毫秒）- 增加到10秒
    };
    
    // 注意：已移除 Web Worker 池，使用主线程并行推理
  }

  // 🗑️ 已移除 getModelPath 方法，现在使用 ModelPathAdapter.getModelPath()

  // 从配置文件初始化模型配置
  async initializeModelConfigs() {
    try {
      // 初始化配置服务
      const configLoaded = await this.configService.initialize();
      if (!configLoaded) {
        throw new Error('配置服务初始化失败');
      }

      // 获取所有模型配置
      const modelConfigs = this.configService.getAllModelConfigs();
      
      // 🆕 使用适配器获取模型路径（无需关心平台差异）
      // 初始化模型配置
      this.models = {
        // MobileNetV3模型从配置文件读取
        mobilenetv3: {
          model: null,
          path: ModelPathAdapter.getModelPath('mobilenetv3_rw_Opset17.onnx', modelConfigs.mobilenetv3?.path),
          classes: null, // 将从配置文件加载
          metadata: null,
          priority: 3,
          description: modelConfigs.mobilenetv3?.name || 'MobileNetV3图像分类模型',
          inputName: 'x',
          outputName: '496',
          confidenceThreshold: modelConfigs.mobilenetv3?.confidenceThreshold || 0.3
        }
      };

      // 加载MobileNetV3类别映射
      const mobilenetv3Classes = this.configService.getMobileNetV3Classes();
      if (mobilenetv3Classes && Object.keys(mobilenetv3Classes).length > 0) {
        // 转换为数组格式（按ID排序）
        const classesArray = Object.values(mobilenetv3Classes)
          .sort((a, b) => a.id - b.id)
          .map(cls => cls.english);
        
        this.imagenetClasses = classesArray;
        this.models.mobilenetv3.classes = Object.values(mobilenetv3Classes)
          .sort((a, b) => a.id - b.id);
        
        logger.debug(`MobileNetV3类别加载成功: ${this.imagenetClasses.length} 个类别`);
      } else {
        logger.warn('配置服务中未找到MobileNetV3类别数据');
        this.imagenetClasses = [];
        this.models.mobilenetv3.classes = [];
      }

      // 加载分类信息
      this.categories = this.configService.getAllCategoryIds();
      logger.debug(`分类信息加载成功: ${this.categories.length} 个分类`);

      logger.debug('模型配置初始化完成');
      return true;
    } catch (error) {
      logger.error('模型配置初始化失败:', error);
      throw error;
    }
  }

  // 初始化ONNX Runtime
  async initializeONNX() {
    if (this.ort) {
      return this.ort;
    }

    try {
      // 🆕 使用适配器加载正确的ONNX Runtime版本
      this.ort = await ModelPathAdapter.loadOnnxRuntime();
      logger.debug('✅ ONNX Runtime初始化成功');
      return this.ort;
    } catch (error) {
      logger.error('❌ ONNX Runtime初始化失败:', error);
      throw error;
    }
  }

  // Initialize service
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      // 初始化模型配置（从配置文件加载）
      await this.initializeModelConfigs();
      
      // 初始化ONNX Runtime
      await this.initializeONNX();
      
      // 加载所有模型
      const loadResults = await this.loadAllModels(['mobilenetv3']);
      
      // 检查加载结果
      if (!loadResults.success) {
        throw new Error(`模型加载失败: ${loadResults.message}`);
      }
      logger.info(`✅ 模型加载完成: ${loadResults.message}`);
      
      // Time-based simulation classification algorithm already initialized
      this.isInitialized = true;
    } catch (error) {
      console.error('❌ Image classification service initialization failed:', error);
      throw error;
    }
  }

  // Load specific model
  async loadModel(modelName = 'mobilenetv3') {
    try {
      const modelConfig = this.models[modelName];
      if (!modelConfig) {
        throw new Error(`Unknown model: ${modelName}`);
      }

      if (modelConfig.model) {
        return modelConfig.model;
      }


      
      // 在浏览器环境中，我们直接尝试加载模型文件
      // 如果文件不存在，ONNX Runtime 会抛出相应的错误
      // 在 Node.js 环境中，可以检查文件是否存在
      if (typeof window === 'undefined') {
        // Node.js 环境 - 在构建时跳过，因为浏览器环境不需要
        console.warn('⚠️ Node.js环境下的文件系统检查在浏览器构建中被跳过');
      }

        // MobileNetV3类别已在初始化时加载，无需重复加载

        // 🆕 确保模型文件存在（仅在移动端需要从 assets 复制）
        if (typeof ModelPathAdapter.ensureModelExists === 'function') {
          const modelFileName = modelConfig.path.split('/').pop();
          await ModelPathAdapter.ensureModelExists(modelFileName);
        }

        // 加载ONNX模型
        // 使用统一的ONNX Runtime实例
        const ort = this.ort;
        
        // 检测可用的执行提供者
        const availableProviders = await this.detectAvailableProviders();
        
        // 创建推理会话时的配置
        const sessionOptions = {
          executionProviders: availableProviders, // 使用检测到的可用提供者
          graphOptimizationLevel: 'disabled', // 禁用图优化，避免输出格式变化
          enableCpuMemArena: false, // 禁用CPU内存池
          enableMemPattern: false, // 禁用内存模式
          enableProfiling: false,
          logSeverityLevel: 3, // 只显示错误日志 (0=Verbose, 1=Info, 2=Warning, 3=Error, 4=Fatal)
          logVerbosityLevel: 0, // 最小详细级别
          sessionLogSeverityLevel: 3, // 会话日志级别
          sessionLogVerbosityLevel: 0 // 会话详细级别
        };
        
        
        modelConfig.model = await ort.InferenceSession.create(modelConfig.path, sessionOptions);

      
      return modelConfig.model;
    } catch (error) {
      console.error(`Failed to load ${modelName} model:`, error);
      throw error;
    }
  }

  async detectAvailableProviders() {
    // 如果已经检测过，直接返回缓存结果
    if (this.cachedProviders) {
      return this.cachedProviders;
    }
    
    try {
      // 🆕 从适配器获取推荐的提供者列表
      const recommendedProviders = ModelPathAdapter.getExecutionProviders();
      logger.debug(`🔍 适配器推荐的执行提供者: ${recommendedProviders.join(', ')}`);
      
      const ort = this.ort;
      const availableProviders = [];
      
      // 检查ONNX Runtime实际支持的提供者
      if (typeof ort.getAvailableProviders === 'function') {
        // 获取ONNX Runtime实际支持的提供者
        const ortProviders = await ort.getAvailableProviders();
        logger.debug(`🔍 ONNX Runtime实际支持: ${ortProviders.join(', ')}`);
        
        // 🆕 取推荐列表和实际支持的交集（按推荐顺序）
        for (const provider of recommendedProviders) {
          if (ortProviders.includes(provider)) {
            availableProviders.push(provider);
            logger.debug(`✅ 启用提供者: ${provider}`);
          }
        }
      } else if (typeof ort.listSupportedBackends === 'function') {
        // Node.js环境：使用listSupportedBackends方法
        const backends = ort.listSupportedBackends();
        logger.debug(`🔍 ONNX Runtime支持的backend: ${backends.map(b => b.name).join(', ')}`);
        
        // 🆕 取推荐列表和实际支持的交集（按推荐顺序）
        for (const provider of recommendedProviders) {
          if (backends.some(b => b.name === provider)) {
            availableProviders.push(provider);
            logger.debug(`✅ 启用提供者: ${provider}`);
          }
        }
      } else {
        // 🆕 如果没有检测方法，直接使用推荐列表
        logger.debug('⚠️ ONNX Runtime未提供检测方法，使用推荐列表');
        availableProviders.push(...recommendedProviders);
      }
      
      // 如果没有检测到任何提供者，默认使用CPU
      if (availableProviders.length === 0) {
        availableProviders.push('cpu');
        logger.debug('⚠️ 未检测到可用提供者，使用 CPU');
      }
      
      // 缓存检测结果
      this.cachedProviders = availableProviders;
      logger.info(`✅ 执行提供者检测完成: ${availableProviders.join(', ')}`);
      
      return availableProviders;
    } catch (error) {
      console.warn('⚠️ 检测执行提供者失败，使用 CPU:', error.message);
      this.cachedProviders = ['cpu'];
      return ['cpu'];
    }
  }




 

  // 卸载模型
  unloadModel(modelName) {
    if (!this.models[modelName]) {
      throw new Error(`Unknown model: ${modelName}`);
    }
    
    // 正确释放ONNX模型会话
    if (this.models[modelName].model) {
      try {
        // ONNX Runtime会话有dispose方法用于释放内存
        if (typeof this.models[modelName].model.dispose === 'function') {
          this.models[modelName].model.dispose();
        }
      } catch (error) {
        console.warn(`释放模型 ${modelName} 时出错:`, error.message);
      }
    }
    
    this.models[modelName].model = null;
    this.models[modelName].classes = null;
    this.models[modelName].metadata = null;
    
    // 对于MobileNetV3模型，清理ImageNet类别数据（可选，因为数据量不大）
    if (modelName === 'mobilenetv3') {
      this.imagenetClasses = null;
      this.models.mobilenetv3.classes = null;
    }
  }

  // 卸载所有模型
  unloadAllModels() {
    let unloadedCount = 0;
    
    Object.keys(this.models).forEach(modelName => {
      if (this.models[modelName].model) {
        this.unloadModel(modelName);
        unloadedCount++;
      }
    });
    
  }

  // 获取图片原始分辨率
  async getOriginalImageDimensions(imageUri) {
    try {
      // 使用ImageProcessor统一接口，避免重复加载
      return await imageProcessor.getImageDimensions(imageUri);
    } catch (error) {
      throw new Error('Failed to load image');
    }
  }

  

  /**
   * 将MobileNetV3的分类结果映射到应用分类
   * @param {string} mobileNetV3Class - MobileNetV3的分类名称
   * @returns {string} 应用分类ID
   */
  mapMobileNetV3ToAppCategory(mobileNetV3Class) {
    if (!mobileNetV3Class) return 'other';
    
    try {
      // 1. 通过MobileNetV3分类名称获取物体分类信息
      const mobileNetV3ClassInfo = this.configService.getMobileNetV3ClassByEnglishName(mobileNetV3Class);
      if (!mobileNetV3ClassInfo || !mobileNetV3ClassInfo.category) {
        logger.debug(`⚠️ 未找到MobileNetV3分类 "${mobileNetV3Class}" 的配置信息`);
        return 'other';
      }
      
      const objectCategory = mobileNetV3ClassInfo.category;
      logger.debug(`🔍 MobileNetV3分类 "${mobileNetV3Class}" 映射到物体分类: ${objectCategory}`);
      
      // 2. 通过物体分类映射到应用分类
      const objectMappings = this.configService.getObjectMappings();
      const appCategory = objectMappings[objectCategory];
      
      if (appCategory) {
        logger.debug(`✅ 物体分类 "${objectCategory}" 映射到应用分类: ${appCategory}`);
        return appCategory;
      } else {
        logger.debug(`⚠️ 未找到物体分类 "${objectCategory}" 的应用分类映射`);
        return 'other';
      }
      
    } catch (error) {
      console.error(`❌ MobileNetV3分类映射失败: ${mobileNetV3Class}`, error);
      return 'other';
    }
  }

  // ==================== 新增的公共接口函数 ====================


  /**
   * 识别手机截图
   * @param {string} fileName - 文件名
   * @param {number} width - 图片宽度
   * @param {number} height - 图片高度
   * @param {string} path - 文件路径（可选，可能是相对路径或绝对路径）
   * @returns {Promise<boolean>} 如果是手机截图返回true，否则返回false
   */
  async identifyMobileScreenshot(fileName, width, height, path = null) {
    try {
      // 特征1：分辨率判定 - 宽高比<=0.5（手机竖屏比例，包括滚动截图）
      // 只有当宽高都大于0时才进行宽高比判断，避免除零错误
      let isMobileResolution = false;
      if (width > 0 && height > 0) {
        const aspectRatio = width / height;
        isMobileResolution = aspectRatio <= 0.5;
      }
      
      // 特征2：文件名判定 - 包含截图/截屏关键词（含中文）
      const fileNameLower = (fileName || '').toLowerCase();
      const isScreenshotFile = fileNameLower.includes('screenshot') ||
                              fileNameLower.includes('截图') ||
                              fileNameLower.includes('截屏') ||
                              fileNameLower.includes('screen');

      // 特征3：路径判定 - 检查是否在截图/截屏目录中
      // path可能是相对路径（Android 10+）或绝对路径（Android 9及以下），PC和移动端都兼容
      let isScreenshotPath = false;
      const screenshotKeywords = ['screenshots', '截图', '截屏', 'screen'];
      
      if (path) {
        const pathLower = path.toLowerCase();
        isScreenshotPath = screenshotKeywords.some(keyword => 
          pathLower.includes(keyword)
        );
      }
      
      const isScreenshot = isMobileResolution || isScreenshotFile || isScreenshotPath;
      
      // 只在检测到手机截图时输出调试信息
      if (isScreenshot) {
        const aspectRatio = width > 0 && height > 0 ? (width / height).toFixed(3) : 'N/A';
        logger.debug(`📱 检测到手机截图: ${width}x${height}, 宽高比=${aspectRatio}, 文件名=${fileName}, 路径=${path || 'N/A'}`);
      }
      
      // 特征中只要有一个满足就判定为手机截图
      return isScreenshot;
    } catch (error) {
      logger.warn('⚠️ 手机截图检测失败:', error.message);
      return false;
    }
  }

  /**
   * 加载指定模型
   * @param {string} modelName - 模型名称 ('idCard' 或 'mobilenetv3')
   * @returns {Promise<Object>} 加载结果
   */

  /**
   * 加载模型（支持指定模型列表或加载所有模型）
   * @param {Array} modelNames - 可选的模型名称数组，不传则加载所有模型
   * @returns {Promise<Object>} 加载结果
   */
  async loadAllModels(modelNames = null) {
    try {
      // 如果没有指定模型列表，则加载所有模型
      const targetModels = modelNames || Object.keys(this.models);
      
      const results = {};
      for (const modelName of targetModels) {
        try {
          await this.loadModel(modelName);
          results[modelName] = { success: true, error: null };
    } catch (error) {
          results[modelName] = { success: false, error: error.message };
          console.error(`❌ ${modelName} 加载失败:`, error.message);
        }
      }
      
      const successCount = Object.values(results).filter(r => r.success).length;
      const totalCount = targetModels.length;
      
        return {
        success: successCount === totalCount,
        totalModels: totalCount,
        loadedModels: successCount,
        results: results,
        message: `成功加载 ${successCount}/${totalCount} 个模型`
      };
    } catch (error) {
      console.error('加载模型失败:', error);
      return {
        success: false,
        totalModels: 0,
        loadedModels: 0,
        results: {},
        message: `加载失败: ${error.message}`,
        error: error.message
      };
    }
  }






  // 加载MobileNetV3模型
  async loadMobileNetV3Model() {
    const modelConfig = this.models.mobilenetv3;
    
    // 如果模型已加载，直接返回
    if (modelConfig.model) {
      return modelConfig.model;
    }

    try {
      // ImageNet类别已在初始化时加载

      // 🆕 确保模型文件存在（仅在移动端需要从 assets 复制）
      if (typeof ModelPathAdapter.ensureModelExists === 'function') {
        const modelFileName = modelConfig.path.split('/').pop();
        await ModelPathAdapter.ensureModelExists(modelFileName);
      }

      // 使用统一的ONNX Runtime实例
      const ort = this.ort;

      // 创建推理会话
      const sessionOptions = {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'disabled',
        enableCpuMemArena: false,
        enableMemPattern: false,
        enableProfiling: false,
        logSeverityLevel: 3,
        logVerbosityLevel: 0,
        sessionLogSeverityLevel: 3,
        sessionLogVerbosityLevel: 0
      };

      modelConfig.model = await ort.InferenceSession.create(modelConfig.path, sessionOptions);
      logger.debug('✅ MobileNetV3模型加载成功');
      
      return modelConfig.model;
    } catch (error) {
      console.error('❌ MobileNetV3模型加载失败:', error);
      throw error;
    }
  }


  // 预处理图片用于MobileNetV3
  async preprocessImageForMobileNetV3(imageUri) {
    try {
      // 使用统一的ONNX Runtime实例
      const ort = this.ort;

      const inputSize = 224; // MobileNetV3输入尺寸
      // 使用新接口获取像素数据（cover模式，填满并裁剪）
      const data = await imageProcessor.getPixelData(
        imageUri,
        inputSize,
        inputSize,
        { mode: 'cover' }
      );
      
      // 转换为RGB格式并归一化到[0,1]
      const rgbData = new Float32Array(inputSize * inputSize * 3);
      for (let i = 0; i < data.length; i += 4) {
        const pixelIndex = i / 4;
        rgbData[pixelIndex * 3] = data[i] / 255.0;         // R
        rgbData[pixelIndex * 3 + 1] = data[i + 1] / 255.0; // G
        rgbData[pixelIndex * 3 + 2] = data[i + 2] / 255.0; // B
      }
      
      // 转换为CHW格式 (Channel, Height, Width)
      const chwData = new Float32Array(3 * inputSize * inputSize);
      for (let h = 0; h < inputSize; h++) {
        for (let w = 0; w < inputSize; w++) {
          for (let c = 0; c < 3; c++) {
            const hwcIndex = h * inputSize * 3 + w * 3 + c;
            const chwIndex = c * inputSize * inputSize + h * inputSize + w;
            chwData[chwIndex] = rgbData[hwcIndex];
          }
        }
      }
      
      // 创建ONNX张量 [1, 3, 224, 224]
      const tensor = new ort.Tensor('float32', chwData, [1, 3, inputSize, inputSize]);
      return tensor;
    } catch (error) {
      console.error('❌ MobileNetV3图片预处理失败:', error);
      throw error;
    }
  }

  // 后处理MobileNetV3输出
  async postprocessMobileNetV3Output(output, confidenceThreshold = null) {
    try {
      // 使用模型配置中的阈值作为默认值
      const threshold = confidenceThreshold !== null ? confidenceThreshold : (this.models.mobilenetv3?.confidenceThreshold || 0.3);
      
      // 获取实际的数值数据（支持GPU和CPU）
      let outputData;
      if (output.cpuData) {
        // CPU数据，直接使用
        outputData = output.cpuData;
      } else if (output.data) {
        // GPU数据，需要转换为CPU数据
        outputData = await output.data();
        logger.debug('📊 使用GPU数据，长度:', outputData.length);
      } else if (Array.isArray(output)) {
        // 数组格式数据
        outputData = output;
        logger.debug('📊 使用数组数据，长度:', outputData.length);
      } else {
        throw new Error(`无法识别的MobileNetV3输出数据格式: ${JSON.stringify(output)}`);
      }
      
      const probabilities = new Array(outputData.length);

      // 计算softmax
      let maxLogit = Math.max(...outputData);
      let sumExp = 0;
      for (let i = 0; i < outputData.length; i++) {
        probabilities[i] = Math.exp(outputData[i] - maxLogit);
        sumExp += probabilities[i];
      }

      // 归一化
      for (let i = 0; i < probabilities.length; i++) {
        probabilities[i] /= sumExp;
      }

      // 获取top-5预测结果
      const top5 = [];
      for (let i = 0; i < probabilities.length; i++) {
        top5.push({
          index: i,
          probability: probabilities[i],
          class: this.imagenetClasses && this.imagenetClasses[i] ? this.imagenetClasses[i] : `class_${i}`
        });
      }

      top5.sort((a, b) => b.probability - a.probability);
      
      // 过滤低置信度预测
      const validPredictions = top5.filter(pred => pred.probability >= threshold);
      
      return {
        predictions: top5.slice(0, 5), // 返回top-5
        validPredictions: validPredictions,
        topPrediction: top5[0],
        confidence: top5[0].probability
      };
    } catch (error) {
      console.error('❌ MobileNetV3后处理失败:', error);
      return {
        predictions: [],
        validPredictions: [],
        topPrediction: null,
        confidence: 0
      };
    }
  }



  // 使用MobileNetV3分类图片
  async classifyImageWithMobileNetV3(imageUri, options = {}) {
    const t0 = Date.now();
    const { confidenceThreshold = this.models.mobilenetv3?.confidenceThreshold || 0.3 } = options;
    
    try {
      // 确保模型已加载
      const loadStart = Date.now();
      await this.loadMobileNetV3Model();
      const loadTime = Date.now() - loadStart;
      
      // 预处理图片
      const preprocessStart = Date.now();
      const inputTensor = await this.preprocessImageForMobileNetV3(imageUri);
      const preprocessTime = Date.now() - preprocessStart;
      
      // 运行推理
      const inferenceStart = Date.now();
      const modelConfig = this.models.mobilenetv3;
      const feeds = { [modelConfig.inputName]: inputTensor };
      const results = await modelConfig.model.run(feeds);
      const inferenceTime = Date.now() - inferenceStart;
      
      // 获取输出
      const postprocessStart = Date.now();
      const output = results[modelConfig.outputName];
      if (!output) {
        throw new Error('MobileNetV3模型没有返回有效的输出数据');
      }
      
      // 后处理结果
      const processedResults = await this.postprocessMobileNetV3Output(output, confidenceThreshold);
      const postprocessTime = Date.now() - postprocessStart;
      
      const totalTime = Date.now() - t0;
      
      // 详细性能日志（仅在总时间过长时输出）
      if (totalTime > 500) {
      }
      
      return {
        success: true,
        predictions: processedResults.predictions,
        validPredictions: processedResults.validPredictions,
        topPrediction: processedResults.topPrediction,
        confidence: processedResults.confidence,
        model: 'mobilenetv3',
        processingTime: totalTime
      };
    } catch (error) {
      console.error('❌ MobileNetV3分类失败:', error);
      return {
        success: false,
        error: error.message,
        predictions: [],
        validPredictions: [],
        topPrediction: null,
        confidence: 0,
        model: 'mobilenetv3',
        processingTime: Date.now() - t0
      };
    }
  }

  /**
   * 翻译ImageNet类别ID为英文名称
   * @param {string} classId - 如 "imagenet_class_664"
   * @returns {string} 英文名称或原ID
   */
  translateImageNetClass(classId) {
    try {
      // 提取数字部分
      const match = classId.match(/imagenet_class_(\d+)/);
      if (!match) {
        return classId; // 如果不是标准格式，返回原ID
      }
      
      const classNumber = parseInt(match[1]);
      
      // 🔥 修复：通过 configService 根据 ID 获取类别信息，而不是通过数组索引
      // 因为数组索引和类别 ID 可能不匹配（如果 ID 不是从 0 开始或有缺失）
      const classInfo = this.configService.getMobileNetV3ClassById(classNumber);
      if (classInfo && classInfo.english) {
        return classInfo.english;
      }
      
      // 如果找不到，返回去掉前缀的数字ID
      return classNumber.toString();
    } catch (error) {
      logger.warn(`翻译ImageNet类别失败: ${classId}`, error);
      return classId;
    }
  }

  /**
   * 翻译 mobileNetV3Detections 中的 imagenet_class_xxx 为英文名称
   * @param {Object} mobileNetV3Detections - MobileNetV3检测结果
   * @returns {Object} 翻译后的检测结果
   */
  translateMobileNetV3Detections(mobileNetV3Detections) {
    if (!mobileNetV3Detections || !mobileNetV3Detections.predictions || !Array.isArray(mobileNetV3Detections.predictions)) {
      return mobileNetV3Detections;
    }
    
    const translated = {
      ...mobileNetV3Detections,
      predictions: mobileNetV3Detections.predictions.map(prediction => {
        if (prediction.class && typeof prediction.class === 'string' && prediction.class.startsWith('imagenet_class_')) {
          const translatedName = this.translateImageNetClass(prediction.class);
          if (translatedName !== prediction.class) {
            logger.debug(`🔄 翻译 MobileNetV3: ${prediction.class} -> ${translatedName}`);
          }
          return {
            ...prediction,
            class: translatedName || prediction.class
          };
        }
        return prediction;
      })
    };
    
    return translated;
  }

  // ==================== 图片哈希工具 ====================
  // 注：原作者后端分类服务（api.aifuture.net.cn）已整体移除，分类改走用户配置的 LLM。

  /**
   * 计算图片的SHA-256哈希值
   * @param {string} imageUri - 图片URI
   * @returns {Promise<string>} SHA-256哈希字符串
   */
  async calculateImageHash(imageUri) {
    try {
      // 安全地加载图片数据
      let blob;
      
      if (imageUri.startsWith('file://')) {
        // 本地文件：使用 WebAdapters 中的安全读取函数
        const { readImageFileAsBlob } = require('../adapters/WebAdapters');
        blob = await readImageFileAsBlob(imageUri);
      } else {
        // 网络URL：使用 fetch
        const response = await fetch(imageUri);
        blob = await response.blob();
      }
      
      const arrayBuffer = await blob.arrayBuffer();
      
      // 计算SHA-256哈希
      const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      
      return hashHex;
    } catch (error) {
      logger.error('❌ 计算图片哈希失败:', error);
      throw error;
    }
  }


}

export default ImageClassifierService;
