# LiteRT-LM（iOS 本地多模态分类档运行时）

iOS 端「分类模型 → 多模态大模型」档用 Google **LiteRT-LM + Gemma4-E2B** 看图分类，与安卓统一。
这里放官方 LiteRT-LM 的 **Swift 封装源**（`swift/`，已入库）和**预编译框架** `CLiteRTLM.xcframework`（**未入库**）。

## 为什么 xcframework 不入库

`CLiteRTLM.xcframework` 是 ~77MB 的预编译二进制（device + simulator 两份动态库）。iOS 不在 CI 构建矩阵里，
这份二进制对 CI 发版（只构建 Android/桌面）无用，入库只会永久撑大公开仓库 git 历史，故 `.gitignore` 掉。
首次 clone 后要本地构建 iOS，需按下面步骤把它取回。

## 取回 xcframework

从官方 LiteRT-LM Release 下载 `CLiteRTLM.xcframework.zip` 解压到本目录：

```bash
cd ios/LiteRTLM
curl -L -o CLiteRTLM.xcframework.zip \
  https://github.com/google-ai-edge/LiteRT-LM/releases/download/v0.13.0/CLiteRTLM.xcframework.zip
unzip -q CLiteRTLM.xcframework.zip && rm CLiteRTLM.xcframework.zip
# 得到 ios/LiteRTLM/CLiteRTLM.xcframework/（含 ios-arm64 与 ios-arm64-simulator 两个切片）
```

> 版本：Swift 封装源对应 LiteRT-LM v0.13.1；其 `Package.swift` 里 binaryTarget 指向 v0.13.0 的
> `CLiteRTLM.xcframework.zip`（两版框架 ABI 兼容）。

## 接线方式（不走 CocoaPods）

CocoaPods 的 xcframework 解包脚本不在 Swift 模块依赖扫描之前执行，`import CLiteRTLM` 会报
`unable to resolve module dependency`。故改为把 xcframework + `swift/` 源**直接挂到 ImagePilot app target**，
由 Xcode 原生 ProcessXCFramework 选切片。接线脚本（幂等，pod install 后/换机后重跑即可）：

```bash
cd ios
GEM_HOME=/opt/homebrew/Cellar/cocoapods/<ver>/libexec /opt/homebrew/opt/ruby/bin/ruby add_litertlm_module.rb       # 原生模块文件 + 部署目标 15
GEM_HOME=/opt/homebrew/Cellar/cocoapods/<ver>/libexec /opt/homebrew/opt/ruby/bin/ruby add_litertlm_xcframework.rb   # xcframework 链接+嵌入签名 + swift 封装源
```

- 部署目标 iOS 15（`CLiteRTLM.framework` MinimumOSVersion=15）。
- xcframework 只带 arm64 模拟器切片 → app target 已设 `EXCLUDED_ARCHS[sdk=iphonesimulator*]=x86_64`（Apple Silicon 用）。
- 原生模块 `ios/ImagePilot/LiteRTLMModule.swift`（+`.m`），镜像安卓 `GemmaModule.java`。

## 实测运行配置（v1.5.20，iPhone 13/4GB 调通，踩坑结论）

把 Gemma4-E2B 在 iOS 跑通踩了一长串坑，最终可用配置如下，**改这些前务必看这里**：

- **iOS 主后端必须用 CPU**：GPU(Metal) 能 `initialize()` 引擎、却**建不了会话**（`createConversation` 返回
  null → `failedToCreateConversation`），换什么 `maxNumTokens` 都一样；甚至「CPU 主 + GPU 视觉」也会让建会话**卡死**。
  唯有 **主后端与视觉后端都用 CPU** 能稳定出结果（conf 0.9 + 正确中文描述）。慢但可用；GPU 这条路在 iOS LiteRT-LM 上目前走不通。
  （安卓相反：GPU 正常且更快，`GemmaModule.java` 用 GPU。）
- **`maxNumTokens` 必须 = 4096**（模型声明上下文）。填小于它（512/1024/2048）反而让 `createConversation` 失败——「越小越挂」的反直觉坑。
- **不要传 `cacheDir`**：让缓存默认落模型目录。传 `NSTemporaryDirectory()` 会被 iOS 清，且与参考实现「译人」唯一差异就在此。
- **不要在 `ensureEngine` 里探测建会话**：iOS（甚至安卓个别 GPU）的 `createConversation` 探测会**挂住**，把整个流程堵死。直接 init 引擎、到 `classify()` 再建会话。
- **AI 描述显示**：描述生成后必须让 `ImageStorageService.getImages()` 的精简对象带上 `message` 字段，否则 GlobalImageCache→UI 拿不到、详情页不显示（v1.5.20 之前的"分类了却没描述"总根因）。
- **下载**：`.litertlm` 文件头是 ASCII `LITERTLM`（**不是** zip 的 `PK`）——`classifierModelSource` 的 magic 校验按此（base64 前缀 `TElU`）。
- **iPhone 13(4GB) 体验**：CPU 推理较慢（首张含引擎加载更久），整库批量是一次性成本（扫描只处理未分类图）。高端 6GB+ 机若内存够、GPU 会话能建起来，理论上可大幅提速（未实测）。
