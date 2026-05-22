/**
 * CustomProvider — 通用 OpenAI 兼容 Provider
 *
 * 用途：让用户接入任何 OpenAI 兼容的服务
 *   - 自部署的 vLLM / LM Studio / LocalAI
 *   - 国内厂商：DeepSeek、智谱 GLM-4V、Qwen-VL（开放 API）
 *   - 中转 / 代理服务
 *
 * 与 OpenAIProvider 唯一差异：
 *   - 不内置 baseURL/model 默认值，必须由用户配置
 *   - 允许 apiKey 为空（部分自部署服务无认证）
 */

import { OpenAIProvider } from './OpenAIProvider.js';
import { LLMProviderError, LLMErrorCode } from './BaseProvider.js';

export class CustomProvider extends OpenAIProvider {
  constructor(config = {}) {
    if (!config.baseURL) {
      throw new LLMProviderError(
        'CustomProvider: baseURL is required',
        LLMErrorCode.CONFIG,
        false,
      );
    }
    if (!config.model) {
      throw new LLMProviderError(
        'CustomProvider: model is required',
        LLMErrorCode.CONFIG,
        false,
      );
    }
    super(config);
    this.providerName = 'custom';
    // 允许无认证
    this._authMissing = false;
  }

  _buildHeaders() {
    const headers = {
      'Content-Type': 'application/json',
      ...this.config.headersExtra,
    };
    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }

  estimateCostCents() {
    // 自定义服务无法预知成本
    return -1;
  }
}

export default CustomProvider;
