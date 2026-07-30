# Windows App Certification Kit (WACK) 测试指南

## 问题：路径过长错误

WACK 工具在测试 APPX 时可能会遇到路径过长的问题：
```
System.IO.PathTooLongException: 指定的路径或文件名太长或者两者都太长。
完全限定文件名必须少于 260 个字符并且目录名必须少于 248 个字符。
```

这是因为 WACK 在解压 APPX 文件时，临时目录路径 + APPX 内部文件路径可能超过 Windows 的 260 字符限制。

## 解决方案

### 方法1：使用准备脚本（推荐）

运行准备脚本，将 APPX 文件复制到短路径（如 `C:\WACK\`）：

```powershell
# 复制到短路径（不签名）
.\prepare-for-wack.ps1

# 复制到短路径并签名
.\prepare-for-wack.ps1 -Sign
```

脚本会自动：
1. 查找最新的 APPX 文件
2. 复制到 `C:\WACK\` 目录（短路径）
3. 可选：使用测试证书签名
4. 显示文件路径和长度信息

### 方法2：手动复制到短路径

手动将 APPX 文件复制到短路径：

```powershell
# 创建短路径目录
New-Item -ItemType Directory -Path "C:\WACK" -Force

# 复制文件
Copy-Item ".\dist\ImagePilot-1.0.0.appx" -Destination "C:\WACK\ImagePilot-1.0.0.appx"
```

### 方法3：使用短路径名（8.3格式）

使用 PowerShell 获取短路径名：

```powershell
$fso = New-Object -ComObject Scripting.FileSystemObject
$shortPath = $fso.GetFile(".\dist\ImagePilot-1.0.0.appx").ShortPath
Write-Host $shortPath
```

## 关于签名

**WACK 可以测试签名的 APPX，也可以测试未签名的 APPX。**

### 建议：先签名再测试

原因：
1. 测试完整的签名流程
2. 验证签名是否正确
3. 更接近实际发布场景

### 签名步骤

```powershell
# 1. 创建测试证书（首次运行）
.\create-test-certificate.ps1

# 2. 签名 APPX
.\sign-appx-with-test-cert.ps1

# 3. 准备用于 WACK（复制到短路径）
.\prepare-for-wack.ps1 -Sign
```

## 使用 WACK 测试

1. **打开 Windows App Certification Kit**
   - 在开始菜单搜索 "Windows App Certification Kit"
   - 或运行：`WinAppCertKit.exe`

2. **选择测试类型**
   - 选择 "Validate Windows App"

3. **选择 APPX 文件**
   - 浏览并选择 `C:\WACK\ImagePilot-1.0.0.appx`
   - 或使用准备脚本输出的路径

4. **开始测试**
   - 点击 "Next" 开始测试
   - 等待测试完成

5. **查看结果**
   - 查看测试报告
   - 修复发现的问题
   - 重新测试

## 常见问题

### Q: 路径仍然太长怎么办？

**A:** 尝试：
1. 使用更短的目录名（如 `C:\T\app.appx`）
2. 使用短路径名（8.3格式）
3. 确保 APPX 内部文件路径不要太长

### Q: 必须签名才能测试吗？

**A:** 不是必须的，但建议签名：
- WACK 可以测试未签名的 APPX
- 但签名后的测试更完整
- 可以验证签名是否正确

### Q: 测试证书可以用于 WACK 吗？

**A:** 可以：
- 测试证书可以用于 WACK 测试
- 但不能用于 Microsoft Store 发布
- Store 发布需要使用正式证书

## 相关文件

- `prepare-for-wack.ps1` - 准备 APPX 文件用于 WACK 测试
- `sign-appx-with-test-cert.ps1` - 签名 APPX 文件
- `create-test-certificate.ps1` - 创建测试证书
- `APPX_TEST_CERT_GUIDE.md` - 测试证书签名指南





