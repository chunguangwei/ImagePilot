# 项目文档索引

## 📁 文档目录结构

```
docs/
├── README.md                    # 本文档索引
├── architecture/                # 架构设计文档（15个文档）
├── design/                     # UI/UX 设计文档（4个文档）
├── testing/                     # 测试文档（4个文档）
├── User/                        # 用户指南（5个文档）
├── harmonyos/                   # 鸿蒙(HarmonyOS)相关文档（10个文档）
├── platforms/                   # 平台相关文档
│   ├── macOS/                   # macOS平台文档（4个文档）
│   └── android/                 # Android/华为平台文档（6个文档）
├── features/                     # 功能特性文档
│   ├── ai-enhancement/          # AI图像增强功能（2个文档）
│   ├── api/                      # API调用指南（1个文档）
│   ├── image-preview/            # 图片预览功能（2个文档）
│   └── mediastore/              # MediaStore集成（4个文档）
├── implementation/              # 技术实现细节（3个文档）
└── work-summary/                # 工作总结（4个文档）
```

---

## 📚 文档分类说明

### 🏗️ 架构设计文档 (architecture/)

#### 移动端适配系列
- **service层移动端适配分析报告.md** - Service 层移动端适配详细分析
- **service层移动端适配改动总结.md** - Service 层适配改动总结和测试指南
- **移动端重写分析报告.md** - 移动端重写的完整技术分析
- **移动端移植最终改动汇总.md** - 移动端移植的最终改动汇总
- **移动端移植完整改动清单.md** - 移动端移植的完整改动清单
- **移动端适配改动总结.md** - 移动端适配的总体改动总结

#### 适配器系列
- **Canvas统一适配方案.md** - Canvas API 跨平台适配方案
- **WebAdapters统一Platform对象说明.md** - WebAdapters 平台检测说明

#### 项目架构
- **CodeStructure20250911.md** - 项目代码结构文档
- **YOLOv8_DEPENDENCIES.md** - YOLOv8 依赖说明
- **技术实现方案.md** - 整体技术实现方案
- **照片分类APP20250910.md** - 项目早期设计文档
- **照片分类APP20250911.md** - 项目设计更新版

#### 功能特性
- **分页功能使用示例.md** - 分页功能实现示例
- **动态布局简化总结.md** - 动态布局优化总结

---

### 🎨 设计文档 (design/)

- **APP_UI设计原型.md** - 应用 UI 设计原型
- **PC端UI设计.md** - PC 端 UI 设计规范
- **手机图片分类APP设计方案.md** - 移动端 UI 设计方案
- **移动端界面设计方案-v2.0.md** - 移动端界面设计 v2.0

---

### 🧪 测试文档 (testing/)

#### 测试指南
- **PC端回归测试清单.md** - PC 端回归测试完整清单
- **CLASSIFICATION_TEST_GUIDE.md** - 分类功能测试指南
- **测试用例文档-漏斗式扫描流程.md** - 漏斗式扫描流程测试用例

#### 问题修复
- **IndexedDB修复说明.md** - IndexedDB 保存错误修复文档

---

### 👤 用户指南 (User/)

- **照片创玩功能介绍.md** - 照片创玩功能详细说明
- **照片创玩宣传介绍.md** - 照片创玩功能宣传文档
- **ImagePilot使用指南.md** - ImagePilot完整使用指南
- **ImagePilot快速清理指南.md** - 快速清理功能指南
- **ImagePilot权限设置说明.md** - 权限设置说明

---

### 🎯 鸿蒙相关文档 (harmonyos/)

#### 适配评估
- **鸿蒙适配可行性评估报告.md** - 鸿蒙适配可行性评估
- **鸿蒙适配可行性评估报告-最终版.md** - 最终版评估报告
- **鸿蒙适配方案-快速上线版.md** - 快速上线适配方案
- **鸿蒙项目结构设计.md** - 鸿蒙项目结构设计

#### 库支持情况
- **鸿蒙库支持情况对比分析.md** - RN库支持情况对比分析
- **鸿蒙库支持情况检查清单.md** - 库支持检查清单

#### 环境配置
- **鸿蒙开发环境安装指南.md** - 开发环境安装详细指南
- **鸿蒙环境安装步骤.md** - 环境安装步骤
- **鸿蒙环境快速开始.md** - 快速开始指南

---

### 📱 平台相关文档 (platforms/)

#### macOS平台 (platforms/macOS/)
- **macOS应用测试方案.md** - macOS应用测试方案
- **macOS构建测试快速参考.md** - 构建测试快速参考
- **macOS桌面版构建方案.md** - 桌面版构建方案
- **macOS测试指南-给测试者.md** - 测试者指南

#### Android/华为平台 (platforms/android/)
- **华为手机开发人员选项开启指南.md** - 开发人员选项开启指南
- **华为手机调试配置指南.md** - 华为手机调试配置完整指南
- **查看Release版本日志指南.md** - Android Release版本日志查看完整指南
- **后台扫描实现方案.md** - Android后台扫描前台服务实现方案
- **获取pepk.jar说明.md** - 如何获取华为应用签名工具pepk.jar

---

### ⚡ 功能特性文档 (features/)

#### AI图像增强 (features/ai-enhancement/)
- **AI图像增强功能-实现计划.md** - AI图像增强功能实现计划
- **AI图像增强功能设计文档.md** - AI图像增强功能详细设计文档

#### API调用 (features/api/)
- **客户端调用指南.md** - 客户端API调用完整指南

#### 图片预览 (features/image-preview/)
- **图片预览动态刷新功能.md** - 图片预览动态刷新功能说明
- **PC端图片预览动态刷新功能.md** - PC端图片预览动态刷新

#### MediaStore (features/mediastore/)
- **MediaStore快速开始.md** - MediaStore快速开始指南
- **MediaStore性能优化报告.md** - MediaStore性能优化报告
- **MediaStore文件清单.md** - MediaStore相关文件清单
- **MediaStore集成说明.md** - MediaStore集成详细说明

---

### 🔧 技术实现文档 (implementation/)

- **ONNX并行推理实现说明.md** - ONNX并行推理实现说明
- **原生多线程哈希计算说明.md** - 原生多线程哈希计算实现说明

---

### 📝 工作总结 (work-summary/)

- **今日工作总结-2025-10-22.md** - 2025-10-22工作总结
- **今日工作总结-MediaStore集成.md** - MediaStore集成工作总结
- **本次提交内容总结.md** - 提交内容总结

---

## 📖 快速导航

### 对于新开发者
1. **入门必读**: `architecture/技术实现方案.md`
2. **了解结构**: `architecture/CodeStructure20250911.md`
3. **移动端适配**: `architecture/移动端重写分析报告.md`
4. **平台适配**: `architecture/WebAdapters统一Platform对象说明.md`

### 对于移动端开发
1. **适配分析**: `architecture/service层移动端适配分析报告.md`
2. **改动总结**: `architecture/service层移动端适配改动总结.md`
3. **WebAdapters**: `architecture/WebAdapters统一Platform对象说明.md`
4. **Canvas适配**: `architecture/Canvas统一适配方案.md`
5. **MediaStore**: `features/mediastore/MediaStore集成说明.md`

### 对于鸿蒙开发
1. **适配评估**: `harmonyos/鸿蒙适配可行性评估报告-最终版.md`
2. **适配方案**: `harmonyos/鸿蒙适配方案-快速上线版.md`
3. **项目结构**: `harmonyos/鸿蒙项目结构设计.md`
4. **环境配置**: `harmonyos/鸿蒙开发环境安装指南.md`
5. **库支持**: `harmonyos/鸿蒙库支持情况对比分析.md`

### 对于测试人员
1. **PC端测试**: `testing/PC端回归测试清单.md`
2. **分类测试**: `testing/CLASSIFICATION_TEST_GUIDE.md`
3. **扫描测试**: `testing/测试用例文档-漏斗式扫描流程.md`
4. **macOS测试**: `platforms/macOS/macOS测试指南-给测试者.md`

### 对于UI设计师
1. **移动端设计**: `design/手机图片分类APP设计方案.md`
2. **PC端设计**: `design/PC端UI设计.md`
3. **UI原型**: `design/APP_UI设计原型.md`
4. **移动端v2.0**: `design/移动端界面设计方案-v2.0.md`

### 对于产品/用户
1. **使用指南**: `User/ImagePilot使用指南.md`
2. **照片创玩**: `User/照片创玩功能介绍.md`
3. **快速清理**: `User/ImagePilot快速清理指南.md`
4. **权限设置**: `User/ImagePilot权限设置说明.md`

---

## 🔄 最近更新 (2025-11-02)

### 文档整理
- 📦 **重新组织文档结构** - 按主题分类整理所有文档
- 📦 **新增harmonyos目录** - 集中管理鸿蒙相关文档（10个文档）
- 📦 **新增platforms目录** - 按平台分类（macOS 4个，Android 5个）
- 📦 **新增features目录** - 按功能分类（AI增强2个，API 1个，图片预览2个，MediaStore 4个）
- 📦 **新增implementation目录** - 技术实现细节文档（2个文档）
- 📦 **新增work-summary目录** - 工作总结文档（3个文档）

### 文档分类统计
- **harmonyos/**: 10个文档 - 鸿蒙适配相关
- **platforms/**: 9个文档 - 平台相关（macOS 4个，Android 5个）
- **features/**: 9个文档 - 功能特性（AI增强2个，API 1个，图片预览2个，MediaStore 4个）
- **implementation/**: 2个文档 - 技术实现
- **work-summary/**: 3个文档 - 工作总结
- **architecture/**: 15个文档 - 架构设计
- **design/**: 4个文档 - UI设计
- **testing/**: 4个文档 - 测试文档
- **User/**: 5个文档 - 用户指南
- **总计**: 61个文档

---

## 🎯 文档维护规范

### 文档命名
- 使用清晰的中文或英文名称
- 日期格式统一使用 YYYY-MM-DD
- 版本号使用 v1.0、v2.0 格式

### 文档分类
- **architecture/** - 架构、设计、技术方案
- **design/** - UI/UX 设计、原型
- **testing/** - 测试用例、测试指南、问题修复
- **harmonyos/** - 鸿蒙适配相关
- **platforms/** - 平台特定文档
- **features/** - 功能特性文档
- **implementation/** - 技术实现细节
- **work-summary/** - 工作总结
- **User/** - 用户指南

### 更新规范
- 文档底部注明更新日期和版本
- 重要改动需要在本 README 记录
- 废弃文档移动到 `archive/` 目录

---

## 📞 联系方式

如有文档相关问题，请联系项目维护者。

---

**最后更新**: 2025-11-02  
**文档版本**: v2.0
