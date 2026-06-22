/**
 * WakeLock服务
 * 用于在图片扫描和AI处理期间保持CPU运行，防止休眠影响性能
 */

import { NativeModules, Platform } from 'react-native';
import { logger } from '../adapters/WebAdapters';
import KeepAwakeService from './KeepAwakeService';

const { WakeLockModule } = NativeModules;

class WakeLockService {
  constructor() {
    this.isActive = false;
    this.startTime = null;
  }

  /**
   * 检查WakeLock是否可用
   */
  isAvailable() {
    return Platform.OS === 'android' && WakeLockModule != null;
  }

  /**
   * 获取唤醒锁
   * @param {number} timeout - 超时时间（毫秒），0表示不自动释放
   * @returns {Promise<boolean>}
   */
  async acquire(timeout = 0) {
    // 屏幕常亮（跨端，含 iOS）：长任务期间防自动锁屏 → 屏幕不熄、app 前台、任务持续跑。
    // 与下面的 CPU WakeLock(仅 Android)互补：iOS 靠这个保活，Android 两者都上。
    try { await KeepAwakeService.activate(); } catch (_) {}

    if (!this.isAvailable()) {
      logger.debug('⚠️ WakeLock(CPU)不可用（仅 Android）；屏幕常亮已启用');
      return false;
    }

    try {
      await WakeLockModule.acquire(timeout);
      this.isActive = true;
      this.startTime = Date.now();
      
      if (timeout > 0) {
        logger.info(`🔋 已获取唤醒锁，超时: ${timeout}ms (${Math.round(timeout / 60000)}分钟)`);
      } else {
        logger.info('🔋 已获取唤醒锁，无超时限制');
      }
      
      return true;
    } catch (error) {
      logger.error('❌ 获取唤醒锁失败:', error.message);
      return false;
    }
  }

  /**
   * 释放唤醒锁
   * @returns {Promise<boolean>}
   */
  async release() {
    // 关屏幕常亮（跨端，与 acquire 配对）
    try { await KeepAwakeService.deactivate(); } catch (_) {}

    if (!this.isAvailable()) {
      return false;
    }

    try {
      const released = await WakeLockModule.release();
      
      if (released && this.startTime) {
        const duration = Math.round((Date.now() - this.startTime) / 1000);
        logger.info(`🔋 已释放唤醒锁，持续时间: ${duration}秒`);
      }
      
      this.isActive = false;
      this.startTime = null;
      
      return released;
    } catch (error) {
      logger.error('❌ 释放唤醒锁失败:', error.message);
      return false;
    }
  }

  /**
   * 检查是否持有唤醒锁
   * @returns {Promise<boolean>}
   */
  async isHeld() {
    if (!this.isAvailable()) {
      return false;
    }

    try {
      return await WakeLockModule.isHeld();
    } catch (error) {
      logger.error('❌ 检查唤醒锁状态失败:', error.message);
      return false;
    }
  }

  /**
   * 自动管理唤醒锁：在扫描/处理期间获取，完成后释放
   * @param {Function} task - 要执行的任务
   * @param {number} timeout - 超时时间（毫秒），默认30分钟
   * @returns {Promise<any>} 任务返回值
   */
  async withWakeLock(task, timeout = 30 * 60 * 1000) {
    const acquired = await this.acquire(timeout);
    
    try {
      const result = await task();
      return result;
    } finally {
      if (acquired) {
        await this.release();
      }
    }
  }

  /**
   * 获取唤醒锁持续时间（秒）
   * @returns {number}
   */
  getDuration() {
    if (!this.startTime) {
      return 0;
    }
    return Math.round((Date.now() - this.startTime) / 1000);
  }
}

// 单例
export default new WakeLockService();

