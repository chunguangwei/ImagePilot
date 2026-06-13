/**
 * GeminiProvider — Google Gemini（generativelanguage API，视觉）
 *
 * 与 OpenAI 线格式不同（参考本地 LLMWiKi 的 toGoogleParts / buildGoogleBody）：
 *   - 端点：/v1beta/models/<model>:generateContent（非流式）
 *   - 鉴权：x-goog-api-key 头
 *   - 图片：parts: [{ text }, { inline_data: { mime_type, data } }]
 *   - 采样参数放 generationConfig；JSON 用 responseMimeType: 'application/json'
 *   - 返回在 candidates[0].content.parts[].text
 */

import { BaseProvider, LLMProviderError, LLMErrorCode, isVisionUnsupportedError } from './BaseProvider.js';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-1.5-flash';
const VISION_HINT =
  '当前模型不支持图像识别，请在设置里改用多模态模型（如 Gemini 1.5 / OpenAI gpt-4o / Claude 3.5）。';

export class GeminiProvider extends BaseProvider {
  constructor(config = {}) {
    super({ baseURL: DEFAULT_BASE_URL, model: DEFAULT_MODEL, ...config });
    this.providerName = 'gemini';
    if (!this.config.apiKey) this._authMissing = true;
  }

  _buildUrl() {
    const base = (this.config.baseURL || DEFAULT_BASE_URL).replace(/\/+$/, '');
    // 用户可能直接粘贴到 /models 前缀；统一拼到 :generateContent
    const model = encodeURIComponent(this.config.model || DEFAULT_MODEL);
    if (/:generateContent$/i.test(base)) return base;
    return `${base}/models/${model}:generateContent`;
  }

  _buildHeaders() {
    return {
      'Content-Type': 'application/json',
      'x-goog-api-key': this.config.apiKey,
      ...this.config.headersExtra,
    };
  }

  _buildBody(imageBase64, prompt) {
    const data = imageBase64.startsWith('data:') ? imageBase64.split(',')[1] : imageBase64;
    return {
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inline_data: { mime_type: 'image/jpeg', data } },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
      },
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

    const parts = data?.candidates?.[0]?.content?.parts;
    const content = Array.isArray(parts) ? parts.map((p) => p.text || '').join('') : '';
    if (!content) {
      throw new LLMProviderError('Empty content in Gemini response', LLMErrorCode.INVALID_RESPONSE, true);
    }
    const parsed = this._extractJSON(content);
    if (!parsed) {
      throw new LLMProviderError(`Cannot parse JSON from response: ${content.slice(0, 200)}`, LLMErrorCode.INVALID_RESPONSE, true, null, content);
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
      providerName: this.providerName,
      model: this.config.model,
    };
  }

  estimateCostCents() {
    // gemini-1.5-flash 极廉价，单图远 < 1 美分
    if (/flash/i.test(this.config.model || '')) return 0.02;
    return 0;
  }
}

export default GeminiProvider;
