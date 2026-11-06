# 模型与安卓更新的国内外下载路线（1.5.92）

## 模型

- 本项目分类与图像增强模型：国内 ModelScope / 海外 GitHub models-v1，失败自动换源；GitHub 加速代理作为额外候选。
- EmbeddingGemma、E2B：明确登记同名仓库的 ModelScope / Hugging Face 文件映射；不猜测任意第三方仓库地址。
- 修复 modelFilenameFromUrl 将所有 ModelScope 仓库误识别为本项目仓库的问题。
- 系统 locale 仅影响源顺序，不证明地理位置。支持 I18nManager.getConstants()。两路失败会显示错误；用户取消不会继续换源。
- 大文件保留断点；大小严格匹配，SmolVLM 两个文件还校验固定 SHA-256。校验失败会清除损坏文件再试另一源。新模型必须重新下载，旧 LFM 文件不会误判为可用 SmolVLM。
- 新增“清理已下线的 LFM / SmolVLM 文件”入口，用户主动清理，不自动删除下载文件或图片。

## 安卓更新

检查更新在 GitHub API 失败后尝试 gh-proxy.com 的 API 加速，再保留 Atom 兜底。APK 按地区偏好使用 GitHub 直连或 gh-proxy.com 加速，下载失败换源；已进入安装阶段的失败不换源、不重复下载安装。保留下载页入口。

下载接收 Release 附件的大小与 SHA-256 digest（如 API 提供），先检查 APK 文件头、大小和哈希，再交给 Android 安装器。第三方加速源不是本项目自有大陆 CDN，不能承诺所有运营商永久可用；Android 覆盖安装仍由系统校验包名与签名。

## 验证与边界

2026-11-06，11 个产品模型文件的 22 条国内外路线均以 Range GET 返回 206、正确文件内容及一致总大小，见 [请求记录](model-source-probes-1592.json)。这不是从两个国家或所有运营商分别进行的网络测试，也不是所有大文件均完整重下。

SmolVLM 主模型分别从 ModelScope 与 Hugging Face 完整下载，两份 SHA-256 均为 `9d4612de6a42214499e301494a3ecc2be0abdd9de44e663bda63f1152fad1bf4`；视觉文件完整校验为 `d1eb8b6b23979205fdf63703ed10f788131a3f812c7b1f72e0119d5d81295150`。安卓 1.5.91 APK 加速链接返回正确 PK 头、382607188 字节总大小；API 加速返回有效 latest 元数据。新发布 APK 必须在发布后再次验证加速路线。

最终上线仅保留 EmbeddingGemma 与 E2B 分类入口。SmolVLM 文件验证记录仅作为下线前实验记录保留；图像增强模型的双路下载继续有效。
