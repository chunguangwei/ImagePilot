/**
 * LLMProviderService — Provider 路由 Facade
 *
 * 上层（ImageClassifierService）只与本类交互，不直接 new Provider。
 *
 * 职责：
 *   1. 根据 ConfigService.aiProvider.active 路由到具体 Provider
 *   2. 解析 apiKeyRef → 从 SecureKeyStore 拿真实 Key
 *   3. 平台守卫（Ollama 仅 PC）
 *   4. 提供 classify/classifyBatch/healthCheck/listAvailableProviders 统一入口
 *   5. 与 ResponseValidator 配合：1 次重试 + fallbackToLocal
 *
 * 不负责：
 *   - 本地 ONNX 推理（由 LocalClassifierService 处理，Week 2 落地）
 *   - 图片预处理（resize / base64）（由 ImageClassifierService 处理）
 */

import { OpenAIProvider } from './providers/OpenAIProvider.js';
import { KimiProvider } from './providers/KimiProvider.js';
import { CustomProvider } from './providers/CustomProvider.js';
import { OllamaProvider } from './providers/OllamaProvider.js';
import { AnthropicProvider } from './providers/AnthropicProvider.js';
import { GeminiProvider } from './providers/GeminiProvider.js';
import { LLMProviderError, LLMErrorCode } from './providers/BaseProvider.js';
import { ResponseValidator } from './ResponseValidator.js';

const PROVIDER_REGISTRY = {
  openai: OpenAIProvider,
  kimi: KimiProvider,
  custom: CustomProvider,
  ollama: OllamaProvider,
  anthropic: AnthropicProvider,
  gemini: GeminiProvider,
  // 'local-onnx' 不在此注册——它由 LocalClassifierService 处理
};

export class LLMProviderService {
  /**
   * @param {object} deps
   * @param {object} deps.configService    - 提供 getAIProviderConfig()
   * @param {object} deps.keyStore         - SecureKeyStore 实例
   * @param {object} [deps.localClassifier] - 用于 fallbackToLocal（Week 2 注入）
   * @param {string} [deps.platform]       - 'pc' | 'ios' | 'android'
   * @param {object} [deps.validator]      - ResponseValidator 实例（默认自动创建）
   */
  constructor({ configService, keyStore, localClassifier, platform, validator }) {
    if (!configService) throw new Error('LLMProviderService: configService required');
    if (!keyStore) throw new Error('LLMProviderService: keyStore required');
    this.configService = configService;
    this.keyStore = keyStore;
    this.localClassifier = localClassifier || null;
    this.platform = platform || detectPlatform();
    this.validator = validator || new ResponseValidator();
    this._providerCache = new Map(); // 配置签名 -> Provider 实例
  }

  /**
   * 获取当前激活 Provider 实例（带缓存）
   */
  async getActiveProvider() {
    const cfg = await this.configService.getAIProviderConfig();
    const active = cfg.active || 'local-onnx';

    if (active === 'local-onnx') {
      return null; // 上层走本地推理
    }

    const ProviderCls = PROVIDER_REGISTRY[active];
    if (!ProviderCls) {
      throw new LLMProviderError(
        `Unknown provider: ${active}`,
        LLMErrorCode.CONFIG,
        false,
      );
    }

    // 平台守卫
    if (ProviderCls.isPlatformSupported && !ProviderCls.isPlatformSupported(this.platform)) {
      throw new LLMProviderError(
        `Provider "${active}" is not supported on platform "${this.platform}"`,
        LLMErrorCode.CONFIG,
        false,
      );
    }

    const providerCfg = cfg.providers[active] || {};
    const apiKey = providerCfg.apiKeyRef
      ? await this.keyStore.getKey(providerCfg.apiKeyRef)
      : undefined;

    const sig = `${active}|${providerCfg.baseURL}|${providerCfg.model}|${apiKey ? 'k' : 'nk'}`;
    if (this._providerCache.has(sig)) {
      return this._providerCache.get(sig);
    }

    const instance = new ProviderCls({
      baseURL: providerCfg.baseURL,
      model: providerCfg.model,
      apiKey,
      headersExtra: providerCfg.headersExtra || {},
      timeoutMs: cfg.remoteTimeoutMs || 60000,
    });

    this._providerCache.set(sig, instance);
    return instance;
  }

  /**
   * 单图分类（含校验 + 1 次重试 + fallbackToLocal）
   * @param {string} imageBase64
   * @param {string} prompt
   * @returns {Promise<{source: 'remote'|'local', result: object}>}
   */
  async classify(imageBase64, prompt) {
    const cfg = await this.configService.getAIProviderConfig();
    const provider = await this.getActiveProvider();

    if (!provider) {
      // active = 'local-onnx'
      return this._classifyLocal(imageBase64);
    }

    try {
      const result = await this._classifyWithRetry(provider, imageBase64, prompt);
      return { source: 'remote', result };
    } catch (err) {
      if (cfg.fallbackToLocal && this.localClassifier) {
        // eslint-disable-next-line no-console
        console.warn('[LLMProviderService] Remote failed, falling back to local:', err.message);
        return this._classifyLocal(imageBase64, err);
      }
      throw err;
    }
  }

  /**
   * 批量分类（统一入口）
   */
  async classifyBatch(images, prompt, opts = {}) {
    const provider = await this.getActiveProvider();
    if (!provider) {
      // 本地批量
      const results = [];
      for (const item of images) {
        results.push(await this._classifyLocal(item.imageBase64));
      }
      return results;
    }
    const cfg = await this.configService.getAIProviderConfig();
    const concurrent = opts.concurrent || cfg.concurrent || 3;
    return provider.classifyBatch(images, prompt, null, { ...opts, concurrent });
  }

  /**
   * 健康检查（用于配置页"测试连接"按钮）
   */
  async healthCheck(providerName) {
    const cfg = await this.configService.getAIProviderConfig();
    const target = providerName || cfg.active;
    if (target === 'local-onnx') {
      return { ok: true, latencyMs: 0, model: 'local-onnx' };
    }
    const ProviderCls = PROVIDER_REGISTRY[target];
    if (!ProviderCls) {
      return { ok: false, error: `Unknown provider: ${target}` };
    }
    if (ProviderCls.isPlatformSupported && !ProviderCls.isPlatformSupported(this.platform)) {
      return { ok: false, error: `Not supported on ${this.platform}` };
    }
    const providerCfg = cfg.providers[target] || {};
    const apiKey = providerCfg.apiKeyRef
      ? await this.keyStore.getKey(providerCfg.apiKeyRef)
      : undefined;
    const instance = new ProviderCls({
      baseURL: providerCfg.baseURL,
      model: providerCfg.model,
      apiKey,
      headersExtra: providerCfg.headersExtra || {},
      timeoutMs: 15000, // healthCheck 用更短的超时
    });
    return instance.healthCheck();
  }

  /**
   * 列出当前平台可用的 Provider
   */
  listAvailableProviders() {
    return Object.entries(PROVIDER_REGISTRY)
      .filter(([, Cls]) => !Cls.isPlatformSupported || Cls.isPlatformSupported(this.platform))
      .map(([name]) => name);
  }

  /**
   * 估算成本（美分）
   */
  async estimateCost() {
    const provider = await this.getActiveProvider();
    if (!provider) return 0;
    return provider.estimateCostCents();
  }

  // ============ 内部 ============

  async _classifyWithRetry(provider, imageBase64, prompt) {
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await provider.classify(imageBase64, prompt);
        // 校验
        const validation = this.validator.validate(result);
        if (validation.ok) {
          return result;
        }
        lastErr = new LLMProviderError(
          `Schema validation failed: ${validation.errors}`,
          LLMErrorCode.INVALID_RESPONSE,
          true,
        );
      } catch (err) {
        lastErr = err;
        if (!err.retryable) throw err;
      }
    }
    throw lastErr;
  }

  async _classifyLocal(imageBase64, prevError) {
    if (!this.localClassifier) {
      throw new LLMProviderError(
        prevError
          ? `Remote failed and no local classifier configured. Original error: ${prevError.message}`
          : 'Local classifier not configured',
        LLMErrorCode.CONFIG,
        false,
        prevError,
      );
    }
    const result = await this.localClassifier.classify(imageBase64);
    return { source: 'local', result };
  }

  /** 清空 Provider 实例缓存（配置变更时调用） */
  invalidateCache() {
    this._providerCache.clear();
  }
}

function detectPlatform() {
  if (typeof process !== 'undefined' && process?.versions?.electron) return 'pc';
  if (typeof navigator !== 'undefined' && navigator.product === 'ReactNative') {
    // 进一步细分由调用方注入
    return 'mobile';
  }
  if (typeof window !== 'undefined') return 'pc';
  return 'unknown';
}

export default LLMProviderService;
