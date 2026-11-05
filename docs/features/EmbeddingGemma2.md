# EmbeddingGemma 2 图文分类

## EmbeddingGemma 2 图文分类测试版（2026-11-05）

Android 测试版本为 **1.5.83-beta.1**，iOS 已接入同一能力，但本次仅提供 Android APK。进入「设置 → 分类模型 → EmbeddingGemma 2 · 测试版」，下载约 **388 MB** 的 440M 图文模型后选择使用。模型不内置 APK，无需同时下载 Gemma4-E2B。

图像与类别名称/规则分别编码为向量，按语义相似度归类，支持自定义类别；不生成图片描述，也不支持文本润色。复杂规则的效果须实测。两端均用 CPU，不依赖 GPU。项目没有语音输入/语音识别，幻灯片背景音乐只是播放，因此无需 740M 音频版。

本地分类与外部 API 是用户主动选择的两种方式。该模型下载或推理失败不会自动调用外部 API。切换模型后，可在分类页选中同一批照片执行「AI 分类」重新测试；仅增量扫描不会重跑所有已分类照片。模型准确率、持续运行温升和耗电尚待真机测试，不能视为已改善。

## 模型来源与实现

- 官方：[Hugging Face LiteRT 模型](https://huggingface.co/litert-community/embeddinggemma-2-text-vision-440m-litert-lm)
- 应用下载：[ModelScope 模型文件](https://modelscope.cn/models/litert-community/embeddinggemma-2-text-vision-440m-litert-lm/resolve/master/embeddinggemma-2-text-vision-440m.litertlm)
- 文件大小：387710976 字节；SHA-256：`92dcbea108899e5d6e30d919b0744f90d9967e80c67a4ab5503ac16d54f62eb0`。下载完成检查文件长度；此处散列供人工校验，不代表客户端已实施散列校验。
- 已验证下载地址可返回 HTTP 206 和 LITERTLM 文件头，尚未完成整个模型的真机下载及推理。
- `classifierModelTiers.js` 定义下载档，`EmbeddingGemmaClassifier.js` 串行处理向量分类、类别缓存及释放。
- 类别输入包含名称、内置或配置中的完整语义描述；自定义规则优先。E2B 共用类别含义。使用 `task: classification | text: ...` 前缀。余弦相似度选择候选类别；非正向匹配或数值并列（差值不超过 1e-6）归入其它。此检查只排除无效/并列结果，不代表结果已达到可靠性门限。相似度不是准确率或校准概率。
- Android `GemmaModule` 与 iOS `LiteRTLMModule` 使用 LiteRT-LM 0.18.0，CPU 两线程、视觉 token 预算 70；与 E2B 切换时释放上一引擎。
- iOS XCFramework 恢复方法见 [运行时说明](../../ios/LiteRTLM/README.md)。

## 测试与限制

同一批图片依次使用 E2B 与新模型进行手动 AI 分类，记录类别正确数、首张耗时、持续处理速度、温升和耗电。类别规则改变后重新运行，确认缓存失效。覆盖下载取消/续传、模型删除、扫描取消、断网离线分类和损坏文件报错。

请记录手机型号、系统版本、应用构建号、样本数量及是否启用外部 API。不得把编译通过当成模型推理通过；不能根据参数量直接宣称不发热。复杂逻辑、否定条件和精细规则不保证符合生成式模型的指令执行效果。

## 发布范围

本次 Android 1.5.83-beta.1 为测试版；为支持 Android 应用内检查更新，Release 取消 prerelease 并设为 latest，保留历史正式版 v1.5.82；iOS 代码同步接入但未发布，PC 不新增此模型入口。历史版本文档保留原记录。

## 1.5.84 修正

新增 `categorySemantics.js` 为 E2B 和 EmbeddingGemma 提供统一类别描述；配置描述和自定义规则不会丢失。`embeddingRecordFields.js` 两端共用，将候选相似度等元数据存入已有 JSON 列 `mobileNetV3Detections.embedding`，无需数据库迁移。

新结果的 `confidence` 为 null，不再显示误导性的百分比。已有 `message`（AI 或手工描述）保持原值，没有图片描述时仍可手工添加。详情页单列“类别说明（非图片描述）”及前五候选相似度，不能将其当作模型针对该照片生成的句子。

旧记录不会被自动重分或猜测来源；请在新版本中对测试样本执行「AI 分类」生成新的诊断记录。已经被旧版清空且没有备份的描述无法由这些改动恢复。自定义规则包含否定或复杂逻辑时，向量匹配仍不等同于指令推理。

## 1.5.85 选中状态修正

选择 EmbeddingGemma 时，Gemma4 变体不再因其是默认偏好而显示选中对勾。Gemma4 的对勾要求当前档位为多模态、当前变体匹配、已下载且未标记不可用；模型下载和选择逻辑不变。

## 1.5.86 可选 LFM 图片描述

EmbeddingGemma 自身仍不生成文本。设置中新增独立、默认关闭的 LFM2.5-VL-450M 描述模型（约 419 MB），可选跟随应用、中文或英文。图文分类后先释放 EmbeddingGemma，再运行描述阶段；每张图清空 LFM 循环状态，最长边 512，最多 160 输出 token。停止或失败不写半成品描述，成功写入已有 message 字段，分类及相似度元数据不变。

- 官方权重：[LiquidAI GGUF](https://huggingface.co/LiquidAI/LFM2.5-VL-450M-GGUF)。下载依赖该站可达，不会偷偷启用外部推理 API。
- Q4_K_M：229313568 字节，SHA-256 `1093f1331319199bbcacdbd7ecc9aa6e5678db6b55073948d0f508be90c8ab68`。
- F16 视觉编码器：189126080 字节，SHA-256 `51b458cfdbc736982145a35f798ce37611af0aab639e58b33473ba0c7815fd99`。
- 客户端验证完整长度与 SHA-256；两个文件完整才可启用。两种语言共用同一对权重。
- llama.rn 0.9.7 支持 RN 0.72 旧架构，锁定精确版本；0.10+ 要求新架构，不能直接升级。两端 CPU、2 线程、n_gpu_layers=0，视觉 use_gpu=false。
- 本地描述是可选增量开销；它不参与本次 EmbeddingGemma 相似度排名，不承诺分类准确率提升。图片描述质量及手机性能需要单独测量。
- 已有图片需手动再次执行 AI 分类；中途停止的未生成描述不自动续跑。生成失败会保留原描述。

### 原生兼容修复

官方 450M 视觉编码器没有输入 LayerNorm；llama.rn 0.9.7 预编译库会报缺少 `mm.input_norm.weight`。`scripts/patch-llama-lfm.js` 在 npm install/ci 后自动应用上游 optional-norm 逻辑，两端必须从源码构建，不能换回未修复预编译库。Android 手动注册 RNLlamaPackage，NDK 固定 27.2；所有 CPU 指令集分支保留，禁用 GPU/NPU 后端。iOS 禁用 Metal，并接入单窗口 Scene 生命周期以兼容本次 Xcode SDK 的启动要求。

真实权重验证：iOS 模拟器上，同一活动合影分别生成中文和英文描述，均成功写入测试回调并释放模型。仅证明本次图文链路可运行，不代表各手机质量、速度、耗电或温升指标。Android 正式构建和手机实测另行记录。
