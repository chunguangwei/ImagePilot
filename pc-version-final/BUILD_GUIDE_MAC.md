# macOS版本构建指南

## 📋 目录
- [方案对比](#方案对比)
- [方案1: 使用GitHub Actions（推荐）](#方案1-使用github-actions推荐)
- [方案2: 在Windows上构建](#方案2-在windows上构建)
- [方案3: 在macOS上构建](#方案3-在macos上构建)
- [常见问题](#常见问题)

---

## 方案对比

| 方案 | 需要MAC | 可签名 | 难度 | 推荐度 |
|------|---------|--------|------|--------|
| **GitHub Actions** | ❌ | ✅ | ⭐ | ⭐⭐⭐⭐⭐ |
| **Windows构建** | ❌ | ❌ | ⭐⭐ | ⭐⭐⭐ |
| **macOS构建** | ✅ | ✅ | ⭐ | ⭐⭐⭐⭐ |

---

## 方案1: 使用GitHub Actions（推荐）

### ✅ 优点
- **完全免费**（每月2000分钟免费额度）
- **自动化构建**：推送代码即自动构建
- **支持代码签名**：可配置Apple证书
- **多架构支持**：同时构建Intel和Apple Silicon版本
- **不需要MAC电脑**

### 📝 步骤

#### 1. 推送代码到GitHub
```bash
git add .
git commit -m "添加macOS构建配置"
git push origin main
```

#### 2. 创建Release Tag（可选）
```bash
git tag v1.0.0
git push origin v1.0.0
```

#### 3. 查看构建进度
- 访问：https://github.com/你的用户名/ImageClassifierApp/actions
- 等待构建完成（约10-15分钟）

#### 4. 下载构建产物
- **开发版本**：在Actions页面的Artifacts中下载
- **正式版本**：在Releases页面下载

### 🔐 配置代码签名（可选）

如果你有Apple开发者账号（$99/年），可以配置签名：

```bash
# 1. 导出证书和Provisioning Profile
# 2. 转换为Base64
base64 -i certificate.p12 -o certificate.base64
base64 -i profile.provisionprofile -o profile.base64

# 3. 在GitHub仓库设置中添加Secrets:
# - MACOS_CERTIFICATE: certificate.base64的内容
# - MACOS_CERTIFICATE_PWD: 证书密码
# - APPLE_ID: 你的Apple ID
# - APPLE_ID_PASSWORD: App专用密码
```

---

## 方案2: 在Windows上构建

### ✅ 优点
- **不需要MAC电脑**
- **快速测试**
- **适合内部分发**

### ⚠️ 限制
- **不能代码签名**
- **不能公证**
- **用户需要"右键-打开"绕过Gatekeeper**

### 📝 步骤

#### 1. 安装依赖
```powershell
cd pc-version-final
npm install
```

#### 2. 构建macOS版本
```powershell
# 构建 DMG 安装包（Intel + Apple Silicon）
npm run electron:build-mac

# 或构建 DMG + ZIP
npm run electron:build-mac-zip
```

#### 3. 查看输出
```powershell
ls dist\
# 你会看到:
# - ImagePilot-1.0.0-x64.dmg
# - ImagePilot-1.0.0-arm64.dmg
```

### 📦 分发方式
1. 将 `.dmg` 文件上传到网盘
2. 告诉用户：
   - 下载DMG文件
   - 双击打开
   - **右键点击应用 → 选择"打开"**（首次需要）
   - 拖动到Applications文件夹

---

## 方案3: 在macOS上构建

### ✅ 优点
- **支持完整签名和公证**
- **用户体验最佳**
- **可上架Mac App Store**

### 📋 前置条件
- macOS电脑
- Xcode命令行工具
- Apple开发者账号（如需签名）

### 📝 步骤

#### 1. 安装Xcode命令行工具
```bash
xcode-select --install
```

#### 2. 创建图标文件
```bash
cd pc-version-final
chmod +x create-mac-icon.sh
./create-mac-icon.sh
```

#### 3. 安装依赖
```bash
npm install
```

#### 4. 构建应用
```bash
# 基础构建（未签名）
npm run electron:build-mac

# 使用Apple证书签名（需要配置）
export CSC_LINK="path/to/certificate.p12"
export CSC_KEY_PASSWORD="your-password"
npm run electron:build-mac
```

#### 5. 公证应用（可选）
```bash
# 需要Apple开发者账号
npx electron-notarize dist/mac/ImagePilot.app \
  --apple-id "your@email.com" \
  --apple-id-password "app-specific-password" \
  --team-id "YOUR_TEAM_ID"
```

---

## 常见问题

### Q1: 在Windows上构建的DMG能正常使用吗？
**A:** 可以！但用户首次打开时需要：
1. 右键点击应用
2. 选择"打开"
3. 确认"打开"

### Q2: 如何支持Intel和Apple Silicon两种架构？
**A:** 已配置！`electron-builder`会自动生成两个版本：
- `ImagePilot-1.0.0-x64.dmg` (Intel)
- `ImagePilot-1.0.0-arm64.dmg` (Apple Silicon)

### Q3: 图标文件(.icns)怎么生成？
**A:** 三种方式：
1. **在macOS上**：运行 `./create-mac-icon.sh`
2. **在线工具**：https://cloudconvert.com/png-to-icns
3. **使用现有的**：electron-builder会自动从PNG转换

### Q4: GitHub Actions构建失败怎么办？
**A:** 常见原因：
1. **依赖安装失败**：检查package.json
2. **图标文件缺失**：确保`public/icon.png`存在
3. **配置错误**：检查`package.json`的build配置

### Q5: 能否同时构建Windows和macOS版本？
**A:** 可以！但需要：
- **在macOS上**：可以构建所有平台
- **在Windows上**：只能构建Windows和macOS（不能构建Linux）
- **GitHub Actions**：可以构建所有平台

---

## 🚀 推荐流程

### 开发阶段
```bash
# 在Windows上快速构建测试
npm run electron:build-mac
```

### 发布阶段
```bash
# 使用GitHub Actions自动构建
git tag v1.0.0
git push origin v1.0.0
# 等待Actions完成，从Releases下载
```

### 正式分发
1. **有Apple开发者账号**：
   - 在macOS上构建 + 签名 + 公证
   - 或在GitHub Actions中配置证书
   
2. **没有Apple开发者账号**：
   - GitHub Actions构建未签名版本
   - 提供安装说明给用户

---

## 📚 相关文档
- [electron-builder文档](https://www.electron.build/)
- [Apple代码签名指南](https://developer.apple.com/support/code-signing/)
- [GitHub Actions免费额度](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions)

---

## 💡 提示

### Windows用户（推荐）
1. 使用GitHub Actions自动构建
2. 无需任何MAC设备
3. 完全免费

### 有MAC的用户（最佳）
1. 在MAC上直接构建
2. 可完整签名和公证
3. 用户体验最好

### 临时需求
1. 在Windows上快速构建DMG
2. 分发给信任的用户测试
3. 后续再考虑签名

