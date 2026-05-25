/**
 * ImageEnhanceService - AI图像增强服务
 * 
 * 功能：
 * 1. 图片预处理（resize、压缩、hash计算）- 复用 ImageProcessor
 * 2. API交互（提交任务、查询状态、轮询）
 * 3. 文件操作（下载、保存到xualbum目录）
 */

import { logger, normalizeFilePath } from '../adapters/WebAdapters';
import ImageProcessor from './ImageProcessor';
import ImageStorageService from './ImageStorageService';
import WeChatAuthService from './WeChatAuthService';

class ImageEnhanceService {
  constructor() {
    // 原作者 AI 修图后端（api.aifuture.net.cn）已移除。
    // AI 修图改走用户配置的大模型；当前聊天类大模型不支持图像编辑输出，
    // 故功能以「正在开发中」占位（见 submitEnhanceTask）。
    this.imageStorageService = new ImageStorageService();
  }

  // ========== 工具方法 ==========
  
  /**
   * 获取客户端ID
   * @returns {Promise<string>} 客户端ID
   */
  async getClientId() {
    try {
      const settings = await this.imageStorageService.getSettings();
      return settings.clientId || '';
    } catch (error) {
      logger.error('❌ 获取客户端ID失败:', error);
      return '';
    }
  }

  // ========== 图片预处理（复用 ImageProcessor）==========
  
  /**
   * 准备图片用于增强（直接使用原图，不缩放不计算哈希）
   * @param {string} imageUri - 图片URI (file:/// 或 content://)
   * @returns {Promise<{originalFileName: string, localUri: string}>}
   */
  async prepareImageForEnhance(imageUri) {
    try {
      logger.debug('🖼️ 准备图片进行增强(原图直传):', imageUri);
      const originalFileName = (() => {
        try {
          const clean = (imageUri || '').replace(/^file:\/\//, '');
          const noQuery = clean.split('?')[0].split('#')[0];
          const segments = noQuery.split(/[\\\/]/);
          const name = segments[segments.length - 1];
          return name && name.trim() ? name : `image_${Date.now()}.jpg`;
        } catch (e) {
          return `image_${Date.now()}.jpg`;
        }
      })();
      // 直接返回本地URI与文件名
      return { originalFileName, localUri: imageUri };
    } catch (error) {
      logger.error('❌ 图片预处理失败:', error);
      throw new Error(`图片预处理失败: ${error.message}`);
    }
  }

  // ========== AI 修图（占位）==========

  /**
   * 提交增强任务。原作者后端已移除；AI 修图改走用户配置的大模型，
   * 但当前聊天类大模型不支持图像编辑输出，故功能正在开发中。
   * 任何调用都会抛出「开发中」错误，由 UI 提示用户。
   */
  async submitEnhanceTask() {
    throw new Error('AI 修图功能正在开发中，敬请期待');
  }

  /**
   * 轮询任务状态。同 submitEnhanceTask，功能开发中（保留以兼容 UI 调用）。
   */
  async pollTaskStatus() {
    throw new Error('AI 修图功能正在开发中，敬请期待');
  }

  // ========== 文件操作 ==========
  
  /**
   * 下载增强后的图片
   * @param {string} resultUrl - 图片URL
   * @returns {Promise<Blob>}
   */
  async downloadEnhancedImage(resultUrl) {
    try {
      logger.debug('⬇️ 下载增强图片:', resultUrl);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时
      
      const response = await fetch(resultUrl, { signal: controller.signal });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`下载失败: HTTP ${response.status}`);
      }
      
      const blob = await response.blob();
      logger.debug('✅ 图片已下载:', blob.size, 'bytes');
      
      return blob;
      
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('下载超时，请检查网络连接');
      }
      logger.error('❌ 下载图片失败:', error);
      throw new Error(`下载图片失败: ${error.message}`);
    }
  }

  /**
   * 保存图片到xualbum目录
   * @param {Blob} imageBlob - 图片Blob
   * @param {string} originalFileName - 原文件名
   * @returns {Promise<{filePath: string, fileName: string, directory: string}>}
   */
  async saveToXualbum(imageBlob, originalFileName) {
    try {
      logger.debug('💾 保存图片到xualbum:', originalFileName);
      
      const { ipcRenderer } = window.require('electron');
      const path = window.require('path');
      const os = window.require('os');

      // 1. 准备路径
      const picturesDir = path.join(os.homedir(), 'Pictures');
      const xualbumDir = path.join(picturesDir, 'xualbum');
      
      // 2. 确保目录存在
      const dirResult = await ipcRenderer.invoke('ensure-directory', xualbumDir);
      if (!dirResult.success) {
        throw new Error(`创建目录失败: ${dirResult.error}`);
      }

      // 3. 生成文件名: 原文件名_xt_时间戳.扩展名
      const timestamp = Date.now();
      const parsedPath = path.parse(originalFileName);
      const newFileName = `${parsedPath.name}_xt_${timestamp}${parsedPath.ext || '.jpg'}`;
      const fullPath = path.join(xualbumDir, newFileName);

      // 4. 保存文件
      const arrayBuffer = await imageBlob.arrayBuffer();
      const saveResult = await ipcRenderer.invoke('save-file-to-path', {
        path: fullPath,
        buffer: Buffer.from(arrayBuffer)
      });

      if (!saveResult.success) {
        throw new Error(`保存文件失败: ${saveResult.error}`);
      }

      logger.debug('✅ 文件已保存:', fullPath);

      return {
        filePath: fullPath,
        fileName: newFileName,
        directory: xualbumDir
      };
      
    } catch (error) {
      logger.error('❌ 保存到xualbum失败:', error);
      throw new Error(`保存文件失败: ${error.message}`);
    }
  }

  /**
   * 批量准备图片（用于批量增强）
   * @param {Array<string>} imageUris - 图片URI数组
   * @returns {Promise<Array<{file: Blob, hash: string, originalFileName: string}>>}
   */
  async prepareImagesForEnhance(imageUris) {
    const results = [];
    
    for (let i = 0; i < imageUris.length; i++) {
      try {
        logger.debug(`📦 准备图片 ${i + 1}/${imageUris.length}:`, imageUris[i]);
        const result = await this.prepareImageForEnhance(imageUris[i]);
        results.push(result);
      } catch (error) {
        logger.error(`❌ 准备图片失败 (${i + 1}/${imageUris.length}):`, error);
        // 继续处理其他图片
        results.push({ error: error.message, uri: imageUris[i] });
      }
    }
    
    return results;
  }
}

// 导出单例
export default new ImageEnhanceService();

