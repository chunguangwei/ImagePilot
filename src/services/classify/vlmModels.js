/**
 * vlmModels — VLM（多模态大模型）分类档的模型注册表。
 *
 * 与 clipModels.js 同构，但每个变体含两份 GGUF：主模型 model + 视觉投影 mmproj
 * （llama.cpp 多模态约定：vision 走独立 mmproj 文件）。推理引擎是 llama.rn
 * （llama.cpp 的 RN 绑定，iOS Metal / 安卓 OpenCL GPU + CPU 自动回退）。
 *
 * 为什么不用「译人」的 Gemma E2B/LiteRT-LM：LiteRT-LM 仅 Android、iOS 无成熟实现，
 * 且 E2B 需 ~4GB 运行内存、2.6GB 体积。改用 llama.rn + 更小的 GGUF：iOS+安卓通吃、
 * 体积/内存大幅下降，并能用 GBNF 语法强制模型只输出合法分类 id。
 *
 * 模型一律不打包进 App，全部从 ModelScope（魔搭，阿里）中国源按需下载（断点续传见
 * classifierModelSource.ensureLargeModel）。文件名/体积均已对 ModelScope 实测核对。
 *
 * 为什么不用 hf-mirror：这些 GGUF 仓库用 HF 的 Xet 存储，hf-mirror 不代理、只 308 跳回
 * huggingface.co（国内被墙）→ 设备下载卡死。ModelScope 直连阿里云 OSS（cdn-lfs-cn-1.modelscope.cn），
 * 国内不跳国外，实测可下（GGUF 魔数校验通过）。
 *
 * 两档定位：
 *   - smolvlm_500m：~0.5GB，所有手机可跑、可整库批量（秒级/张），跨平台。推荐。
 *   - qwen3vl_2b ：阿里 Qwen3-VL-2B，质量更好但 ~1.5GB、更慢、需 6GB+ 内存机型。
 *
 * 注意：llama.rn 加载失败（OOM/不支持）时，VLMClassifier 会捕获并标记本机不可用，
 * 设置页据此禁用该变体（见 vlmUnsupported 设置）。
 */

// ModelScope（魔搭）resolve 直链：/models/{org}/{repo}/resolve/master/{file}
const MS = 'https://modelscope.cn/models';

export const VLM_MODELS = {
  // 注：SmolVLM-500M 已移除 —— 实测它中英文分类都不准（0.5B 太小、且偏英文），
  // AI 英文描述虽对但归类差，留之无益。本地多模态档只保留 Qwen3-VL-2B。
  qwen3vl_2b: {
    id: 'qwen3vl_2b',
    name: 'Qwen3-VL-2B',
    sublabel: '推荐 · 中文准 · 阿里',
    // 主模型用 unsloth Q4_K_M（1.1GB，最省）；mmproj 用 ggml-org 的 Q8（445MB，比 F16 的 819MB 省 ~370MB 内存）。
    // 跨仓但同为 Qwen3-VL-2B base，视觉投影通用。为在 4GB iPhone 上尽量不 OOM 而选小 mmproj。
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
    sizeMB: 1480,           // model + mmproj
    minRamGB: 6,
    // 下载前内存门槛（物理内存 MB）：iOS 给单 App 的预算约为物理内存一半（jetsam，4GB 机 ~2.1GB）。
    // Qwen3-VL-2B 工作集 >2.1GB → 4GB iPhone（物理 ~3.7GB）必崩；需 6GB+ iPhone（物理 ~5.7GB）。
    minDeviceMemMB: 5500,
    recommended: false,
  },
};

export const VLM_MODEL_ORDER = ['qwen3vl_2b'];
export const DEFAULT_VLM_MODEL = 'qwen3vl_2b';

/** 解析模型 id → 变体配置；缺/无效兜底默认（SmolVLM-500M） */
export function getVlmModel(id) {
  return VLM_MODELS[id] || VLM_MODELS[DEFAULT_VLM_MODEL];
}

/** 该变体需下载的两文件（model + mmproj）。供下载/状态判断遍历。 */
export function vlmModelFiles(id) {
  const m = getVlmModel(id);
  return [m.model, m.mmproj];
}

export default { VLM_MODELS, VLM_MODEL_ORDER, DEFAULT_VLM_MODEL, getVlmModel, vlmModelFiles };
