# 端侧分类模型升级指南（CLIP 档）

> **现状（v1.5.17）**：CLIP 档用 **MobileCLIP2-S2（fp32）**，20 类多原型标定，是「AI 智能识别」
> 内容分类核心。basic=MobileNetV3、scene=ResNet18-Places365 为可选档。
>
> **已落地的关键决策（踩过的坑）**：
> - **必须 fp32，不要 fp16**：fp16 模型在 iOS（苹果芯片原生 fp16）正常，但安卓
>   onnxruntime-react-native 1.17 移动版 fp16 算子精度不足 → 安卓分类明显弱于 iOS。
>   实测 fp32 与 fp16 输出逐位等价（cos≈1.0），故端侧分发一律 fp32。
> - **SigLIP2-base 已淘汰**：sigmoid loss 需 logit 温度/偏置校准，裸余弦量纲下几端基本不可用，
>   且体积过大（768 维 ~178MB）。
> - **MobileCLIP-S1 已移除**：旧版，质量不如 S2。
> - **预处理用 cover（短边缩放 + 居中裁剪）**：与 CLIP 训练一致，纯 JS（Jimp）实现、两端一致。

## 为什么换模型几乎零改 App 代码

`src/services/classify/MobileCLIPClassifier.js` 的预处理与维度**全部从
`clipTextEmbeddings.json` 的 `_meta` 读取**：

```
INPUT_SIZE = _meta.input_size
MEAN/STD   = _meta.mean / _meta.std      // 图像做 (pixel/255 - mean)/std, CHW, RGB
EMBED_DIM  = _meta.embed_dim             // 运行时还会校验 ONNX 输出维度是否一致
```

所以换模型 = 重新产出两份**互相匹配**的产物：
1. **image encoder ONNX**：输入 `name='image'` 形状 `[B,3,H,W]`，输出 **L2 归一**的 image features；
2. **clipTextEmbeddings.<变体>.json**：`_meta` + 20 类**多原型**文本 embedding（维度/归一与新模型一致）。

注册表见 `src/services/classify/clipModels.js`（现仅 MobileCLIP2-S2 一个，结构保留便于扩展）。

## 导出要点（踩坑后的固定做法）

```bash
pip install "open_clip_torch>=2.24" torch torchvision onnx onnxruntime onnxconverter_common \
            onnxscript transformers sentencepiece pillow numpy
cd scripts/model-upgrade
python export_clip_to_onnx.py --model MobileCLIP2-S2 --out-dir ./out
# 仅重算文本 embedding（改了 CATEGORY_PROMPTS、不重导 onnx）：加 --text-only
```

脚本已内置以下处理（都是为兼容现网运行时）：
- **ir_version 降到 8**：torch 新导出器默认 ir_version 10，会被 onnxruntime-react-native 1.17 拒绝
  （"Can't load model"）。
- **external data 合并为单文件**。
- **fp16 带数值自检**：用真实 `[0,1]` 输入校验输出有限且 L2≈1（用 randn 会假性溢出 inf）。
  ⚠️ 但**端侧分发请用 fp32**（见顶部"踩过的坑"），fp16 仅作体积参考。

接入：
1. 覆盖/新增 `src/services/classify/clipTextEmbeddings.<变体>.json`
2. 把 image encoder onnx **以 fp32** 传到 GitHub Release（`models-v1` tag）；换内容时文件名带版本/精度
   后缀（如 `_fp32`）以强制旧装机重新下载
3. 在 `clipModels.js` 注册变体（filename/url/embeddings/minSim/sizeMB），必要时改
   `classifierModelTiers.js` 里 clip 档的默认 filename/url
4. 真机各跑几张验证 top1 合理；必要时回看每个变体的 `minSim` 阈值（MobileCLIP 系 cosine ~0.20）。

## 调“分类口味” / 加删类别

改 `export_clip_to_onnx.py` 里的 `CATEGORY_PROMPTS`（每类多句 prompt，**多原型**：保留每句各自的
向量，分类时取最大余弦，召回更高），加 `--text-only` 重跑即可，无需重导 onnx。增删类别同时同步
`public/initialSettings.json`（categoryNameMap + categoryDisplayOrder）与 `categoryUI.js` 的图标表。

> 预处理已统一为 **cover（短边缩放 + 居中裁剪）**，与 CLIP 训练一致、纯 JS 两端一致，
> 不再是早期的"直接方形 resize 拉伸"。

## 其它档/辅助模型（按需）

- basic：`MobileNetV3` → **MobileNetV4-conv-small (2024)**（近 drop-in，准确率/延迟更优）；
  或直接弱化此档、以 CLIP 零样本为主。
- scene：`ResNet18-Places365` → 用 CLIP prompt 出场景，省一个模型。
- 抠图：`U2Net-P` → **BiRefNet (2024) / RMBG-2.0**（质量更高，但更大更慢，端侧需权衡）。
- iOS 专属最优：辅助检测（二维码/人脸/证件/OCR）可改用 **Apple Vision 框架**
  （端侧、走神经引擎、零模型下载、App Store 友好）——需写 iOS 原生桥接。
