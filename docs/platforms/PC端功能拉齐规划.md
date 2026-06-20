# PC 端 ↔ 移动端 功能拉齐 · 可行性评估与规划

> 评估日期：2026-06-20。结论：**可行性大**——核心业务逻辑已两端共享、PC 端 ONNX 推理地基已铺好，拉齐主要是「补 desktop UI + 补少数桌面原生能力」，不是重写。
> 原则：**分阶段、先易后难**；大模型能力 PC 端**走云端**（零新基建）；视频导出/本地大模型推理栈单列，按真实需求再投入。

---

## 一、现状对比

| | 移动端 | PC 端(Electron) |
|---|---|---|
| 屏幕数 | **20 个** | **6 个**：Home / Category / ImagePreview / Settings / EnhanceResult / AIModelConfig |
| 业务逻辑(services) | ← **28 个 service + classify/enhance/llm/showcase/image 子目录，两端共享** → | |
| ONNX 推理 | onnxruntime-react-native | **onnxruntime-node ✓ 已装** |
| 图像处理 | jimp | **sharp + jimp ✓ 已装** |
| 文件/路径/URI | ← **`src/adapters/WebAdapters.js`(web/electron) + `.native.js`(RN) 适配层已抹平** → | |
| 视频编码 | MediaCodec / AVAssetWriter | ✗ 无(需引入 ffmpeg) |
| 本地大模型 | LiteRT-LM + Gemma(`.litertlm`) | ✗ 无(LiteRT-LM 是移动框架) |
| 美颜 | ML Kit 人脸 | ✗ 无(需换 ONNX 人脸) |

**PC 端缺的 14 个屏幕**：BackupRestore、Collection、CustomCategories、DocScan、Duplicates、FilterEditor、Inpaint、Moments(回忆/时刻秀)、Search(语义)、ShowcaseCreate、ShowcasePicker、Slideshow、Stats(相册报告)。

---

## 二、功能分档（拉齐难度）

### 🟢 易 — 逻辑全共享，PC 基建够，只缺 desktop UI
> 这些 service 层都现成，**只要写 desktop UI 就能接通**。性价比最高，优先做。

- 语义搜索（SearchScreen）— ClipVectorIndexService / 向量检索逻辑现成
- 相册报告/年报（StatsScreen）— 纯 JS 统计计算
- 重复照片清理（DuplicatesScreen）— ImageSimilarityService 现成
- 回忆（那年今天/节日/旅行）— UnifiedDataService 纯 JS 数据计算
- 时刻秀**应用内放映 / 模板预览**（Slideshow + 不导出的 Showcase）— 纯 UI + 逻辑
- 自定义分类（CustomCategoriesScreen）、集合（CollectionScreen）
- 备份还原（BackupRestoreScreen）— BackupService 现成
- 滤镜编辑（FilterEditorScreen）— jimp/sharp 像素处理

### 🟡 中 — PC 有 ONNX 基建，接通服务 + UI
> onnxruntime-node 已装，跑同一批 ONNX 模型，逻辑接通即可。

- 本地分类档（basic/scene/clip ONNX）— onnxruntime-node 跑
- 超分增强、智能抠图、物体消除 — 均 ONNX，onnxruntime-node 跑
- 文档矫正（DocScanScreen）

### 🔴 难 — 缺桌面原生基建，要引入替代方案（单列、按需做）

- **时刻秀导出 MP4** — `showcaseExport.js` 是纯原生（`PhotoKitModule/MediaStoreModule.exportSlideshow`，无 JS 兜底）。PC 必须引入 **ffmpeg**（Electron 打包 ffmpeg-static + fluent-ffmpeg），独立实现「图片序列 + 转场 + 配乐」合成。
- **PC 本地大模型推理** — LiteRT-LM 是 Google 移动端框架，桌面没有。要跑本地大模型需**换推理栈**（llama.cpp / ollama / onnxruntime-genai）+ **换模型格式**（litertlm → gguf）。spike 级工作。
  - **务实替代（强烈建议）**：PC 要「大模型能力」**走云端**——已有云端 LLM 逻辑（`provider.classify` / queryRewrite），PC 联网稳定，配 API key 即用，**几乎零新基建**。本地大模型在 PC 上投入大、收益不明显，不优先。
- **美颜** — 移动用 ML Kit 人脸，桌面要换 ONNX 人脸检测方案。

---

## 三、关键技术决策

1. **PC 大模型能力 → 走云端,不搬本地**。云端逻辑现成,最快;本地推理栈桌面化是独立大工程,非必要不做。
2. **时刻拆开**：回忆 + 应用内放映(🟢)先做;导出 MP4(🔴 ffmpeg)后置或评估是否需要(PC 用户可录屏替代)。
3. **复用适配层**：新 desktop 功能走 `WebAdapters`(web 分支)抹平 fs/path/uri,不重复造。
4. **ONNX 复用**：分类/超分/抠图/消除在 PC 用 onnxruntime-node 跑**同一批模型文件**,服务层逻辑尽量共享。

---

## 四、分阶段路径（建议）

- **阶段 1（🟢，性价比最高）**：回忆 + 应用内放映 + 语义搜索 + 相册报告 + 去重 + 备份还原 → PC 功能立刻丰满,投入小。
- **阶段 2（🟡）**：本地分类档 + 超分/抠图/消除接 onnxruntime-node。
- **阶段 3（🔴，按需）**：① 大模型 → 接云端(轻);② 时刻秀导出 MP4 → ffmpeg(重);③ 本地大模型推理栈 / 美颜 → 评估是否真要。

---

## 五、价值权衡（要不要做、做多少）

技术可行性大,但 app 主战场是移动(照片在手机里)。PC 端**实际使用价值**决定铺多大:
- 若 PC 只需"能看能管能搜" → 做到 🟢 + 🟡 就够,体验已很完整。
- 若要把时刻秀出片 / 本地大模型全搬上 PC(🔴) → 投入大、PC 用户未必用,**谨慎评估再投**。

**建议**：先做 🟢(阶段1),用最小投入让 PC 大幅追上;🔴 真有需求再单独立项。

---

## 关联
- 适配层：`src/adapters/WebAdapters.js`(web/electron) / `WebAdapters.native.js`(RN)
- 视频导出：`src/services/showcaseExport.js`(纯原生,PC 需 ffmpeg 替代)
- 本地大模型：`src/services/classify/VLMClassifier.{ios,android}.js`(LiteRT-LM,PC 无对应)
- 云端 LLM：`src/services/llm/`(PC 大模型能力建议复用此)
- 待办清单：`docs/待办清单.md`
