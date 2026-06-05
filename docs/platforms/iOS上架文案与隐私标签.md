# iOS 上架：App Store 描述文案 + App Privacy 隐私标签答题

> 直接复制粘贴到 App Store Connect。已按各字段字符上限裁剪；描述里**不提安卓/其它平台、不提"下载 APK/检查更新"**（违反审核指南）。
> 准确性已对齐应用实际功能（8 维度分类、20 内容类别、设备端 MobileCLIP2-S2、可选用户自配大模型、本地修图）。

---

## 一、App 信息（中文 简体）

**App 名称**（≤30 字）
```
芯图相册：本地AI照片分类整理
```

**副标题**（≤30 字）
```
设备端AI分类·不上传·无广告
```

**宣传文本 / Promotional Text**（≤170 字，可随时改、不需审核）
```
全程在你的设备上完成照片智能分类与整理：内容、城市、颜色、相似照片一键归类，快速腾空间。不登录、不上传、无广告，隐私由你掌控。
```

**描述 / Description**（≤4000 字）
```
芯图相册是一款隐私优先的智能照片整理工具。它在你的设备本地用 AI 识别并分类照片，帮你快速找到、整理、清理相册——全程不登录、不上传、无广告。

【设备端 AI 智能分类】
采用先进的设备端多模态模型（MobileCLIP2），离线识别照片内容，覆盖 20 个常见类别：单人照、社交活动、儿童、宠物、旅行风景、夜景、建筑、植物花卉、美食、车辆、运动健身、服饰穿搭、商品、电子产品、文档票据、证件照、艺术绘画、卡通表情、手机截图、二维码。识别全部在本地完成，照片不出设备。

【8 大维度，多角度整理】
· 按内容：AI 语义识别照片主题
· 按城市：仅用照片自带的 GPS 信息离线匹配拍摄城市，不联网
· 按颜色：识别主色调归类
· 按存储 / 格式 / 分辨率 / 方向：按文件信息快速归类
· 相似照片：自动找出连拍、重复，方便挑选删除

【四步清理，轻松腾空间】
扫描分类 → 逐类浏览勾选 → 移入暂存箱 → 二次确认后删除或归档。重复照片、过期截图、临时文档，几下就能清干净。

【自定义你的分类】
可删除用不到的默认分类，也可新增自定义类别；删除的照片会回到"待分类"，绝不丢失，随时可恢复。

【本地修图工具】
内置滤镜、AI 清晰增强（超分）、智能抠图、物体消除，全部在设备端完成，不联网。

【隐私，由你掌控】
· 本地分类与修图全程不联网、不上传、不登录
· 唯一的联网情形：当你主动在设置中配置自己的在线大模型（如 OpenAI / Claude 等）并选择云端分类时，照片才会按你指定的服务商发送——发往的是你自己配置的服务，作者不经手、不留存
· 无广告、无内购、无会员、完全免费

让整理照片这件小事，既高效又安心。
```

**关键词 / Keywords**（≤100 字符，英文逗号分隔，勿留空格更省字符）
```
照片整理,相册清理,图片分类,AI识别,智能相册,重复照片,截图清理,本地AI,隐私,腾空间,照片管理,离线
```

**技术支持网址 / 营销网址**
```
https://github.com/chunguangwei/ImagePilot
```

---

## 二、App 信息（English）

**Name** (≤30)
```
ImagePilot: On-Device Photo AI
```

**Subtitle** (≤30)
```
Sort photos locally, no upload
```

**Promotional Text** (≤170)
```
Organize your photo library entirely on your device: sort by content, city, color, and find similar shots to free up space. No login, no upload, no ads.
```

**Description** (≤4000)
```
ImagePilot is a privacy-first photo organizer. It uses on-device AI to recognize and sort your photos so you can quickly find, organize, and clean up your library — with no login, no upload, and no ads.

ON-DEVICE AI CLASSIFICATION
Powered by an advanced on-device multimodal model (MobileCLIP2), it recognizes photo content offline across 20 everyday categories: portraits, social events, kids, pets, travel & scenery, night scenes, architecture, plants, food, vehicles, sports, fashion, products, electronics, documents, ID cards, art, cartoon, screenshots, and QR codes. All recognition happens locally — your photos never leave the device.

8 WAYS TO ORGANIZE
- By content: AI understands what's in the photo
- By city: matched offline from the photo's own GPS data — no network
- By color, storage, format, resolution, orientation: fast metadata-based sorting
- Similar photos: automatically groups bursts and duplicates for easy review

CLEAN UP IN FOUR STEPS
Scan & classify → browse and select by category → move to the staging box → confirm and delete or archive. Clear out duplicates, old screenshots, and temporary documents in a few taps.

MAKE IT YOURS
Delete built-in categories you don't use or add your own. Deleted photos simply return to "Unclassified" — never lost, and restorable anytime.

LOCAL PHOTO EDITING
Built-in filters, AI upscaling, smart cutout, and object removal — all on-device, no network.

PRIVACY, IN YOUR HANDS
- Local classification and editing never connect to the network, upload, or require a login.
- The only time anything is sent online is if you choose to configure your own online model (e.g. OpenAI / Claude) for cloud classification — in which case photos are sent to the provider you configured. The developer never receives or stores them.
- No ads, no in-app purchases, completely free.

Organizing your photos, made effortless and private.
```

**Keywords** (≤100)
```
photo organizer,gallery cleaner,photo sort,on-device AI,duplicate photos,screenshot,offline,privacy,declutter
```

---

## 三、版本更新说明 / What's New（v1.5.17）

**中文**
```
· 「AI 智能识别」内容分类质量提升，识别更准更稳
· 可在「自定义分类」中删除用不到的默认分类（照片回到"待分类"不丢失，可随时恢复）
· 优化模型下载入口与若干界面细节
```

**English**
```
- Improved accuracy and stability of on-device content recognition
- You can now delete built-in categories you don't use (photos return to "Unclassified", never lost, restorable anytime)
- Clearer model-download entry and various UI refinements
```

---

## 四、App Privacy 隐私标签答题（App Store Connect → App 隐私）

### 推荐答案：**Data Not Collected（不收集任何数据）**

**为什么可以这样答**：Apple 对"收集(collect)"的定义是——把数据传输到设备外、且**你（开发者）或你的第三方合作伙伴**能访问。本应用：
- 无账号、无分析 SDK、无开发者后端服务器；
- 照片仅在**用户主动配置自己的大模型**时才离开设备，且发往的是**用户自己的服务商**（用户自己的 API Key），开发者既不接收也不留存——不属于"开发者收集"；
- 城市分类只读照片自带 GPS、离线完成，不外传。

因此在「App 隐私」问卷第一步选 **"No, we do not collect data from this app"（否，我们不从此 App 收集数据）** 是诚实且站得住的。

> 注：`PrivacyInfo.xcprivacy` 已声明 FileTimestamp / UserDefaults / SystemBootTime 三个"必备理由 API"（RN 框架内部使用），`NSPrivacyTracking=false`、`NSPrivacyCollectedDataTypes` 为空——与"不收集"一致。

### 审核备注 / Review Notes（提交时粘贴，预先回答审核员疑问）
**中文**
```
本 App 为本地优先的照片整理工具：
1. 所有照片分类与修图默认在设备端离线完成，不上传、不联网、无需登录、无账号体系。
2. 相册权限用于本地读取照片以分类、预览、整理；导出修图结果时写回相册。
3. 唯一的联网分类是可选功能：仅当用户在"设置 > AI 模型设置"中主动填入自己的第三方大模型（如 OpenAI/Claude）API Key 并选择云端分类时，照片才会发往用户自己指定的服务商。开发者无任何服务器，不接收、不存储任何照片或用户数据。
4. App 不含任何分析/广告/追踪 SDK。
如需，我可提供"仅本地分类"的演示路径（无需配置任何在线模型即可完整体验）。
```
**English**
```
ImagePilot is a local-first photo organizer:
1. All classification and editing run on-device and offline by default — no upload, no network, no login, no accounts.
2. Photo Library access is used to read photos locally for classification/preview/organization, and to save edited results back to the library.
3. The only online classification is optional: photos are sent to a third-party model ONLY when the user enters their own provider API key (e.g. OpenAI/Claude) in Settings and chooses cloud classification — to the user's own configured provider. The developer operates no server and never receives or stores any photo or user data.
4. No analytics, ads, or tracking SDKs are included.
A fully local-only flow is available without configuring any online model.
```

### 若审核坚持要求声明（备选）
如审核员认为"可选云端上传"需声明，则在隐私问卷里只勾 **Photos or Videos**：
- Used for **App Functionality**（仅功能）
- **Not linked to the user's identity**（不与身份关联，因无账号）
- **Not used for tracking**（不用于追踪）
其余数据类别一律不勾。优先用上面的"Data Not Collected + 审核备注"方案，此为退一步的备选。

---

## 五、其它上架字段速查
- **分类**：照片与视频（Photo & Video）
- **年龄分级**：4+（无不良内容）
- **价格**：免费（无内购）
- **出口合规**：`ITSAppUsesNonExemptEncryption=false` 已配置 → Connect 不会追问加密
- **设备**：建议首次仅 iPhone 提交（支持 iPad 需补 iPad 截图与测试）
- **Build 号**：每次上传 `CURRENT_PROJECT_VERSION` 需 +1（当前 1）
