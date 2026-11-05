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
- 类别输入包含名称与规则，使用 `task: classification | text: ...` 前缀。余弦相似度选择候选类别，不使用 MobileNet 概率门限；相似度不是准确率或校准概率。
- Android `GemmaModule` 与 iOS `LiteRTLMModule` 使用 LiteRT-LM 0.18.0，CPU 两线程、视觉 token 预算 70；与 E2B 切换时释放上一引擎。
- iOS XCFramework 恢复方法见 [运行时说明](../../ios/LiteRTLM/README.md)。

## 测试与限制

同一批图片依次使用 E2B 与新模型进行手动 AI 分类，记录类别正确数、首张耗时、持续处理速度、温升和耗电。类别规则改变后重新运行，确认缓存失效。覆盖下载取消/续传、模型删除、扫描取消、断网离线分类和损坏文件报错。

请记录手机型号、系统版本、应用构建号、样本数量及是否启用外部 API。不得把编译通过当成模型推理通过；不能根据参数量直接宣称不发热。复杂逻辑、否定条件和精细规则不保证符合生成式模型的指令执行效果。

## 发布范围

本次 Android 1.5.83-beta.1 为独立预发布，保留正式版 v1.5.82；iOS 代码同步接入但未发布，PC 不新增此模型入口。历史版本文档保留原记录。
