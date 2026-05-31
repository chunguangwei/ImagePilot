"""
export_places365_onnx.py —— 把 CSAILVision/places365 ResNet18 PyTorch ckpt 导出 ONNX

用途：生成 P1 场景识别档需要的 resnet18_places365.onnx，传到 GitHub Release
      chunguangwei/ImagePilot/releases/tag/models-v1 即可被 app 按需下载。

依赖：
  pip install torch torchvision onnx

步骤：
  1. 从 CSAILVision/places365 下载预训练 ckpt：
     wget http://places2.csail.mit.edu/models_places365/resnet18_places365.pth.tar
  2. 跑这个脚本：
     python scripts/export_places365_onnx.py
  3. 验证：
     python -c "import onnx; m = onnx.load('resnet18_places365.onnx'); print(m.graph.output)"
  4. 上传到 GitHub Release（gh release upload models-v1 resnet18_places365.onnx）

输入：1×3×224×224 float32（ImageNet 归一）
输出：1×365 logits（CSAILVision Places365 标准类别顺序）
"""

import torch
from torchvision import models

CKPT_PATH = 'resnet18_places365.pth.tar'
ONNX_PATH = 'resnet18_places365.onnx'
NUM_CLASSES = 365

# 加载 ResNet18 架构，改最后一层为 365 类
arch = 'resnet18'
model = models.__dict__[arch](num_classes=NUM_CLASSES)

# CSAILVision 的 ckpt 是 DataParallel 包过的，键名有 'module.' 前缀
ckpt = torch.load(CKPT_PATH, map_location='cpu', weights_only=False)
state = ckpt['state_dict'] if 'state_dict' in ckpt else ckpt
clean = {k.replace('module.', ''): v for k, v in state.items()}
model.load_state_dict(clean)
model.eval()

# 导出 ONNX —— 必须 dynamo=False（legacy TorchScript 导出器）
# torch 2.9+ 默认 dynamo=True 出来的 ONNX (opset 18 + 新算子) onnxruntime-react-native
# iOS 端 InferenceSession.create 100% 'Can't load a model: failed to load model'。
# dynamo=False 出来的 onnx 是 ir_version 9 / opset 17，weights inline，两端都能加载。
dummy = torch.randn(1, 3, 224, 224)
torch.onnx.export(
    model, dummy, ONNX_PATH,
    input_names=['input'],
    output_names=['output'],
    dynamic_axes={'input': {0: 'batch'}, 'output': {0: 'batch'}},
    opset_version=17,
    do_constant_folding=True,
    dynamo=False,
)

print(f'✅ 导出: {ONNX_PATH}')

# 简单 sanity check
import onnx
m = onnx.load(ONNX_PATH)
out = m.graph.output[0]
print(f'输出名: {out.name}')
print(f'输出 shape: {[d.dim_value or d.dim_param for d in out.type.tensor_type.shape.dim]}')
