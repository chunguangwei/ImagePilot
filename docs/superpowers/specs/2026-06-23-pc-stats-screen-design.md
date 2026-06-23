# PC 端相册报告（desktop）— 设计文档

> 日期：2026-06-23。PC 端功能拉齐 🟢 档第一个试点，建立「PC desktop 功能开发样板」（复用共享 service + 写 .desktop.js + 接 desktop 入口）。后续去重/回忆/搜索/备份照此模式。

## 目标

PC 端展示相册报告（本地统计），桌面大屏适配。

## 数据源（逻辑零改）

`UnifiedDataService.getAlbumStats()` —— 纯本地聚合，与移动端**同一份**：总量/体积/年度分布/Top 分类/Top 城市/拍照最多的一天/最长视频/AI 描述覆盖率。零联网。desktop 直接调，**不改 service**。
- 实现第一步：核对 `getAlbumStats()` 返回的实际字段名（移动端 StatsScreen.mobile.js 用到 `stats.photos/videos/videoSeconds/totalBytes/earliest/latest/years/aiCoverage` 等，desktop 照用同字段）。

## UI

新建 `src/screens/desktop/StatsScreen.desktop.js`：
- 调 `getAlbumStats()` → 展示统计卡片：
  - **总览**：照片数 / 视频数（含合计时长）/ 占用空间 / 时间跨度 / AI 描述覆盖
  - **年度分布**：各年照片数（列表或简单柱状）
  - **Top 分类** / **Top 城市**
  - **拍照最多的一天** / **最长视频**（getAlbumStats 提供则展示）
- 桌面大屏：**多列卡片布局**（比移动端单列舒展），复用 desktop 现有卡片/容器样式（参考其它 .desktop.js）。
- 加载态（ActivityIndicator）+ 空数据兜底（无照片时友好提示）。

## 入口

desktop 首页（`HomeScreen.desktop.js`）功能区加「相册报告」入口 → 导航到 StatsScreen.desktop。
- 实现第一步：核对 desktop 的导航方式（navigation.navigate 的路由名）+ 首页功能入口区位置，照现有入口模式加。

## 一期不做（YAGNI）

- **分享成图**：移动端用 `view-shot`，桌面端该原生模块不可用；桌面大屏展示 + 用户截屏够用。后续真要再用 html2canvas/electron 截图。

## 样板价值

跑通后沉淀「PC desktop 功能开发模式」：① 找共享 service ② 新建 `Xxx.desktop.js` 调它 ③ desktop UI（大屏适配，复用现有样式）④ 接 desktop 导航/入口。去重/回忆/搜索/备份照此。

## 验证

桌面端（v1.5.69+ 构建）打开相册报告：统计数据正确显示、与移动端一致（同一份 getAlbumStats）；无照片时不报错；大屏布局正常。
