/**
 * VLMClassifier（iOS）—— 本地多模态分类的 iOS 入口，按所选变体的引擎路由：
 *   - engine === 'litertlm'（Gemma4-E2B，主路径）：调原生 LiteRTLMModule.classify（Google LiteRT-LM Swift 运行时）。
 *   - 否则（Qwen3-VL-2B，兜底）：委派到 VLMClassifierQwen（llama.rn / GGUF）。
 *
 * 与安卓 VLMClassifier.android.js 对称：原生侧只跑「(模型路径, 图片路径, prompt) → 原始文本」，
 * prompt 构建 + 结果解析复用 vlmShared（两端、两引擎完全一致）。
 * 引擎初始化失败（E_LOAD，通常内存不足/机型不支持）→ markVlmUnsupported → 设置页禁用、上层回退 basic。
 */

import { NativeModules } from 'react-native';
import { logger } from '../../adapters/WebAdapters';
import {
  currentLang, getCategoryList, buildPrompt, parseResult,
  prepareImageFile, cleanupTmp, markVlmUnsupported, buildResult, buildFailure,
} from './vlmShared';

const { LiteRTLMModule } = NativeModules;

/** 释放推理资源（换模型/退出时）：释放原生 LiteRT-LM Engine + Qwen 的 llama context。 */
export async function disposeVLMContext() {
  try { if (LiteRTLMModule && LiteRTLMModule.release) await LiteRTLMModule.release(); } catch (_) {}
  try {
    // eslint-disable-next-line global-require
    await require('./VLMClassifierQwen').disposeVLMContext();
  } catch (_) {}
}

/** Gemma / LiteRT-LM 主路径：原生模块看图出文本 → 共享解析。 */
async function classifyWithLiteRTLM(imageUri, paths, vlmModel) {
  const t0 = Date.now();
  let tmpFile = null;
  try {
    if (!LiteRTLMModule || typeof LiteRTLMModule.classify !== 'function') {
      throw new Error('E_VLM_LOAD LiteRTLMModule 未链接');
    }
    const cats = getCategoryList();
    const lang = currentLang();
    const prompt = buildPrompt(cats, lang);
    const imgUrl = await prepareImageFile(imageUri);
    tmpFile = imgUrl;

    // 原生侧：确保 Engine（GPU→CPU 回退）→ 看图出文本。多秒级。
    const raw = String(await LiteRTLMModule.classify(paths.model, imgUrl, prompt) || '').trim();
    const { appCategory, description } = parseResult(raw, cats, lang);
    logger.debug(`[VLM-Gemma] ${String(imageUri).slice(-30)} → ${appCategory} desc="${description || ''}" in ${Date.now() - t0}ms`);
    await cleanupTmp(tmpFile);
    return buildResult(appCategory, description, t0);
  } catch (e) {
    await cleanupTmp(tmpFile);
    const code = e?.code || e?.message || '';
    if (String(code).includes('E_LOAD') || String(code).includes('E_VLM_LOAD')) {
      await markVlmUnsupported(vlmModel?.id || 'gemma_e2b', e?.message || String(e));
    }
    logger.error(`[VLM-Gemma] 推理失败: ${e?.message || e}`);
    return buildFailure(e, t0);
  }
}

/**
 * 单张图 → top1 app 类。按引擎路由（Gemma 原生 / Qwen llama.rn）。
 * @param paths { model: file://..., mmproj?: file://... }
 */
export async function classifyImageWithVLM(imageUri, paths, vlmModel) {
  if (vlmModel && vlmModel.engine === 'litertlm') {
    return classifyWithLiteRTLM(imageUri, paths, vlmModel);
  }
  // 兜底：Qwen / llama.rn
  // eslint-disable-next-line global-require
  return require('./VLMClassifierQwen').classifyImageWithVLM(imageUri, paths, vlmModel);
}

export default { classifyImageWithVLM, disposeVLMContext };
