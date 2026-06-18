/**
 * VLMClassifier（iOS）—— 本地多模态分类：Google LiteRT-LM + Gemma4-E2B（纯 CPU 推理）。
 *
 * 通过原生模块 LiteRTLMModule.classify(modelPath, imagePath, prompt) 跑推理拿原始文本，
 * prompt 构建 + 结果解析复用 vlmShared（与安卓 GemmaModule 路径完全一致）。
 * 引擎初始化失败（E_LOAD，通常内存不足/机型不支持）→ markVlmUnsupported → 设置页禁用、上层回退 basic。
 *
 * 注：原 Qwen3-VL-2B（llama.rn）兜底已于 v1.5.21 下线。
 */

import { NativeModules } from 'react-native';
import { logger } from '../../adapters/WebAdapters';
import {
  currentLang, getCategoryList, buildPrompt, parseResult,
  prepareImageFile, cleanupTmp, markVlmUnsupported, buildResult, buildFailure,
} from './vlmShared';

const { LiteRTLMModule } = NativeModules;

/** 释放原生 LiteRT-LM Engine（换模型/退出时）。 */
export async function disposeVLMContext() {
  try { if (LiteRTLMModule && LiteRTLMModule.release) await LiteRTLMModule.release(); } catch (_) {}
}

/**
 * 单张图 → top1 app 类（Gemma / LiteRT-LM）。
 * @param paths { model: file://... }（Gemma 单文件，无 mmproj）
 */
export async function classifyImageWithVLM(imageUri, paths, vlmModel, opts = {}) {
  const t0 = Date.now();
  let tmpFile = null;
  try {
    if (!LiteRTLMModule || typeof LiteRTLMModule.classify !== 'function') {
      throw new Error('E_VLM_LOAD LiteRTLMModule 未链接');
    }
    const cats = getCategoryList();
    const lang = currentLang();
    const prompt = buildPrompt(cats, lang, opts);
    const imgUrl = await prepareImageFile(imageUri);
    tmpFile = imgUrl;

    // 原生侧：确保 Engine（纯 CPU）→ 看图出文本。多秒级。
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
 * 端侧纯文本生成（润色/查询改写用）：喂占位图 + 文本 prompt，取模型原始输出。
 * 不解析分类（与 classifyImageWithVLM 区别）——调用方自行清洗文本。
 * @param modelUri file:// 模型路径  @param placeholderImgUri file:// 占位图  @param prompt 文本指令
 */
export async function generateTextWithVLM(modelUri, placeholderImgUri, prompt) {
  if (!LiteRTLMModule || typeof LiteRTLMModule.classify !== 'function') {
    throw new Error('E_VLM_LOAD LiteRTLMModule 未链接');
  }
  return String(await LiteRTLMModule.classify(modelUri, placeholderImgUri, prompt) || '').trim();
}

export default { classifyImageWithVLM, disposeVLMContext, generateTextWithVLM };
