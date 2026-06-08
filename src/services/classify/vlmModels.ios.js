/**
 * vlmModels（iOS）—— 本地多模态分类档：主用 Gemma4-E2B（LiteRT-LM），Qwen3-VL-2B 作兜底。
 *
 * 与安卓统一：两端都用 Google LiteRT-LM + Gemma4-E2B（.litertlm 单文件，无 mmproj），
 * iOS 走官方 LiteRT-LM Swift 运行时（原生模块 LiteRTLMModule，见 VLMClassifier.ios.js）。
 * 统一后逻辑/模型一致，且 Gemma 比 Qwen 更新、端侧"可玩性"更大（不止图片）。
 *
 * Qwen3-VL-2B（llama.rn/GGUF）作为「兜底退路」保留：当 Gemma 在某机型跑不通、用户手动切到 Qwen 时启用。
 * 现实里 iPhone 13(4GB) 两者都跑不动 → 下载前内存门槛(minDeviceMemMB)直接拦，提示"机型配置较低"。
 *
 * 模型一律不打包进 App，从 ModelScope（魔搭，阿里）国内直连按需下载（断点续传见
 * classifierModelSource.ensureLargeModel）。为什么不用 hf-mirror：HF Xet 仓库只 308 跳回被墙的
 * huggingface.co；ModelScope 直连阿里云 OSS（cdn-lfs-cn-1.modelscope.cn）实测可下。
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
    // 下载前内存门槛（物理内存 MB）。
    // 【实测档】暂降到 3000，让 iPhone 13(物理 ~3.7GB) 也能下载并尝试加载 Gemma ——
    // 验证 Gemma E2B 的 PLE/MatFormer 省内存能否在 4GB iPhone 上扛住（Qwen 当初是直接 OOM 崩）。
    // 若实测照样 OOM，再恢复 5500（仅 6GB+ iPhone 物理~5.7GB 才放行）。
    minDeviceMemMB: 3000,
    recommended: true,
  },
  // 兜底退路：Qwen3-VL-2B（llama.rn / GGUF，model + mmproj 两文件）。
  qwen3vl_2b: {
    id: 'qwen3vl_2b',
    name: 'Qwen3-VL-2B',
    sublabel: '兜底 · 阿里 · llama.cpp',
    // engine 缺省 → VLMClassifier.ios.js 走 llama.rn 路径（VLMClassifierQwen）。
    model: {
      filename: 'Qwen3-VL-2B-Instruct-Q4_K_M.gguf',
      url: `${MS}/unsloth/Qwen3-VL-2B-Instruct-GGUF/resolve/master/Qwen3-VL-2B-Instruct-Q4_K_M.gguf`,
      bytes: 1107410624,
    },
    mmproj: {
      filename: 'mmproj-Qwen3-VL-2B-Instruct-Q8_0.gguf',
      url: `${MS}/ggml-org/Qwen3-VL-2B-Instruct-GGUF/resolve/master/mmproj-Qwen3-VL-2B-Instruct-Q8_0.gguf`,
      bytes: 445053056,
    },
    sizeMB: 1480,
    minRamGB: 6,
    minDeviceMemMB: 5500,
    recommended: false,
  },
};

// Gemma 主、Qwen 兜底（顺序即设置页列表顺序）。
export const VLM_MODEL_ORDER = ['gemma_e2b', 'qwen3vl_2b'];
export const DEFAULT_VLM_MODEL = 'gemma_e2b';

export function getVlmModel(id) {
  return VLM_MODELS[id] || VLM_MODELS[DEFAULT_VLM_MODEL];
}

/** 该变体需下载的文件数组（Gemma 单文件；Qwen 两文件；过滤 null mmproj）。 */
export function vlmModelFiles(id) {
  const m = getVlmModel(id);
  return [m.model, m.mmproj].filter(Boolean);
}

export default { VLM_MODELS, VLM_MODEL_ORDER, DEFAULT_VLM_MODEL, getVlmModel, vlmModelFiles };
