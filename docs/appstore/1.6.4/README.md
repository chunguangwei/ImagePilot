# App Store 更新准备：1.6.4 / build 37

## 当前状态

- 版本 1.6.4 / build 37，包含设置页分组与图标优化及此前分类修复。
- 原 App 包名 `com.chunguangwei.imagepilot`，团队 `CCTFP9X3SW`，保持不变。
- build 37 已归档并覆盖安装启动，严格签名校验通过。归档位于 `dist/releases/1.6.4/ImagePilot-1.6.4-b37.xcarchive`。完整验证及签名导出结果记录在 [发布记录](../../releases/v1.6.4.md)。
- 用户登录 Xcode 后，正式 App Store 分发导出成功，原团队 Apple Distribution 签名核验通过。最终 IPA 位于 `dist/releases/1.6.4/ImagePilot-1.6.4-b37-AppStore.ipa`。
- 2026-11-07 19:34:57 已上传 App Store Connect，上传工具确认 Apple 开始处理。随后处理完成，已创建 1.6.4、关联 build 37 并保存中英文介绍、宣传文本、更新说明和审核说明。2026-11-07 提交成功，状态“正在等待审核”，尚未上架。CLiteRTLM、Hermes dSYM 缺失警告详见发布记录。

## 已准备文案

- `zh-Hans-whatsNew.txt` / `en-US-whatsNew.txt`：汇总此前商店版本之后的主要改进。
- `zh-Hans-description.txt` / `en-US-description.txt`：更新当前模型和规则能力，区分本地推理与用户主动配置的在线处理。
- 两种语言的 `subtitle.txt`、`promotionalText.txt`。
- `review-notes-en.txt`：审核员操作路径及本地/在线分类说明。
- `metadata.json`：版本、build、包名及上述商店字段的结构化副本。

名称、关键词、支持/隐私网址、截图和现有隐私标签未在后台改动。旧上架文档已标记为历史资料，不能继续直接复制旧版“全程不上传”等笼统文案。提交前应核对后台当前版本/build 是否有其他渠道上传的更高编号，以及当前隐私声明与可选第三方处理是否一致。

文案已检查副标题≤30、宣传文本≤170、描述与更新说明≤4000字符。字段规则见 [Apple 平台版本信息](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information)。

## 重新导出与后续步骤

本机原团队分发签名已恢复，build 37 已提交审核。不要重复上传同一 build。

从仓库根目录执行：

```sh
xcodebuild -exportArchive \
  -archivePath /tmp/ImagePilot-1.6.4-b37.xcarchive \
  -exportPath /tmp/ImagePilot-1.6.4-AppStore \
  -exportOptionsPlist ios/ExportOptions-AppStore.plist \
  -allowProvisioningUpdates
```

该配置只导出，不上传。导出成功后核对版本、团队、分发签名、隐私清单和包内规则，再通过 Xcode Organizer 上传，等待 Apple 处理后关联版本、填写文案并提交审核。当前线上状态已核对为“正在等待审核”。参见 [Apple 上传构建说明](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds)。

本版增加设置页分组、统一展开控件和矢量小图标优化。最终构建与上传状态见 docs/releases/v1.6.4.md，旧版归档校验值不可用于本版。
