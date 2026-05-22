/**
 * KimiProvider — Moonshot AI（Kimi）
 *
 * Kimi 完全兼容 OpenAI Chat Completions 协议，仅 baseURL/model 不同。
 * 视觉模型：moonshot-v1-8k-vision-preview / moonshot-v1-32k-vision-preview
 *
 * 文档：https://platform.moonshot.cn/docs/api/chat
 */

import { OpenAIProvider } from './OpenAIProvider.js';

const KIMI_BASE_URL = 'https://api.moonshot.cn/v1';
const KIMI_DEFAULT_MODEL = 'moonshot-v1-8k-vision-preview';

export class KimiProvider extends OpenAIProvider {
  constructor(config = {}) {
    super({
      baseURL: KIMI_BASE_URL,
      model: KIMI_DEFAULT_MODEL,
      ...config,
    });
    this.providerName = 'kimi';
  }

  /**
   * Kimi 当前定价（截至 2024-Q4，以 ¥ 计）：
   *   moonshot-v1-8k-vision-preview: ¥12/M tokens（不区分 input/output）
   * 这里粗略折算为美分：¥1 ≈ 14 美分
   */
  estimateCostCents() {
    if (this.config.model?.includes('vision')) {
      const totalTokens = 285 + 150; // prompt + output
      const yuan = (totalTokens / 1_000_000) * 12;
      return Math.round(yuan * 14 * 100) / 100;
    }
    return 0;
  }
}

export default KimiProvider;
