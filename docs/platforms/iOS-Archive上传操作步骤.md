# iOS Archive 上传 App Store 操作步骤

> 对照本工程：workspace `ios/ImagePilot.xcworkspace`、scheme `ImagePilot`、
> bundle id `com.chunguangwei.imagepilot`、Team `L35RLT89XN`。
> 版本号/build 号以 `ios/ImagePilot.xcodeproj` 里的 `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` 为准
> （build 号上传前 +1，可叫 Claude 代办，见第 6 节）。
> 全程用 **Xcode 图形界面**最稳；命令行方式见文末附录。

---

## 0. 前置条件（只需第一次）

1. **Apple Developer Program 会员**（个人 $99/年）已激活。
2. **App Store Connect 里已创建 App 记录**：
   - https://appstoreconnect.apple.com → 我的 App → ➕ → 新建 App
   - 平台 iOS；名称（如"芯图相册"）；主要语言 简体中文；
   - **Bundle ID 选 `com.chunguangwei.imagepilot`**（若下拉里没有，先去
     https://developer.apple.com/account → Identifiers 注册这个 App ID）；
   - SKU 随便填个唯一串（如 `imagepilot`）。
3. **签名**：Xcode 里用 Automatically manage signing + 选中 Team `L35RLT89XN` 即可，
   Xcode 会自动生成 Distribution 证书与 App Store 描述文件。

---

## 1. Archive 前检查（30 秒）

- 用 **Xcode 打开 `ios/ImagePilot.xcworkspace`**（不是 `.xcodeproj`——CocoaPods 工程必须开 workspace）。
- 顶部目标选 **ImagePilot**，运行目标选 **"Any iOS Device (arm64)"**
  （插不插真机都行，但**不能选模拟器**，否则 Archive 菜单是灰的）。
- 确认 **scheme 的 Build Configuration 是 Release**：
  Product ▸ Scheme ▸ Edit Scheme ▸ 左侧 Archive ▸ Build Configuration = **Release**。
- 版本号已是 1.5.17、build 是 1（本工程已配好；以后每次上传 build 号要 +1，见第 6 节）。

---

## 2. 生成 Archive

1. Xcode 菜单 **Product ▸ Archive**。
2. 等待编译打包（首次几分钟）。成功后自动弹出 **Organizer** 窗口，
   列出刚生成的 Archive（名称 ImagePilot、版本 1.5.17 (1)）。
   - 若 Archive 菜单是灰的：检查第 1 节的运行目标不是模拟器。
   - 若报签名错误：Signing & Capabilities 里勾 Automatically manage signing + 选对 Team。

---

## 3. 校验（可选但推荐）

在 Organizer 选中该 Archive ▸ 右侧 **Validate App**：
- Distribution method 选 **App Store Connect**；
- 一路 Next（签名用 Automatically manage signing）；
- Validate 通过 = 基本没有会被自动机器拒绝的硬错误（缺图标、缺 build 号、签名问题等）。

---

## 4. 上传

在 Organizer 选中 Archive ▸ **Distribute App**：
1. 选 **App Store Connect** ▸ Next
2. 选 **Upload** ▸ Next
3. 选项默认即可（含 symbols 便于崩溃符号化）▸ Next
4. 签名 **Automatically manage signing** ▸ Next
5. Review 后 **Upload**。
6. 上传成功提示后，App Store Connect 后台会**处理 build（10–30 分钟）**，
   处理完才会出现在 TestFlight / 提交版本的"构建"里。

---

## 5. 在 App Store Connect 提交审核

build 处理完后（会收到邮件）：
1. https://appstoreconnect.apple.com ▸ 你的 App ▸ 左侧 **App Store** 标签 ▸ 当前版本（1.5.17）
2. 填写（文案见 `iOS上架文案与隐私标签.md`）：
   - **名称 / 副标题 / 描述 / 关键词 / 宣传文本 / 此版本更新说明(What's New)**
   - **截图**：至少 **6.7″（iPhone 15 Pro Max 等）** 一套；可用真机截图或 Xcode 模拟器截图
   - **"构建"**：点 ➕ 选刚上传处理好的 build 1.5.17(1)
3. **App 隐私**（左侧 App 隐私）：按文档选 **Data Not Collected**（理由见文档）
4. **价格与销售范围**：免费、选发售地区
5. **App 审核信息**：把文档里的**审核备注**贴进 Notes；无需登录账号
6. **年龄分级**：按问卷如实填（本应用 4+）
7. 右上 **添加以供审核 / Submit for Review**

---

## 6. 以后每次更新（重要）

- **build 号必须递增**：改 `ios/ImagePilot.xcodeproj` 的 `CURRENT_PROJECT_VERSION`
  （现在是 1 → 下次 2、3…），否则上传会被拒"build 号已存在"。
  **👉 此步交给 Claude 代办**：Archive 前对 Claude 说一句「准备上 App Store，把 build 号 +1」即可
  （它会把 pbxproj 里两处 `CURRENT_PROJECT_VERSION` 同步递增并提交）。
- **版本号(MARKETING_VERSION)**：发新版本时按
  `.cursor/skills/update-version/SKILL.md` 一起改（含 iOS 两处）。
- 同一个 MARKETING_VERSION 下可以传多个递增的 build（如修小问题重传）。
- 隐私清单 `ios/ImagePilot/PrivacyInfo.xcprivacy` 已含 FileTimestamp/UserDefaults/SystemBootTime/DiskSpace
  四类 Required Reason 声明（2026-06 校验过），新增第三方 SDK 时才需要重审。

---

## 附录：命令行方式（备选，无需点 Xcode）

本机 RN 0.72 的 `react-native run-ios` 依赖已弃用的 `ios-deploy`，但 **archive/上传不需要它**。

```bash
cd ios

# 1) 生成 archive
xcodebuild -workspace ImagePilot.xcworkspace -scheme ImagePilot \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath /tmp/ImagePilot.xcarchive archive -allowProvisioningUpdates

# 2) 导出 ipa（需要一个 ExportOptions.plist，method=app-store-connect）
xcodebuild -exportArchive -archivePath /tmp/ImagePilot.xcarchive \
  -exportPath /tmp/ImagePilot-ipa \
  -exportOptionsPlist ExportOptions.plist -allowProvisioningUpdates

# 3) 上传（二选一）
#   a. 用 Transporter.app（Mac App Store 免费下载）拖入 ipa 上传，最省心
#   b. 或 notarytool/altool：
xcrun altool --upload-app -f /tmp/ImagePilot-ipa/ImagePilot.ipa \
  -t ios --apiKey <KEY_ID> --apiIssuer <ISSUER_ID>
```

`ExportOptions.plist` 最小内容：
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>L35RLT89XN</string>
  <key>destination</key><string>upload</string>
  <key>signingStyle</key><string>automatic</string>
</dict></plist>
```

> 首次强烈建议走 Xcode 图形界面（第 2–4 节）——签名/描述文件自动处理，少踩坑。
> 命令行适合以后熟悉了做自动化。
