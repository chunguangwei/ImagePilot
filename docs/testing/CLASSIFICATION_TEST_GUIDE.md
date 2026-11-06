# 图片智能分类测试指南

## 1.5.84 语义分类回归

- 查看“儿童”“社交活动”“单人照片”等含义是否包含自然语言描述；自定义类别修改规则后，新推理应重新编码。
- 对同一批原图重跑分类，并在详情页记录前五候选的相似度。不能使用带黑边/工具栏的截图代替原图评价分类质量。
- 对已有 AI 描述或手工描述的照片重跑新模型，确认描述保持不变；没有描述时显示手工添加入口和模型能力说明。
- 新结果不显示相似度百分比，类别说明与图片描述分别标注；旧记录须重新分类才有新元数据。
- 模拟向量完全并列或非正匹配时落其它，不应按类别列表顺序强选。
- 仍需真机验证成人合照、儿童、合照背景含卡通角色等样本，比较总耗时与温升。未宣称这些样本已经通过。

## 当前移动端测试：EmbeddingGemma 2（2026-11-05）

旧文中的 YOLO / Windows 脚本为历史测试流程，不适用于本次移动端模型。当前步骤与限制见 [EmbeddingGemma 2](../features/EmbeddingGemma2.md)。

1. 安装 Android 1.5.83-beta.1，选择本地分类，下载并选择新图文模型。
2. 用同一批 20–50 张照片，分别通过多选「AI 分类」重跑 E2B 和新模型，记录正确率、首张耗时、总耗时与温升。
3. 覆盖自定义类别/规则修改、取消后续传、删除模型、扫描取消、断网分类及错误提示；失败不应自动调用外部 API。
4. 本次无语音输入测试；幻灯片音乐播放与模型无关。iOS 真机需要重新编译安装。

自动化命令：`npm test -- --runInBand --watchman=false src/services/classify/__tests__`。现有全量套件有独立的 UpdateService URL 回退断言失败，需与模型测试分开记录。


## 📋 概述

本指南提供了对 `D:\Pictures` 目录下的图片进行智能分类的测试方法，包括模拟版本和真实版本。

## 🚀 快速开始

### 1. 模拟版本测试（推荐先运行）

```bash
node test_simple_classification.js
```

**特点：**
- ✅ 无需模型文件
- ✅ 快速运行
- ✅ 模拟真实分类过程
- ✅ 展示完整的工作流程

### 2. 真实版本测试（需要模型文件）

```bash
node test_real_classification.js
```

**特点：**
- 🔥 使用真实的 YOLO 模型
- 🔥 实际的物体检测和分类
- ⚠️ 需要模型文件：`./models/id_card_detection.onnx` 和 `./models/yolov8s.onnx`

## 📊 测试结果示例

### 分类过程输出
```
📸 正在分类: IMG_20230118_171129.jpg
  ✅ 分类完成: life (81.5%)
  📊 原因: 检测到 3 个物体
  🔧 方法: smart_detection
  🆔 身份证: 否
  🤖 模型: idCard → yolo8s
  ⏱️  耗时: 306ms
  🎯 检测到 3 个物体:
    1. bottle (62.8%)
    2. bottle (81.5%)
    3. person (51.5%)
```

### 分类报告
```
📈 统计信息:
  - 总文件数: 21
  - 已处理: 21
  - 成功: 21
  - 失败: 0
  - 成功率: 100.0%
  - 身份证检测: 0 张
  - 总耗时: 8654ms
  - 平均耗时: 412.1ms/张

📂 分类分布:
  - document: 7 张 (33.3%)
  - life: 5 张 (23.8%)
  - travel: 4 张 (19.0%)
  - people: 3 张 (14.3%)
  - other: 2 张 (9.5%)
```

## 🔧 配置选项

### 修改目标目录
在测试文件中修改 `picturesDir` 变量：
```javascript
this.picturesDir = 'D:\\Pictures';  // 修改为你的目录
```

### 支持的图片格式
```javascript
this.supportedFormats = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'];
```

### 内存管理选项
```javascript
// 单张图片分类后释放内存
const result = await classifier.classifyImage(imagePath, {}, {
  unloadAfterClassification: true
});

// 批量分类后释放内存
const results = await classifier.classifyImages(imagePaths, {}, {
  unloadAfterClassification: true
});
```

## 📁 输出文件

### 1. 控制台输出
- 实时显示分类过程
- 详细的检测信息
- 最终统计报告

### 2. JSON 结果文件
- 文件名：`classification_results_YYYY-MM-DDTHH-mm-ss-sssZ.json`
- 包含完整的分类结果和统计信息
- 可用于后续分析和处理

## 🎯 分类类别

### 应用分类
- `wechat` - 微信截图
- `meeting` - 会议场景
- `document` - 工作照片
- `people` - 社交活动
- `life` - 生活记录
- `game` - 游戏截图
- `food` - 美食记录
- `travel` - 旅行风景
- `pet` - 宠物照片
- `other` - 其他图片

### 身份证检测
- `id_card_front` - 身份证正面
- `id_card_back` - 身份证背面

## 🔍 智能推理流程

1. **身份证检测**：首先使用身份证专用模型检测
2. **条件判断**：如果检测到身份证，停止推理
3. **通用检测**：如果未检测到身份证，使用通用 YOLO 模型
4. **分类映射**：将检测结果映射到应用分类
5. **结果返回**：返回最终分类结果

## ⚠️ 注意事项

### 模型文件要求
- `./models/id_card_detection.onnx` - 身份证检测模型
- `./models/yolov8s.onnx` - 通用物体检测模型

### 系统要求
- Node.js 16+
- 足够的内存（建议 4GB+）
- 支持的图片格式

### 性能考虑
- 首次运行需要加载模型（较慢）
- 批量处理时建议保持模型加载
- 单次使用后可以卸载模型释放内存

## 🐛 故障排除

### 常见问题

1. **模型文件未找到**
   ```
   ❌ 缺少模型文件: ./models/id_card_detection.onnx
   ```
   **解决方案**：确保模型文件存在于指定路径

2. **目录不存在**
   ```
   ❌ 目录不存在: D:\Pictures
   ```
   **解决方案**：修改脚本中的目录路径或创建该目录

3. **依赖导入失败**
   ```
   ❌ 导入 ImageClassifierService 失败
   ```
   **解决方案**：检查文件路径和依赖关系

4. **内存不足**
   ```
   ❌ 分类失败: out of memory
   ```
   **解决方案**：使用 `unloadAfterClassification: true` 选项

## 📈 性能优化

### 批量处理优化
```javascript
// 批量处理时保持模型加载
const results = await classifier.classifyImages(imagePaths, {}, {
  unloadAfterClassification: false  // 批量完成后统一卸载
});
```

### 内存管理
```javascript
// 单次使用后立即释放内存
const result = await classifier.classifyImage(imagePath, {}, {
  unloadAfterClassification: true
});
```

## 🎉 总结

通过这个测试系统，你可以：
- ✅ 验证智能分类功能
- ✅ 了解分类过程和结果
- ✅ 测试不同场景下的性能
- ✅ 获得详细的分类报告
- ✅ 保存结果用于后续分析

开始测试吧！🚀

## LFM 可选描述回归（1.5.86）

1. 默认关闭，EmbeddingGemma 仅分类；不下载或加载 LFM。
2. 下载过程中取消、继续；两个文件均校验完成才能开启；损坏文件不能推理。
3. 分别选择中文、English、跟随应用，对同一组照片重新 AI 分类，确认描述语言、图片信息展示及搜索命中。
4. 照片/视频各一张；视频用抽帧描述。连续不同图片不能沿用上一张的内容。
5. 预处理期间及生成期间点击停止；未完成描述不写入，已完成分类保留。
6. 描述模型不可用或返回空文本时，旧 message 保留；不调用外部 API。
7. 记录 Android / iPhone 13 的耗时、温升、耗电；CPU 基线不依赖 GPU。开启前后分类结果应保持一致。

### 1.5.87：LFM 描述为空与单人照片回归

1. 描述模型已下载且开关开启，选择少量图片手动 AI 分类；完成后检查 AI 描述可展示、可搜索。
2. 图片信息的 LFM 状态应为“已生成并保存”；失败须显示阶段和错误，不能仅看到空描述。模型初始化失败应在所有待处理图片记录失败，不能改写已有描述。
3. 中途停止的未处理图片保持等待/中断状态；失败诊断写入不得改变分类候选分数。
4. 以同一组单人、多人、儿童、风景和服饰图片比较修正前后结果。类别前缀必须为 `task: classification | query: `。禁止用模拟向量测试冒充真实准确率测试。
5. Android 描述故障已定位至旧架构桥接未导出 clearCache；需验证旧桥接失败、补齐后连续生成成功及数据库读回。真实手机分类效果仍需用户样本回归。

### 1.5.87：EmbeddingGemma 2 描述开关

选择 EmbeddingGemma 2 后，在该模型下打开“生成图片描述”，展开 LFM 下载入口。点击“下载并启用”，完成文件校验后自动用于后续分类；已有模型无需重复下载。关闭开关收起配置并保留模型文件。描述语言跟随设备系统语言：中文使用中文，其它语言使用英文，不再提供独立语言按钮；旧语言偏好不再用于描述生成。

Android 描述为空已定位为旧架构缺少 clearCache 桥接，并在 1.5.87 补齐；安装包及 iOS 签名状态见发布记录。

1.5.87 原生回归入口为 `scripts/mobile-caption-smoke.js`，仅供模拟器/测试安装使用，禁止替换正式入口 `index.js`。Documents 中放 sample.jpg 和 classify_models 官方模型，输出 caption-smoke-result.json：检查 bridgeReset、classificationSaved、generated/failed、数据库读回的 message 与 caption.state。

## 1.5.88 中断恢复回归

- 双端 scannerCaptionRecovery 测试：0 张 NA 仍续补、8 张一批串行释放、分类中停止后下轮续补、重新分类保留已有描述。
- 类别测试：有效系统全集 + 自定义类别/规则进入清单，裸名称标签不能绕过类别说明。
- 原生脚本 `scripts/caption-recovery-smoke.js`：在隔离模拟器 Documents 放 rack/trophy/portrait/cat/food/group.jpg 和官方模型；实际分类入 SQLite，重新创建存储客户端并读取精简相册，恢复 pending 队列、生成描述并再次读库。仅用于开发验证，不得用作正式包入口。
- 截图照片裁出图像区域后用于诊断，不能等同于原始照片全分辨率测试；除机柜、奖杯外，回测人像、合影、猫、咖啡。尚不代表真机温升/耗电或整体准确率。

最终补充验证：实际 iOS 扫描器 10 张机柜/奖杯副本按 8+2 批次完成，10 次分类和 10 次描述均成功并逐条读库验证；首页在隐藏空分类、0 张待分类、2 张 pending 时仍显示续补入口。副本验证只用于调度与模型切换，不增加独立分类样本数。
