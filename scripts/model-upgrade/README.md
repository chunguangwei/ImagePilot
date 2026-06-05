# 端侧分类模型升级指南（CLIP 档）

> 现状：CLIP 档用 **MobileCLIP-S1**（Apple，2024，已经是现代选型）；basic=MobileNetV3(2019)、
> scene=ResNet18-Places365(骨干 2015) 偏老。**最划算的升级是把 CLIP 档换更强的编码器，并以 CLIP
> 零样本为主分类路径**（还天然支持用户用文字自定义类别）。

## 为什么换模型几乎零改 App 代码

`src/services/classify/MobileCLIPClassifier.js` 的预处理与维度**全部从
`clipTextEmbeddings.json` 的 `_meta` 读取**：

```
INPUT_SIZE = _meta.input_size
MEAN/STD   = _meta.mean / _meta.std      // 图像做 (pixel/255 - mean)/std, CHW, RGB
EMBED_DIM  = _meta.embed_dim             // 运行时还会校验 ONNX 输出维度是否一致
```

所以升级 = 重新产出两份**互相匹配**的产物：
1. **image encoder ONNX**：输入 `name='image'` 形状 `[B,3,H,W]`，输出 **L2 归一**的 image features；
2. **clipTextEmbeddings.json**：`_meta` + 9 类文本 embedding（维度/归一与新模型一致）。

App 端代码无需改动；只需替换 JSON、上传新 ONNX、更新模型 URL。

## 推荐模型（精度↑、仍适合端侧）

| 选项 | open_clip 名 / 来源 | 维度 | 输入 | 备注 |
|---|---|---|---|---|
| **SigLIP2 base/256**（推荐） | `ViT-B-16-SigLIP2-256` / `webli` | 768 | 256 | Google 2025，通常优于原 CLIP |
| SigLIP base/256 | `ViT-B-16-SigLIP-256` / `webli` | 768 | 256 | 稳，多语种 |
| **MobileCLIP2**（端侧最快） | Apple `ml-mobileclip` 仓库 | 512 | 256 | 需单独装 Apple 仓库导出 |
| 对照/兜底 | `ViT-B-16` / `datacomp_xl_s13b_b90k` | 512 | 224 | 经典 CLIP |

> 体积/速度权衡：ViT-B 系列端侧约 80–180MB、单图推理几百 ms（NNAPI/CoreML 加速后更快）。
> 想更小可选 SigLIP small 或 MobileCLIP-S0/S2。

## 操作步骤（在一台有 Python/GPU 的机器上）

```bash
pip install "open_clip_torch>=2.24" torch torchvision onnx onnxruntime pillow numpy
cd scripts/model-upgrade
python export_clip_to_onnx.py --model ViT-B-16-SigLIP2-256 --pretrained webli --out-dir ./out
```

产物：`out/clip_image_encoder.onnx`、`out/clipTextEmbeddings.json`（脚本末尾会自检维度&L2范数）。

接入：
1. 覆盖 `src/services/classify/clipTextEmbeddings.json` ← `out/clipTextEmbeddings.json`
2. 把 `clip_image_encoder.onnx` 传到 GitHub Release（models 那个 tag）
3. 改 `src/services/classify/classifierModelTiers.js` 里 clip 档的 `filename` / `url` 指向新文件
   （或沿用同名直接覆盖 Release 资源）
4. 真机各跑几张验证 top1 合理；必要时回看 `MIN_SIM` 阈值（相似度门槛）。

## 调“分类口味”

改 `export_clip_to_onnx.py` 里的 `CATEGORY_PROMPTS`（每类多句 prompt 取平均），
重跑即可，无需重训模型。想加/删类别也在这里改（同时同步 App 的类别表）。

## 一个可选的精度细节（非必须）

App 端 `preprocessImage` 是把图**直接方形 resize**（不保持长宽比、无 center-crop），
而 open_clip 训练用的是 Resize+CenterCrop。两者有轻微差异（现 MobileCLIP-S1 也如此，效果可接受）。
若想最大化精度，可把 `MobileCLIPClassifier.js` 的预处理改成「短边缩放到 input_size 再中心裁剪」。

## 其它档/辅助模型（按需）

- basic：`MobileNetV3` → **MobileNetV4-conv-small (2024)**（近 drop-in，准确率/延迟更优）；
  或直接弱化此档、以 CLIP 零样本为主。
- scene：`ResNet18-Places365` → 用 CLIP prompt 出场景，省一个模型。
- 抠图：`U2Net-P` → **BiRefNet (2024) / RMBG-2.0**（质量更高，但更大更慢，端侧需权衡）。
- iOS 专属最优：辅助检测（二维码/人脸/证件/OCR）可改用 **Apple Vision 框架**
  （端侧、走神经引擎、零模型下载、App Store 友好）——需写 iOS 原生桥接。
