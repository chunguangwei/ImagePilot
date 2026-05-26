/**
 * WeChatAuthService - 会员/授权服务（已停用原作者公网后端）
 *
 * 原依赖 api.aifuture.net.cn 的会员/二维码/额度接口已整体移除：
 *   - 会员限制已关闭：getMembershipStatus / getCredits 恒返回「已开通 + 充足额度」。
 *   - 二维码/关注状态等网络方法改为无操作桩（设置页相关 UI 也已隐藏）。
 * 仅保留 clientId / openId 的本地读写（不联网）。
 */

import { logger } from '../adapters/WebAdapters';
import ImageStorageService from './ImageStorageService';

class WeChatAuthService {
  constructor() {
    this.imageStorageService = new ImageStorageService();
  }

  // ========== 本地工具方法（不联网）==========

  /** 获取客户端ID（本地设置） */
  async getClientId() {
    try {
      const settings = await this.imageStorageService.getSettings();
      return settings.clientId || '';
    } catch (error) {
      logger.error('❌ 获取客户端ID失败:', error);
      return '';
    }
  }

  /** 保存 openID 到本地设置 */
  async saveOpenId(openId) {
    try {
      const settings = await this.imageStorageService.getSettings();
      settings.wechatOpenId = openId;
      await this.imageStorageService.saveSettings(settings);
      logger.debug('✅ openID 已保存');
    } catch (error) {
      logger.error('❌ 保存openID失败:', error);
    }
  }

  /** 获取本地保存的 openID */
  async getOpenId() {
    try {
      const settings = await this.imageStorageService.getSettings();
      return settings.wechatOpenId || '';
    } catch (error) {
      logger.error('❌ 获取openID失败:', error);
      return '';
    }
  }

  // ========== 会员状态（已关闭限制，不联网）==========

  /** 会员状态：恒返回已开通会员 + 已关注 */
  async getMembershipStatus() {
    return { isMember: true, isFollowed: true, memberExpireAt: null };
  }

  /** 额度：恒返回充足额度 + 已开通会员 + 已关注 */
  async getCredits() {
    return { total: 999999, used: 0, remaining: 999999, isFollowed: true, isMember: true, memberExpireAt: null };
  }

  // ========== 原公网交互（已移除，保留无操作桩以兼容历史调用）==========

  /** 二维码功能已移除（原作者后端停用） */
  async generateQrCode() {
    logger.debug('generateQrCode: 原作者后端已移除，无操作');
    return { qrcode: '', ticket: '' };
  }

  /** 关注状态检查已移除：会员恒为已关注 */
  async checkFollowStatus() {
    return { isFollowed: true };
  }

  /** 轮询关注状态已移除（无操作） */
  startCheckingFollowStatus() {
    return () => {};
  }
}

// 导出单例
export default new WeChatAuthService();
