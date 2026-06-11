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

/** 是否可用（已配置在线大模型） */
export async function isRewriteAvailable() {
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
export async function rewriteSearchQuery(query) {
  const q = String(query || '').trim();
  if (!q) return q;
  const provider = await svc().getActiveProvider();
  if (!provider) throw new Error('未配置在线大模型');
  const prompt =
    '忽略附带的占位图片。把下面这句口语化的"找照片"请求改写成更利于检索的简体中文画面描述：' +
    '保留主体、动作、场景等具体词，去掉口语助词和无关词，可补充 1~2 个同义词，总长 8~30 字。' +
    '只输出改写结果本身，不要任何解释、引号或前后缀。\n\n原话：' + q;
  const r = await provider.classify(TINY_PNG, prompt);
  const text = String((r && (r.rawText || r.text)) || '').trim()
    .replace(/^["'「『]+|["'」』]+$/g, '')
    .split('\n')[0].trim();
  if (!text) throw new Error('改写结果为空');
  logger.debug(`[queryRewrite] "${q}" → "${text}"`);
  return text;
}

export default { isRewriteAvailable, rewriteSearchQuery };
