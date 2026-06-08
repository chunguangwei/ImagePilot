/**
 * VLMClassifierQwen —— 用 llama.rn（llama.cpp RN 绑定）加载 GGUF 多模态模型
 * （Qwen3-VL-2B：model + mmproj），看图 → 出"描述 + 分类"。
 *
 * 这是 iOS 的「兜底」推理路径：主路径是 LiteRT-LM + Gemma（VLMClassifier.ios.js 调原生 LiteRTLMModule），
 * 当用户在设置页选 Qwen 变体（engine !== 'litertlm'）时由 VLMClassifier.ios.js 委派到这里。
 * 跨平台共享逻辑（分类清单/prompt/解析/语言/图像/落库契约）在 vlmShared.js。
 *
 * 设计：GPU→CPU 自动回退；加载失败 markVlmUnsupported → 设置页禁用；单例 context 按模型 id 缓存。
 */

import { logger } from '../../adapters/WebAdapters';
import {
  currentLang, getCategoryList, buildPrompt, parseResult,
  prepareImageFile, cleanupTmp, markVlmUnsupported, buildResult, buildFailure,
} from './vlmShared';

// llama.rn 懒加载：未链接/老包时不至于 import 崩，留给上层回退 basic。
let _llama = null;
function getLlama() {
  if (_llama) return _llama;
  // eslint-disable-next-line global-require
  _llama = require('llama.rn');
  return _llama;
}

// 单例 context（按模型 id 缓存）
let _ctx = null;
let _ctxModelId = null;
let _ctxBackend = null;

/** 释放当前 context（换模型 / 重新下载 / 退出时） */
export async function disposeVLMContext() {
  if (_ctx) { try { await _ctx.release(); } catch (_) {} }
  _ctx = null;
  _ctxModelId = null;
  _ctxBackend = null;
}

/** 确保 llama context 就绪（GPU→CPU 自动回退）。失败 markVlmUnsupported 并抛 E_VLM_LOAD。 */
async function ensureContext(vlmModel, paths) {
  if (_ctx && _ctxModelId === vlmModel.id) return _ctx;
  if (_ctx) await disposeVLMContext();

  const llama = getLlama();
  const initLlama = llama.initLlama || (llama.default && llama.default.initLlama);
  if (typeof initLlama !== 'function') throw new Error('E_VLM_LOAD llama.rn 未正确链接');

  const attempts = [
    { gpuLayers: 99, useGpu: true, tag: 'gpu' },
    { gpuLayers: 0, useGpu: false, tag: 'cpu' },
  ];
  let lastErr = null;
  for (const a of attempts) {
    let ctx = null;
    try {
      logger.debug(`[VLM] initLlama ${vlmModel.id} backend=${a.tag}`);
      // n_ctx 压到 2048（分类只需 短prompt+图像token+短输出），省 KV-cache 内存，缓解 4GB 机 OOM。
      // eslint-disable-next-line no-await-in-loop
      ctx = await initLlama({ model: paths.model, n_ctx: 2048, n_gpu_layers: a.gpuLayers, ctx_shift: false });
      // image_max_tokens 128：进一步限图像 token，降激活内存峰值（分类不需要高分辨率细节）。
      // eslint-disable-next-line no-await-in-loop
      const okMM = await ctx.initMultimodal({ path: paths.mmproj, use_gpu: a.useGpu, image_max_tokens: 128 });
      if (!okMM) throw new Error('initMultimodal 返回 false（mmproj 不被支持）');
      _ctx = ctx; _ctxModelId = vlmModel.id; _ctxBackend = a.tag;
      logger.debug(`[VLM] ${vlmModel.id} 就绪 backend=${a.tag}`);
      return _ctx;
    } catch (e) {
      lastErr = e;
      logger.warn(`[VLM] ${vlmModel.id} backend=${a.tag} 加载失败: ${e?.message || e}`);
      try { if (ctx) await ctx.release(); } catch (_) {}
    }
  }
  await markVlmUnsupported(vlmModel.id, (lastErr && (lastErr.message || String(lastErr))) || 'load failed');
  throw new Error(`E_VLM_LOAD ${vlmModel.id} 本机无法加载: ${lastErr?.message || lastErr}`);
}

/**
 * 单张图 → top1 app 类（VLM / llama.rn）。
 * @param paths { model: file://..., mmproj: file://... }
 */
export async function classifyImageWithVLM(imageUri, paths, vlmModel) {
  const t0 = Date.now();
  let tmpFile = null;
  try {
    const ctx = await ensureContext(vlmModel, paths);
    const cats = getCategoryList();
    const lang = currentLang();
    const prompt = buildPrompt(cats, lang);
    const imgUrl = await prepareImageFile(imageUri);
    tmpFile = imgUrl;

    const res = await ctx.completion({
      messages: [{ role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: imgUrl } },
      ] }],
      n_predict: 64,
      temperature: 0.2,
    });

    const raw = (res && (res.text || res.content || '')).trim();
    const { appCategory, description } = parseResult(raw, cats, lang);
    logger.debug(`[VLM] ${String(imageUri).slice(-30)} → ${appCategory} desc="${description || ''}" backend=${_ctxBackend} in ${Date.now() - t0}ms`);
    await cleanupTmp(tmpFile);
    return buildResult(appCategory, description, t0);
  } catch (e) {
    await cleanupTmp(tmpFile);
    logger.error(`[VLM] 推理失败: ${e?.message || e}`);
    return buildFailure(e, t0);
  }
}

export default { classifyImageWithVLM, disposeVLMContext };
