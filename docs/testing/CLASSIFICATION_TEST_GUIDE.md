# 图片智能分类测试指南

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
