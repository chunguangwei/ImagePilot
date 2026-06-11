/**
 * LLMClassifyOrchestrator — 基于多模态大模型的新一代云端分类（最佳实践）
 *
 * 与旧路径（wireLLMRouting + 9 个硬编码桶）的核心差异：
 *   1. 分类清单由"用户自己的分类"动态构造（内置 + settings.aiProvider.customCategories）
 *      ——LLM 从用户清单里选 id，而不是从 OpenAI schema 的 9 个桶里选
 *   2. 输出富语义：primaryCategory + tags[] + shortLabel + description + containsText + isScreenshot + colorTheme
 *      ——tags 让搜索可行，shortLabel 让卡片可见，description 让预览有上下文
 *   3. 单一解析点：拿到 provider.classify() 的 rawText 后，本模块统一容错解析（去 ```json 围栏 / 抽首个 {} 块）
 *      ——无需为每个 provider 改 _parseResponse
 *   4. 拒绝兜底：LLM 不确定时输出 'other'（在 prompt 里硬性约束），App 端再做一次 id 校验
 *   5. 可观测：每次调用记录 provider/model/latency/tokens，便于诊断
 *
 * 流入：inputs[{id, imageBase64}], validResults[{imageData}], aiCfg
 * 流出：与 wireLLMRouting.classifyCloudBatch 相同形状的 { success, total, items[] }，调用方零改动
 */

import { LLMProviderService } from './LLMProviderService.js';
import unifiedDataConfigService from './adapters/UnifiedDataConfigService.js';
import keyStore from './keyStoreSingleton.js';
import { LocalClassifierService } from '../LocalClassifierService.js';
import { createLocalOnnxRunner, localMapper } from './adapters/localOnnxRunner.js';
import configService from '../ConfigService.js';
import i18n from '../../i18n';
import { logger } from '../../adapters/WebAdapters';

let _llm = null;

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
 * 构造用户的分类清单（内置 + 自定义；NA 是 App 内部状态，不暴露给 LLM）
 * @param {object} aiCfg
 * @param {string} lang  'zh' | 'en'
 * @returns {Array<{id:string,name:string,rule:string}>}
 */
function buildTaxonomy(aiCfg, lang) {
  const out = [];
  const builtIn = (configService.getAllCategoriesWithUI && configService.getAllCategoriesWithUI()) || [];
  for (const c of builtIn) {
    if (!c || !c.id || c.id === 'NA') continue;
    const name = lang === 'en'
      ? (c.english || c.chinese || c.id)
      : (c.chinese || c.english || c.id);
    out.push({ id: c.id, name, rule: '' });
  }
  const customs = Array.isArray(aiCfg?.customCategories) ? aiCfg.customCategories : [];
  for (const c of customs) {
    if (!c || typeof c.id !== 'string' || !c.id.trim() || typeof c.name !== 'string' || !c.name.trim()) continue;
    if (out.some(x => x.id === c.id)) continue;
    out.push({ id: c.id.trim(), name: c.name.trim(), rule: (c.rule || '').trim() });
  }
  return out;
}

function buildPromptZH(taxonomy, detailed = false) {
  const taxoLines = taxonomy
    .map(t => `  - ${t.id}：${t.name}${t.rule ? `（${t.rule}）` : ''}`)
    .join('\n');
  return `你是一个专业的照片整理助手。请"先理解后归类"：先看清图片内容，再从用户清单里选最贴近的一类，最后严格返回一个 JSON 对象。

【用户分类清单】primaryCategory 必须是下方某个 id：
${taxoLines}

【输出 JSON 字段】所有字段必填：
- primaryCategory: 字符串（必须是上面的 id 之一；若图片不属于任何一类，用 "other"，不要硬选）
- tags: 字符串数组，1~5 个语义标签（每个 2~6 个汉字，要"具体"，如「夜景」「会议白板」「咖啡馆」「菜单」「行车记录」，**不要**用"图片/照片/风景"这种泛词）
- shortLabel: 字符串，4~12 个汉字，概括图片核心（如「夜景人像」「工作 PPT」「外卖菜单」）
- description: ${detailed ? '字符串，50~80 字详细描述：主体、动作、场景/背景、可见文字、显著细节（单图精细模式）' : '字符串，≤24 字的一句具体描述，补充 shortLabel 没体现的信息（人物动作、文字片段、地点细节等）'}
- confidence: 0.0~1.0 数字
- colorTheme: 单选 blue | green | red | yellow | black | white | warm | cold | mixed
- containsText: 布尔，画面里是否含明显文字
- isScreenshot: 布尔，是否为手机/电脑屏幕截图

【输出规则】
1. 只输出 JSON 对象本体；不要 \`\`\`json 代码块、不要任何前后缀解释文字
2. 所有字段都必须存在
3. 不确定时 primaryCategory 用 "other"，不要乱选；confidence 也据实调低
4. tags 用中文短词，要能让人靠这些词搜回这张图`;
}

function buildPromptEN(taxonomy, detailed = false) {
  const taxoLines = taxonomy
    .map(t => `  - ${t.id}: ${t.name}${t.rule ? ` (${t.rule})` : ''}`)
    .join('\n');
  return `You are a professional photo-organization assistant. Work in two steps: first understand the image, then pick the best fit from the user's taxonomy. Return strictly ONE JSON object.

[User Taxonomy] primaryCategory must be one of these ids:
${taxoLines}

[JSON fields — all required]
- primaryCategory: string (must be one of the ids above; if nothing fits, use "other" — do NOT guess)
- tags: array of 1-5 short semantic tags (2-5 words each, specific not generic — e.g. "night portrait", "meeting whiteboard", "coffee shop", "restaurant menu"; avoid words like "photo", "image", "scenery")
- shortLabel: 2-5 words summarizing the core (e.g. "night portrait", "code screenshot")
- description: ${detailed ? '2-3 detailed sentences (30-50 words): subject, action, scene, visible text, notable details' : "one concise sentence < 14 words adding what tags don't capture (action, readable text, location detail)"}
- confidence: 0.0-1.0
- colorTheme: pick one of blue | green | red | yellow | black | white | warm | cold | mixed
- containsText: boolean (visible text on screen?)
- isScreenshot: boolean (screen capture from a phone or computer?)

[Rules]
1. Output the raw JSON object only — no \`\`\`json fences, no commentary before or after
2. Every field must be present
3. When uncertain, primaryCategory = "other" and lower confidence — do not guess
4. Tags should be descriptive search keywords`;
}

/** 从 LLM rawText 里抽出 JSON 对象，容忍代码块/前后缀 */
function reparseRichSchema(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  // 1) 直接 parse
  try { return JSON.parse(rawText); } catch (_) { /* fallthrough */ }
  // 2) 去掉 ```json 围栏
  const fenced = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  if (fenced !== rawText) {
    try { return JSON.parse(fenced); } catch (_) { /* fallthrough */ }
  }
  // 3) 抓首个 {…} 块
  const m = fenced.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch (_) { /* fallthrough */ }
  }
  return null;
}

/** primaryCategory 校验：命中用户清单则保留；否则强制 'other'（兜底，不让 LLM 任意造词） */
function resolveCategoryId(rawCategory, taxonomy) {
  if (!rawCategory || typeof rawCategory !== 'string') return 'other';
  const c = rawCategory.trim();
  if (taxonomy.some(t => t.id === c)) return c;
  const lower = c.toLowerCase();
  const hit = taxonomy.find(t => t.id.toLowerCase() === lower);
  return hit ? hit.id : 'other';
}

/** 把 LLM 富语义输出合成 UI 可见的 message 字符串 */
function composeMessage({ shortLabel, description, tags }) {
  const head = [shortLabel, description].filter(s => s && s.trim()).join(' · ');
  const tagLine = (tags && tags.length) ? '\n#' + tags.join(' #') : '';
  return head + tagLine;
}

/** 安全规整 tags（去空、限制条数与长度） */
function normalizeTags(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const t of raw) {
    if (out.length >= 5) break;
    if (typeof t !== 'string') continue;
    const s = t.trim().replace(/^#/, '');
    if (!s || s.length > 12) continue;
    if (out.includes(s)) continue;
    out.push(s);
  }
  return out;
}

/**
 * 云端批量分类——与 wireLLMRouting.classifyCloudBatch 同形状的返回值
 * @param {object} args
 * @param {object} args.imageClassifier
 * @param {string} args.platform
 * @param {Array<{id:string,imageBase64:string}>} args.inputs
 * @param {Array<object>} args.validResults
 * @param {object} args.aiCfg
 * @returns {Promise<{success:boolean,total:number,success_count:number,fail_count:number,items:Array}>}
 */
export async function classifyCloudBatchV2({ imageClassifier, platform, inputs, validResults, aiCfg }) {
  const llm = getLLM(imageClassifier, platform);
  const lang = (aiCfg && aiCfg.promptLang) || i18n.language || 'zh';
  const taxonomy = buildTaxonomy(aiCfg, lang);
  if (!taxonomy.length) {
    logger.warn('⚠️ 用户分类清单为空，云端分类无法进行');
    return {
      success: false, total: validResults.length,
      success_count: 0, fail_count: validResults.length,
      items: validResults.map(v => ({ imageData: v.imageData, success: false, error: 'empty taxonomy' })),
    };
  }
  // 单图（用户主动点单张 AI 分类）→ 精细模式：描述加长，信息更丰富
  const detailed = (inputs && inputs.length === 1);
  const prompt = lang === 'en' ? buildPromptEN(taxonomy, detailed) : buildPromptZH(taxonomy, detailed);

  logger.info(`☁️ LLMClassifyOrchestrator: taxonomy=${taxonomy.length} 项, lang=${lang}, concurrent=${aiCfg?.concurrent || 3}`);

  // Pre-flight 健康检查（外层 20s 总超时兜底；用 1x1 PNG）——错误配置秒败，而不是让 N 张图各等 60s。
  // 外层 race 是必须的：BaseProvider._fetchWithTimeout 在 Hermes 上有时 AbortController 不能真正中断 fetch，
  // 或 keystore.getKey 自身可能阻塞，导致内部 15s 不生效。外层 race 是最后保险。
  logger.info(`☁️ Pre-flight 开始：${aiCfg.active}（20s 总超时）`);
  const preflightStart = Date.now();
  try {
    const hc = await Promise.race([
      llm.healthCheck(aiCfg.active),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Pre-flight 总超时 20s（网络不通 / API 不响应 / 配置错误）')), 20000)),
    ]);
    if (!hc || hc.ok !== true) {
      const reason = hc?.error || 'health check failed';
      logger.warn(`☁️ Pre-flight 失败（${Date.now() - preflightStart}ms）：${aiCfg.active} → ${reason}`);
      return {
        success: false,
        total: validResults.length,
        success_count: 0,
        fail_count: validResults.length,
        items: validResults.map(v => ({
          imageData: v.imageData,
          success: false,
          error: `Provider 不可用：${reason}`,
        })),
      };
    }
    logger.info(`☁️ Pre-flight OK（${Date.now() - preflightStart}ms）: ${hc.model || aiCfg.active}`);
  } catch (e) {
    logger.warn(`☁️ Pre-flight 异常（${Date.now() - preflightStart}ms）：${e?.message || e}`);
    return {
      success: false,
      total: validResults.length,
      success_count: 0,
      fail_count: validResults.length,
      items: validResults.map(v => ({
        imageData: v.imageData,
        success: false,
        error: `Provider 健康检查失败：${e?.message || String(e)}`,
      })),
    };
  }

  // 复用 LLMProviderService.classifyBatch（内有并发控制、provider 解析、健康检查）。
  // 它返回 [{ ok, result|error, code }]，我们关心 result.rawText（LLM 原文）。
  const out = await llm.classifyBatch(inputs, prompt, { concurrent: aiCfg?.concurrent || 3 });

  let successCount = 0;
  const items = validResults.map((vr, i) => {
    const r = out[i];
    if (!r || r.ok === false) {
      return { imageData: vr.imageData, success: false, error: r?.error || 'classify failed' };
    }
    const res = r.result || (r.contentCategory ? r : null);
    const raw = res?.rawText || '';
    const parsed = reparseRichSchema(raw) || {};

    const primary = resolveCategoryId(parsed.primaryCategory, taxonomy);
    const tags = normalizeTags(parsed.tags);
    const shortLabel = typeof parsed.shortLabel === 'string' ? parsed.shortLabel.trim() : '';
    const description = typeof parsed.description === 'string' ? parsed.description.trim() : '';
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.85;
    const colorTheme = typeof parsed.colorTheme === 'string' ? parsed.colorTheme : null;

    const message = composeMessage({ shortLabel, description, tags });

    successCount++;
    // 观测日志（采样：每批前 3 张）
    if (i < 3) {
      logger.debug(`✅ [${i}] LLM 分类: cat=${primary}, tags=[${tags.join(',')}], label="${shortLabel}", model=${res?.model || '?'}, ms=${res?.costMs || '?'}`);
    }

    return {
      imageData: vr.imageData,
      success: true,
      data: {
        category: primary,
        confidence,
        description: message,
        background_color: colorTheme,
      },
    };
  });

  return {
    success: true,
    total: items.length,
    success_count: successCount,
    fail_count: items.length - successCount,
    items,
  };
}

/** 测试钩子：重置懒构造的 llm 单例（与 wireLLMRouting._resetForTest 对齐） */
export function _resetForTest() { _llm = null; }

export default classifyCloudBatchV2;
