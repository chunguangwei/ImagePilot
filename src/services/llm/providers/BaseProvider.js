/**
 * BaseProvider — LLM Provider 抽象基类
 *
 * 所有具体 Provider（OpenAI / Kimi / Ollama / Custom）必须继承本类。
 *
 * 设计原则：
 *   1. classify() 输入统一：base64 图片 + prompt + schema → 输出归一化 JSON
 *   2. 错误标准化：所有失败抛出 LLMProviderError（含 code/retryable）
 *   3. 平台无关：不直接用 node:fs / window 等专有 API
 */

export const LLMErrorCode = Object.freeze({
  NETWORK: 'NETWORK',
  TIMEOUT: 'TIMEOUT',
  AUTH: 'AUTH',
  RATE_LIMIT: 'RATE_LIMIT',
  SERVER: 'SERVER',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  CONFIG: 'CONFIG',
  VISION_UNSUPPORTED: 'VISION_UNSUPPORTED', // 模型不支持图像 → 提示用户换多模态模型
  UNKNOWN: 'UNKNOWN',
});

/**
 * 从错误响应文本判断是否「模型不支持图像/多模态」。各家措辞不同，做宽匹配。
 * 命中后 provider 应抛 VISION_UNSUPPORTED，引导用户切换多模态模型。
 * @param {string} bodyText 错误响应体文本
 * @returns {boolean}
 */
export function isVisionUnsupportedError(bodyText) {
  if (!bodyText) return false;
  const t = String(bodyText).toLowerCase();
  return (
    /does\s*not\s*support\s*image|image\s*input.*not|not.*support.*image|image_url|invalid.*modalit|multimodal.*not|vision.*not.*support|no.*image.*support|content.*type.*image.*not|不支持图|不支持图像|不支持多模态|无法处理图/.test(t)
  );
}

export class LLMProviderError extends Error {
  constructor(message, code = LLMErrorCode.UNKNOWN, retryable = false, cause = null, rawText = '') {
    super(message);
    this.name = 'LLMProviderError';
    this.code = code;
    this.retryable = retryable;
    this.cause = cause;
    // 模型原始文本：当返回非 JSON（如纯文本润色结果）解析失败时，上层纯文本诉求可回收它
    this.rawText = rawText;
  }
}

/**
 * @typedef {Object} ClassifyResult
 * @property {string} contentCategory  - single_person | social | pet | food | scenery | id_card | screenshot | qrcode | other
 * @property {string} colorTheme       - blue | green | red | yellow | black | white | warm | cold | mixed
 * @property {boolean} isScreenshot
 * @property {boolean} isIDCard
 * @property {number} confidence       - 0.0 ~ 1.0
 * @property {string} description      - 简短描述
 * @property {string} rawText          - 原始返回文本（调试用）
 * @property {number} costMs           - 本次调用耗时
 * @property {object} [tokens]         - { prompt, completion, total } 可选
 * @property {string} providerName
 * @property {string} model
 */

export class BaseProvider {
  /**
   * @param {Object} config
   * @param {string} config.baseURL
   * @param {string} config.model
   * @param {string} [config.apiKey]    - 已解密的 Key（由 LLMProviderService 解析 apiKeyRef 后注入）
   * @param {Object} [config.headersExtra]
   * @param {number} [config.timeoutMs] - 单次请求超时
   */
  constructor(config = {}) {
    if (new.target === BaseProvider) {
      throw new Error('BaseProvider is abstract. Use a concrete provider.');
    }
    this.config = {
      timeoutMs: 60000,
      headersExtra: {},
      ...config,
    };
    this.providerName = 'base';
  }

  /**
   * 单张图片分类
   * @param {string} imageBase64  - 不带 data: 前缀的 base64
   * @param {string} prompt       - 提示词
   * @param {object} schema       - JSON Schema（用于 ResponseValidator 校验，子类可忽略）
   * @returns {Promise<ClassifyResult>}
   */
  // eslint-disable-next-line no-unused-vars
  async classify(imageBase64, prompt, schema) {
    throw new LLMProviderError(
      `${this.providerName}.classify() not implemented`,
      LLMErrorCode.CONFIG,
      false,
    );
  }

  /**
   * 健康检查 / 连通性测试
   * 用途：配置页"测试连接"按钮
   * @returns {Promise<{ok: boolean, latencyMs: number, error?: string, model?: string}>}
   */
  async healthCheck() {
    const start = Date.now();
    try {
      // 默认实现：尝试一次最小调用（1x1 黑色像素）
      const tinyPng =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=';
      const result = await this.classify(tinyPng, 'Reply with {"ok":true} only.', {});
      return {
        ok: true,
        latencyMs: Date.now() - start,
        model: this.config.model,
        sample: result.rawText?.slice(0, 80),
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

  /**
   * 批量分类（默认实现 = 受控并发循环）
   * 子类如有 batch API 可覆写
   *
   * @param {Array<{imageBase64: string, id?: string}>} images
   * @param {string} prompt
   * @param {object} schema
   * @param {object} [opts]
   * @param {number} [opts.concurrent=3]
   * @param {(progress:{done:number,total:number,current:string})=>void} [opts.onProgress]
   * @returns {Promise<Array<{id?: string, ok: boolean, result?: ClassifyResult, error?: string}>>}
   */
  async classifyBatch(images, prompt, schema, opts = {}) {
    const concurrent = Math.max(1, opts.concurrent || 3);
    const onProgress = opts.onProgress || (() => {});
    const results = new Array(images.length);
    let cursor = 0;
    let done = 0;

    const worker = async () => {
      while (cursor < images.length) {
        const idx = cursor++;
        const item = images[idx];
        try {
          const r = await this.classify(item.imageBase64, prompt, schema);
          results[idx] = { id: item.id, ok: true, result: r };
        } catch (err) {
          results[idx] = { id: item.id, ok: false, error: err.message, code: err.code };
        }
        done++;
        onProgress({ done, total: images.length, current: item.id });
      }
    };

    await Promise.all(Array.from({ length: concurrent }, worker));
    return results;
  }

  /**
   * 估算单张图片的成本（美分）
   * 子类需要覆写以提供准确成本
   * @returns {number} 估算美分数（0 = 免费 / 本地）
   */
  // eslint-disable-next-line class-methods-use-this
  estimateCostCents() {
    return 0;
  }

  // ============ 工具方法（子类共享） ============

  /**
   * 带超时的 fetch
   * @protected
   */
  async _fetchWithTimeout(url, init = {}) {
    const timeoutMs = this.config.timeoutMs || 60000;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      const resp = await fetch(url, { ...init, signal: ctrl ? ctrl.signal : undefined });
      return resp;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new LLMProviderError(
          `Request timeout after ${timeoutMs}ms`,
          LLMErrorCode.TIMEOUT,
          true,
          err,
        );
      }
      throw new LLMProviderError(
        `Network error: ${err.message}`,
        LLMErrorCode.NETWORK,
        true,
        err,
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * 标准化 HTTP 错误
   * @protected
   */
  // eslint-disable-next-line class-methods-use-this
  _mapHttpError(status, body) {
    if (status === 401 || status === 403) {
      return new LLMProviderError(`Auth failed (${status}): ${body}`, LLMErrorCode.AUTH, false);
    }
    if (status === 429) {
      return new LLMProviderError(`Rate limited: ${body}`, LLMErrorCode.RATE_LIMIT, true);
    }
    if (status >= 500) {
      return new LLMProviderError(
        `Server error (${status}): ${body}`,
        LLMErrorCode.SERVER,
        true,
      );
    }
    return new LLMProviderError(
      `HTTP ${status}: ${body}`,
      LLMErrorCode.UNKNOWN,
      false,
    );
  }

  /**
   * 从模型回复中提取首个 JSON 对象（容错）
   * @protected
   */
  // eslint-disable-next-line class-methods-use-this
  _extractJSON(text) {
    if (!text) return null;
    // 直接尝试
    try {
      return JSON.parse(text);
    } catch (_) {
      // ignore
    }
    // 从 ```json ... ``` 中提取
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) {
      try {
        return JSON.parse(fence[1]);
      } catch (_) {
        // ignore
      }
    }
    // 找第一个 { ... }
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(text.slice(firstBrace, lastBrace + 1));
      } catch (_) {
        // ignore
      }
    }
    return null;
  }
}

export default BaseProvider;
