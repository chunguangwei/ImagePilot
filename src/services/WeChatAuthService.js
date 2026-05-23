/**
 * WeChatAuthService - 微信授权服务
 * 
 * 功能：
 * 1. 生成二维码（POST /api/v1/auth/wechat/qrcode）
 * 2. 检查关注状态（GET /api/v1/auth/wechat/check-follow）
 * 3. 查询额度（GET /api/v1/user/credits）
 * 
 * 使用场景：
 * - 用户首次使用AI图像增强功能前，需先关注公众号获取免费额度
 * - 在设置页面显示二维码和关注状态
 * - 提交增强任务前检查用户额度是否充足
 */

import { logger } from '../adapters/WebAdapters';
import ImageStorageService from './ImageStorageService';

class WeChatAuthService {
  constructor() {
    this.apiConfig = {
      baseURL: 'https://api.aifuture.net.cn',
      endpoints: {
        qrcode: '/api/v1/auth/wechat/qrcode',
        checkFollow: '/api/v1/auth/wechat/check-follow',
        credits: '/api/v1/user/credits',
        membership: '/api/v1/user/member-status'
      },
      timeout: 30000 // 30秒超时
    };
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

  /**
   * 查询会员状态（统一使用 getCredits 接口）
   * 返回 { isMember: boolean, isFollowed: boolean, memberExpireAt: string|null }
   */
  async getMembershipStatus() {
    // 🆕 关闭会员限制：恒返回已开通会员 + 已关注，不再依赖远程后端
    return { isMember: true, isFollowed: true, memberExpireAt: null };
    // eslint-disable-next-line no-unreachable -- 下方原逻辑保留以便回退
    try {
      // 统一使用 getCredits 接口获取会员状态和关注状态
      const creditsResult = await this.getCredits();
      return {
        isMember: creditsResult.isMember,
        isFollowed: creditsResult.isFollowed,
        memberExpireAt: creditsResult.memberExpireAt
      };
    } catch (error) {
      logger.debug('查询会员状态失败:', error);
      // 失败时按非会员、未关注处理，避免阻塞扫描
      return { isMember: false, isFollowed: false, memberExpireAt: null };
    }
  }

  /**
   * 保存 openID 到本地设置
   * @param {string} openId 
   */
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

  /**
   * 获取本地保存的 openID
   * @returns {Promise<string>} openID
   */
  async getOpenId() {
    try {
      const settings = await this.imageStorageService.getSettings();
      return settings.wechatOpenId || '';
    } catch (error) {
      logger.error('❌ 获取openID失败:', error);
      return '';
    }
  }

  // ========== API 交互 ==========
  
  /**
   * 生成二维码
   * @returns {Promise<{qrcode: string, ticket: string}>}
   */
  async generateQrCode() {
    try {
      const clientId = await this.getClientId();
      
      if (!clientId) {
        throw new Error('客户端ID未找到，请重新安装应用');
      }

      logger.debug('📱 正在生成二维码...');

      const url = `${this.apiConfig.baseURL}${this.apiConfig.endpoints.qrcode}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.apiConfig.timeout);

      // 生成随机的scene_str（用于标识这个二维码请求）
      const sceneStr = `qrcode_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      const requestBody = {
        client_id: clientId,
        scene_str: sceneStr
      };
      
      logger.debug('📤 发送请求:', url);
      logger.debug('📤 请求体:', requestBody);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      logger.debug(`📡 API响应状态: ${response.status} ${response.statusText}`);
      
      const responseText = await response.text();
      logger.debug(`📡 API响应内容:`, responseText);

      if (!response.ok) {
        logger.debug(`生成二维码失败 (${response.status}):`, responseText);
        logger.debug('请求URL:', url);
        logger.debug('请求体:', requestBody);
        logger.debug('客户端ID:', clientId);
        let errorMessage = '生成二维码失败';
        try {
          const errorJson = JSON.parse(responseText);
          errorMessage = errorJson.detail || errorJson.message || errorMessage;
        } catch (e) {
          errorMessage = responseText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      const result = JSON.parse(responseText);
      logger.debug(`📡 API返回结果:`, result);
      
      if (result.success && result.qrcode_url && result.ticket) {
        logger.debug('✅ 二维码生成成功');
        return {
          qrcode: result.qrcode_url, // 二维码URL
          ticket: result.ticket  // 二维码票据
        };
      } else {
        throw new Error(result.message || '生成二维码失败');
      }

    } catch (error) {
      if (error.name === 'AbortError') {
        logger.debug('生成二维码超时');
        throw new Error('生成二维码超时，请检查网络连接');
      }
      logger.debug('生成二维码失败:', error.message || error);
      throw new Error(error.message || '生成二维码失败');
    }
  }

  /**
   * 检查关注状态（不再返回 open_id）
   * @returns {Promise<{followed: boolean, openId: string}>} // openId 兼容保留为空字符串
   */
  async checkFollowStatus() {
    try {
      const clientId = await this.getClientId();
      
      if (!clientId) {
        throw new Error('客户端ID未找到');
      }

      logger.debug('🔍 正在检查关注状态...');

      const url = `${this.apiConfig.baseURL}${this.apiConfig.endpoints.checkFollow}?client_id=${clientId}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.apiConfig.timeout);

      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`❌ 检查关注状态失败 (${response.status}):`, errorText);
        throw new Error(`检查关注状态失败: ${response.status}`);
      }

      const result = await response.json();
      logger.debug('📡 API返回结果:', result);
      
      // 新接口不再返回 open_id，仅解析关注状态
      // 兼容旧格式字段名：subscribed / followed，可能包在 data 中
      let followed = false;
      if (result && typeof result === 'object') {
        if (typeof result.subscribed !== 'undefined') {
          followed = !!result.subscribed;
        } else if (typeof result.followed !== 'undefined') {
          followed = !!result.followed;
        } else if (result.success && result.data && (typeof result.data.subscribed !== 'undefined' || typeof result.data.followed !== 'undefined')) {
          const v = (typeof result.data.subscribed !== 'undefined') ? result.data.subscribed : result.data.followed;
          followed = !!v;
        }
      }

      // 不再保存 openId，本函数仅返回关注布尔值；为兼容调用处结构，返回空字符串
      return {
        followed: !!followed,
        openId: ''
      };

    } catch (error) {
      if (error.name === 'AbortError') {
        logger.error('❌ 检查关注状态超时');
        throw new Error('检查关注状态超时，请检查网络连接');
      }
      logger.error('❌ 检查关注状态失败:', error);
      throw error;
    }
  }

  /**
   * 查询用户额度和会员状态（统一接口）
   * @returns {Promise<{total: number, used: number, remaining: number, isFollowed: boolean, isMember: boolean, memberExpireAt: string|null}>}
   */
  async getCredits() {
    // 🆕 关闭会员限制：恒返回充足额度 + 已开通会员 + 已关注，不再查远程后端
    return { total: 999999, used: 0, remaining: 999999, isFollowed: true, isMember: true, memberExpireAt: null };
    // eslint-disable-next-line no-unreachable -- 下方原逻辑保留以便回退
    try {
      const clientId = await this.getClientId();
      
      if (!clientId) {
        throw new Error('客户端ID未找到');
      }

      logger.debug('💰 正在查询额度和会员状态...');

      // 仅使用 client_id，不再使用 openid
      const url = `${this.apiConfig.baseURL}${this.apiConfig.endpoints.credits}?client_id=${encodeURIComponent(clientId)}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.apiConfig.timeout);

      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        // 404且是"用户未关注公众号"的情况，属于正常业务逻辑，使用debug级别
        if (response.status === 404) {
          try {
            const errorJson = JSON.parse(errorText);
            if (errorJson.detail && errorJson.detail.includes('未关注公众号')) {
              logger.debug(`📡 用户未关注公众号，返回404（正常情况）`);
              // 返回默认值，不抛出错误
              return { total: 0, used: 0, remaining: 0, isFollowed: false, isMember: false, memberExpireAt: null };
            }
          } catch (e) {
            // 解析失败，继续使用error级别
          }
        }
        logger.error(`❌ 查询额度失败 (${response.status}):`, errorText);
        throw new Error(`查询额度失败: ${response.status}`);
      }

      const result = await response.json();
      logger.debug('📡 额度API返回结果:', result);
      
      // 解析返回结构：{ success, total_credits, used_credits, remaining_credits, is_followed, is_member, member_expire_at }
      let total = 0, used = 0, remaining = 0, isFollowed = false, isMember = false, memberExpireAt = null;
      
      if (result.success) {
        const source = result.data || result;
        total = source.total_credits || source.total || 0;
        used = source.used_credits || source.used || 0;
        remaining = source.remaining_credits || source.remaining || 0;
        isFollowed = source.is_followed === true || source.is_followed === 'true' || source.is_followed === 1;
        isMember = source.is_member === true || source.is_member === 'true' || source.is_member === 1;
        memberExpireAt = source.member_expire_at || null;
      }

      if (total > 0 || used > 0 || remaining > 0) {
        logger.debug(`✅ 额度查询成功: 总计${total}，已用${used}，剩余${remaining}，关注:${isFollowed}，会员:${isMember}`);
      } else {
        logger.debug(`✅ 额度查询成功: 总计${total}，已用${used}，剩余${remaining}，关注:${isFollowed}，会员:${isMember}`);
      }

      return { 
        total, 
        used, 
        remaining, 
        isFollowed, 
        isMember, 
        memberExpireAt 
      };

    } catch (error) {
      if (error.name === 'AbortError') {
        logger.error('❌ 查询额度超时');
        throw new Error('查询额度超时，请检查网络连接');
      }
      logger.error('❌ 查询额度失败:', error);
      return { total: 0, used: 0, remaining: 0, isFollowed: false, isMember: false, memberExpireAt: null };
    }
  }

  /**
   * 轮询检查关注状态
   * @param {Function} onFollowed - 关注成功回调
   * @param {Function} onError - 错误回调
   * @returns {Function} 停止轮询的函数
   */
  startCheckingFollowStatus(onFollowed, onError) {
    let isPolling = true;
    
    const checkInterval = setInterval(async () => {
      if (!isPolling) return;
      
      try {
        const { followed } = await this.checkFollowStatus();
        
        if (followed) {
          clearInterval(checkInterval);
          isPolling = false;
          
          if (onFollowed) {
            onFollowed({ followed: true });
          }
        }
      } catch (error) {
        // 轮询中的错误不需要中断轮询，仅记录日志
        logger.debug('⏳ 轮询中...', error.message);
      }
    }, 2000); // 每2秒检查一次

    // 返回停止函数
    return () => {
      clearInterval(checkInterval);
      isPolling = false;
    };
  }
}

export default new WeChatAuthService();

