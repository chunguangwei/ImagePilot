# App Store 更新准备：1.6.3 / build 33

## 当前状态

- 已生成归档：`/tmp/ImagePilot-1.6.3-b33.xcarchive`；持久副本及 ZIP 位于仓库 `dist/releases/1.6.3/`（已忽略，不提交 Git）。
- 原 App 包名：`com.chunguangwei.imagepilot`；团队：`CCTFP9X3SW`，与已知商店标签 ios-appstore-1.5.74-b6 一致。
- 开发签名 1.6.3 build 33 已覆盖安装并启动于 iPhone 13。
- **商店分发导出尚未成功**：Xcode 返回 `No Accounts` 和缺少团队对应的 `iOS Distribution` 证书私钥。开发签名归档不能冒充已导出的 App Store IPA。
- 未上传 App Store Connect，未创建/修改线上商店版本，未提交审核。

## 已准备文案

- `zh-Hans-whatsNew.txt` / `en-US-whatsNew.txt`：汇总此前商店版本之后的主要改进。
- `zh-Hans-description.txt` / `en-US-description.txt`：更新当前模型和规则能力，区分本地推理与用户主动配置的在线处理。
- 两种语言的 `subtitle.txt`、`promotionalText.txt`。
- `review-notes-en.txt`：审核员操作路径及本地/在线分类说明。
- `metadata.json`：版本、build、包名及上述商店字段的结构化副本。

名称、关键词、支持/隐私网址、截图和现有隐私标签未在后台改动。旧上架文档已标记为历史资料，不能继续直接复制旧版“全程不上传”等笼统文案。提交前应核对后台当前版本/build 是否有其他渠道上传的更高编号，以及当前隐私声明与可选第三方处理是否一致。

文案已检查副标题≤30、宣传文本≤170、描述与更新说明≤4000字符。字段规则见 [Apple 平台版本信息](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information)。

## 签名恢复后的继续步骤

在 Xcode → Settings → Accounts 登录有原团队分发权限的账号，确保能使用该团队的发行签名。无需在聊天中提供密码、证书私钥。

从仓库根目录执行：

```sh
xcodebuild -exportArchive \
  -archivePath /tmp/ImagePilot-1.6.3-b33.xcarchive \
  -exportPath /tmp/ImagePilot-1.6.3-AppStore \
  -exportOptionsPlist ios/ExportOptions-AppStore.plist \
  -allowProvisioningUpdates
```

该配置只导出，不上传。导出成功后核对版本、团队、分发签名、隐私清单和包内规则，再通过 Xcode Organizer 上传，等待 Apple 处理后关联版本、填写文案并提交审核。当前未核对线上 App Store Connect 版本状态。参见 [Apple 上传构建说明](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds)。
