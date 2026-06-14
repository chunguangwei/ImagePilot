# 时刻秀「剪映式模板一键出片」一期设计

- 日期：2026-06-14
- 状态：待实现
- 关联：记忆 `showcase-video-templates-deferred`、时刻秀导出（#55）

## 1. 目标与范围

让用户在创建时刻秀时**选一个风格模板**，自动套用「全局滤镜 + 单图时长 + 转场 + 片头/片尾标题卡」，一键出片。

**一期方向：广度优先。** 27 个模板全部录入为数据驱动 JSON 表；高级特效（运镜 motion、花式转场遮罩、定制字体、文字动画、节拍卡点、多画幅）一期降级或后置，二期逐步消费。

**核心约束：模板效果必须在「应用内播放」就能看到（全平台，含安卓/华为）**，不能只在 iOS 导出时生效——否则安卓用户选了模板看不到任何变化。导出仍 iOS 先行（安卓 MediaCodec 导出是独立后续项）。

**不碰原生**：一期全 JS，复用现有原生模块（导出/播放/view-shot/jimp），不引新依赖，安卓无需手动注册三件套。

## 2. 现状地基（复用点）

- **时刻秀存储**：`ImageStorageService` `showcases` 表 `{id, name, description, imageIds(JSON), mode, interval, musicPath, createdAt}`。`saveShowcase/listShowcases/deleteShowcase`。
- **播放解析**：`MomentsScreen.mobile.js` `sc.imageIds.map(id => byId.get(id)).filter(Boolean)` → 相册图对象数组（含 uri）。播放（▶ 放映）与导出 `exportShowcaseVideo(sc)` 都消费**解析后的图片对象数组**。
- **创建页**：`ShowcaseCreateScreen.mobile.js`（名称/描述/✨润色/播放模式/单图时长/背景音乐 → `saveShowcase`）。
- **滤镜库**：`jimpFilters.js` `JIMP_FILTERS`（vivid/fade/warm/film/soften/grayscale，部分支持 intensity）+ `applyJimpFilterToBase64(base64, filterId, intensity)`。
- **导出**：`showcaseExport.js` `exportShowcaseVideo` → 逐张 `ImageProcessor.resizeImage(1080)` → `PhotoKitModule.exportSlideshow`（iOS，固定 1080×1920，静帧 + 12 帧交叉淡入）。
- **转场**：应用内播放支持 8 种 mode（淡入/平移/缩放/推入/翻转/弹入/上浮/直切；具体 id 实现时核对 ShowcaseCreate 转场选项）。
- **标题卡素材**：`react-native-view-shot` `captureRef`（StatsScreen 已用）截样式化 View 成图片。

## 3. 架构

### 3.1 模板注册表（纯数据）
`src/config/showcaseTemplates.js` 导出 `SHOWCASE_TEMPLATES`（27 项）。每项保真用户规格全字段（templateId/name/category/aspectRatio/maxPhotos/music/globalFilter/clipRules/textStyle/intro/outro），一期只消费其中 `globalFilter`、`clipRules.defaultDuration`、`clipRules.transition`、`intro`、`outro`、`textStyle`（颜色/对齐/字号近似）；其余字段一期忽略但保留，供二期消费。

### 3.2 套用服务（保存时预生成）
`src/services/showcase/templateApply.js` 导出 `applyTemplate(template, albumImages, slots, onProgress)`：
1. **逐张套滤镜**：`globalFilter` → `filterMap` 映射到 jimp 滤镜 id+intensity → `applyJimpFilterToBase64` → 写缓存文件，得 assetUri。带进度回调。
2. **生成片头/片尾**：把 `intro`/`outro` 文案经**槽位映射**填值 → 渲染 `TitleCard` View → `captureRef` 截图 → 写缓存文件。
3. **组装 items**：`[introItem, ...filteredImageItems, outroItem]`，每项 `{kind:'asset', uri}`（标题卡/滤镜图）。返回 `{items, interval, mode, templateId}`。

`src/services/showcase/filterMap.js`：
- `globalFilter` → `{jimpId, intensity}`：warm_cream→warm、high_saturation→vivid、film_vintage→film、japanese_soft→fade、fresh_clean→**新增 fresh**、candy_bright→**新增 candy**、cold_grey→**新增 coldgrey**。
- `transition` → 现有 8 种 mode：soft_dissolve/fade→淡入、slide/wipe→平移、zoom→缩放、pageflip→翻转、bounce→弹入、flash/glitch/mask_*→直切（降级）。

`jimpFilters.js` 新增 3 个预设：`fresh`（提亮 + 轻降饱和）、`candy`（提亮 + 高饱和）、`coldgrey`（降饱和 + 冷色温）。

### 3.3 槽位映射（零额外表单）
模板 intro/outro 文案里的 `{{变量}}` 统一退化为通用槽：
- `{{name}}/{{name1}}/{{name2}}/{{destination}}/{{babyName}}/...`（主体类）→ 时刻秀**名称**
- `{{date}}/{{year}}`（时间类）→ 选中图片的**拍摄日期**（无则今天）
- 其余小众变量（`{{mileage}}/{{altitude}}/{{price}}/{{age}}/...`）→ 一期**删除该占位**（连同多余符号清理，如 `海拔 {{altitude}} m` → `海拔` 或整行省略）
- 不含变量的固定文案（`ON THE ROAD`/`Merry Christmas`/`NO PAIN NO GAIN`）→ 原样保留

模板可在注册表标 `intro.text:""` 表示无片头（则不生成该卡）。

### 3.4 标题卡组件
`src/components/shared/TitleCard.js`：受控 View，按 `textStyle`（color/对齐/字号近似）+ 主标题/副标题渲染，背景取滤镜后首图或纯色。一期用**系统字体**（手写/书法/打字机/Impact 等 font 后置二期）；文字动画（typing/glitch_in/bounce_in/fade_glow）后置——一期标题卡为静态帧。

### 3.5 数据模型演进（向后兼容）
`showcases` 表新增列 `items TEXT`（JSON，可空）：
- 新建（走模板或不走模板）写 `items`：`[{kind:'album', imageId} | {kind:'asset', uri}]`。
- 旧记录无 `items`：回退用 `imageIds`（全部视作 `kind:'album'`）。
- `saveShowcase` 写 `items`（同时仍写 `imageIds` 取其中 album 项，保旧逻辑/兼容）；`listShowcases` 输出时若有 `items` 用之，否则用 `imageIds`。
- `MomentsScreen` 解析：遍历 items，`album`→`byId.get(imageId)`、`asset`→构造 `{id:'asset_'+uri, uri}`。输出仍是**图片对象数组（含 uri）**。

→ **播放屏与导出零改动**：它们消费图片对象数组，只要每项有可识别 uri（`getUri(img) || img.uri`，现有代码已有 `|| img.uri` 回退；导出 `ImageProcessor.resizeImage(uri)` 吃 uri）。

### 3.6 缓存管理
缓存目录 `<cacheDir>/showcase_assets/<showcaseId>/`。`deleteShowcase` 时递归删该目录。保存失败/取消时清理半成品。

## 4. 创建页改动
`ShowcaseCreateScreen`：
- 顶部加「模板」横向选择行（chip：无模板 / 27 模板按 category 分组）。选中模板时：① 自动填单图时长（chip 高亮模板值，仍可改）；② 显示模板名+一句风格说明。
- 「保存到时刻」：选了模板 → 调 `applyTemplate`（带进度条「正在套用模板 x/y」）→ 用返回的 items/interval/mode 保存；未选模板 → 现有逻辑。
- 滤镜/标题卡预生成耗时（每张 ~1-2s）走进度提示，复用现有 exporting 风格 pill。

## 5. 一期字段落地清单

| 字段 | 一期 |
|---|---|
| globalFilter | ✅ jimp 映射（新增 3 预设） |
| clipRules.defaultDuration | ✅ 放开任意秒 |
| clipRules.transition | ✅ 映射现有 8 种 mode（应用内播放体现；导出仍交叉淡入） |
| intro/outro | ✅ 槽位映射 + 静态样式卡 |
| textStyle 颜色/对齐/字号 | ✅ 近似（系统字体） |
| aspectRatio | ⚠️ 一期统一 9:16（记录不生效） |
| motion / font / animation / beatDetection | ❌ 记录保真，二期 |

## 6. 不在一期（二期/后续）
运镜（Ken Burns/pan/bounce/shake/glitch）、花式转场遮罩（mask_heart/mask_circle/wipe/pageflip 的导出实现）、定制字体、文字动画、节拍卡点（音频分析）、多画幅（16:9/1:1）、**安卓 MediaCodec 导出**。

## 7. 风险
1. **缓存空间**：每个时刻秀多存一份滤镜图 + 2 张标题卡。缓解：缓存按 showcaseId 隔离，删时清理；图按 1080 长边压缩。
2. **保存耗时**：jimp 逐张串行，20 张约 20-40s。缓解：进度条 + 分块 yield（复用 blendBase64Pair 的分块手法），可取消。
3. **view-shot 安卓字体/截图**：StatsScreen 已验证 view-shot 在安卓可用（3.8.0）；标题卡用系统字体规避字体缺失。
4. **旧时刻秀兼容**：items 为空回退 imageIds，已覆盖。
5. **导出标题卡尺寸**：标题卡按 9:16 截图，导出 resize 到 1080×1920 一致。

## 8. 验证方式
- 选「婚礼·永恒誓约」模板 + 3 张图 → 保存（看进度条）→ 应用内播放：暖色滤镜生效、片头「名称 ❤ 名称」、片尾日期、转场为淡入、单图 3.5s。
- 安卓（华为）与 iOS 应用内播放均见模板效果。
- iOS 导出该时刻秀 → MP4 含滤镜图 + 首尾标题卡。
- 删除时刻秀 → 缓存目录清空。
- 旧（无模板/无 items）时刻秀播放/导出不受影响。
- 不走模板创建仍正常（items 全 album 项）。
