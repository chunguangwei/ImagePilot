# macOS Desktop 与 Windows Desktop 差异说明

本文档总结ImagePilot桌面版在 **macOS** 与 **Windows** 上的实现差异（代码与行为），便于三端测试与维护。

---

## 一、主进程 (public/electron.js)

| 项目 | macOS | Windows |
|------|--------|--------|
| **应用菜单** | 使用系统标准菜单（App 名、Edit、View、Window，含 About/Services/Hide/Quit、Front/Window 等） | 简化菜单（File：Reload/DevTools/Quit；Edit 全选；无 App 名菜单） |
| **窗口图标** | `icon.icns` | `icon.ico` |
| **窗口标题** | 固定为「ImagePilot」（用于 Cmd+Tab 显示）；不随统计更新 | 显示完整统计：「ImagePilot-... \| 总照片: x \| 已分类: x \| 大小: xMB」 |
| **标题栏 overlay** | `title` 传空，配合前端不渲染左侧图标和标题 | 有标题；前端渲染左侧图标 +「ImagePilot」文字 |
| **GPU/硬件加速** | 启用（`hardwareAcceleration: true`） | 禁用（`--disable-gpu` 等命令行开关） |
| **平台依赖** | 启动时跳过（仅打日志 "macOS: skipping platform deps check"） | 检查并可选静默安装 Visual C++ Redistributable（`redist/vc_redist.x64.exe`） |
| **复制到剪贴板** | JXA（JavaScript for Automation）写路径到临时文件，再读入并写入 NSPasteboard | PowerShell + Base64 编码路径，通过 .NET 写入剪贴板 |
| **关闭最后一个窗口** | 不退出应用，保留 Dock 图标，可再次打开窗口 | 退出应用 |
| **window-all-closed** | 不调用 `app.quit()` | 调用 `app.quit()` |

---

## 二、前端 (desktop 共用入口，按平台分支)

| 项目 | macOS | Windows |
|------|--------|--------|
| **标题栏左侧** | 不显示应用图标和「ImagePilot」文字（仅保留右侧设置、暂存箱按钮） | 显示图标 +「ImagePilot」标题 |

（实现位置：`src/screens/desktop/HomeScreen.desktop.js`，`process.platform !== 'darwin'` 时才渲染左侧图标与标题。）

---

## 三、构建与产物

| 项目 | macOS | Windows |
|------|--------|--------|
| **图标格式** | `.icns`（由 `scripts/create-mac-icon.js` 或 `create-mac-icon.sh` 从 `icon.png` 生成） | `.ico` |
| **安装包** | DMG（可选 ZIP） | NSIS 安装包（.exe）、便携版等 |
| **构建命令** | `./build-macos.sh` 或 `npm run electron:build-mac` | `npm run electron:build`（在 Windows 上执行） |

---

## 四、路径与适配层

- **WebAdapters.js**：桌面端共用，内部通过 `process.platform` 区分文件系统、路径分隔等；两平台共用同一套 RNFS/Node fs 封装。
- **路径分隔符**：WebAdapters.native.js 中 Windows 使用 `\`，其余使用 `/`（桌面打包通常走 Web 适配层）。

---

## 五、小结

- **macOS**：系统风格菜单、无标题栏文字、仅「ImagePilot」短标题、JXA 剪贴板、关窗不退出、GPU 开启、无 VC++ 依赖。
- **Windows**：简化菜单、完整标题与统计、PowerShell 剪贴板、关窗即退出、GPU 关闭、可选 VC++ 安装、标题栏带图标与名称。

功能上（选目录、扫描、分类、截图识别、设置、暂存箱等）两平台一致，差异集中在**系统集成与窗口/剪贴板行为**。
