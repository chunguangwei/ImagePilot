# ImagePilot iOS 开发指南

iOS 端工程从零搭起的全套上手 + 真机 + 打包指引。所有命令在仓库根目录 `ImagePilot/` 下执行（除非另注）。

## 工具链版本

| 工具 | 版本 | 验证命令 |
| --- | --- | --- |
| React Native | 0.72.17 | `cat package.json \| grep react-native` |
| Node | 18+（实测 25.3.0） | `node -v` |
| Ruby | 系统 2.6+ 即可 | `ruby -v` |
| CocoaPods | 1.16.2 | `pod --version` |
| Xcode | 15.x / 16.x | `xcodebuild -version` |
| iOS Deployment Target | 14.0 | `head -10 ios/Podfile` |

> **平台范围**：仅 iPhone（不带 iPad / Mac Catalyst）。最低 iOS 14（PhotoKit `.readWrite` 授权和现代 `PHFetchOptions` 都从 14 起；iOS 12/13 全网占比 < 0.5%）。

## 装依赖

```bash
# JS 依赖
npm install --legacy-peer-deps

# iOS Pods（CocoaPods）—— 第一次或 native 依赖有变都要跑
cd ios && pod install && cd ..
```

> Xcode 16+ 的 Clang 默认开 `-Wdeprecated-literal-operator` 会让 Yoga 报错。我们在 `ios/Podfile` 的 `post_install` 已经统一加了 `-Wno-deprecated-literal-operator -Wno-nullability-completeness -Wno-non-modular-include-in-framework-module`，不用手动改。

## 模拟器调试（最常用）

```bash
# 启 Metro
npx react-native start

# 另开一个终端，把模拟器跑起来
npx react-native run-ios --simulator="iPhone 15 Pro"
```

或者在 Xcode 打开 `ios/ImagePilot.xcworkspace` → 选 iPhone 15 Pro Simulator → ▶。

**注意**：模拟器没有真实 PhotoKit 相册——首次运行会用 Apple 自带的"模拟相册"（12 张演示图）；自己加图用 `xcrun simctl addmedia <DEVICE_ID> /path/to/image.jpg`。

## 在真机上跑（开发版）

只需要 Apple Developer 账号（个人或公司都行），不需要 Ad Hoc 设备注册：

1. **Xcode → Settings → Accounts**：把你的 Apple ID 加进去（用过 App Store 的就行）
2. **Xcode 打开 `ios/ImagePilot.xcworkspace`** → Target ImagePilot → Signing & Capabilities
   - ✅ 勾 **Automatically manage signing**
   - Team 选你自己的（Apple ID 关联的 Personal Team 或公司 Team 都行）
3. iPhone 数据线接 Mac，解锁屏幕、点「**信任此电脑**」
4. Xcode 顶部 Scheme 旁的设备下拉里选你的 iPhone
5. ▶ Run

首次安装时 iPhone 会让你去 **设置 → 通用 → VPN 与设备管理** 信任你的 Apple ID 颁发的开发者证书；信完就能打开 ImagePilot。

> Personal Team 签的 app **有效期 7 天**，过期重新装一次即可；付费 Team 签的 **有效期 1 年**。

## Ad Hoc 打包（产物可发其它注册过 UDID 的同事）

前置条件比真机调试多两步：

1. 上面的真机步骤先走通
2. Apple Developer Portal → **Devices** 把目标 iPhone 的 UDID 注册（UDID 在 Xcode → Window → Devices and Simulators 看，或 Apple Configurator 2 / iTunes）
3. Apple Developer Portal → **Profiles** 创建一个 Ad Hoc 类型的 Provisioning Profile，attach 上述 UDID + 你的 distribution 证书

然后填好 `ios/ExportOptions.plist` 里的两个占位符（顶部注释有详细说明）：

```xml
<key>teamID</key>
<string>72LM77TJSN</string>   <!-- 改成你自己的 10 位 Team ID -->

<key>provisioningProfiles</key>
<dict>
    <key>com.chunguangwei.imagepilot</key>
    <string>YOUR_AD_HOC_PROFILE_NAME</string>  <!-- 改成你 Portal 里的 Profile Name -->
</dict>
```

跑打包脚本：

```bash
bash scripts/ios-archive-adhoc.sh
```

成功后产物在 `/tmp/ImagePilot-v<version>-ipa/ImagePilot.ipa`。

**分发方式**：
- 真机：Finder 把 .ipa 拖到接好线的 iPhone（或 Apple Configurator 2 安装）
- 自家用：上传到自有服务器，用 `itms-services://` 链接做 OTA 安装
- TestFlight：本脚本是 ad-hoc 不能用；TestFlight 需要 method 改为 `app-store` 并通过 Transporter.app 上传

## 关键原生模块

- **`PhotoKitModule.swift / .m`** —— 相册全套：requestAuthorization / fetchAllPhotos / deleteAssets / presentLimitedLibraryPicker；继承 `RCTEventEmitter` + 实现 `PHPhotoLibraryChangeObserver` 推增量变化事件 `PhotoLibraryDidChange`
- **`PhotoKitImageLoader.m`** —— 实现 `RCTImageURLLoader` 协议，让 RN `<Image source={{uri:"ph://..."}}/>` 透明走 PHImageManager；带 NSCache LRU（UIImage + PHAsset 两层）
- **`HapticsModule.swift / .m`** —— UIKit 三个 generator（impact / notification / selection）包装给 JS

JS 端入口：
- `src/services/GalleryScannerService.ios.js` —— 全量扫 + 增量监听（订阅 `PhotoLibraryDidChange`）
- `src/utils/haptics.js` —— Haptics 薄包装，Android/web no-op
- `src/ui/ios/theme.js` —— `useIosColors()` 钩子，按 `useColorScheme()` 返回 light/dark 调色板

## Privacy Manifest（Apple 2024 起 App Store 必交）

`ios/ImagePilot/PrivacyInfo.xcprivacy` 已经填了三个 Required Reason：

- **C617.1** — File Timestamp APIs（RNFS 读写本地数据库 / 备份文件修改时间）
- **CA92.1** — User Defaults APIs（AsyncStorage 持久化用户设置 / 自定义分类）
- **35F9.1** — System Boot Time APIs（React Native 内核使用）

CocoaPods Privacy Manifest Aggregation 会在 `pod install` 时把所装 Pods 的 reason 自动并入。**手工只在本文件里记 ImagePilot 自身代码用到的 reason；不要手动删除 CocoaPods 写入的条目。**

新加原生功能（相机/麦克风/位置）时记得在 `Info.plist` 加 `NS<Capability>UsageDescription`，并在 `PrivacyInfo.xcprivacy` 补对应 Required Reason API。

## 隐私承诺（代码层面，不只是文档）

- 默认设备端 ONNX（MobileNetV3）分类，**不联第三方/作者服务器**
- 仅当用户主动配置在线大模型 Provider（OpenAI / Kimi / Claude / Gemini / Ollama / Custom）并选了云端分类时，照片才会发往其自配服务商
- 同 Android 端一致；`GalleryScannerService.ios.js` 严格走相同路由（`forceLocal=true / active='local-onnx'` 走设备端，云端走 `wireLLMRouting`）

## CI / 持续集成

iOS 暂无 CI build job——iOS 模拟器 build 时间长、 GitHub Actions macOS runner 配额贵。本地 `xcodebuild` build 通过即可合 main。

如要加 iOS CI：参考 `.github/workflows/` 下既有的 build matrix（android / windows / macos desktop）。

## 常见问题

**Q：编译报 "Build input file cannot be found: PhotoKitImageLoader.m"**
A：新加的 `.m` 文件 path 必须带 `ImagePilot/` 前缀。用 `ruby` + xcodeproj gem 写脚本调时记得 `f.path = "ImagePilot/Xxx.m"`，参考 commit `0d33580`。

**Q：模拟器图标不显示，只见文字标签**
A：检查 `Info.plist` 的 `UIAppFonts` 是否列了所有 vector-icons ttf。新装的 icon 库要加到这个数组里。

**Q：iOS `<Image source={{uri:"ph://..."}}/>` 报 "No suitable image URL loader"**
A：理论上不该出现——`PhotoKitImageLoader.m` 已经统一接管 `ph://`。如果突然出现，检查这个文件是否在 build target 里。

**Q：MARKETING_VERSION 想升级**
A：在 `ios/ImagePilot.xcodeproj/project.pbxproj` 改两处（Debug + Release），保持和 `package.json` `version` 一致。
