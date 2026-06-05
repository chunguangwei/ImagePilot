#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ImagePilot —— CLIP 档分类模型升级：导出 image encoder 到 ONNX + 计算 9 类文本 embedding。

为什么能零改 App 代码：
  src/services/classify/MobileCLIPClassifier.js 的预处理与维度全部从
  clipTextEmbeddings.json 的 _meta 读取（input_size / mean / std / embed_dim），
  并对图像做 (pixel/255 - mean)/std 的 CHW(RGB) 归一、对图/文向量做余弦相似度。
  所以「换更强的模型」= 重新产出两份产物：
    1) 新的 image encoder ONNX（输入 name='image' [B,3,H,W]，输出 L2 归一的 image features）
    2) 新的 clipTextEmbeddings.json（_meta + 9 类文本 embedding，维度/归一与新模型一致）

推荐模型（精度↑、仍适合端侧；按需取舍体积）：
  - SigLIP2 base/256：open_clip 名 'ViT-B-16-SigLIP2-256'（Google 2025，通常优于原 CLIP）
  - SigLIP base/256 ：'ViT-B-16-SigLIP-256'
  - MobileCLIP2     ：用 Apple ml-mobileclip 仓库（单独安装），端侧最快
  - 兜底/对照       ：'ViT-B-16' pretrained='datacomp_xl_s13b_b90k'

依赖：
  pip install "open_clip_torch>=2.24" torch torchvision onnx onnxruntime pillow numpy
用法：
  python export_clip_to_onnx.py --model ViT-B-16-SigLIP2-256 --pretrained webli \
      --out-dir ./out
产物：
  ./out/clip_image_encoder.onnx
  ./out/clipTextEmbeddings.json   ← 覆盖 src/services/classify/clipTextEmbeddings.json
之后：
  - 把 clip_image_encoder.onnx 传到 GitHub Release（models 那个 tag），
    并在 src/services/classify/classifierModelTiers.js 把 clip 档的 filename/url 指过去
    （或沿用同名覆盖）。
  - 用脚本末尾的自检确认：ONNX 输出维度 == _meta.embed_dim。
"""

import argparse
import json
import os

import numpy as np
import torch
import torch.nn.functional as F

# 9 个 App 内置类别 → 自然语言 prompt 集（prompt ensemble：多句取平均更稳）。
# 想调分类“口味”，改这里的句子即可（中英都行，CLIP/SigLIP 多语种模型对中文也可）。
CATEGORY_PROMPTS = {
    "single_person":    ["a portrait photo of a single person", "a selfie of one person", "a photo focused on one individual"],
    "social_activities":["a photo of people at a social gathering", "a group of friends together", "a party or event with several people"],
    "travel_scenery":   ["a travel landscape photo", "a scenic view of nature or a city", "a photo of a tourist attraction or landmark"],
    "pets":             ["a photo of a pet", "a cute dog or cat", "a domestic animal companion"],
    "foods":            ["a photo of food", "a delicious meal or dish", "food on a plate at a restaurant"],
    "screenshot":       ["a smartphone screenshot", "a screen capture of an app interface", "a screenshot of a phone screen"],
    "idcard":           ["a photo of an ID card or identity document", "a passport, certificate or official document", "a scanned identity card"],
    "electronics":      ["a photo of an electronic device", "a gadget such as a phone, laptop or camera", "consumer electronics product"],
    "qrcode":           ["a QR code", "a barcode or scannable code", "a black and white QR matrix code"],
}
CATEGORY_ORDER = list(CATEGORY_PROMPTS.keys())


def get_open_clip(model_name, pretrained):
    import open_clip
    model, _, preprocess = open_clip.create_model_and_transforms(model_name, pretrained=pretrained)
    tokenizer = open_clip.get_tokenizer(model_name)
    model.eval()
    return model, preprocess, tokenizer


def extract_preprocess_meta(preprocess):
    """从 open_clip 的 val transform 里抽 input_size / mean / std（写进 _meta，App 据此预处理）。"""
    size, mean, std = None, None, None
    for t in getattr(preprocess, "transforms", []):
        name = type(t).__name__
        if name in ("Resize", "RandomResizedCrop") and size is None:
            s = getattr(t, "size", None)
            size = s[0] if isinstance(s, (list, tuple)) else s
        if name == "CenterCrop":
            s = getattr(t, "size", None)
            size = (s[0] if isinstance(s, (list, tuple)) else s) or size
        if name == "Normalize":
            mean = [float(x) for x in t.mean]
            std = [float(x) for x in t.std]
    return int(size or 224), (mean or [0.5, 0.5, 0.5]), (std or [0.5, 0.5, 0.5])


class ImageEncoderWrapper(torch.nn.Module):
    """输入已按 App 端 (x/255-mean)/std 归一的 [B,3,H,W]；输出 L2 归一的 image features。"""
    def __init__(self, clip_model):
        super().__init__()
        self.clip = clip_model

    def forward(self, image):
        feats = self.clip.encode_image(image)
        return F.normalize(feats, dim=-1)


@torch.no_grad()
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True, help="open_clip 模型名，如 ViT-B-16-SigLIP2-256")
    ap.add_argument("--pretrained", required=True, help="预训练权重名，如 webli")
    ap.add_argument("--out-dir", default="./out")
    ap.add_argument("--opset", type=int, default=17)
    args = ap.parse_args()
    os.makedirs(args.out_dir, exist_ok=True)

    model, preprocess, tokenizer = get_open_clip(args.model, args.pretrained)
    input_size, mean, std = extract_preprocess_meta(preprocess)
    print(f"[meta] input_size={input_size} mean={mean} std={std}")

    # 1) 导出 image encoder
    wrapper = ImageEncoderWrapper(model).eval()
    dummy = torch.randn(1, 3, input_size, input_size)
    onnx_path = os.path.join(args.out_dir, "clip_image_encoder.onnx")
    torch.onnx.export(
        wrapper, dummy, onnx_path,
        input_names=["image"], output_names=["image_features"],
        dynamic_axes={"image": {0: "batch"}, "image_features": {0: "batch"}},
        opset_version=args.opset, do_constant_folding=True,
    )
    embed_dim = int(wrapper(dummy).shape[-1])
    print(f"[onnx] {onnx_path}  embed_dim={embed_dim}")

    # 1b) 合并外部权重为单文件（torch 新导出器可能把权重拆成 .onnx.data；App 要单文件）
    import onnx
    onnx.save(onnx.load(onnx_path), onnx_path, save_as_external_data=False)
    for ext_data in (onnx_path + ".data", os.path.join(args.out_dir, "clip_image_encoder.onnx.data")):
        if os.path.exists(ext_data):
            os.remove(ext_data)

    # 2) 计算 9 类文本 embedding（prompt ensemble → 平均 → L2 归一）
    embeddings = {}
    for cat in CATEGORY_ORDER:
        toks = tokenizer(CATEGORY_PROMPTS[cat])
        tfeat = model.encode_text(toks)
        tfeat = F.normalize(tfeat, dim=-1).mean(dim=0)
        tfeat = F.normalize(tfeat, dim=-1)
        embeddings[cat] = [float(x) for x in tfeat.cpu().numpy().tolist()]

    out_json = {
        "_meta": {
            "model": args.model, "pretrained": args.pretrained,
            "input_size": input_size, "mean": mean, "std": std,
            "embed_dim": embed_dim, "categories": CATEGORY_ORDER,
        },
        "embeddings": embeddings,
    }
    json_path = os.path.join(args.out_dir, "clipTextEmbeddings.json")
    with open(json_path, "w") as f:
        json.dump(out_json, f, ensure_ascii=False)
    print(f"[json] {json_path}")

    # 3) 单文件 fp16（带数值校验回退）：fp16 体积减半，但 ViT/CLIP 激活可能溢出 fp16。
    #    用「真实 [0,1] 输入」校验输出有限且 L2≈1；fp16 不达标则回退 fp32，保证产出可用模型。
    import onnxruntime as ort
    from onnxconverter_common import float16
    test_in = np.random.RandomState(0).rand(1, 3, input_size, input_size).astype(np.float32)

    def validate(path):
        sess = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
        o = sess.run(None, {"image": test_in})[0]
        n = float(np.linalg.norm(o[0]))
        ok = (o.shape[-1] == embed_dim == len(embeddings[CATEGORY_ORDER[0]])) and bool(np.isfinite(o).all()) and abs(n - 1.0) < 0.05
        return ok, o.shape[-1], n

    ok32, d32, n32 = validate(onnx_path)
    assert ok32, f"fp32 模型自检失败 dim={d32} norm={n32}"
    m16 = float16.convert_float_to_float16(onnx.load(onnx_path), keep_io_types=True, disable_shape_infer=True)
    fp16_path = onnx_path + ".fp16.onnx"
    onnx.save(m16, fp16_path, save_as_external_data=False)
    ok16, d16, n16 = validate(fp16_path)
    if ok16:
        os.replace(fp16_path, onnx_path)
        print(f"[check] fp16 OK  dim={d16} L2={n16:.4f}  → 单文件 {os.path.getsize(onnx_path)//1024//1024} MB")
    else:
        os.remove(fp16_path)
        print(f"[check] fp16 数值溢出(norm={n16:.2f}) → 回退 fp32  单文件 {os.path.getsize(onnx_path)//1024//1024} MB (dim={d32}, L2={n32:.4f})")

    # 与现网 onnxruntime-react-native 1.17 兼容：降 ir_version 到 8（opset 18 仍受支持；
    # torch 新导出器默认 ir_version 10 可能被 1.17 拒绝 → "Can't load model"）。
    mfin = onnx.load(onnx_path); mfin.ir_version = 8
    onnx.save(mfin, onnx_path, save_as_external_data=False)
    print(f"[ir] ir_version → 8（兼容 onnxruntime 1.17）")

    print("\n完成。把 out/clipTextEmbeddings.json 覆盖 src/services/classify/clipTextEmbeddings.json，"
          "并把 clip_image_encoder.onnx 传到 GitHub Release 后更新 classifierModelTiers.js 的 clip 档 url。")


if __name__ == "__main__":
    main()
