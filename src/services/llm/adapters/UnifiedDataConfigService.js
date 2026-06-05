/**
 * UnifiedDataConfigService — 把 LLM Provider 配置接到本仓库真实的「用户设置」存储
 *
 * 关键事实（本仓库实测）：
 *   - 只读静态配置在 ConfigService（public/initialSettings.json），**不可写**。
 *   - 用户可写设置走 UnifiedDataService.readSettings()(L1329) / writeSettings()(L1344)
 *     → 底层 imageStorageService.saveSettings（移动端 AsyncStorage / PC 端持久化）。
 *
 * 本适配器在 settings.aiProvider 节点下读写 LLM 配置，向 LLMProviderService /
 * AIModelConfigController 暴露它们期望的 getAIProviderConfig / setActiveProvider /
 * updateProviderConfig / setAIProviderTopLevel 接口。apiKey 一律不进此处（走 SecureKeyStore）。
 */

import UnifiedDataService from '../../UnifiedDataService.js';

const DEFAULTS = {
  active: 'local-onnx',
  onboarded: false,
  fallbackToLocal: true,
  remoteTimeoutMs: 60000,
  concurrent: 3,
  promptLang: 'zh',
  providers: {
    openai: { baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKeyRef: 'kc:openai_key' },
    kimi: { baseURL: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k-vision-preview', apiKeyRef: 'kc:kimi_key' },
    anthropic: { baseURL: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-latest', apiKeyRef: 'kc:anthropic_key' },
    gemini: { baseURL: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-1.5-flash', apiKeyRef: 'kc:gemini_key' },
    ollama: { baseURL: 'http://localhost:11434', model: 'qwen2.5vl:7b' },
    custom: { baseURL: '', model: '', apiKeyRef: 'kc:custom_key', headersExtra: {} },
  },
  promptOverride: null,
  customCategories: [], // [{ id, name, rule }]，A 方案：LLM 按规则归入自定义分类
  hiddenBuiltinCategories: [], // 被用户「删除」的内置分类 id；从展示与分类器候选集中剔除，可一键恢复
};

export class UnifiedDataConfigService {
  constructor(dataService = UnifiedDataService) {
    this.data = dataService;
  }

  async getAIProviderConfig() {
    const settings = (await this.data.readSettings()) || {};
    const cfg = settings.aiProvider || {};
    return {
      ...DEFAULTS,
      ...cfg,
      providers: { ...DEFAULTS.providers, ...(cfg.providers || {}) },
      onboarded: cfg.onboarded === true,
      fallbackToLocal: cfg.fallbackToLocal !== false,
    };
  }

  async setActiveProvider(active) {
    await this._mergeTopLevel({ active });
  }

  async updateProviderConfig(name, patch) {
    const { apiKey, ...safe } = patch; // 防御：明文 Key 绝不入设置
    const settings = (await this.data.readSettings()) || {};
    const ap = settings.aiProvider || {};
    ap.providers = { ...(ap.providers || {}) };
    ap.providers[name] = { ...(ap.providers[name] || {}), ...safe };
    settings.aiProvider = ap;
    await this.data.writeSettings(settings);
  }

  async setAIProviderTopLevel(patch = {}) {
    const { apiKey, ...safe } = patch;
    await this._mergeTopLevel(safe);
  }

  /** 设置自定义分类列表 [{ id, name, rule }] */
  async setCustomCategories(list) {
    await this._mergeTopLevel({ customCategories: Array.isArray(list) ? list : [] });
  }

  /** 设置「已删除的内置分类」id 列表（空数组＝恢复全部默认分类） */
  async setHiddenBuiltinCategories(list) {
    const clean = Array.isArray(list)
      ? Array.from(new Set(list.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())))
      : [];
    await this._mergeTopLevel({ hiddenBuiltinCategories: clean });
  }

  async _mergeTopLevel(patch) {
    const settings = (await this.data.readSettings()) || {};
    settings.aiProvider = { ...(settings.aiProvider || {}), ...patch };
    await this.data.writeSettings(settings);
  }
}

export default new UnifiedDataConfigService();
