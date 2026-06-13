/**
 * OllamaProvider — 本地 Ollama 服务
 *
 * 仅 PC 平台可用（移动端无法运行 Ollama）。
 * 默认 endpoint: http://localhost:11434
 * 推荐模型: qwen2.5vl:7b（中文视觉效果较好）/ llava:13b
 *
 * 文档：https://github.com/ollama/ollama/blob/main/docs/api.md
 *
 * 协议差异（与 OpenAI）：
 *   - 端点：/api/chat（不是 /chat/completions）
 *   - 图片：messages[].images 数组（base64 字符串，无 data: 前缀）
 *   - 流式默认 stream=true，需显式设 false
 */

import { BaseProvider, LLMProviderError, LLMErrorCode } from './BaseProvider.js';

const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'qwen2.5vl:7b';

export class OllamaProvider extends BaseProvider {
  constructor(config = {}) {
    super({
      baseURL: DEFAULT_BASE_URL,
      model: DEFAULT_MODEL,
      timeoutMs: 120000, // 本地推理可能更慢
      ...config,
    });
    this.providerName = 'ollama';
  }

  /**
   * Ollama 仅 PC 可用，调用前的平台守卫
   * 由 LLMProviderService 的 createProvider() 在创建时调用
   */
  static isPlatformSupported(platform) {
    return platform === 'pc' || platform === 'electron' || platform === 'desktop';
  }

  async classify(imageBase64, prompt /*, schema */) {
    const start = Date.now();
    const url = `${this.config.baseURL.replace(/\/+$/, '')}/api/chat`;

    // Ollama 要求 base64 不带 data: 前缀
    const cleanBase64 = imageBase64.startsWith('data:')
      ? imageBase64.split(',')[1]
      : imageBase64;

    const body = {
      model: this.config.model,
      messages: [
        {
          role: 'user',
          content: prompt,
          images: [cleanBase64],
        },
      ],
      stream: false,
      format: 'json',
      options: {
        temperature: 0,
        num_predict: 300,
      },
    };

    const resp = await this._fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.config.headersExtra },
      body: JSON.stringify(body),
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
        `Failed to parse Ollama response: ${err.message}`,
        LLMErrorCode.INVALID_RESPONSE,
        true,
        err,
      );
    }

    const content = data?.message?.content;
    if (!content) {
      throw new LLMProviderError(
        'Empty content in Ollama response',
        LLMErrorCode.INVALID_RESPONSE,
        true,
      );
    }

    const parsed = this._extractJSON(content);
    if (!parsed) {
      throw new LLMProviderError(
        `Cannot parse JSON from Ollama: ${content.slice(0, 200)}`,
        LLMErrorCode.INVALID_RESPONSE,
        true,
        null,
        content,
      );
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

  /**
   * 健康检查覆写 —— 先 ping /api/tags 确认服务是否启动
   */
  async healthCheck() {
    const start = Date.now();
    try {
      const url = `${this.config.baseURL.replace(/\/+$/, '')}/api/tags`;
      const resp = await this._fetchWithTimeout(url, { method: 'GET' });
      if (!resp.ok) {
        return {
          ok: false,
          latencyMs: Date.now() - start,
          error: `Ollama server returned ${resp.status}. Is ollama running?`,
        };
      }
      const data = await resp.json();
      const models = (data?.models || []).map((m) => m.name);
      const hasModel = models.some((m) => m === this.config.model || m.startsWith(this.config.model.split(':')[0]));
      if (!hasModel) {
        return {
          ok: false,
          latencyMs: Date.now() - start,
          error: `Model "${this.config.model}" not found. Run: ollama pull ${this.config.model}`,
          availableModels: models,
        };
      }
      return {
        ok: true,
        latencyMs: Date.now() - start,
        model: this.config.model,
        availableModels: models,
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: err.message,
        code: err.code,
      };
    }
  }

  estimateCostCents() {
    return 0; // 本地免费
  }
}

export default OllamaProvider;
