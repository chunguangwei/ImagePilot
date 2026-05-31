"""
export_p2lite.py — 把 MobileCLIP-S0（OpenCLIP 加载） 拆出 image encoder ONNX
+ 用 text encoder 把 9 app 类的提示词预计算成 embeddings 嵌入 JS。

目标：
- mobileclip_image_encoder.onnx  → 上传到 GH Release（models-v1）
- clip_text_embeds.json           → 拷到 src/services/classify/clipTextEmbeddings.json
- meta: input_size / mean / std / embed_dim → 一起写 JSON 头

依赖：
  pip install torch torchvision onnx onnxruntime open_clip_torch

模型：OpenCLIP 的 MobileCLIP-S0
（先用 OpenCLIP 自带的 'MobileCLIP-S0' 权重；fallback ViT-B/32 if 失败）
"""

import json
import torch
import open_clip

# ---- 9 app 类 prompt ensembling（CLIP 标准做法：多 prompt 平均）----
PROMPTS_PER_CLASS = {
    "single_person": [
        "a photo of a single person",
        "a portrait of one person",
        "a selfie of a person",
        "a photo focusing on one person",
    ],
    "social_activities": [
        "a group photo of people",
        "people gathering at an event",
        "friends at a party",
        "a social gathering with multiple people",
    ],
    "travel_scenery": [
        "a landscape photo",
        "a travel destination scenery",
        "an outdoor natural scene",
        "a photo taken while traveling",
        "a beautiful view of nature",
    ],
    "pets": [
        "a photo of a pet at home",
        "a cat or a dog",
        "a domestic animal",
        "a pet portrait",
    ],
    "foods": [
        "a photo of food on a plate",
        "a meal at a restaurant",
        "a delicious dish",
        "food photography",
    ],
    "mobile_screenshot": [
        "a smartphone screenshot",
        "a screen capture of a mobile app",
        "a phone screen photo",
    ],
    "id_photo": [
        "an ID card photo",
        "a passport photo",
        "an official document photo",
    ],
    "qr_code": [
        "a QR code",
        "a barcode",
        "a scannable code",
    ],
    "house_view": [
        "an indoor view of a house",
        "a room interior",
        "a view from a window",
    ],
}

# ---- 模型选择 ----
# 想最小的 MobileCLIP-S1（~21M 图编码器），FP32 onnx 估算 ~85MB
# 若失败用 MobileCLIP-S2 → ViT-B-32 兜底
CANDIDATES = [
    ("MobileCLIP-S1", "datacompdr"),
    ("MobileCLIP-S2", "datacompdr"),
    ("MobileCLIP-B",  "datacompdr"),
    ("ViT-B-32",      "openai"),
]
model = tokenizer = preprocess = None
MODEL_NAME = PRETRAINED = None
for name, tag in CANDIDATES:
    try:
        model, _, preprocess = open_clip.create_model_and_transforms(name, pretrained=tag)
        tokenizer = open_clip.get_tokenizer(name)
        MODEL_NAME, PRETRAINED = name, tag
        print(f"✅ loaded {MODEL_NAME} ({PRETRAINED})")
        break
    except Exception as e:
        print(f"⚠️ {name} ({tag}) failed: {e}")
if model is None:
    raise RuntimeError("no CLIP model loaded")

model.eval()
device = torch.device("cpu")
model = model.to(device)

# ---- 探测输入尺寸 / 归一化 ----
# preprocess 是 torchvision Compose；从里面提
input_size = preprocess.transforms[0].size if hasattr(preprocess.transforms[0], 'size') else 224
if isinstance(input_size, (list, tuple)):
    input_size = input_size[0]
# normalize 一般是最后一项
norm = preprocess.transforms[-1]
mean = list(norm.mean) if hasattr(norm, 'mean') else [0.48145466, 0.4578275, 0.40821073]
std = list(norm.std) if hasattr(norm, 'std') else [0.26862954, 0.26130258, 0.27577711]
print(f"input_size={input_size} mean={mean} std={std}")

# ---- 1) image encoder → ONNX ----
class VisualOnly(torch.nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m
    def forward(self, x):
        feat = self.m.encode_image(x)
        # L2 normalize on device → JS 端不用做
        return feat / feat.norm(dim=-1, keepdim=True)

vis = VisualOnly(model)
vis.eval()
dummy = torch.randn(1, 3, input_size, input_size)
ONNX_PATH = "mobileclip_image_encoder.onnx"
torch.onnx.export(
    vis, dummy, ONNX_PATH,
    input_names=["image"],
    output_names=["embedding"],
    dynamic_axes={"image": {0: "batch"}, "embedding": {0: "batch"}},
    opset_version=17,
    do_constant_folding=True,
)
print(f"✅ exported {ONNX_PATH}")

# 合并 external data（防止 torch.onnx 把权重单独写文件）
import os
import onnx
m_onnx = onnx.load(ONNX_PATH, load_external_data=True)
from onnx.external_data_helper import load_external_data_for_tensor
for tensor in m_onnx.graph.initializer:
    if tensor.HasField('data_location') and tensor.data_location == onnx.TensorProto.EXTERNAL:
        load_external_data_for_tensor(tensor, '.')
        tensor.data_location = onnx.TensorProto.DEFAULT
        del tensor.external_data[:]
INLINE = "mobileclip_image_encoder_inline.onnx"
onnx.save(m_onnx, INLINE)
for f in os.listdir('.'):
    if f.endswith('.onnx.data'):
        os.remove(f)
os.replace(INLINE, ONNX_PATH)
print(f"✅ inlined weights → {ONNX_PATH} ({os.path.getsize(ONNX_PATH)//1024} KB)")

# ---- 2) 9 app 类文本 embeddings ----
text_embeds = {}
with torch.no_grad():
    for cat, prompts in PROMPTS_PER_CLASS.items():
        tokens = tokenizer(prompts).to(device)
        feats = model.encode_text(tokens)
        feats = feats / feats.norm(dim=-1, keepdim=True)
        # ensemble: 多 prompt 平均后再 norm
        avg = feats.mean(dim=0)
        avg = avg / avg.norm()
        text_embeds[cat] = avg.cpu().numpy().tolist()
        print(f"  {cat}: {len(avg)} dim, {len(prompts)} prompts")

# ---- 3) 输出 ----
embed_dim = len(next(iter(text_embeds.values())))
out = {
    "_meta": {
        "model": MODEL_NAME,
        "pretrained": PRETRAINED,
        "input_size": input_size,
        "mean": mean,
        "std": std,
        "embed_dim": embed_dim,
        "categories": list(PROMPTS_PER_CLASS.keys()),
    },
    "embeddings": text_embeds,
}
with open("clip_text_embeds.json", "w") as f:
    json.dump(out, f, separators=(',', ':'))
print(f"✅ wrote clip_text_embeds.json (embed_dim={embed_dim}, {len(text_embeds)} classes)")

# ---- 4) ORT 自检 ----
import onnxruntime as ort
import numpy as np
sess = ort.InferenceSession(ONNX_PATH)
test = np.random.randn(1, 3, input_size, input_size).astype(np.float32)
emb = sess.run(None, {"image": test})[0]
print(f"sanity: image_embed shape={emb.shape}, ||emb||={float(np.linalg.norm(emb)):.4f} (should ≈1)")
