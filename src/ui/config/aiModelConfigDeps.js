/**
 * aiModelConfigDeps — 为 AIModelConfigScreen 装配它需要的 deps
 *
 * 关键：这里用的 keyStore / configService 必须与 GalleryScannerService 在线分类路径
 * 用的是**同一实例**（keyStoreSingleton + UnifiedDataConfigService 默认导出），
 * 否则用户在配置页存的 API Key，扫描分类时读不到。
 *
 * platform 不传 → LLMProviderService 内部 detectPlatform 自动判定
 * （RN→mobile 隐藏 Ollama，Electron→pc 显示 Ollama）。
 */

import { LLMProviderService } from '../../services/llm/LLMProviderService.js';
import configService from '../../services/llm/adapters/UnifiedDataConfigService.js';
import keyStore from '../../services/llm/keyStoreSingleton.js';

let _deps = null;

export function makeAIModelConfigDeps() {
  if (_deps) return _deps; // 单例：保证 deps 引用稳定，避免每次渲染重建 controller
  const llmService = new LLMProviderService({ configService, keyStore });
  _deps = { configService, keyStore, llmService };
  return _deps;
}

export default makeAIModelConfigDeps;
