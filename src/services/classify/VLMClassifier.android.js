/**
 * VLMClassifier（Android）—— 用 LiteRT-LM + Gemma4-E2B（译人那套）做本地多模态分类。
 *
 * 通过原生模块 GemmaModule.classify(modelPath, imagePath, prompt) 跑推理拿原始文本，
 * prompt 构建 + 结果解析复用 vlmShared（与 iOS 的 Qwen/llama.rn 路径完全一致）。
 * 引擎初始化（GPU→CPU 回退）在原生侧；加载失败（E_LOAD）→ markVlmUnsupported → 设置页禁用、上层回退 basic。
 */

import { NativeModules } from 'react-native';
import { logger } from '../../adapters/WebAdapters';
import {
  currentLang, getCategoryList, buildPrompt, parseResult,
  prepareImageFile, cleanupTmp, markVlmUnsupported, buildResult, buildFailure,
} from './vlmShared';

const { GemmaModule } = NativeModules;

/** 释放原生 Engine（换模型/退出时） */
export async function disposeVLMContext() {
  try { if (GemmaModule && GemmaModule.release) await GemmaModule.release(); } catch (_) {}
}

/**
 * 单张图 → top1 app 类（VLM / LiteRT-LM-Gemma）。
 * @param paths { model: file://... }  （Gemma 单文件，无 mmproj）
 */
export async function classifyImageWithVLM(imageUri, paths, vlmModel) {
  const t0 = Date.now();
  let tmpFile = null;
  try {
    if (!GemmaModule || typeof GemmaModule.classify !== 'function') {
      throw new Error('E_VLM_LOAD GemmaModule 未链接');
    }
    const cats = getCategoryList();
    const lang = currentLang();
    const prompt = buildPrompt(cats, lang);
    const imgUrl = await prepareImageFile(imageUri);
    tmpFile = imgUrl;

    // 原生侧：确保 Engine（GPU→CPU 回退）→ 看图出文本。多秒级。
    const raw = String(await GemmaModule.classify(paths.model, imgUrl, prompt) || '').trim();
    const { appCategory, description } = parseResult(raw, cats, lang);
    logger.debug(`[VLM-Gemma] ${String(imageUri).slice(-30)} → ${appCategory} desc="${description || ''}" in ${Date.now() - t0}ms`);
    await cleanupTmp(tmpFile);
    return buildResult(appCategory, description, t0);
  } catch (e) {
    await cleanupTmp(tmpFile);
    const code = e?.code || e?.message || '';
    // 加载失败（OOM/不支持）→ 标记本机不可用，设置页禁用该变体
    if (String(code).includes('E_LOAD') || String(code).includes('E_VLM_LOAD')) {
      await markVlmUnsupported(vlmModel?.id || 'gemma_e2b', e?.message || String(e));
    }
    logger.error(`[VLM-Gemma] 推理失败: ${e?.message || e}`);
    return buildFailure(e, t0);
  }
}

export default { classifyImageWithVLM, disposeVLMContext };
