/**
 * vlmModels（iOS）—— 本地多模态分类档：Gemma4-E2B（LiteRT-LM），与安卓统一。
 *
 * iOS 走官方 LiteRT-LM Swift 运行时（原生模块 LiteRTLMModule，纯 CPU 推理，见 VLMClassifier.ios.js）。
 * Gemma 单文件 .litertlm（无 mmproj），从 ModelScope（魔搭，阿里）国内直连按需下载（断点续传见
 * classifierModelSource.ensureLargeModel）。为什么不用 hf-mirror：HF Xet 仓库只 308 跳回被墙的
 * huggingface.co；ModelScope 直连阿里云 OSS（cdn-lfs-cn-1.modelscope.cn）实测可下。
 *
 * 注：原 Qwen3-VL-2B（llama.rn）兜底档已于 v1.5.21 下线——Gemma 两端跑通，llama.rn 一并移除以减体积。
 */

const MS = 'https://modelscope.cn/models';

export const VLM_MODELS = {
  gemma_e2b: {
    id: 'gemma_e2b',
    name: 'Gemma4-E2B',
    sublabel: '推荐 · 谷歌多模态',
    engine: 'litertlm',
    // 单文件 .litertlm（无 mmproj）。与安卓同一文件，ModelScope 直连。
    model: {
      filename: 'gemma-4-E2B-it.litertlm',
      url: `${MS}/litert-community/gemma-4-E2B-it-litert-lm/resolve/master/gemma-4-E2B-it.litertlm`,
      bytes: 2588147712,
    },
    mmproj: null,
    sizeMB: 2468,        // ~2.5GB
    minRamGB: 4,
    // 下载前内存门槛（物理内存 MB）。iOS 端 Gemma 走纯 CPU（GPU Metal 建不了会话）：
    // 4GB iPhone（如 iPhone 13）能跑但较慢，故门槛放到 3000 让其可用；更低配机型拦下。
    minDeviceMemMB: 3000,
    recommended: true,
  },
};

export const VLM_MODEL_ORDER = ['gemma_e2b'];
export const DEFAULT_VLM_MODEL = 'gemma_e2b';

export function getVlmModel(id) {
  return VLM_MODELS[id] || VLM_MODELS[DEFAULT_VLM_MODEL];
}

/** 该变体需下载的文件数组（Gemma 单文件；过滤 null mmproj）。 */
export function vlmModelFiles(id) {
  const m = getVlmModel(id);
  return [m.model, m.mmproj].filter(Boolean);
}

export default { VLM_MODELS, VLM_MODEL_ORDER, DEFAULT_VLM_MODEL, getVlmModel, vlmModelFiles };
