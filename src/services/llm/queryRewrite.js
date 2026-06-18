/**
 * queryRewrite —— 语义查询润色（AI 搜索的"✨改写"）
 *
 * 口语化找图请求 → 云端 LLM 改写成检索友好的画面描述（保留主体/动作/场景，
 * 去口语词，可补同义词）。复用现有 Provider 体系；纯文本诉求通过 1x1 占位图
 * 走多模态通道（与 BaseProvider.healthCheck 同模式，全 Provider 兼容）。
 * 仅云端可用（本地 Gemma 纯文本会话未验证，不接）。
 */
import { LLMProviderService } from './LLMProviderService.js';
import unifiedDataConfigService from './adapters/UnifiedDataConfigService.js';
import keyStore from './keyStoreSingleton.js';
import { logger } from '../../adapters/WebAdapters';

const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=';

let _svc = null;
function svc() {
  if (!_svc) {
    _svc = new LLMProviderService({ configService: unifiedDataConfigService, keyStore });
  }
  return _svc;
}

/** 是否可用：端侧 VLM 已下载 或 已配置在线大模型（任一即可润色）。 */
export async function isRewriteAvailable() {
  try {
    // eslint-disable-next-line global-require
    const { isLocalTextAvailable } = require('./localTextGen');
    if (await isLocalTextAvailable()) return true; // 端侧 Gemma 可用
  } catch (_) { /* 端侧不可用 → 看云端 */ }
  try {
    const cfg = await unifiedDataConfigService.getAIProviderConfig();
    return !!(cfg && cfg.active && cfg.active !== 'local-onnx');
  } catch (_) {
    return false;
  }
}

/**
 * 改写查询。失败抛错（上层提示）；成功返回改写后的字符串。
 */
/** 清洗模型纯文本输出：去首尾引号、取首行。 */
function cleanText(s) {
  return String(s || '').trim()
    .replace(/^["'「『]+|["'」』]+$/g, '')
    .split('\n')[0].trim();
}

/**
 * 纯文本生成：走多模态通道发占位图 + prompt，取模型的纯文本输出。
 * classify() 本是分类用、会强解析 JSON——纯文本诉求时模型不返 JSON 会抛
 * INVALID_RESPONSE，此时从 err.rawText 回收原文（润色/扩写等场景）。
 * 返回清洗后的字符串；拿不到内容抛错。
 */
export async function generateText(prompt) {
  // 优先端侧 Gemma（免费/隐私/离线）；端侧不可用或失败/空 → 无缝回退云端。
  try {
    // eslint-disable-next-line global-require
    const { isLocalTextAvailable, generateTextLocal } = require('./localTextGen');
    if (await isLocalTextAvailable()) {
      const localText = cleanText(await generateTextLocal(prompt));
      if (localText) return localText;
      logger.warn('[queryRewrite] 端侧润色返回空，回退云端');
    }
  } catch (e) {
    logger.warn('[queryRewrite] 端侧润色失败，回退云端:', e?.message || e);
  }

  // 云端
  const provider = await svc().getActiveProvider();
  if (!provider) throw new Error('未配置在线大模型，也未下载端侧多模态模型');
  let raw = '';
  try {
    const r = await provider.classify(TINY_PNG, prompt);
    raw = (r && (r.rawText || r.text)) || '';
  } catch (e) {
    // 模型直接返回纯文本（非 JSON）：classify 解析失败，但原文已挂在 err.rawText
    if (e && e.rawText) raw = e.rawText;
    else throw e;
  }
  const text = cleanText(raw);
  if (!text) throw new Error('生成结果为空');
  return text;
}

/**
 * 改写查询。失败抛错（上层提示）；成功返回改写后的字符串。
 */
export async function rewriteSearchQuery(query) {
  const q = String(query || '').trim();
  if (!q) return q;
  const prompt =
    '忽略附带的占位图片。把下面这句口语化的"找照片"请求改写成更利于检索的简体中文画面描述：' +
    '保留主体、动作、场景等具体词，去掉口语助词和无关词，可补充 1~2 个同义词，总长 8~30 字。' +
    '只输出改写结果本身，不要任何解释、引号或前后缀。\n\n原话：' + q;
  const text = await generateText(prompt);
  logger.debug(`[queryRewrite] "${q}" → "${text}"`);
  return text;
}

export default { isRewriteAvailable, rewriteSearchQuery, generateText };
