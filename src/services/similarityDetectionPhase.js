import { logger } from '../adapters/WebAdapters';
import UnifiedDataService from './UnifiedDataService';

/**
 * 判断图片是否应该被排除在相似度检测之外
 * @param {Object} image - 图片对象
 * @returns {boolean} 如果应该排除返回true，否则返回false
 */
function shouldExcludeFromSimilarityDetection(image) {
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
function getExcludedCategoryStats(images) {
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
 * 相似度检测阶段（全量重新检测）
 * 共享函数，供 GalleryScannerService 和 GalleryScannerService.android 使用
 * 
 * @param {Object} context - 上下文对象，包含服务实例的属性和方法
 * @param {Function} context.sendProgressMessage - 发送进度消息的方法
 * @param {Object} context.similarityService - 相似度检测服务实例
 * @param {number} [context.totalImagesToBeClassified] - 总分类目标（可选，Android 版本使用）
 * @returns {Promise<void>}
 */
export async function similarityDetectionPhase(context) {
  const { sendProgressMessage, similarityService, totalImagesToBeClassified } = context;
  
  logger.info('🔍 阶段6: 开始相似度检测（全量重新检测）');
  
  try {
    // 全量：读取所有图片
    let imagesForSimilarity = await UnifiedDataService.readAllImages();
    
    if (!imagesForSimilarity || imagesForSimilarity.length === 0) {
      logger.info('📊 阶段6: 没有图片，跳过相似度检测');
      return;
    }
    
    // 过滤掉不需要进行相似度检测的分类（手机截图、二维码、证件照）
    const beforeFilterCount = imagesForSimilarity.length;
    const excludedStats = getExcludedCategoryStats(imagesForSimilarity);
    imagesForSimilarity = imagesForSimilarity.filter(image => !shouldExcludeFromSimilarityDetection(image));
    const filteredCount = beforeFilterCount - imagesForSimilarity.length;
    if (filteredCount > 0) {
      const statsParts = [];
      if (excludedStats.screenshot > 0) statsParts.push(`screenshot: ${excludedStats.screenshot}`);
      if (excludedStats.qrcode > 0) statsParts.push(`qrcode: ${excludedStats.qrcode}`);
      if (excludedStats.idcard > 0) statsParts.push(`idcard: ${excludedStats.idcard}`);
      logger.info(`📊 阶段6: 已排除 ${filteredCount} 张图片（${statsParts.join(', ')}）`);
    }
    
    if (imagesForSimilarity.length === 0) {
      logger.info('📊 阶段6: 过滤后没有图片，跳过相似度检测');
      return;
    }
    
    const totalFoundThisPhase = imagesForSimilarity.length;
    logger.info(`🔍 阶段6: 开始相似度检测，处理 ${totalFoundThisPhase} 张图片（全量）`);
    
    // 发送开始处理消息
    // 第三个参数是相似组数量（初始为0），第四个参数是总分类目标（可选，Android版本使用）
    try {
        await sendProgressMessage('similarity_detection', 0, totalFoundThisPhase, 0, totalImagesToBeClassified);
    } catch (error) {
      logger.warn(`⚠️ 发送相似度检测开始消息失败: ${error.message}`);
    }
    
    // 批量进行相似度检测（相似度阈值从 settings 传入，默认 0.8 即 80%，最低 80%）
    let similarityThreshold = (context.similarityThreshold != null && context.similarityThreshold >= 0 && context.similarityThreshold <= 1)
      ? context.similarityThreshold
      : 0.8;
    if (similarityThreshold < 0.8) similarityThreshold = 0.8;
    logger.info(`🔍 开始调用相似度检测服务，参数: timeWindow=300, similarityThreshold=${similarityThreshold}, useSimplifiedAlgorithm=false`);
    const result = await similarityService.detectSimilarImages({
      timeWindow: 300, // 5分钟时间窗口
      similarityThreshold,
      groupType: 'similar',
      images: imagesForSimilarity,
      clearExisting: true, // 全量重新检测：先清除现有相似组，再对所有图片重新检测
      useSimplifiedAlgorithm: false, // 🔥 强制使用直方图模式，因为AI分类不一定执行了
      onProgress: async (processed, total, groups) => {
        // 更新相似组数量（使用传递的groups参数）
        const groupsCount = groups || 0;
        logger.debug(`🔍 相似度检测进度: processed=${processed}, total=${total}, groups=${groupsCount}`);
        // 发送进度消息
        // 第三个参数是相似组数量（groupsCount），第四个参数是总分类目标（可选，Android版本使用）
        // 注意：不等待完成，避免阻塞相似度检测进度回调
        try {
          const progressPromise = sendProgressMessage('similarity_detection', processed, total, groupsCount, totalImagesToBeClassified);
          
          // 捕获可能的错误，但不阻塞进度回调
          if (progressPromise && typeof progressPromise.catch === 'function') {
            progressPromise.catch(err => {
              logger.warn('⚠️ 发送相似度检测进度消息失败:', err);
            });
          }
        } catch (error) {
          logger.warn('⚠️ 发送相似度检测进度消息失败:', error);
        }
      }
    });
    
    logger.info(`🔍 相似度检测服务返回结果:`, {
      success: result.success,
      groupsLength: result.groups ? result.groups.length : 0,
      processed: result.processed,
      total: result.total,
      error: result.error
    });
    
    if (result.success) {
      logger.info(`✅ 阶段6完成: 相似度检测成功，发现 ${result.groups.length} 个相似组`);
      // 发送相似度检测完成消息
      // 第三个参数是最终相似组数量，第四个参数是总分类目标（可选，Android版本使用）
      const totalWindows = result.windows || 0;
        await sendProgressMessage('similarity_detection', totalWindows, totalWindows, result.groups.length, totalImagesToBeClassified);
    } else {
      logger.error(`❌ 阶段6失败: 相似度检测失败: ${result.error}`);
    }
    
  } catch (error) {
    logger.error('❌ 阶段6失败:', error);
    throw error;
  }
}

