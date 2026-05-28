/**
 * wireLLMRouting — 云端 LLM 批量分类（GalleryScannerService 节点2 的云端分支）
 *
 * 设计：本模块由 GalleryScannerService 通过**动态 import()** 加载，因此它的所有
 * 依赖（LLMProviderService / providers / ResponseValidator …）只在用户真正选择
 * 云端 Provider 时才进入运行时——`active=local-onnx` 的默认路径完全不受影响。
 *
 * 职责：把已转好 base64 的 inputs 交给 LLMProviderService.classifyBatch，再把结果
 * **适配回原 batchClassifyRemote 的 batchResult 形状**，使下游节点3（结果处理/落库）
 * 无需任何改动。分类映射复用 categoryMapper（schema 枚举 → App 分类 ID）。
 *
 * 与骨架仓库 remoteClassifyRouter 的云端分支逻辑一致（该逻辑已在 ImagePilot 骨架单测覆盖）。
 */

import { LLMProviderService } from './LLMProviderService.js';
import unifiedDataConfigService from './adapters/UnifiedDataConfigService.js';
import { createLocalOnnxRunner, localMapper } from './adapters/localOnnxRunner.js';
import { LocalClassifierService } from '../LocalClassifierService.js';
import keyStore from './keyStoreSingleton.js';
import { mapSchemaCategoryToApp } from './adapters/categoryMapper.js';
import { buildClassificationPrompt, resolveAppCategory } from './customCategories.js';

// 中/英分类提示词（与 prompts/classification.*.txt 保持一致；内联以避开 .txt 打包差异）
//
// 设计：先让多模态模型"看图理解"产出一个语意短标签 semanticLabel（自由短语），
// 再选粗分类桶 contentCategory。短标签会作为可见标签随图保存（落到现存 message 字段，
// 预览页直接显示），让云端分类相对设备端 MobileNetV3 产生差异化体验。
const PROMPT_ZH = `你是一个专业的照片分类助手。请按"先理解再归类"两步走：先用一句话描述你看到了什么，再选一个最贴近的语意短标签和粗分类桶，最后严格按下面 JSON 输出。
要求：
1. 只输出一个 JSON 对象，不要输出任何解释、前缀、后缀或代码块标记。
2. 所有字段都必须存在，contentCategory/colorTheme 的取值必须从给定候选项中选择。
3. confidence 表示你对本次分类的整体置信度，取值 0.0 到 1.0。
4. semanticLabel 是 4~12 个汉字的短语，体现图片核心语意（如「夜景人像」「会议白板」「街头美食」「狗狗特写」「证件正面」「微信聊天截图」），不要用通用词如「图片」「照片」。
5. description 为一句具体描述，不超过 24 个字，补充 semanticLabel 没体现的信息（如人物动作、场景细节、可读文字片段）。
字段：
- semanticLabel（字符串，4~12 汉字）
- contentCategory（单选）：single_person | social | pet | food | scenery | id_card | screenshot | qrcode | other
- colorTheme（单选）：blue | green | red | yellow | black | white | warm | cold | mixed
- isScreenshot（布尔）/ isIDCard（布尔）/ confidence（0.0~1.0）/ description（≤24字）`;

const PROMPT_EN = `You are a professional photo classification assistant. Work in two steps: first understand the image, then pick a concise semantic label and a coarse bucket. Return strictly as one JSON object.
Rules:
1. Output exactly one JSON object. No explanation, prefix, suffix, or code fences.
2. Every field must be present; contentCategory / colorTheme values must be chosen from the allowed options.
3. confidence is your overall confidence, 0.0 to 1.0.
4. semanticLabel is a short noun phrase of 2-5 words capturing the core meaning (e.g., "night portrait", "whiteboard meeting", "street food", "dog close-up", "ID front", "WeChat chat screenshot"). Avoid generic words like "photo" or "image".
5. description is a concrete one-sentence description, < 14 words, complementing what semanticLabel does not convey (action, scene detail, readable text snippet).
Fields:
- semanticLabel (string, 2-5 words)
- contentCategory (pick one): single_person | social | pet | food | scenery | id_card | screenshot | qrcode | other
- colorTheme (pick one): blue | green | red | yellow | black | white | warm | cold | mixed
- isScreenshot (bool) / isIDCard (bool) / confidence (0.0~1.0) / description (< 14 words)`;

function loadPrompt(lang) {
  return lang === 'en' ? PROMPT_EN : PROMPT_ZH;
}

let _llm = null;

/** 懒构造共享 LLMProviderService（含本地兜底 localClassifier） */
function getLLM(imageClassifier, platform) {
  if (_llm) return _llm;
  const localClassifier = new LocalClassifierService({
    onnxRunner: createLocalOnnxRunner(imageClassifier),
    mapper: localMapper,
  });
  _llm = new LLMProviderService({
    configService: unifiedDataConfigService,
    keyStore,
    localClassifier,
    platform,
  });
  return _llm;
}

/**
 * 云端批量分类，返回与原 batchClassifyRemote 相同形状的 batchResult。
 * @param {object} args
 * @param {object} args.imageClassifier - GSS 的 ImageClassifierService 实例（供本地兜底）
 * @param {string} args.platform        - 'pc' | 'ios' | 'android' | 'electron'
 * @param {Array<{id:string,imageBase64:string}>} args.inputs - 已转 base64（无 data: 前缀）
 * @param {Array<object>} args.validResults - 原始 validResults（保留 imageData 等）
 * @param {object} args.aiCfg            - getAIProviderConfig() 结果
 * @returns {Promise<{success:boolean,total:number,success_count:number,fail_count:number,items:Array}>}
 */
export async function classifyCloudBatch({ imageClassifier, platform, inputs, validResults, aiCfg }) {
  const llm = getLLM(imageClassifier, platform);
  const lang = aiCfg.promptLang || 'zh';
  const customCats = aiCfg.customCategories || [];
  // 基础提示词 + 用户自定义分类规则段（A 方案：让大模型按规则归入自定义分类）
  const base = aiCfg.promptOverride || loadPrompt(lang);
  const prompt = buildClassificationPrompt(base, customCats, lang);
  const out = await llm.classifyBatch(inputs, prompt, { concurrent: aiCfg.concurrent });

  const items = validResults.map((vr, i) => {
    const r = out[i];
    const res = r && (r.result || (r.contentCategory ? r : null));
    if (!r || r.ok === false || !res) {
      return { imageData: vr.imageData, success: false, error: (r && r.error) || 'classify failed' };
    }
    // semanticLabel + description 合并为可见标签（落到现有 message 字段，预览页直接显示）：
    // 「夜景人像 · 路灯下女孩侧脸」。短标签在前，便于一眼识别；description 无值时只显示短标签。
    const label = (res.semanticLabel || '').trim();
    const desc = (res.description || '').trim();
    const combined = label && desc ? `${label} · ${desc}` : (label || desc || res.rawText || null);
    return {
      imageData: vr.imageData,
      success: true,
      data: {
        category: resolveAppCategory(res.contentCategory, customCats),
        confidence: typeof res.confidence === 'number' ? res.confidence : 0.9,
        description: combined,
        background_color: res.colorTheme || null,
      },
    };
  });

  const success_count = items.filter((x) => x.success).length;
  return {
    success: true,
    total: items.length,
    success_count,
    fail_count: items.length - success_count,
    items,
  };
}

/** 测试钩子：重置懒构造的 llm 单例 */
export function _resetForTest() {
  _llm = null;
}

export default classifyCloudBatch;
