# APPX 测试证书签名指南

本指南说明如何使用测试证书对 APPX 包进行签名，以便在本地测试安装。

## 快速开始

### 1. 创建测试证书

```powershell
.\create-test-certificate.ps1
```

这会创建：
- `test-certificate.pfx` - 证书文件（用于签名）
- `test-certificate.cer` - 公钥文件（用于安装到系统）

### 2. 安装证书到受信任根证书颁发机构

**重要：需要管理员权限**

```powershell
# 方法1: 使用批处理脚本（推荐）
.\install-test-certificate.bat

# 方法2: 手动安装
certutil -addstore Root ".\test-certificate.cer"
```

或者双击 `test-certificate.cer`，选择"安装证书" -> "本地计算机" -> "受信任的根证书颁发机构"。

### 3. 打包 APPX

```powershell
npm run electron-pack-appx
```

### 4. 签名 APPX 文件

```powershell
.\sign-appx-with-test-cert.ps1
```

脚本会自动查找最新的 APPX 文件并签名。也可以指定文件路径：

```powershell
.\sign-appx-with-test-cert.ps1 -AppxPath ".\dist\ImagePilot-1.0.0.appx"
```

### 5. 安装并测试

```powershell
.\install-and-test-appx.ps1
```

安装脚本会自动：
1. 检查并签名 APPX（如果未签名）
2. 启用开发者模式（如果需要）
3. 卸载旧版本（如果存在）
4. 安装新版本

## 完整流程脚本

```powershell
# 1. 创建证书（首次运行）
.\create-test-certificate.ps1

# 2. 安装证书（首次运行，需要管理员权限）
.\install-test-certificate.bat

# 3. 打包
npm run electron-pack-appx

# 4. 签名并安装（一键完成）
.\install-and-test-appx.ps1
```

## 常见问题

### Q: SignTool 未找到

**A:** 需要安装 Windows SDK 或 Visual Studio 的 Signing Tools：

1. 下载 Windows SDK: https://developer.microsoft.com/windows/downloads/windows-sdk/
2. 或使用 Visual Studio Installer 安装 "Windows SDK Signing Tools"

也可以运行 `.\find-signtool.ps1` 来查找 SignTool 的位置。

### Q: 证书安装失败

**A:** 确保：
1. 以管理员身份运行 `install-test-certificate.bat`
2. 证书文件 `test-certificate.cer` 存在
3. 如果证书已存在，先删除旧证书再重新安装

### Q: 签名后仍然无法安装

**A:** 检查：
1. 证书是否已安装到"受信任的根证书颁发机构"
2. 开发者模式是否已启用
3. 运行 `signtool verify /pa /v "path\to\app.appx"` 验证签名

### Q: 跳过签名步骤

**A:** 如果已签名，可以使用 `-SkipSign` 参数：

```powershell
.\install-and-test-appx.ps1 -SkipSign
```

## 注意事项

1. **测试证书仅用于本地测试**，不能用于 Microsoft Store 发布
2. 提交到 Microsoft Store 时需要使用正式证书
3. 证书密码默认为 `test123456`，可以在 `create-test-certificate.ps1` 中修改
4. 证书安装到系统后，所有使用该证书签名的 APPX 都可以安装

## 相关文件

- `create-test-certificate.ps1` - 创建测试证书
- `install-test-certificate.bat` - 安装证书到系统
- `sign-appx-with-test-cert.ps1` - 签名 APPX 文件
- `install-and-test-appx.ps1` - 安装并测试 APPX
- `find-signtool.ps1` - 查找 SignTool 工具





