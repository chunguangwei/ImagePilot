# EmbeddingGemma 2 官方用法对照：用户照片（2026-11-07）

## 测试范围

使用用户实际提供的三张照片，未上传照片到任何外部服务：

- 机柜：`mmexport1793886246233.jpg` 原图，预期电子产品。
- 奖杯：`Screenshot_20261106_080918_com.imageclassifier.v2.jpg` 的照片区域 `(0,273,567,756)`，预期艺术绘画。只有截图，不能当成原图测试。
- 合影：`Screenshot_20261105_193424_com.imageclassifier.v2.jpg` 的照片区域 `(0,437,567,430)`，预期社交活动。只有截图，不能当成原图测试。

用本项目 vendored LiteRT-LM 的 iOS arm64 simulator C API 真正执行图文推理，CPU 2 线程；不是 mock 或重放旧分数。模型 SHA-256 为 `92dcbea108899e5d6e30d919b0744f90d9967e80c67a4ab5503ac16d54f62eb0`。输入等比缩至最长边 768，JPEG 质量 90。PNG 对照是在同一 JPEG 解码后转 PNG，以模拟安卓桥接的额外格式转换；不等同于安卓 Bitmap 解码器实测。

对照无前缀、`task: classification | query: `、`task: clustering | query: `，各自使用 70 / 140 视觉 token。保持全部 21 个内置类别、179 条原型/子类型文本不变。每档编码 537 条文本和 3 张图片。所有输出均为 768 维、L2 范数约 1。随后直接复用当前 `embeddingRanking.js` / `embeddingGroups.js` 判定，最小分差 0.005。单条主描述的原始排序也一并保存。

## 主要结果

以下保留当前 Classification 前缀、当前类别聚合与拒判逻辑：

| 输入方式 | 机柜 | 机柜最终前两名分差 | 奖杯 | 合影 |
| --- | --- | ---: | --- | --- |
| JPEG，70 token | 电子产品，接受 | 0.0172 | 艺术绘画，接受 | 社交活动，接受 |
| JPEG 转 PNG，70 token | 电子产品领先，但拒判 | 0.0018 | 艺术绘画，接受 | 社交活动，接受 |
| JPEG，140 token | 电子产品，接受 | 0.0433 | 艺术绘画，接受 | 社交活动，接受 |
| JPEG 转 PNG，140 token | 电子产品，接受 | 0.0372 | 艺术绘画，接受 | 社交活动，接受 |

- 70-token PNG 输入按**单条主描述**排序时植物第一，但当前完整聚合的电子产品仍稍领先并被拒判。没有完整重现用户安卓端“接受植物”的结果。
- 无前缀在 70-token PNG 上接受机柜为电子产品，分差 0.0082；Clustering 为 0.0055。它们在其他照片上的分差没有全面提高，不能据此全局换前缀。
- 140 token 下三种前缀、两种输入格式的完整判定都正确；样本只有三张，不能推断整体准确率。
- 机柜 JPEG / PNG 向量余弦约 0.98147。两种格式各重复三次，同格式结果一致，排除了该测试中的运行随机波动。Pillow 解码的 RGB 平均绝对像素差约为 `[0.165,0.177,0.276]`（0–255），没有明显内容或尺寸变化；仍可能包含解码器/颜色处理和模型敏感性的影响，不能直接称为 PNG 解码 bug。
- 模拟器中 JPEG 图像编码耗时：70 token 约 197–266 ms；140 token 约 381–506 ms，约 1.9 倍。非手机速度，不包含首次文字缓存与完整应用开销。

## 结论与边界

当前证据不支持“Classification 前缀必然用错”或“改类别提示词就能修好”。值得优先做安卓专项验证的是：保持预处理后的 JPEG 直接入模、对不确定图片尝试 140 token。后者还需评估发热与批量延迟，不能宣称无成本提升。

当前没有连接安卓设备。这次未验证安卓运行时、Bitmap 预处理、手机实际输入文件和模型文件 SHA；没有证明用户手机的根因已经修复。本次未修改生产配置、未发版。iOS 模拟器基线正确也不代表安卓真机通过。

官方背景参考：[图文示例](https://ai.google.dev/gemma/docs/embeddinggemma/multimodal-embeddinggemma-with-sentence-transformers)、[440M LiteRT 模型卡](https://huggingface.co/litert-community/embeddinggemma-2-text-vision-440m-litert-lm)。当前 LiteRT 工件仅测试其支持的 70 / 140 token，不套用完整版的更高档位。

完整 36 条对照结果见 [JSON](embedding-official-usage-ab-20261107.json)。本机原始向量、原生探针、输入清单、重复试验与运行日志保存在 `/tmp/imagepilot-doc-ab/`，未将用户照片提交进仓库。

## 后续实施（待发布）

用户确认保留 70 token 后，仅修改安卓 embedding 桥接：直接读取共享预处理后的 JPEG 字节，移除 PNG 重编码。iOS 已直接读取文件。原生字节保真测试在旧实现下失败、新实现下通过；分类相关 3 组 / 40 项 Jest 测试通过；安卓 `:app:compileDebugJavaWithJavac --offline` 编译通过。未改评分、提示前缀或模型权重，未启用 140 token，尚未发布或验证安卓真机分类。
