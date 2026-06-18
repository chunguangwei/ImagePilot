/**
 * localTextGen —— 端侧纯文本生成（Gemma / LiteRT-LM）。
 *
 * 复用 VLM 多模态分类的同一套端侧模型，做润色 / 查询改写等纯文本任务：
 * 喂一张 1x1 占位图 + 文本 prompt（prompt 里会让模型"忽略占位图"），取纯文本输出。
 * 仅当用户已下载 VLM 模型时可用；否则上层（queryRewrite）回退云端。
 *
 * 设计：端侧是增强，任何异常都向上抛由调用方回退云端，绝不破坏现有云端润色。
 */
import UnifiedDataService from '../UnifiedDataService';
import { getVlmModel, DEFAULT_VLM_MODEL } from '../classify/vlmModels';
import { isLargeModelComplete, modelLocalPath } from '../classify/classifierModelSource';
import VLMClassifier from '../classify/VLMClassifier';
import { logger } from '../../adapters/WebAdapters';

// eslint-disable-next-line global-require
const RNFS = require('react-native-fs');

// 1x1 透明 PNG（与 queryRewrite 占位图一致）：多模态通道做纯文本时的占位输入。
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=';

const asUri = (p) => (String(p).startsWith('file://') ? p : `file://${p}`);

let _phPromise = null;
/** 占位图落地成文件（缓存一次），返回 file:// 路径。 */
function ensurePlaceholderImage() {
  if (_phPromise) return _phPromise;
  _phPromise = (async () => {
    const p = `${RNFS.CachesDirectoryPath}/vlm_text_placeholder.png`;
    try {
      if (!(await RNFS.exists(p))) await RNFS.writeFile(p, TINY_PNG, 'base64');
    } catch (e) {
      _phPromise = null; // 失败不缓存，下次重试
      throw e;
    }
    return asUri(p);
  })();
  return _phPromise;
}

/** 读用户所选 VLM 变体（缺/无效兜底默认）。 */
async function activeVlmModel() {
  try {
    const s = await UnifiedDataService.readSettings();
    return getVlmModel(s?.classifierVlmModel || DEFAULT_VLM_MODEL);
  } catch (_) {
    return getVlmModel(DEFAULT_VLM_MODEL);
  }
}

/** 端侧文本生成是否可用（所选 VLM 变体的模型文件已下载齐 + 原生接口在）。 */
export async function isLocalTextAvailable() {
  try {
    const m = await activeVlmModel();
    if (!m || !m.model) return false;
    if (!(await isLargeModelComplete(m.model.filename, m.model.bytes))) return false;
    if (m.mmproj && !(await isLargeModelComplete(m.mmproj.filename, m.mmproj.bytes))) return false;
    return typeof VLMClassifier.generateTextWithVLM === 'function';
  } catch (_) {
    return false;
  }
}

/** 端侧纯文本生成。返回模型原始文本；不可用/失败抛错（上层回退云端）。 */
export async function generateTextLocal(prompt) {
  const m = await activeVlmModel();
  if (!m || !m.model) throw new Error('E_NO_VLM 无可用 VLM 变体');
  const dest = modelLocalPath(m.model.filename);
  const ph = await ensurePlaceholderImage();
  const t0 = Date.now();
  const raw = await VLMClassifier.generateTextWithVLM(asUri(dest), ph, prompt);
  logger.debug(`[localTextGen] 端侧润色 ${Date.now() - t0}ms → "${String(raw).slice(0, 40)}"`);
  return raw;
}

export default { isLocalTextAvailable, generateTextLocal };
