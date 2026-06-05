/**
 * clipModels — CLIP 档可选模型注册表（用户可在设置里选择下载哪个）。
 *
 * 现在 CLIP 档不再写死单一模型，而是从这里选：
 *   - mobileclip2_s2（默认/推荐）：MobileCLIP2-S2，端侧优化，小而快，质量优于旧版 S1
 *   - siglip2_base（高精度）：SigLIP2-base，更准但体积更大、相似度量纲更低（阈值已单独标定）
 *   - mobileclip_s1（备用/旧版）：原 MobileCLIP-S1，保留兜底
 *
 * 每个变体自带：image encoder onnx（GH Release 按需下载）+ 对应文本 embeddings（内嵌 JS）
 * + minSim 阈值（不同模型相似度量纲不同，必须各自标定）。
 * 文本 embeddings 的 _meta（input_size/mean/std/embed_dim）由分类器据此做预处理与校验，
 * 因此换模型零改推理代码。
 */
import S1_EMB from './clipTextEmbeddings.json';
import S2_EMB from './clipTextEmbeddings.mobileclip2_s2.json';
import SIGLIP2_EMB from './clipTextEmbeddings.siglip2_base.json';

const BASE = 'https://github.com/chunguangwei/ImagePilot/releases/download/models-v1';

export const CLIP_MODELS = {
  mobileclip2_s2: {
    id: 'mobileclip2_s2',
    name: 'MobileCLIP2-S2',
    sublabel: '推荐 · 小而快',
    filename: 'mobileclip2_s2_image_encoder.onnx',
    url: `${BASE}/mobileclip2_s2_image_encoder.onnx`,
    embeddings: S2_EMB,
    minSim: 0.20,         // 与 S1 同量纲（cosine）
    sizeMB: 72,
    recommended: true,
  },
  siglip2_base: {
    id: 'siglip2_base',
    name: 'SigLIP2-base',
    sublabel: '高精度 · 体积较大',
    filename: 'siglip2_base_image_encoder.onnx',
    url: `${BASE}/siglip2_base_image_encoder.onnx`,
    embeddings: SIGLIP2_EMB,
    minSim: 0.085,        // SigLIP 相似度量纲更低，单独标定（实测真匹配 ~0.1）
    sizeMB: 178,
  },
  mobileclip_s1: {
    id: 'mobileclip_s1',
    name: 'MobileCLIP-S1',
    sublabel: '备用 · 旧版',
    filename: 'mobileclip_image_encoder.onnx',
    url: `${BASE}/mobileclip_image_encoder.onnx`,
    embeddings: S1_EMB,
    minSim: 0.20,
    sizeMB: 87,
    legacy: true,
  },
};

export const CLIP_MODEL_ORDER = ['mobileclip2_s2', 'siglip2_base', 'mobileclip_s1'];
export const DEFAULT_CLIP_MODEL = 'mobileclip2_s2';

/** 解析模型 id → 变体配置；缺/无效都兜底默认（新 S2） */
export function getClipModel(id) {
  return CLIP_MODELS[id] || CLIP_MODELS[DEFAULT_CLIP_MODEL];
}

export default { CLIP_MODELS, CLIP_MODEL_ORDER, DEFAULT_CLIP_MODEL, getClipModel };
