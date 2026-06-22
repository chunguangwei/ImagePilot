/**
 * queryRewrite —— 纯文本润色 / 改写（时刻秀✨润色 + AI 搜索✨查询改写）
 *
 * 端侧 Gemma（占位图 + prompt 取纯文本）与云端 LLM 都能做。选择策略：
 * - 只一个可用 → 直接用，不打扰
 * - 两者都可用 → generateTextWithChoice 弹框让用户选这次用哪个（透明 + 可控）
 * - 都不可用 → 抛 E_NO_MODEL（上层提示去配置/下载）
 */
import { Alert } from 'react-native';
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

/** 云端是否已配置在线大模型。 */
export async function isCloudConfigured() {
  try {
    const cfg = await unifiedDataConfigService.getAIProviderConfig();
    return !!(cfg && cfg.active && cfg.active !== 'local-onnx');
  } catch (_) {
    return false;
  }
}

/** 端侧 VLM 是否已下载可用。 */
async function isLocalConfigured() {
  try {
    // eslint-disable-next-line global-require
    const { isLocalTextAvailable } = require('./localTextGen');
    return await isLocalTextAvailable();
  } catch (_) {
    return false;
  }
}

/** 是否可用：端侧 或 云端 任一即可润色。 */
export async function isRewriteAvailable() {
  return (await isLocalConfigured()) || (await isCloudConfigured());
}

/** 清洗模型纯文本输出：去首尾引号、取首行。 */
function cleanText(s) {
  return String(s || '').trim()
    .replace(/^["'「『]+|["'」』]+$/g, '')
    .split('\n')[0].trim();
}

/** 端侧润色：返回 cleanText 或 ''（不可用）。失败抛错。 */
async function tryLocal(prompt) {
  // eslint-disable-next-line global-require
  const { isLocalTextAvailable, generateTextLocal } = require('./localTextGen');
  if (!(await isLocalTextAvailable())) return '';
  return cleanText(await generateTextLocal(prompt));
}

/** 云端润色：返回 cleanText 或 ''（无 provider）。失败抛错。 */
async function tryCloud(prompt) {
  const provider = await svc().getActiveProvider();
  if (!provider) return '';
  let raw = '';
  try {
    const r = await provider.classify(TINY_PNG, prompt);
    raw = (r && (r.rawText || r.text)) || '';
  } catch (e) {
    // 模型返回纯文本（非 JSON）→ classify 解析失败但原文挂在 err.rawText
    if (e && e.rawText) raw = e.rawText;
    else throw e;
  }
  return cleanText(raw);
}

/**
 * 纯文本生成。opts.prefer: 'local' | 'cloud'（指定优先，失败/空回退另一个）；不传则端侧优先。
 * 两端都拿不到内容时抛错。
 */
export async function generateText(prompt, opts = {}) {
  const order = opts.prefer === 'cloud' ? ['cloud', 'local'] : ['local', 'cloud'];
  let lastErr = null;
  for (const which of order) {
    try {
      const text = which === 'local' ? await tryLocal(prompt) : await tryCloud(prompt);
      if (text) return text;
    } catch (e) {
      lastErr = e;
      logger.warn(`[queryRewrite] ${which} 润色失败，尝试下一个:`, e?.message || e);
    }
  }
  throw lastErr || new Error('未配置在线大模型，也未下载端侧多模态模型');
}

/**
 * 带「模型选择」的润色：
 * - 端侧 + 云端都可用 → 弹框让用户选这次用哪个
 * - 只一个可用 → 直接用（不打扰）
 * - 都不可用 → 抛 E_NO_MODEL；用户取消 → 抛 E_CANCEL
 * @param {string} prompt
 * @param {{ t?: Function }} opts t = i18n 翻译函数（弹框文案）
 */
export async function generateTextWithChoice(prompt, opts = {}) {
  const t = opts.t;
  const localOK = await isLocalConfigured();
  const cloudOK = await isCloudConfigured();

  if (!localOK && !cloudOK) throw new Error('E_NO_MODEL 未配置在线大模型，也未下载端侧多模态模型');
  if (!(localOK && cloudOK)) {
    // 只一个可用 → 直接用那个，不打扰
    return generateText(prompt, { prefer: localOK ? 'local' : 'cloud' });
  }

  // 两者都可用 → 弹框让用户选
  const tr = (k, d) => (t ? t(k, { defaultValue: d }) : d);
  const choice = await new Promise((resolve) => {
    Alert.alert(
      tr('search.polishChooseTitle', '选择润色模型'),
      tr('search.polishChooseMsg', '本地大模型：免费 · 隐私 · 离线，略慢\n在线大模型：更快，需联网'),
      [
        { text: tr('common.cancel', '取消'), style: 'cancel', onPress: () => resolve(null) },
        { text: tr('search.polishLocal', '本地大模型'), onPress: () => resolve('local') },
        { text: tr('search.polishCloud', '在线大模型'), onPress: () => resolve('cloud') },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
  if (!choice) throw new Error('E_CANCEL 已取消');
  return generateText(prompt, { prefer: choice });
}

/** 改写查询。失败抛错（上层提示）；成功返回改写后字符串。t 用于模型选择弹框文案。 */
export async function rewriteSearchQuery(query, t) {
  const q = String(query || '').trim();
  if (!q) return q;
  const prompt =
    '忽略附带的占位图片。把下面这句口语化的"找照片"请求改写成更利于检索的简体中文画面描述：' +
    '保留主体、动作、场景等具体词，去掉口语助词和无关词，可补充 1~2 个同义词，总长 8~30 字。' +
    '只输出改写结果本身，不要任何解释、引号或前后缀。\n\n原话：' + q;
  const text = await generateTextWithChoice(prompt, { t });
  logger.debug(`[queryRewrite] "${q}" → "${text}"`);
  return text;
}

export default {
  isRewriteAvailable, isCloudConfigured, rewriteSearchQuery, generateText, generateTextWithChoice,
};
