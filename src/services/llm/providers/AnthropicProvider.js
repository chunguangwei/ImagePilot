/**
 * AnthropicProvider — Claude（Anthropic Messages API，视觉）
 *
 * 与 OpenAI 线格式不同（参考本地 LLMWiKi 的 toAnthropicContent / buildAnthropicBody）：
 *   - 端点：/v1/messages（非 /chat/completions）
 *   - 鉴权：x-api-key 头 + anthropic-version（非 Authorization: Bearer）
 *   - 图片：content 块 { type:'image', source:{ type:'base64', media_type, data } }
 *   - 必填 max_tokens；返回在 content[].text
 *
 * 本实现走非流式（stream 省略），用提示词约束输出 JSON，再 _extractJSON 容错解析。
 */

import { BaseProvider, LLMProviderError, LLMErrorCode, isVisionUnsupportedError } from './BaseProvider.js';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_MODEL = 'claude-3-5-sonnet-latest';
const ANTHROPIC_VERSION = '2023-06-01';
const VISION_HINT =
  '当前模型不支持图像识别，请在设置里改用多模态模型（如 Claude 3.5 / OpenAI gpt-4o / Gemini 1.5）。';

export class AnthropicProvider extends BaseProvider {
  constructor(config = {}) {
    super({ baseURL: DEFAULT_BASE_URL, model: DEFAULT_MODEL, ...config });
    this.providerName = 'anthropic';
    if (!this.config.apiKey) this._authMissing = true;
  }

  /** 构造 /v1/messages URL，兼容用户粘贴的多种 base 形态（参考 LLMWiKi buildAnthropicUrl） */
  _buildUrl() {
    const trimmed = (this.config.baseURL || '').replace(/\/+$/, '');
    if (/\/v\d+\/messages$/i.test(trimmed)) return trimmed;
    if (/\/v\d+$/i.test(trimmed)) return `${trimmed}/messages`;
    return `${trimmed}/v1/messages`;
  }

  _buildHeaders() {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      // 桌面/Web（Electron renderer）直连 Anthropic 需此头放开浏览器访问
      'anthropic-dangerous-direct-browser-access': 'true',
      ...this.config.headersExtra,
    };
  }

  _buildBody(imageBase64, prompt) {
    const data = imageBase64.startsWith('data:') ? imageBase64.split(',')[1] : imageBase64;
    return {
      model: this.config.model,
      max_tokens: 1024,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
          ],
        },
      ],
    };
  }

  async classify(imageBase64, prompt /*, schema */) {
    if (this._authMissing) {
      throw new LLMProviderError(`${this.providerName}: apiKey is required`, LLMErrorCode.AUTH, false);
    }
    const start = Date.now();
    const resp = await this._fetchWithTimeout(this._buildUrl(), {
      method: 'POST',
      headers: this._buildHeaders(),
      body: JSON.stringify(this._buildBody(imageBase64, prompt)),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      if (isVisionUnsupportedError(text)) {
        throw new LLMProviderError(VISION_HINT, LLMErrorCode.VISION_UNSUPPORTED, false);
      }
      throw this._mapHttpError(resp.status, text);
    }

    let data;
    try {
      data = await resp.json();
    } catch (err) {
      throw new LLMProviderError(`Failed to parse JSON: ${err.message}`, LLMErrorCode.INVALID_RESPONSE, true, err);
    }

    // Anthropic 返回 content: [{ type:'text', text }]
    const block = Array.isArray(data?.content) ? data.content.find((b) => b.type === 'text') : null;
    const content = block?.text;
    if (!content) {
      throw new LLMProviderError('Empty content in Anthropic response', LLMErrorCode.INVALID_RESPONSE, true);
    }
    const parsed = this._extractJSON(content);
    if (!parsed) {
      throw new LLMProviderError(`Cannot parse JSON from response: ${content.slice(0, 200)}`, LLMErrorCode.INVALID_RESPONSE, true);
    }
    return {
      contentCategory: parsed.contentCategory || 'other',
      colorTheme: parsed.colorTheme || 'mixed',
      isScreenshot: !!parsed.isScreenshot,
      isIDCard: !!parsed.isIDCard,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      semanticLabel: typeof parsed.semanticLabel === 'string' ? parsed.semanticLabel : '',
      description: parsed.description || '',
      rawText: content,
      costMs: Date.now() - start,
      tokens: data?.usage
        ? { prompt: data.usage.input_tokens, completion: data.usage.output_tokens, total: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0) }
        : undefined,
      providerName: this.providerName,
      model: this.config.model,
    };
  }

  estimateCostCents() {
    // claude-3-5-sonnet ≈ $3/M in + $15/M out（美分）；估 prompt 300 + image ~1.2k + out 150
    if (/sonnet/i.test(this.config.model || '')) {
      const inCost = (1500 / 1_000_000) * 300;
      const outCost = (150 / 1_000_000) * 1500;
      return Math.round((inCost + outCost) * 100) / 100;
    }
    return 0; // haiku 等更便宜，未细算
  }
}

export default AnthropicProvider;
