/**
 * vlmModels（Android）—— 本地多模态分类档：Gemma4-E2B（LiteRT-LM，译人那套）。
 *
 * 与 iOS（vlmModels.js，Qwen3-VL-2B / llama.rn）平台分叉：metro 自动按平台解析。
 * Gemma 是单文件 .litertlm（无 mmproj）；从 ModelScope（魔搭，阿里）国内直连下载。
 *
 * 为什么 Android 用 Gemma/LiteRT-LM 而非 Qwen/llama.rn：用户指定 Android 沿用译人逻辑；
 * 且 llama.rn 在本项目安卓侧 autolink/打包未成功，LiteRT-LM 直接 gradle 依赖更可靠。
 */

const MS = 'https://modelscope.cn/models';

export const VLM_MODELS = {
  gemma_e2b: {
    id: 'gemma_e2b',
    name: 'Gemma4-E2B',
    sublabel: '推荐 · 谷歌多模态',
    engine: 'litertlm',
    // 单文件 .litertlm（无 mmproj）。ModelScope 直连阿里云 OSS（cdn-lfs-cn-1.modelscope.cn）。
    model: {
      filename: 'gemma-4-E2B-it.litertlm',
      url: `${MS}/litert-community/gemma-4-E2B-it-litert-lm/resolve/master/gemma-4-E2B-it.litertlm`,
      bytes: 2588147712,
    },
    mmproj: null,
    sizeMB: 2468,        // ~2.5GB
    minRamGB: 4,
    // 下载前内存门槛（物理内存 MB）：Gemma E2B 权重 ~2.5GB，CPU 推理需留足运行时头寸。
    // 原 2800 过低，低配机加载途中易被系统 OOM-kill / 崩溃退出；提高到 3800（仅 4GB+ 机型放行）。
    // 原生侧另有「可用内存」实时校验兜底（availMemoryMB）。
    minDeviceMemMB: 3800,
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
