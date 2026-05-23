/**
 * OpenAIProvider — 基于 OpenAI Chat Completions Vision API
 *
 * 兼容协议：
 *   - 官方 OpenAI（gpt-4o-mini / gpt-4o）
 *   - Azure OpenAI（需自定义 baseURL + 额外 headers）
 *   - 其他 OpenAI 兼容服务（DeepSeek-V / Yi-Vision 等）
 *
 * Kimi/Custom Provider 直接继承本类，仅替换 baseURL/model 即可。
 */

import { BaseProvider, LLMProviderError, LLMErrorCode } from './BaseProvider.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

export class OpenAIProvider extends BaseProvider {
  constructor(config = {}) {
    super({
      baseURL: DEFAULT_BASE_URL,
      model: DEFAULT_MODEL,
      ...config,
    });
    this.providerName = 'openai';

    if (!this.config.apiKey) {
      // 不在构造时抛错——允许先 new 再做 healthCheck 给出更友好的错误
      this._authMissing = true;
    }
  }

  /**
   * 构造请求体
   * @protected
   */
  _buildBody(imageBase64, prompt) {
    return {
      model: this.config.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: imageBase64.startsWith('data:')
                  ? imageBase64
                  : `data:image/jpeg;base64,${imageBase64}`,
                detail: 'low', // 控制成本——分类任务不需要 high
              },
            },
          ],
        },
      ],
      max_tokens: 300,
      temperature: 0,
      response_format: { type: 'json_object' },
    };
  }

  /**
   * 是否为 Azure OpenAI 端点（决定鉴权头：Azure 经典部署用 api-key，而非 Bearer）
   * 判据：host 以 .openai.azure.com 结尾，或 URL 带 api-version 查询参数。
   * @protected
   */
  _isAzure() {
    const u = this.config.baseURL || '';
    return /\.openai\.azure\.com/i.test(u) || /[?&]api-version=/i.test(u);
  }

  /**
   * 构造最终请求 URL。
   * - baseURL 已含 /chat/completions（可带 ?api-version=…）→ 原样使用，不重复拼接（参考 LLMWiKi）
   * - 否则追加 /chat/completions
   * @protected
   */
  _buildUrl() {
    const raw = this.config.baseURL || '';
    if (/\/chat\/completions(\?|$)/i.test(raw)) return raw; // 已是完整路径（保留查询串）
    return `${raw.replace(/\/+$/, '')}/chat/completions`;
  }

  /**
   * 构造 headers。Azure 端点用 `api-key` 头；标准 OpenAI 兼容端点用 `Authorization: Bearer`。
   * @protected
   */
  _buildHeaders() {
    const headers = { 'Content-Type': 'application/json', ...this.config.headersExtra };
    if (this._isAzure()) {
      headers['api-key'] = this.config.apiKey;
    } else {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }

  /**
   * 解析响应
   * @protected
   */
  _parseResponse(data, costMs) {
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new LLMProviderError(
        'Empty content in OpenAI response',
        LLMErrorCode.INVALID_RESPONSE,
        true,
      );
    }
    const parsed = this._extractJSON(content);
    if (!parsed) {
      throw new LLMProviderError(
        `Cannot parse JSON from response: ${content.slice(0, 200)}`,
        LLMErrorCode.INVALID_RESPONSE,
        true,
      );
    }
    return {
      contentCategory: parsed.contentCategory || 'other',
      colorTheme: parsed.colorTheme || 'mixed',
      isScreenshot: !!parsed.isScreenshot,
      isIDCard: !!parsed.isIDCard,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      description: parsed.description || '',
      rawText: content,
      costMs,
      tokens: data?.usage
        ? {
            prompt: data.usage.prompt_tokens,
            completion: data.usage.completion_tokens,
            total: data.usage.total_tokens,
          }
        : undefined,
      providerName: this.providerName,
      model: this.config.model,
    };
  }

  async classify(imageBase64, prompt /*, schema */) {
    if (this._authMissing) {
      throw new LLMProviderError(
        `${this.providerName}: apiKey is required`,
        LLMErrorCode.AUTH,
        false,
      );
    }
    const start = Date.now();
    const url = this._buildUrl();
    const resp = await this._fetchWithTimeout(url, {
      method: 'POST',
      headers: this._buildHeaders(),
      body: JSON.stringify(this._buildBody(imageBase64, prompt)),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw this._mapHttpError(resp.status, text);
    }

    let data;
    try {
      data = await resp.json();
    } catch (err) {
      throw new LLMProviderError(
        `Failed to parse JSON: ${err.message}`,
        LLMErrorCode.INVALID_RESPONSE,
        true,
        err,
      );
    }

    return this._parseResponse(data, Date.now() - start);
  }

  /**
   * 估算成本（gpt-4o-mini 当前价格：~$0.15/M input + $0.60/M output；image low detail = 85 tokens）
   * @returns {number} 美分
   */
  estimateCostCents() {
    if (this.config.model?.startsWith('gpt-4o-mini')) {
      // 假设 prompt 200 tokens + image 85 tokens + output 150 tokens
      const inputCost = (285 / 1_000_000) * 15; // 美分
      const outputCost = (150 / 1_000_000) * 60;
      return Math.round((inputCost + outputCost) * 100) / 100;
    }
    if (this.config.model?.startsWith('gpt-4o')) {
      const inputCost = (285 / 1_000_000) * 250;
      const outputCost = (150 / 1_000_000) * 1000;
      return Math.round((inputCost + outputCost) * 100) / 100;
    }
    return 0;
  }
}

export default OpenAIProvider;
