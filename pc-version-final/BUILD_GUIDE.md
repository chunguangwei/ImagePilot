# PC版本构建指南

## 📦 支持的构建类型

现在支持两种Windows构建方式：

### 1. 安装版（NSIS）- 推荐 ⭐⭐⭐⭐⭐
- **文件名**：`ImagePilot-Setup-1.0.0.exe`
- **大小**：~80-100MB
- **特点**：
  - ✅ 传统Windows安装程序
  - ✅ 启动速度快（2-3秒）
  - ✅ 自动创建桌面快捷方式
  - ✅ 开始菜单集成
  - ✅ 完整的卸载程序
  - ✅ **不需要Microsoft Store账号**

### 2. 便携版（Portable）
- **文件名**：`ImagePilot-1.0.0-win-x64-portable.exe`
- **大小**：~120-150MB
- **特点**：
  - ✅ 免安装，绿色版
  - ✅ 可在U盘运行
  - ✅ 不写入注册表
  - ⚠️ 启动较慢（5-10秒）

---

## 🚀 构建命令

### 构建安装版（推荐）
```powershell
cd pc-version-final
npm run electron:build
```

**生成文件**：
```
dist/
└─ ImagePilot-Setup-1.0.0.exe  (~90MB)
   - 双击即可安装
   - 用户可选择安装路径
   - 自动创建快捷方式
```

---

### 构建便携版
```powershell
cd pc-version-final
npm run electron:build-portable
```

**生成文件**：
```
dist/
└─ ImagePilot-1.0.0-win-x64-portable.exe  (~140MB)
   - 免安装，直接运行
   - 适合U盘携带
```

---

### 同时构建安装版 + 便携版
```powershell
cd pc-version-final
npm run electron:build-all
```

**生成文件**：
```
dist/
├─ ImagePilot-Setup-1.0.0.exe
└─ ImagePilot-1.0.0-win-x64-portable.exe
```

---

## 📋 完整构建流程

### 第一步：准备环境
```powershell
cd pc-version-final
npm install  # 如果还没安装依赖
```

### 第二步：构建React应用
```powershell
npm run build
```
这会生成 `build/` 文件夹，包含优化后的React应用。

### 第三步：打包Electron应用
选择以下之一：

```powershell
# 方案1：只要安装版（推荐）
npm run electron:build

# 方案2：只要便携版
npm run electron:build-portable

# 方案3：两个都要
npm run electron:build-all
```

### 第四步：测试安装包
```powershell
# 安装版：双击安装测试
.\dist\ImagePilot-Setup-1.0.0.exe

# 便携版：直接运行测试
.\dist\ImagePilot-1.0.0-win-x64-portable.exe
```

---

## ⚡ 性能对比

### 启动速度测试

| 版本类型 | 首次启动 | 再次启动 | 文件大小 |
|---------|---------|---------|---------|
| **安装版** | 3-4秒 | 2-3秒 | ~90MB |
| **便携版** | 8-12秒 | 6-10秒 | ~140MB |

**结论**：安装版速度最快，体验最好！

---

## 🎯 推荐分发策略

### 提供两个版本供用户选择

**下载页面示例**：
```
┌────────────────────────────────────────┐
│  ImagePilot v1.0.0 - Windows版           │
├────────────────────────────────────────┤
│                                        │
│  📦 安装版（推荐）                      │
│  ImagePilot-Setup-1.0.0.exe (90MB)    │
│  [下载]                                │
│                                        │
│  ✨ 特点：                             │
│  • 快速启动（2-3秒）                   │
│  • 自动集成到系统                      │
│  • 完整的安装/卸载体验                 │
│                                        │
├────────────────────────────────────────┤
│                                        │
│  💼 便携版                             │
│  ImagePilot-Portable-1.0.0.exe (140MB)│
│  [下载]                                │
│                                        │
│  ✨ 特点：                             │
│  • 免安装，解压即用                    │
│  • 可在U盘运行                         │
│  • 绿色软件，不写注册表                │
│                                        │
└────────────────────────────────────────┘
```

---

## 📝 配置说明

### NSIS安装程序配置
```json
{
  "nsis": {
    "oneClick": false,                              // 非一键安装，可自定义
    "allowToChangeInstallationDirectory": true,     // 允许选择安装路径
    "allowElevation": true,                        // 允许提升权限
    "perMachine": false,                           // 为当前用户安装
    "createDesktopShortcut": true,                 // 创建桌面快捷方式
    "createStartMenuShortcut": true,               // 创建开始菜单
    "shortcutName": "ImagePilot",                     // 快捷方式名称
    "runAfterFinish": true,                        // 安装完成后运行
    "language": "2052"                             // 简体中文
  }
}
```

---

## 🐛 常见问题

### Q1: 构建失败，提示找不到 icon.ico
**A**: 确保 `public/icon.ico` 文件存在。

### Q2: 构建很慢
**A**: 正常现象，首次构建需要5-10分钟。后续构建会快一些。

### Q3: 生成的安装包能否更名？
**A**: 可以，修改 `package.json` 中的 `version` 和 `productName`：
```json
{
  "version": "1.0.1",
  "build": {
    "productName": "ImagePilot"
  }
}
```

### Q4: 如何添加自动更新？
**A**: 可以集成 `electron-updater`，但需要额外配置更新服务器。

### Q5: 安装版和便携版有功能差异吗？
**A**: 完全没有！只是启动方式和系统集成不同。

---

## 📊 构建输出清单

成功构建后，`dist/` 目录内容：

```
dist/
├─ ImagePilot-Setup-1.0.0.exe           # 安装程序（推荐分发）
├─ ImagePilot-Setup-1.0.0.exe.blockmap  # 更新检查文件
├─ ImagePilot-1.0.0-win-x64-portable.exe # 便携版
├─ builder-debug.yml                     # 构建调试信息
├─ builder-effective-config.yaml         # 实际使用的配置
└─ win-unpacked/                         # 未打包的文件（测试用）
   └─ [完整应用文件]
```

**实际分发**：
- ✅ 安装版：`ImagePilot-Setup-1.0.0.exe`
- ✅ 便携版：`ImagePilot-1.0.0-win-x64-portable.exe`
- ❌ 其他文件：仅供开发调试

---

## ✅ 最佳实践

### 推荐流程
1. **开发阶段**：使用 `npm run electron-dev` 调试
2. **测试阶段**：构建安装版本地测试
3. **发布阶段**：同时构建安装版 + 便携版

### 版本管理
```powershell
# 更新版本号
npm version patch  # 1.0.0 -> 1.0.1
npm version minor  # 1.0.1 -> 1.1.0
npm version major  # 1.1.0 -> 2.0.0

# 然后重新构建
npm run electron:build-all
```

---

## 🎉 总结

**现在你可以**：
- ✅ 生成专业的Windows安装程序
- ✅ 提供便携版供用户选择
- ✅ 完全不依赖Microsoft Store
- ✅ 自由分发，无任何限制

**推荐分发策略**：
1. **主推安装版**（用户体验最好，启动快）
2. **提供便携版**（满足特殊需求，U盘可用）

---

**祝构建顺利！** 🚀

