/**
 * AIModelConfigController — 配置页共享业务逻辑（框架无关）
 *
 * 桌面（React DOM / Electron）与移动（React Native）两套视图复用同一份逻辑。
 * 视图通过 subscribe(listener) 订阅状态，调用 controller 的方法触发变更。
 *
 * 安全红线（务必遵守）：
 *   - 真实 API Key **永不进入可观察状态**，更不会回显到 UI。
 *     用户新输入的 Key 暂存在私有字段 _pendingKeys（不在 getState() 里），save() 时才落 SecureKeyStore。
 *   - 视图只能拿到 `hasKey`（是否已存在）与 `keyDirty`（本次是否改过），拿不到任何明文。
 *
 * 依赖（注入）：
 *   - configService：getAIProviderConfig / setActiveProvider / updateProviderConfig
 *   - keyStore：hasKey / setKey / removeKey
 *   - llmService：healthCheck(name) / listAvailableProviders() / invalidateCache()
 */

import { OpenAIProvider } from '../../services/llm/providers/OpenAIProvider.js';
import { KimiProvider } from '../../services/llm/providers/KimiProvider.js';
import { AnthropicProvider } from '../../services/llm/providers/AnthropicProvider.js';
import { GeminiProvider } from '../../services/llm/providers/GeminiProvider.js';
import { OllamaProvider } from '../../services/llm/providers/OllamaProvider.js';
import { CustomProvider } from '../../services/llm/providers/CustomProvider.js';

const PROVIDER_CLASSES = {
  openai: OpenAIProvider,
  kimi: KimiProvider,
  anthropic: AnthropicProvider,
  gemini: GeminiProvider,
  ollama: OllamaProvider,
  custom: CustomProvider,
};

/** 这些 Provider 需要 API Key（ollama 本地无需） */
const NEEDS_KEY = new Set(['openai', 'kimi', 'anthropic', 'gemini', 'custom']);

export class AIModelConfigController {
  constructor({ configService, keyStore, llmService }) {
    if (!configService || !keyStore || !llmService) {
      throw new Error('AIModelConfigController: configService / keyStore / llmService required');
    }
    this.configService = configService;
    this.keyStore = keyStore;
    this.llmService = llmService;

    this._listeners = new Set();
    this._pendingKeys = new Map(); // name -> plaintext（私有，绝不进 state）
    this._pendingKeyDeletes = new Set();

    this.state = {
      loading: true,
      saving: false,
      dirty: false,
      error: null,
      active: 'local-onnx',
      fallbackToLocal: true,
      promptLang: 'zh',
      available: [], // 当前平台可用的远程 provider 名
      providers: {}, // name -> { baseURL, model, hasKey, keyDirty, costCents, needsKey }
      test: {}, // name -> { status, latencyMs?, error?, model? }
    };
  }

  // ---------- 订阅 ----------
  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  getState() {
    return this.state;
  }

  _set(patch) {
    this.state = { ...this.state, ...patch };
    for (const l of this._listeners) l(this.state);
  }

  _setProvider(name, patch) {
    const providers = {
      ...this.state.providers,
      [name]: { ...(this.state.providers[name] || {}), ...patch },
    };
    this._set({ providers });
  }

  // ---------- 加载 ----------
  async load() {
    this._set({ loading: true, error: null });
    try {
      const cfg = await this.configService.getAIProviderConfig();
      const available = this.llmService.listAvailableProviders();

      const providers = {};
      for (const name of Object.keys(PROVIDER_CLASSES)) {
        const pc = cfg.providers?.[name] || {};
        const hasKey = NEEDS_KEY.has(name) && pc.apiKeyRef ? await this.keyStore.hasKey(pc.apiKeyRef) : false;
        providers[name] = {
          baseURL: pc.baseURL || '',
          model: pc.model || '',
          headersExtra: pc.headersExtra || {},
          apiKeyRef: pc.apiKeyRef || `kc:${name}_key`,
          needsKey: NEEDS_KEY.has(name),
          hasKey,
          keyDirty: false,
          costCents: this._estimateCost(name, pc),
        };
      }

      this._pendingKeys.clear();
      this._pendingKeyDeletes.clear();
      this._set({
        loading: false,
        dirty: false,
        active: cfg.active || 'local-onnx',
        fallbackToLocal: cfg.fallbackToLocal !== false,
        promptLang: cfg.promptLang || 'zh',
        available,
        providers,
        test: {},
      });
    } catch (err) {
      this._set({ loading: false, error: err.message });
    }
  }

  // ---------- 编辑（仅改 draft，save 才落盘） ----------
  selectActive(name) {
    this._set({ active: name, dirty: true });
  }

  setFallbackToLocal(value) {
    this._set({ fallbackToLocal: !!value, dirty: true });
  }

  setPromptLang(lang) {
    this._set({ promptLang: lang === 'en' ? 'en' : 'zh', dirty: true });
  }

  updateProvider(name, patch) {
    const { apiKey, apiKeyRef, ...safe } = patch; // 防御：禁止从这条路径写 Key
    const next = { ...(this.state.providers[name] || {}), ...safe };
    next.costCents = this._estimateCost(name, next);
    this._setProvider(name, next);
    this._set({ dirty: true });
  }

  /** 用户输入新 Key：暂存私有 Map，state 只标记 keyDirty=true（绝不存明文） */
  setApiKey(name, value) {
    if (typeof value !== 'string') return;
    if (value.length === 0) {
      this._pendingKeys.delete(name);
      this._setProvider(name, { keyDirty: false });
    } else {
      this._pendingKeys.set(name, value);
      this._pendingKeyDeletes.delete(name);
      this._setProvider(name, { keyDirty: true });
    }
    this._set({ dirty: true });
  }

  /** 清除已保存的 Key（标记删除，save 时执行） */
  clearApiKey(name) {
    this._pendingKeys.delete(name);
    this._pendingKeyDeletes.add(name);
    this._setProvider(name, { keyDirty: true, hasKey: false });
    this._set({ dirty: true });
  }

  // ---------- 测试连接 ----------
  /**
   * 测试某 provider 的连通性。
   * 注意：会先把该 provider 的 baseURL/model 与（若有）新输入的 Key 落盘，
   * 以便 llmService.healthCheck 用最新值测试；但**不会**改变 active 选择（save 才生效）。
   */
  async testConnection(name) {
    this._set({ test: { ...this.state.test, [name]: { status: 'testing' } } });
    try {
      await this._persistProvider(name); // 含 flush pending key（仅该 provider）
      this.llmService.invalidateCache();
      const r = await this.llmService.healthCheck(name);
      // 刷新 hasKey（可能刚写入）
      const p = this.state.providers[name];
      const hasKey = p?.needsKey ? await this.keyStore.hasKey(p.apiKeyRef) : false;
      this._setProvider(name, { hasKey, keyDirty: false });
      this._pendingKeys.delete(name);
      this._set({
        test: {
          ...this.state.test,
          [name]: r.ok
            ? { status: 'ok', latencyMs: r.latencyMs, model: r.model }
            : { status: 'fail', error: r.error, latencyMs: r.latencyMs },
        },
      });
      return r;
    } catch (err) {
      this._set({ test: { ...this.state.test, [name]: { status: 'fail', error: err.message } } });
      return { ok: false, error: err.message };
    }
  }

  // ---------- 保存 ----------
  async save() {
    this._set({ saving: true, error: null });
    try {
      for (const name of Object.keys(PROVIDER_CLASSES)) {
        await this._persistProvider(name);
      }
      await this.configService.setActiveProvider(this.state.active);
      // fallbackToLocal / promptLang 通过 updateProviderConfig 之外的途径，这里直接合并写：
      await this._persistTopLevel();
      this.llmService.invalidateCache();
      this._pendingKeys.clear();
      this._pendingKeyDeletes.clear();
      this._set({ saving: false, dirty: false });
      // 重新加载以刷新 hasKey 等派生态
      await this.load();
      return { ok: true };
    } catch (err) {
      this._set({ saving: false, error: err.message });
      return { ok: false, error: err.message };
    }
  }

  // ---------- 内部 ----------
  async _persistProvider(name) {
    const p = this.state.providers[name];
    if (!p) return;
    await this.configService.updateProviderConfig(name, {
      baseURL: p.baseURL,
      model: p.model,
      headersExtra: p.headersExtra,
      apiKeyRef: p.apiKeyRef,
    });
    if (this._pendingKeyDeletes.has(name)) {
      await this.keyStore.removeKey(p.apiKeyRef);
      this._pendingKeyDeletes.delete(name);
    }
    if (this._pendingKeys.has(name)) {
      await this.keyStore.setKey(p.apiKeyRef, this._pendingKeys.get(name));
      this._pendingKeys.delete(name);
    }
  }

  async _persistTopLevel() {
    // 复用 configService 的能力：若提供 setAIProviderTopLevel 则用之，否则尽力合并
    if (typeof this.configService.setAIProviderTopLevel === 'function') {
      await this.configService.setAIProviderTopLevel({
        fallbackToLocal: this.state.fallbackToLocal,
        promptLang: this.state.promptLang,
      });
    } else if (typeof this.configService.set === 'function') {
      const cfg = await this.configService.getAIProviderConfig();
      cfg.fallbackToLocal = this.state.fallbackToLocal;
      cfg.promptLang = this.state.promptLang;
      await this.configService.set('aiProvider', cfg);
      await this.configService.save?.();
    }
  }

  /** 用真实 Provider 类估算单图成本（美分）；-1=未知，0=免费/本地 */
  _estimateCost(name, pc) {
    if (name === 'ollama') return 0;
    const Cls = PROVIDER_CLASSES[name];
    if (!Cls) return -1;
    try {
      const inst = new Cls({ baseURL: pc.baseURL || 'https://x', model: pc.model || 'x', apiKey: 'x' });
      return inst.estimateCostCents();
    } catch (_) {
      return -1;
    }
  }
}

export default AIModelConfigController;
