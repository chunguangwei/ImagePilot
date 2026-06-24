# PC 端 CLIP 以图搜图（desktop）实现计划

> **For agentic workers:** 桌面端独立精简 service（方案 Y），不碰移动端 classify 链。

**Goal:** 桌面端「以图搜图」（CLIP 向量语义检索）：选一张图 → 全库 CLIP 相似度排序展示。

**Architecture:** 新建桌面独立 service `src/services/desktop/clipImageSearch.js`，自包含——clipModels(纯数据)拿模型 filename/url/meta → electron IPC 下载模型到 userData → `loadOnnxRuntime()` + `ImageProcessor.getPixelData(cover)` Canvas 预处理出 embedding → **自带轻量 IndexedDB 向量库**（不改 imageStorage）→ 全库点积检索。SearchScreen.desktop 加「以图搜图」入口。

**Tech Stack:** onnxruntime-node/web（`ModelPathAdapter.loadOnnxRuntime`）、浏览器 Canvas（`ImageProcessor._getPixelDataWithCanvas`）、Electron `net` 下载、IndexedDB。

## 关键事实（探查实证）
- 桌面端**已验证可跑的 ONNX 路** = `ModelPathAdapter.loadOnnxRuntime()`（WebAdapters.js:2046，Electron→onnxruntime-node，回退 web）+ `ImageProcessor.getPixelData(uri,256,256,{mode:'cover'})`（Canvas，web 分支已实现）。增强那条 ONNX 路在 Electron 也崩，**不用**。
- CLIP 预处理 = `getPixelData(cover 256)` → 每像素 `(v/255 - mean[c])/std[c]` → CHW → `new ort.Tensor('float32', chw, [1,3,256,256])` → `session.run` → 输出 `embedding`[1,512]（**已 L2 归一**）。mean/std/input_size 来自 `clipTextEmbeddings.mobileclip2_s2.json._meta`（input_size=256，见 MobileCLIPClassifier.preprocessImage）。
- 模型：`mobileclip2_s2_fp32_image_encoder.onnx`，147MB，url `https://modelscope.cn/models/chunguangwee/ImagePilot-models/resolve/master/<file>`（GitHub Release 兜底）。**超 GitHub 100MB → 不能进 git → 下载通道**。
- 模型加载用 **Uint8Array**：`fs.readFileSync(absPath)` → `ort.InferenceSession.create(buf, {executionProviders})`（node/web 都接受 buffer，避免 onnxruntime-web 不能读文件路径的问题）。
- 候选图源 `UnifiedDataService.imageCache.getCache().allImages`（IndexedDB-backed，桌面可用）；缩略图 `getUri(img)` 桌面返回 file://。
- 视频：桌面无抽帧模块 → **一期跳过**（只对 `!mimeType.startsWith('video/')` 的图建向量）。

## Global Constraints
- **不改**移动端、不改 imageStorage/ClipVectorIndexService/MobileCLIPClassifier/classifierModelSource。
- 桌面 service 自带 IndexedDB 库 `imagepilot-clip`，store `embeddings`（keyPath `imageId`，值 `{imageId, vec:number[]}`）。向量与 imageStorage 主库分离。
- 检索像素一致性：索引与查询都走同一条桌面 Canvas 预处理，**自洽即可**（不复用移动端索引）。
- 确认/进度用自绘 dialog（照 CategoryScreen.desktop），不用 Alert。

---

## 接口契约

### electron IPC（两个 electron.js 都加：`public/electron.js` + `pc-version-final/public/electron.js`）
- `ipcMain.on('clip-download-model', (e, { url, filename }))`：下载到 `path.join(app.getPath('userData'),'models',filename)`。用 **electron `net`**（自动跟随重定向 + 系统代理）。`.part` 临时文件 + 完成原子 `fs.renameSync`。已存在且 `size>100000` 直接成功跳过。进度 `e.reply('clip-download-progress', { received, total, ratio })`（节流 ~400ms）。结束 `e.reply('clip-download-result', { success, path, error })`。失败删 .part。
- `ipcMain.handle('clip-model-status', (e, { filename }))` → `{ exists:boolean, path:string, size:number }`。

### 桌面 service `src/services/desktop/clipImageSearch.js`（默认导出单例）
- `isReady(): Promise<boolean>` — 模型已下载（clip-model-status size>100000）
- `ensureModel(onProgress?: (ratio:number)=>void): Promise<string>` — 确保模型本地，返回绝对路径（已在→直接返回；否则 clip-download-model + 监听 progress）
- `getEmbedding(uri: string): Promise<number[]>` — Canvas 预处理+ONNX，返回 512 维（已 L2 归一）
- `buildIndex(onProgress?: (done:number,total:number)=>void): Promise<{indexed,skipped,failed,stopped,total}>` — 增量；视频跳过；可中断
- `search(image: {id?:string, uri:string}, opts?: {limit?:number, minScore?:number}): Promise<{results:Array, indexed:number}>` — results 每项 `{...imageRecord, vectorScore}`，按 vectorScore 降序
- `getIndexStats(): Promise<{indexed:number, total:number}>`
- `clearIndex(): Promise<void>`; `requestStop(): void`; `get isBuilding(): boolean`

### SearchScreen.desktop 入口
顶部加「以图搜图」按钮 → `document.createElement('input type=file accept=image/*')` 选图 → `URL.createObjectURL` 得 blob uri → 先确保模型（未下载弹下载进度）+ 确保索引（未建/不全弹建索引进度）→ `clipImageSearch.search({uri:blobUri})` → 复用现有结果网格展示（vectorScore 角标，点开看大图 viewer 复用）。

---

## Phase / Task

### Phase A：electron 下载 IPC（独立）
两个 electron.js 加 `clip-download-model`(on+reply 带进度) + `clip-model-status`(handle)。照现有 `migrate-files`（on+reply 进度样板）与 `select-folder`（handle 样板）。electron `net` 跟随重定向。

### Phase B：桌面 CLIP service + IndexedDB
新建 `clipImageSearch.js`：encoder（loadOnnxRuntime + getPixelData cover + mean/std + Tensor + run，session 单例缓存）；模型下载封装（IPC）；IndexedDB 向量库（open/save/readAll/deleteByIds/clear）；buildIndex/search/getIndexStats/clearIndex（逻辑移植自 ClipVectorIndexService，视频跳过）。

### Phase C：SearchScreen.desktop 以图搜图入口
顶部「以图搜图」按钮 + 模型下载引导（进度）+ 建索引引导（进度+可停）+ 调 search + 结果展示（复用现网格 + viewer）。

### Phase D：发版
bump 5 处 + README/待办 → PR → CI。用户桌面端真机验证（下载模型→建索引→以图搜图）。

## 风险
- 桌面 ONNX 推理 / 预处理像素一致性：只能桌面真机验证（命门）。encoder 加详细 log（输出维度、L2 norm≈1、chwMean）便于定位。
- onnxruntime-node 在 renderer 加载失败→回退 web（WASM，loadOnnxRuntime 已有兜底）；147MB fp32 WASM create 可能数秒。craco 需确保 ort-wasm 资源不丢。
- 147MB 下载：进度条 + 可取消；ModelScope 重定向用 electron net 处理。
- 性能：全库点积 O(N·512) 纯 JS，数万张几十毫秒可接受；建索引每张一次 ONNX（数百 ms/张），需分批+可中断。
