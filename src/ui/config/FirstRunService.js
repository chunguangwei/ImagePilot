/**
 * FirstRunService — 首次启动引导决策（框架无关）
 *
 * 策略（隐私优先，对应计划 Week 3）：
 *   - 全新安装默认 active = 'local-onnx'：开箱即用、完全离线、零成本。
 *   - 首次进入时弹一次引导：说明「已默认本地分类，可选配置云端 LLM」。
 *   - 用户选择「保持本地」或「去配置云端」后写入 onboarded 标记，不再弹。
 *
 * 标记存放在 aiProvider.onboarded（boolean）。
 */

export class FirstRunService {
  /**
   * @param {Object} deps
   * @param {Object} deps.configService - getAIProviderConfig + (set/save 或 setAIProviderTopLevel)
   */
  constructor({ configService }) {
    if (!configService) throw new Error('FirstRunService: configService required');
    this.configService = configService;
  }

  /** 是否需要展示引导（未 onboarded 即需要） */
  async needsOnboarding() {
    const cfg = await this.configService.getAIProviderConfig();
    return cfg.onboarded !== true;
  }

  /**
   * 返回引导页所需的展示数据（不含任何敏感信息）。
   */
  async getGuide() {
    const cfg = await this.configService.getAIProviderConfig();
    return {
      defaultActive: cfg.active || 'local-onnx',
      title: '欢迎使用 ImagePilot',
      body:
        '已默认启用「本地分类」：完全离线、不上传图片、零成本。\n' +
        '如需更强的理解能力，可在「AI 模型设置」里配置你自己的云端 LLM（OpenAI / Kimi / 自定义）。',
      options: [
        { id: 'keep-local', label: '保持本地分类', active: 'local-onnx' },
        { id: 'configure-cloud', label: '去配置云端 LLM', navigateTo: 'AIModelConfig' },
      ],
    };
  }

  /**
   * 完成引导：写 onboarded=true，并按选择可能切换 active。
   * @param {{active?: string}} [choice]
   */
  async complete(choice = {}) {
    await this._mergeTopLevel({
      onboarded: true,
      ...(choice.active ? { active: choice.active } : {}),
    });
    return { ok: true };
  }

  /** 重置引导（测试 / 设置页「重新查看引导」用） */
  async reset() {
    await this._mergeTopLevel({ onboarded: false });
  }

  async _mergeTopLevel(patch) {
    if (typeof this.configService.setAIProviderTopLevel === 'function') {
      await this.configService.setAIProviderTopLevel(patch);
      return;
    }
    const cfg = await this.configService.getAIProviderConfig();
    Object.assign(cfg, patch);
    await this.configService.set?.('aiProvider', cfg);
    await this.configService.save?.();
  }
}

export default FirstRunService;
