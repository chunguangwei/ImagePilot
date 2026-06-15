/**
 * clipModels — CLIP 档模型注册表。
 *
 * 现仅保留单一模型 MobileCLIP2-S2（fp32）。早先支持多变体可选（S1 旧版 / SigLIP2），
 * 实测后都已移除：
 *   - SigLIP2-base：sigmoid loss 需 logit 温度/偏置校准，裸余弦量纲下几端基本不可用，且体积过大。
 *   - MobileCLIP-S1：旧版，质量不如 S2，已无保留价值。
 *
 * 为什么 S2 用 fp32：原 fp16 版在 iOS（苹果芯片原生 fp16）正常，但安卓
 * onnxruntime-react-native 1.17 移动版的 fp16 算子支持差会掉精度 → 安卓分类明显
 * 不如 iOS。实测 fp32 与 fp16 输出逐位等价（cos=1.0），改 fp32 让安卓追平 iOS、
 * iOS 不受影响，代价仅是体积翻倍（75→147MB）。
 *
 * 模型自带：image encoder onnx（GH Release 按需下载）+ 文本 embeddings（内嵌 JS）
 * + minSim 阈值。文本 embeddings 的 _meta（input_size/mean/std/embed_dim）由分类器据此
 * 做预处理与校验。注册表结构保留（CLIP_MODELS/ORDER），便于将来再扩模型时零改推理代码。
 */
import S2_EMB from './clipTextEmbeddings.mobileclip2_s2.json';

const BASE = 'https://modelscope.cn/models/chunguangwee/ImagePilot-models/resolve/master'; // ModelScope 主源（端侧国内更稳）；GitHub Release 留作兜底（见下载器）

export const CLIP_MODELS = {
  mobileclip2_s2: {
    id: 'mobileclip2_s2',
    name: 'MobileCLIP2-S2',
    sublabel: '推荐 · 最佳质量',
    // fp32 版（文件名带 _fp32 以强制旧装机重新下载，绕开安卓 fp16 掉精度）
    filename: 'mobileclip2_s2_fp32_image_encoder.onnx',
    url: `${BASE}/mobileclip2_s2_fp32_image_encoder.onnx`,
    embeddings: S2_EMB,
    minSim: 0.20,         // cosine 量纲
    sizeMB: 147,
    recommended: true,
  },
};

export const CLIP_MODEL_ORDER = ['mobileclip2_s2'];
export const DEFAULT_CLIP_MODEL = 'mobileclip2_s2';

/** 解析模型 id → 变体配置；缺/无效都兜底默认（新 S2） */
export function getClipModel(id) {
  return CLIP_MODELS[id] || CLIP_MODELS[DEFAULT_CLIP_MODEL];
}

export default { CLIP_MODELS, CLIP_MODEL_ORDER, DEFAULT_CLIP_MODEL, getClipModel };
