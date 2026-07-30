# AI图像增强功能设计文档

**版本**：v1.0  
**日期**：2025-10-27  
**作者**：开发团队  
**状态**：设计中

---

## 📋 目录

1. [功能概述](#1-功能概述)
2. [业务目标](#2-业务目标)
3. [用户操作流程](#3-用户操作流程)
4. [UI设计方案](#4-ui设计方案)
5. [技术架构](#5-技术架构)
6. [API接口设计](#6-api接口设计)
7. [状态管理](#7-状态管理)
8. [代码实现](#8-代码实现)
9. [样式设计](#9-样式设计)
10. [错误处理](#10-错误处理)
11. [性能优化](#11-性能优化)
12. [测试计划](#12-测试计划)
13. [后续优化](#13-后续优化)

---

## 1. 功能概述

### 1.1 功能定位

为PC端"待处置"分类的暂存箱提供AI图像增强功能，支持对1-9张图片进行批量美化处理，包括人像美颜、清晰增强、色彩优化等。

### 1.2 核心价值

- **提升图片质量**：修复模糊、瑕疵、色彩不佳的照片
- **批量处理能力**：一次处理多张图片，提高效率
- **灵活保存方式**：支持保存到本地、添加回暂存箱（方便对比删除原图）
- **实时进度反馈**：可视化处理进度，支持后台运行

### 1.3 使用场景

| 场景 | 适用方案 | 说明 |
|------|----------|------|
| 人物自拍照片 | 人像美颜 | 修复面部瑕疵、提亮肤色 |
| 模糊不清的照片 | 清晰增强 | 去模糊、锐化细节 |
| 偏暗的照片 | 色彩优化 | 提升饱和度和对比度 |
| 特殊需求 | 自定义 | 自定义编辑提示词 |

### 1.4 功能限制

- **图片数量**：1-9张（对应微信九宫格）
- **适用分类**：仅在"待处置"(tobecleaned)分类中可用
- **处理时间**：约18秒/张（API限制）
- **图片格式**：支持JPG、PNG、WebP等常见格式

---

## 2. 业务目标

### 2.1 主要目标

1. ✅ 为用户提供便捷的图片美化工具
2. ✅ 提升暂存箱的实用价值
3. ✅ 增强用户粘性和使用频率

### 2.2 成功指标

- 功能使用率：≥10%的用户使用
- 处理成功率：≥95%
- 用户满意度：≥4.0/5.0
- 平均处理时间：≤20秒/张

---

## 3. 用户操作流程

### 3.1 完整流程图

```
┌─────────────────┐
│  主页           │
│  点击"待处置"   │
└────────┬────────┘
         ↓
┌─────────────────┐
│  待处置分类页   │
│  选择1-9张图片  │ (右键/长按选中)
└────────┬────────┘
         ↓
┌─────────────────┐
│  点击"操作▼"    │
│  选择AI图像增强 │
└────────┬────────┘
         ↓
┌─────────────────────────────────┐
│  增强Modal - 配置阶段            │
│  ├─ 选择预设方案                │
│  └─ 点击"开始增强"              │
└────────┬────────────────────────┘
         ↓ (同一个Modal内部切换)
┌─────────────────────────────────┐
│  增强Modal - 进度阶段            │
│  ├─ 显示处理进度                │
│  ├─ 轮询任务状态 (2秒/次)       │
│  └─ 可点击"后台运行"            │
└────────┬────────────────────────┘
         ↓ (处理完成)
┌─────────────────────────────────┐
│  结果Modal                       │
│  ├─ 对比查看原图和增强图        │
│  ├─ 选择保存方式                │
│  │   ├─ 保存到本地              │
│  │   └─ 添加回暂存箱 ← 推荐    │
│  └─ 完成                         │
└─────────────────────────────────┘
         ↓ (选择"添加回暂存箱")
┌─────────────────────────────────┐
│  暂存箱（更新后）                │
│  ├─ 原图（可删除）               │
│  ├─ 增强图（新添加）             │
│  └─ 用户对比后整理               │
└─────────────────────────────────┘
```

### 3.2 详细操作步骤

#### **步骤1：进入待处置分类**
- 当前位置：`HomeScreen.desktop.js`
- 用户操作：点击"待处置"分类卡片
- 跳转到：`CategoryScreen.desktop.js` (category='tobecleaned')

#### **步骤2：选择图片**
- 支持方式：
  - 右键点击图片（推荐，快速选中）
  - 长按图片
  - 点击时间轴标题（批量选中该日期）
  - 点击"全选"按钮
- 限制条件：1-9张图片
- 界面反馈：
  - 选中图片显示蓝色✓标记
  - 操作按钮显示：`操作 (3) ▼`

#### **步骤3：打开AI图像增强**
- 用户操作：点击"操作▼" → 选择"✨ AI图像增强 (3/9)"
- 验证逻辑：检查选中数量是否在1-9范围内
- 打开：`EnhanceModal` (配置状态)

#### **步骤4：配置增强方案**
- 界面显示：
  - 已选图片预览（缩略图）
  - 4个预设方案卡片
  - 预计耗时提示
- 用户操作：
  - 选择预设方案（人像美颜/清晰增强/色彩优化/自定义）
  - 如果选择自定义，输入提示词
  - 点击"开始增强"

#### **步骤5：查看处理进度**
- Modal状态：从配置状态切换到进度状态（同一个Modal）
- 显示内容：
  - 总进度：2/3 张
  - 进度条动画
  - 每张图片状态：⏸️等待中 / ⏳处理中 / ✅已完成
- 后台处理：
  - 提交任务到服务器
  - 每2秒轮询一次任务状态
  - 实时更新UI
- 用户操作：
  - 等待（或点击"后台运行"最小化）

#### **步骤6：查看结果并保存**
- 关闭：`EnhanceModal`
- 打开：`EnhanceResultModal`
- 显示内容：
  - 左右对比图（原图 vs 增强后）
  - 导航栏：上一张/下一张
  - 保存选项（2种）
- 用户操作：
  - 左右切换查看每张图片
  - 选择保存方式：
    - 💾 保存到本地（下载到用户指定位置）
    - ➕ 添加为新图（添加回暂存箱，方便对比和删除原图）
  - 或批量操作

#### **步骤7：增强图回到暂存箱**
- 用户点击"添加为新图"后：
  1. 从服务器下载增强后的图片
  2. 保存到系统图片目录下的 `xualbum` 子目录（例如：`C:\Users\用户名\Pictures\xualbum\`）
  3. 文件名格式：`原文件名_xt_时间戳.扩展名`（例如：`photo.jpg` → `photo_xt_1735261234567.jpg`）
  4. 添加到数据库（category: 'tobecleaned'）
  5. 刷新缓存
  6. 提示用户"已添加到暂存箱"，并显示文件保存路径
- 用户关闭结果Modal，返回暂存箱
- 现在暂存箱中有：
  - 原图（未增强的）
  - 增强图（新添加的，文件名格式 `原文件名_xt_时间戳.扩展名`）
- 用户可以对比查看，然后：
  - 选择原图 → 删除原图（保留增强图）
  - 选择增强图 → 将增强图移动到正确分类
  - 同时选择 → 批量移动到正确分类

**工作流程示例**：
```
暂存箱（处理前）:
  ├─ image1.jpg (原图)
  ├─ image2.jpg (原图)
  └─ image3.jpg (原图)

照片创玩（选中3张）
    ↓
查看结果 → 点击"添加为新图"
    ↓
暂存箱（处理后）:
  ├─ image1.jpg (原图) ← 可以删除
  ├─ image1_xt_1735261234567.jpg (增强图) ← 新添加，保存在 Pictures/xualbum/
  ├─ image2.jpg (原图) ← 可以删除
  ├─ image2_xt_1735261234568.jpg (增强图) ← 新添加，保存在 Pictures/xualbum/
  ├─ image3.jpg (原图) ← 可以删除
  └─ image3_xt_1735261234569.jpg (增强图) ← 新添加，保存在 Pictures/xualbum/

用户对比后:
  1. 选中3个原图 → 删除
  2. 选中3个增强图 → 移动到"单人照片"分类
  3. 完成整理
```

---

## 4. UI设计方案

### 4.1 组件架构

```
CategoryScreen.desktop.js
├── Header
│   └── 操作菜单
│       └── [✨ AI图像增强] ← 新增入口
├── 图片网格
└── Modals
    ├── EnhanceModal (新增) ← 配置 + 进度合并
    │   ├── ConfigView (初始状态)
    │   └── ProgressView (处理状态)
    └── EnhanceResultModal (新增) ← 结果展示
```

### 4.2 Modal 1: EnhanceModal (增强配置+进度)

#### **4.2.1 配置状态 (enhanceStep === 'config')**

```
┌──────────────────────────────────────────┐
│ AI图像增强                          [×] │
├──────────────────────────────────────────┤
│                                          │
│ 已选择 3 张图片 (最多9张)               │
│ ┌────────────────────────────────────┐  │
│ │ [缩略图] [缩略图] [缩略图]         │  │
│ └────────────────────────────────────┘  │
│                                          │
│ 选择增强方案：                           │
│ ┌──────────────┐  ┌──────────────┐     │
│ │  👤 人像美颜  │  │  ✨ 清晰增强  │     │
│ │  适合人物照片 │  │  适合模糊照片 │     │
│ │      ✓       │  │              │     │
│ └──────────────┘  └──────────────┘     │
│ ┌──────────────┐  ┌──────────────┐     │
│ │  🎨 色彩优化  │  │  ⚙️ 自定义   │     │
│ │  适合偏暗照片 │  │  自定义需求   │     │
│ └──────────────┘  └──────────────┘     │
│                                          │
│ [自定义提示词输入框] (条件显示)         │
│                                          │
│ ⏱️ 预计耗时：约 54 秒                   │
│                                          │
│              [取消]  [开始增强]          │
└──────────────────────────────────────────┘
```

**尺寸**：
- 宽度：90% (最大600px)
- 高度：自适应 (最大80vh)
- 居中显示

**交互**：
- 点击预设卡片：高亮选中，显示✓标记
- 选择"自定义"：显示多行文本输入框
- 点击"开始增强"：切换到进度状态

#### **4.2.2 进度状态 (enhanceStep === 'processing')**

```
┌──────────────────────────────────────────┐
│ 正在处理图像增强...                [−] │
├──────────────────────────────────────────┤
│                                          │
│ 总进度：2/3 张                           │
│ ████████████████░░░░░░░░ 67%            │
│                                          │
│ 处理详情：                               │
│ ┌────────────────────────────────────┐  │
│ │ [缩略图] ✅ 已完成                  │  │
│ │ [缩略图] ✅ 已完成                  │  │
│ │ [缩略图] ⏳ 处理中...               │  │
│ └────────────────────────────────────┘  │
│                                          │
│          🔄 处理中...                    │
│                                          │
│              [后台运行]                  │
└──────────────────────────────────────────┘
```

**特点**：
- 同一个Modal，无缝切换
- 实时更新进度数据
- 支持最小化到后台

### 4.3 Modal 2: EnhanceResultModal (结果展示)

```
┌────────────────────────────────────────────────────┐
│ 图像增强完成 ✅                           [×]     │
├────────────────────────────────────────────────────┤
│                                                    │
│  [← 上一张]        1 / 3        [下一张 →]        │
│                                                    │
│  ┌──────────────────┐  →  ┌──────────────────┐  │
│  │     原图         │     │    增强后         │  │
│  │                  │     │                  │  │
│  │   [图片预览]      │     │   [图片预览]      │  │
│  │                  │     │                  │  │
│  └──────────────────┘     └──────────────────┘  │
│                                                    │
│  操作选项：                                        │
│  [💾 保存到本地] [➕ 添加为新图]                  │
│                                                    │
│  批量操作：                                        │
│  [全部保存到本地]  [全部添加为新图]               │
│                                                    │
└────────────────────────────────────────────────────┘
```

**尺寸**：
- 全屏模态框 (`transparent={false}`)
- 利用整个屏幕空间展示对比图

**交互**：
- 左右箭头：切换图片
- 单张操作：对当前图片生效
- 批量操作：对所有图片生效

### 4.4 后台运行机制详解

#### **4.4.1 概念说明**

"后台运行"允许用户在图像处理任务进行中关闭进度窗口，继续使用应用的其他功能，任务完成后自动弹出结果。

#### **4.4.2 完整交互流程**

**场景1：正常等待完成**

```
用户点击"开始增强"
    ↓
┌─────────────────────────────┐
│ 正在处理图像增强...    [−] │
│                             │
│ 总进度：1/3 张              │
│ ████░░░░░░░░ 33%           │
│                             │
│ [缩略图] ✅ 已完成          │
│ [缩略图] ⏳ 处理中...       │
│ [缩略图] ⏸️ 等待中          │
│                             │
│      [后台运行]             │  ← 用户可以点击
└─────────────────────────────┘

用户耐心等待
    ↓
处理完成（3/3 张）
    ↓
自动弹出结果对比窗口
```

**场景2：点击"后台运行"**

```
用户正在查看进度（1/3）
    ↓
点击 [后台运行] 按钮
    ↓
进度Modal关闭（fadeOut动画，200ms）
    ↓
───────────────────────────────────
│  暂存箱 (tobecleaned)          │  ← 返回到CategoryScreen
│  ┌───┐ ┌───┐ ┌───┐ ┌───┐     │
│  │img│ │img│ │img│ │img│      │  用户可以继续操作
│  └───┘ └───┘ └───┘ └───┘     │
│                                 │
│  💡 右下角浮动提示：            │
│  ┌──────────────────────┐     │
│  │ 🔄 图像增强处理中... │     │  ← 小型浮动提示
│  │    (1/3 已完成)      │     │
│  │                      │     │
│  │     [点击查看]       │     │  ← 可点击展开
│  └──────────────────────┘     │
───────────────────────────────────

后台轮询继续进行...
    ↓ (30秒后)
处理完成！
    ↓
自动弹出结果Modal（无论用户在哪个页面）
```

#### **4.4.3 浮动提示UI设计**

**位置和样式**：

```
CategoryScreen 右下角：

┌──────────────────────────────┐
│                              │
│                              │
│                              │
│              ┌──────────────┐│
│              │🔄 图像增强中 ││  ← 浮动提示
│              │  (2/3 已完成) ││
│              │              ││
│              │  [点击查看]  ││
│              └──────────────┘│
└──────────────────────────────┘

样式规格：
- 位置：fixed, bottom: 20px, right: 20px
- 背景：rgba(0, 0, 0, 0.85) 半透明黑
- 文字：白色
- 圆角：12px
- 阴影：0 4px 12px rgba(0,0,0,0.3)
- 尺寸：160px × 80px
- z-index：999
```

**交互行为**：
- 点击 `[点击查看]` → 重新打开进度Modal
- 悬停时：略微放大（scale: 1.05）
- 实时更新进度数字

#### **4.4.4 处理完成自动弹出**

```
任务完成时：
1. 隐藏浮动提示（fadeOut）
2. 关闭进度Modal（如果打开着）
3. 准备结果数据
4. 自动弹出结果Modal ✨

无论用户当前在：
- 浏览其他图片 → 弹出
- 查看其他分类 → 弹出
- 在主页面     → 弹出
```

#### **4.4.5 时间轴示例**

```
0s    用户点击"开始增强"
      ↓
2s    处理开始，显示进度Modal
      ↓
5s    用户点击"后台运行"
      ↓ Modal关闭，显示浮动提示
6s    用户继续浏览其他图片
      ↓ 浮动提示更新：1/3
15s   用户查看其他分类
      ↓ 浮动提示更新：2/3
30s   用户返回主页
      ↓ 浮动提示更新：3/3
54s   处理完成！
      ↓ 
      浮动提示消失
      结果Modal自动弹出
```

#### **4.4.6 用户体验优势**

| 特性 | 说明 | 体验提升 |
|------|------|----------|
| **非阻塞操作** | 用户可以继续浏览和操作 | 不需要傻等 |
| **可视化反馈** | 浮动提示实时显示进度 | 知道任务在运行 |
| **随时恢复** | 点击可重新查看详细进度 | 保持掌控感 |
| **自动通知** | 完成后自动弹出结果 | 不会错过结果 |
| **优雅降级** | 即使切换页面也能正常工作 | 可靠性高 |

#### **4.4.7 状态管理**

```javascript
// 浮动提示显示状态
const [showFloatingProgress, setShowFloatingProgress] = useState(false);

// 浮动提示进度数据
const floatingProgressRef = useRef({
  completed: 0,
  total: 0
});

// 后台运行处理
const handleBackgroundRun = () => {
  setShowEnhanceModal(false);        // 关闭进度Modal
  setShowFloatingProgress(true);     // 显示浮动提示
  // 轮询继续（pollTimerRef.current 不中断）
};

// 轮询中更新浮动提示
const updateFloatingProgress = (completed, total) => {
  if (showFloatingProgress) {
    floatingProgressRef.current = { completed, total };
    forceUpdate(); // 刷新UI
  }
};

// 处理完成
const handleComplete = (results) => {
  setShowFloatingProgress(false);    // 隐藏浮动提示
  setShowEnhanceModal(false);        // 确保进度Modal关闭
  setEnhanceResults(results);
  setShowEnhanceResult(true);        // 自动弹出结果Modal
};
```

#### **4.4.8 可选优化**

**1. 桌面通知（Electron）**
```javascript
// 应用在后台时，发送系统通知
if (typeof window !== 'undefined' && window.require) {
  const { ipcRenderer } = window.require('electron');
  ipcRenderer.send('show-notification', {
    title: '图像增强完成 ✅',
    body: `已成功处理 ${results.length} 张图片`
  });
}
```

**2. 提示音效**
```javascript
// 处理完成时播放提示音
const audio = new Audio('/sounds/complete.mp3');
audio.play();
```

**3. 呼吸灯动画**
```javascript
// 浮动提示添加脉冲动画，增强视觉吸引力
Animated.loop(
  Animated.sequence([
    Animated.timing(scale, { toValue: 1.1, duration: 800 }),
    Animated.timing(scale, { toValue: 1.0, duration: 800 })
  ])
).start();
```

---

## 5. 技术架构

### 5.1 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端框架 | React Native Web | 跨平台UI |
| 状态管理 | React Hooks (useState, useRef) | 局部状态管理 |
| API通信 | Fetch API | HTTP请求 |
| 文件操作 | Electron IPC | 读取/保存文件 |
| UI组件 | React Native 内置组件 | Modal, Image, ScrollView等 |

### 5.2 系统架构图

```
┌─────────────────────────────────────────┐
│        CategoryScreen.desktop.js        │
│  ┌───────────────────────────────────┐  │
│  │  EnhanceModal                     │  │
│  │  ├─ ConfigView (选择方案)        │  │
│  │  └─ ProgressView (查看进度)      │  │
│  └───────────────────────────────────┘  │
│  ┌───────────────────────────────────┐  │
│  │  EnhanceResultModal               │  │
│  │  └─ ResultCompareView (对比查看)  │  │
│  └───────────────────────────────────┘  │
└──────────────┬──────────────────────────┘
               ↓
┌──────────────────────────────────────────┐
│           API Service Layer              │
│  ├─ submitImageEdit() - 提交任务        │
│  └─ getEditTaskStatus() - 查询状态      │
└──────────────┬───────────────────────────┘
               ↓
┌──────────────────────────────────────────┐
│      Backend API (阿里云图像编辑)        │
│  POST /api/v1/image-edit/submit          │
│  GET  /api/v1/image-edit/task/{task_id}  │
└──────────────────────────────────────────┘
```

### 5.3 数据流

```
用户选择图片
    ↓
点击"AI图像增强"
    ↓
配置增强方案
    ↓
点击"开始增强"
    ↓
读取图片文件 (Electron IPC)
    ↓
提交到API (POST /submit)
    ↓
获取 task_id
    ↓
轮询查询状态 (GET /task/{id}, 每2秒)
    ↓
更新进度UI
    ↓
处理完成
    ↓
展示结果对比
    ↓
保存处理结果 (Electron IPC)
```

### 5.4 Service 层设计

#### **5.4.1 新建 ImageEnhanceService.js**

**📁 文件路径**: `src/services/ImageEnhanceService.js`

**功能职责**：
- 图片预处理（resize、压缩、hash计算）
- API交互（提交任务、查询状态、轮询）
- 文件操作（下载、保存到xualbum目录）

**核心方法**：

```javascript
class ImageEnhanceService {
  constructor() {
    this.apiConfig = {
      baseURL: 'https://your-server.example.com',
      endpoints: {
        submit: '/api/v1/image-edit/submit',
        taskStatus: '/api/v1/image-edit/task',
        batchCheckCache: '/api/v1/image-edit/batch-check-cache'
      },
      timeout: 30000
    };
  }

  // ========== 图片预处理 ==========
  
  /**
   * 准备图片用于增强（resize + hash）
   * @param {string} imageUri - 图片URI
   * @returns {Promise<{file: Blob, hash: string}>}
   */
  async prepareImageForEnhance(imageUri) {
    // 1. Resize到1024px长边，80%质量，JPEG
    const resizedBlob = await this.resizeImage(imageUri, 1024, 0.8);
    
    // 2. 计算SHA-256
    const hash = await this.calculateImageHash(resizedBlob);
    
    return { file: resizedBlob, hash };
  }

  /**
   * Resize图片（基于Canvas API）
   * @param {string} imageUri - 图片URI
   * @param {number} maxSize - 长边最大尺寸
   * @param {number} quality - JPEG质量 (0-1)
   * @returns {Promise<Blob>}
   */
  async resizeImage(imageUri, maxSize, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        // 计算缩放比例
        const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
        const newWidth = Math.round(img.width * scale);
        const newHeight = Math.round(img.height * scale);
        
        // Canvas绘制
        const canvas = document.createElement('canvas');
        canvas.width = newWidth;
        canvas.height = newHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, newWidth, newHeight);
        
        // 转为Blob
        canvas.toBlob(resolve, 'image/jpeg', quality);
      };
      img.onerror = reject;
      img.src = imageUri;
    });
  }

  /**
   * 计算SHA-256哈希
   * @param {Blob} blob - 图片Blob
   * @returns {Promise<string>} - 十六进制哈希字符串
   */
  async calculateImageHash(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // ========== API交互 ==========
  
  /**
   * 提交增强任务
   * @param {Blob} imageFile - 图片文件
   * @param {string} preset - 增强方案 (auto/enhance_face/...)
   * @param {string} imageHash - 图片SHA-256
   * @param {string} clientId - 客户端ID
   * @returns {Promise<{task_id: string, status: string}>}
   */
  async submitEnhanceTask(imageFile, preset, imageHash, clientId) {
    const formData = new FormData();
    formData.append('image', imageFile);
    formData.append('preset', preset);
    formData.append('image_hash', imageHash);

    const response = await fetch(
      `${this.apiConfig.baseURL}${this.apiConfig.endpoints.submit}`, 
      {
        method: 'POST',
        headers: { 'X-User-ID': clientId },
        body: formData,
        timeout: this.apiConfig.timeout
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * 查询任务状态
   * @param {string} taskId - 任务ID
   * @param {string} clientId - 客户端ID
   * @returns {Promise<Object>} - 任务状态信息
   */
  async queryTaskStatus(taskId, clientId) {
    const response = await fetch(
      `${this.apiConfig.baseURL}${this.apiConfig.endpoints.taskStatus}/${taskId}`,
      { 
        method: 'GET',
        headers: { 'X-User-ID': clientId } 
      }
    );
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return await response.json();
  }

  /**
   * 轮询任务直到完成
   * @param {string} taskId - 任务ID
   * @param {string} clientId - 客户端ID
   * @param {Function} onProgress - 进度回调函数
   * @returns {Promise<Object>} - 完成后的任务信息
   */
  async pollTaskStatus(taskId, clientId, onProgress) {
    const maxRetries = 60;  // 最多60次（2分钟）
    const interval = 2000;  // 2秒一次

    for (let i = 0; i < maxRetries; i++) {
      const status = await this.queryTaskStatus(taskId, clientId);
      
      if (onProgress) {
        onProgress(status);
      }

      if (status.status === 'completed') {
        return status;
      } else if (status.status === 'failed') {
        throw new Error(status.error || '任务失败');
      }

      await new Promise(resolve => setTimeout(resolve, interval));
    }

    throw new Error('任务超时（超过2分钟）');
  }

  // ========== 文件操作 ==========
  
  /**
   * 下载增强后的图片
   * @param {string} resultUrl - 图片URL
   * @returns {Promise<Blob>}
   */
  async downloadEnhancedImage(resultUrl) {
    const response = await fetch(resultUrl);
    
    if (!response.ok) {
      throw new Error(`下载失败: HTTP ${response.status}`);
    }
    
    return await response.blob();
  }

  /**
   * 保存图片到xualbum目录
   * @param {Blob} imageBlob - 图片Blob
   * @param {string} originalFileName - 原文件名
   * @returns {Promise<{filePath, fileName, directory}>}
   */
  async saveToXualbum(imageBlob, originalFileName) {
    const { ipcRenderer } = window.require('electron');
    const path = window.require('path');
    const os = window.require('os');

    // 1. 准备路径
    const picturesDir = path.join(os.homedir(), 'Pictures');
    const xualbumDir = path.join(picturesDir, 'xualbum');
    
    // 2. 确保目录存在
    const dirResult = await ipcRenderer.invoke('ensure-directory', xualbumDir);
    if (!dirResult.success) {
      throw new Error(`创建目录失败: ${dirResult.error}`);
    }

    // 3. 生成文件名: 原文件名_xt_时间戳.扩展名
    const timestamp = Date.now();
    const parsedPath = path.parse(originalFileName);
    const newFileName = `${parsedPath.name}_xt_${timestamp}${parsedPath.ext}`;
    const fullPath = path.join(xualbumDir, newFileName);

    // 4. 保存文件
    const arrayBuffer = await imageBlob.arrayBuffer();
    const saveResult = await ipcRenderer.invoke('save-file-to-path', {
      path: fullPath,
      buffer: Buffer.from(arrayBuffer)
    });

    if (!saveResult.success) {
      throw new Error(`保存文件失败: ${saveResult.error}`);
    }

    return {
      filePath: fullPath,
      fileName: newFileName,
      directory: xualbumDir
    };
  }
}

export default new ImageEnhanceService();
```

#### **5.4.2 扩展 UnifiedDataService.js**

**新增方法**：

```javascript
/**
 * 添加单张图片（用于AI增强图）
 * @param {Object} imageData - 图片数据
 * @returns {Promise<Object>} - 保存后的图片数据
 */
async addImage(imageData) {
  try {
    logger.debug('添加新图片:', imageData.fileName);
    
    // 1. 写入数据库
    await this.imageStorageService.addOrUpdateSingleImage(imageData);
    logger.debug('✅ 数据库写入完成');
    
    // 2. 增量更新缓存
    this.imageCache.addImageToCache(imageData);
    logger.debug('✅ 缓存增量更新完成');
    
    // 3. 刷新缓存统计（categoryCounts等）
    await this.imageCache.refreshCache();
    logger.debug('✅ 缓存统计刷新完成');
    
    return imageData;
    
  } catch (error) {
    logger.error('❌ 添加图片失败:', error);
    throw error;
  }
}

**调用示例**：

```javascript
// 添加增强图到数据库
const imageData = {
  id: `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  fileName: 'photo_xt_1735261234567.jpg',
  uri: 'file:///C:/Users/xxx/Pictures/xualbum/photo_xt_1735261234567.jpg',
  path: 'C:\\Users\\xxx\\Pictures\\xualbum\\photo_xt_1735261234567.jpg',
  category: 'tobecleaned',
  timestamp: Date.now(),
  takenAt: Date.now(),
  
  metadata: {
    source: 'ai_enhanced',
    originalImageId: 'img_original_xxx',
    enhancePreset: 'auto',
    enhancedAt: Date.now()
  }
};

await UnifiedDataService.addImage(imageData);
```

### 5.5 Data 层设计

#### **5.5.1 应用设置扩展（AI增强预设方案）**

**存储位置**: `settings` 对象（通过 `UnifiedDataService.readSettings()` / `writeSettings()` 访问）

**新增字段**: `aiEnhancePresets`

**数据结构**：

```javascript
// settings 对象扩展
{
  // 现有字段
  scanPaths: [...],
  hideEmptyCategories: false,
  clientId: 'xxx',
  
  // 🆕 AI增强预设方案配置
  aiEnhancePresets: {
    // 默认预设（可被用户修改）
    portrait: {
      name: '人像美颜',
      icon: '👤',
      prompt: '修复面部瑕疵和皱纹，提亮肤色，保持人物原貌不变',
      description: '适合人物照片',
      enabled: true,  // 是否启用
      sortOrder: 1    // 显示顺序
    },
    enhance: {
      name: '清晰增强',
      icon: '✨',
      prompt: '增强图像清晰度，去除模糊，锐化细节，提升整体质量',
      description: '适合模糊照片',
      enabled: true,
      sortOrder: 2
    },
    color: {
      name: '色彩优化',
      icon: '🎨',
      prompt: '优化色彩饱和度和对比度，使图片更加鲜艳生动',
      description: '适合偏暗照片',
      enabled: true,
      sortOrder: 3
    },
    custom: {
      name: '自定义',
      icon: '⚙️',
      prompt: '',  // 自定义预设没有默认提示词
      description: '自定义编辑需求',
      enabled: true,
      sortOrder: 4
    }
    // 用户可以添加更多自定义预设
  },
  
  // 🆕 AI增强默认预设
  aiEnhanceDefaultPreset: 'portrait',  // 默认选中的预设
  
  // 🆕 AI增强最近使用的提示词（历史记录）
  aiEnhanceRecentPrompts: [
    '修复照片瑕疵，提升清晰度',
    '优化人像细节，美化肤色',
    // ... 最多保留10条
  ]
}
```

**默认值初始化**：

```javascript
// 在 ImageStorageService.js 的 getSettings() 方法中
async getSettings() {
  try {
    await this.ensureInitialized();
    const settingsData = await this.storage.getItem(this.storageKeys.settings);
    
    // ... 现有代码 ...
    
    // 🆕 初始化 AI 增强预设方案（如果不存在）
    if (!result.aiEnhancePresets) {
      result.aiEnhancePresets = {
        portrait: {
          name: '人像美颜',
          icon: '👤',
          prompt: '修复面部瑕疵和皱纹，提亮肤色，保持人物原貌不变',
          description: '适合人物照片',
          enabled: true,
          sortOrder: 1
        },
        enhance: {
          name: '清晰增强',
          icon: '✨',
          prompt: '增强图像清晰度，去除模糊，锐化细节，提升整体质量',
          description: '适合模糊照片',
          enabled: true,
          sortOrder: 2
        },
        color: {
          name: '色彩优化',
          icon: '🎨',
          prompt: '优化色彩饱和度和对比度，使图片更加鲜艳生动',
          description: '适合偏暗照片',
          enabled: true,
          sortOrder: 3
        },
        custom: {
          name: '自定义',
          icon: '⚙️',
          prompt: '',
          description: '自定义编辑需求',
          enabled: true,
          sortOrder: 4
        }
      };
    }
    
    // 🆕 初始化默认预设
    if (!result.aiEnhanceDefaultPreset) {
      result.aiEnhanceDefaultPreset = 'portrait';
    }
    
    // 🆕 初始化最近使用的提示词
    if (!result.aiEnhanceRecentPrompts) {
      result.aiEnhanceRecentPrompts = [];
    }
    
    return result;
  }
}
```

**访问方式**：

```javascript
// 读取预设方案
const settings = await UnifiedDataService.readSettings();
const presets = settings.aiEnhancePresets;
const defaultPreset = settings.aiEnhanceDefaultPreset;

// 更新预设方案
settings.aiEnhancePresets.portrait.prompt = '新的提示词';
await UnifiedDataService.writeSettings(settings);

// 添加新的自定义预设
settings.aiEnhancePresets.myCustom = {
  name: '我的预设',
  icon: '🌟',
  prompt: '自定义提示词',
  description: '我的描述',
  enabled: true,
  sortOrder: 5
};
await UnifiedDataService.writeSettings(settings);

// 记录最近使用的提示词
const newPrompt = '修复照片瑕疵';
if (!settings.aiEnhanceRecentPrompts.includes(newPrompt)) {
  settings.aiEnhanceRecentPrompts.unshift(newPrompt);
  settings.aiEnhanceRecentPrompts = settings.aiEnhanceRecentPrompts.slice(0, 10); // 最多10条
  await UnifiedDataService.writeSettings(settings);
}
```

**在 CategoryScreen 中使用**：

```javascript
// 读取预设方案
const [enhancePresets, setEnhancePresets] = useState({});

useEffect(() => {
  const loadPresets = async () => {
    const settings = await UnifiedDataService.readSettings();
    setEnhancePresets(settings.aiEnhancePresets || DEFAULT_ENHANCE_PRESETS);
  };
  loadPresets();
}, []);

// 渲染预设卡片
{Object.entries(enhancePresets)
  .filter(([key, preset]) => preset.enabled)
  .sort((a, b) => a[1].sortOrder - b[1].sortOrder)
  .map(([key, preset]) => (
    <PresetCard key={key} preset={preset} />
  ))}
```

**优势**：
1. ✅ **灵活配置**：用户可以自定义预设方案
2. ✅ **持久化存储**：预设方案保存在数据库中
3. ✅ **易于扩展**：可以添加/删除/修改预设
4. ✅ **历史记录**：记录最近使用的提示词，提升体验
5. ✅ **跨平台同步**：PC端和移动端共享配置（如果未来支持）

#### **5.5.2 数据库 Schema（图片存储）**

**结论**: ✅ **无需修改现有数据库结构**

现有的 `images` 表已完全支持AI增强图片的存储需求：

| 字段 | 类型 | 说明 | AI增强图使用 |
|------|------|------|-------------|
| `id` | STRING | 唯一标识 | ✅ 生成新ID |
| `uri` | STRING | 文件URI | ✅ `file:///path/to/xualbum/xxx.jpg` |
| `fileName` | STRING | 文件名 | ✅ `原文件名_xt_时间戳.扩展名` |
| `category` | STRING | 分类 | ✅ `tobecleaned` (暂存箱) |
| `timestamp` | NUMBER | 时间戳 | ✅ 创建时间 |
| `takenAt` | NUMBER | 拍摄时间 | ✅ 同上 |
| `metadata` | JSON Object | 元数据 | ✅ 存储增强相关信息 |

**AI增强图元数据结构**：

```javascript
{
  metadata: {
    source: 'ai_enhanced',           // 图片来源
    originalImageId: 'img_xxx',      // 原图ID（用于关联）
    enhancePreset: 'auto',           // 使用的增强方案
    enhancedAt: 1735261234567,       // 增强时间戳
    enhanceTaskId: 'task_xxx',       // 任务ID（可选）
    enhanceApiVersion: 'v1'          // API版本（可选）
  }
}
```

### 5.6 Electron IPC 接口设计

#### **5.6.1 新增 IPC Handlers**

在 `public/electron.js` 的 `setupIpcHandlers()` 函数中新增：

```javascript
// ========== 文件操作相关 IPC handlers ==========

/**
 * 确保目录存在（递归创建）
 */
ipcMain.handle('ensure-directory', async (event, dirPath) => {
  try {
    const fs = require('fs').promises;
    await fs.mkdir(dirPath, { recursive: true });
    logger.debug('✅ 目录已创建:', dirPath);
    return { success: true, path: dirPath };
  } catch (error) {
    logger.error('❌ 创建目录失败:', error);
    return { success: false, error: error.message };
  }
});

/**
 * 保存文件到指定路径
 */
ipcMain.handle('save-file-to-path', async (event, { path, buffer }) => {
  try {
    const fs = require('fs').promises;
    
    // 确保父目录存在
    const pathModule = require('path');
    const dir = pathModule.dirname(path);
    await fs.mkdir(dir, { recursive: true });
    
    // 写入文件
    await fs.writeFile(path, Buffer.from(buffer));
    logger.debug('✅ 文件已保存:', path);
    
    return { success: true, path };
  } catch (error) {
    logger.error('❌ 保存文件失败:', error);
    return { success: false, error: error.message };
  }
});

```

**注意**：获取系统图片目录不需要单独的 IPC handler，可以直接在渲染进程中使用 Node.js API：

```javascript
// 渲染进程中直接获取系统图片目录
const os = window.require('os');
const path = window.require('path');
const picturesDir = path.join(os.homedir(), 'Pictures');
console.log('系统图片目录:', picturesDir);
```

#### **5.6.2 IPC 调用示例**

```javascript
// 在渲染进程中调用（CategoryScreen.desktop.js）

const { ipcRenderer } = window.require('electron');
const path = window.require('path');
const os = window.require('os');

// 1. 获取系统图片目录（直接使用 Node.js API）
const picturesDir = path.join(os.homedir(), 'Pictures');
const xualbumDir = path.join(picturesDir, 'xualbum');

// 2. 创建目录
const result = await ipcRenderer.invoke('ensure-directory', xualbumDir);
if (result.success) {
  console.log('目录已创建:', result.path);
}

// 3. 保存文件
const saveResult = await ipcRenderer.invoke('save-file-to-path', {
  path: path.join(xualbumDir, 'photo_xt_1735261234567.jpg'),
  buffer: Buffer.from(arrayBuffer)
});
if (saveResult.success) {
  console.log('文件已保存:', saveResult.path);
}
```

### 5.7 实现优先级

| 优先级 | 任务 | 文件 | 说明 |
|------|------|------|------|
| **P0** | 新增 IPC handlers | `public/electron.js` | 必须，文件保存的基础 |
| **P0** | 新建 ImageEnhanceService | `src/services/ImageEnhanceService.js` | 核心业务逻辑 |
| **P0** | 扩展 UnifiedDataService | `src/services/UnifiedDataService.js` | 数据库操作 |
| **P1** | UI层实现 | `src/screens/desktop/CategoryScreen.desktop.js` | 用户界面和交互 |
| **P2** | 错误处理和日志 | 各文件 | 健壮性保障 |
| **P3** | 性能优化 | 各文件 | 缓存、并发等优化 |

### 5.8 技术方案总结

| 层级 | 变更类型 | 具体内容 |
|------|---------|---------|
| **Service 层** | ✅ 新增 | `ImageEnhanceService.js`（新文件，约300行） |
| **Service 层** | ✅ 扩展 | `UnifiedDataService.addImage()` 方法（约30行） |
| **Data 层** | ❌ 无需修改 | 现有 Schema 完全支持（tags + metadata） |
| **IPC 层** | ✅ 新增 | 2个 handlers：`ensure-directory`, `save-file-to-path` |
| **UI 层** | ✅ 新增 | `CategoryScreen.desktop.js` 中的 Modal 和业务逻辑（约500行） |

**核心优势**：
1. ✅ **职责分离**: 独立的 `ImageEnhanceService` 处理所有增强逻辑
2. ✅ **低耦合**: 通过 `UnifiedDataService` 统一数据访问
3. ✅ **零侵入**: 数据库无需任何修改，利用现有扩展字段
4. ✅ **易测试**: Service 层可独立单元测试
5. ✅ **易维护**: 清晰的分层架构，便于后续扩展

---

## 6. API接口设计

### 6.1 提交图像编辑任务

#### **请求**

```http
POST http://123.57.68.4:8000/api/v1/image-edit/submit
Content-Type: multipart/form-data
X-User-ID: {user_id} (可选)
```

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| images | File[] | 是 | 图片文件数组（1-9张） |
| edit_type | string | 是 | 编辑类型（固定为"enhance"） |
| edit_params | string | 是 | 编辑参数（JSON字符串） |

**edit_params示例**：

```json
{
  "prompt": "修复面部瑕疵和皱纹，提亮肤色，保持人物原貌不变"
}
```

#### **响应**

```json
{
  "success": true,
  "task_id": "task_20250124_abc123",
  "total_images": 3,
  "estimated_time_ms": 54000
}
```

### 6.2 查询任务状态

#### **请求**

```http
GET http://123.57.68.4:8000/api/v1/image-edit/task/{task_id}
```

#### **响应 - 处理中**

```json
{
  "task_id": "task_20250124_abc123",
  "user_id": "user123",
  "edit_type": "enhance",
  "edit_params": {
    "prompt": "修复面部瑕疵和皱纹，提亮肤色，保持人物原貌不变"
  },
  "total_images": 3,
  "completed_images": 2,
  "progress": 67.0,
  "status": "processing",
  "results": [
    {
      "index": 0,
      "filename": "image1.jpg",
      "status": "completed",
      "result_url": "http://123.57.68.4:8000/images/edited/img_xxx.png"
    },
    {
      "index": 1,
      "filename": "image2.jpg",
      "status": "completed",
      "result_url": "http://123.57.68.4:8000/images/edited/img_yyy.png"
    },
    {
      "index": 2,
      "filename": "image3.jpg",
      "status": "processing",
      "result_url": null
    }
  ],
  "created_at": "2025-01-24T10:00:00",
  "updated_at": "2025-01-24T10:00:30"
}
```

#### **响应 - 已完成**

```json
{
  "task_id": "task_20250124_abc123",
  "status": "completed",
  "progress": 100.0,
  "results": [
    {
      "index": 0,
      "filename": "image1.jpg",
      "status": "completed",
      "result_url": "http://123.57.68.4:8000/images/edited/img_xxx.png"
    },
    {
      "index": 1,
      "filename": "image2.jpg",
      "status": "completed",
      "result_url": "http://123.57.68.4:8000/images/edited/img_yyy.png"
    },
    {
      "index": 2,
      "filename": "image3.jpg",
      "status": "completed",
      "result_url": "http://123.57.68.4:8000/images/edited/img_zzz.png"
    }
  ]
}
```

### 6.3 API封装函数

```javascript
// API基础配置
const API_BASE_URL = 'http://123.57.68.4:8000';

/**
 * 提交图像编辑任务
 * @param {File[]} imageFiles - 图片文件数组
 * @param {string} prompt - 编辑提示词
 * @param {string} userId - 用户ID（可选）
 * @returns {Promise<Object>} 任务信息
 */
async function submitImageEdit(imageFiles, prompt, userId = null) {
  const formData = new FormData();
  
  // 添加图片文件
  imageFiles.forEach(file => {
    formData.append('images', file);
  });
  
  // 编辑类型
  formData.append('edit_type', 'enhance');
  
  // 编辑参数
  const editParams = { prompt };
  formData.append('edit_params', JSON.stringify(editParams));
  
  // 请求头
  const headers = {};
  if (userId) headers['X-User-ID'] = userId;
  
  const response = await fetch(`${API_BASE_URL}/api/v1/image-edit/submit`, {
    method: 'POST',
    headers: headers,
    body: formData
  });
  
  if (!response.ok) {
    throw new Error(`提交失败: ${response.status}`);
  }
  
  return await response.json();
}

/**
 * 查询任务状态
 * @param {string} taskId - 任务ID
 * @returns {Promise<Object>} 任务状态
 */
async function getEditTaskStatus(taskId) {
  const response = await fetch(`${API_BASE_URL}/api/v1/image-edit/task/${taskId}`);
  
  if (!response.ok) {
    throw new Error(`查询失败: ${response.status}`);
  }
  
  return await response.json();
}
```

---

## 7. 状态管理

### 7.1 状态定义

```javascript
// ========== Modal显示控制 ==========
const [showEnhanceModal, setShowEnhanceModal] = useState(false);
const [showEnhanceResult, setShowEnhanceResult] = useState(false);

// ========== 增强流程状态 ==========
const [enhanceStep, setEnhanceStep] = useState('config'); // 'config' | 'processing'

// ========== 配置数据 ==========
const [enhancePreset, setEnhancePreset] = useState('portrait'); // 预设方案
const [customPrompt, setCustomPrompt] = useState(''); // 自定义提示词

// ========== 进度数据 ==========
const [enhanceProgress, setEnhanceProgress] = useState({
  total: 0,
  completed: 0,
  images: []
});

// ========== 任务数据 ==========
const [currentTaskId, setCurrentTaskId] = useState(null);
const pollTimerRef = useRef(null); // 轮询定时器

// ========== 结果数据 ==========
const [enhanceResults, setEnhanceResults] = useState([]);
const [currentResultIndex, setCurrentResultIndex] = useState(0);

// ========== 后台运行状态 ==========
const [showFloatingProgress, setShowFloatingProgress] = useState(false);
const floatingProgressRef = useRef({
  completed: 0,
  total: 0
});
```

### 7.2 预设方案配置

```javascript
const DEFAULT_ENHANCE_PRESETS = {
  portrait: {
    name: '人像美颜',
    icon: '👤',
    prompt: '修复面部瑕疵和皱纹，提亮肤色，保持人物原貌不变',
    description: '适合人物照片',
    enabled: true,
    sortOrder: 1
  },
  enhance: {
    name: '清晰增强',
    icon: '✨',
    prompt: '增强图像清晰度，去除模糊，锐化细节，提升整体质量',
    description: '适合模糊照片',
    enabled: true,
    sortOrder: 2
  },
  color: {
    name: '色彩优化',
    icon: '🎨',
    prompt: '优化色彩饱和度和对比度，使图片更加鲜艳生动',
    description: '适合偏暗照片',
    enabled: true,
    sortOrder: 3
  },
  custom: {
    name: '自定义',
    icon: '⚙️',
    prompt: '',
    description: '自定义编辑需求',
    enabled: true,
    sortOrder: 4
  }
};

// ========== 从设置加载预设方案 ==========
const [enhancePresets, setEnhancePresets] = useState(DEFAULT_ENHANCE_PRESETS);
```

### 7.3 状态流转图

```
[初始状态]
  showEnhanceModal: false
  enhanceStep: 'config'
    ↓ 用户点击"AI图像增强"
[配置状态]
  showEnhanceModal: true
  enhanceStep: 'config'
  enhancePreset: 'portrait'
    ↓ 用户点击"开始增强"
[进度状态]
  showEnhanceModal: true
  enhanceStep: 'processing'
  enhanceProgress: { total: 3, completed: 0, ... }
    ↓ 轮询更新进度
  enhanceProgress: { total: 3, completed: 1, ... }
  enhanceProgress: { total: 3, completed: 2, ... }
  enhanceProgress: { total: 3, completed: 3, ... }
    ↓ 处理完成
[结果状态]
  showEnhanceModal: false
  showEnhanceResult: true
  enhanceResults: [...]
  currentResultIndex: 0
    ↓ 用户保存完成
[返回初始状态]
  showEnhanceResult: false
```

---

## 8. 代码实现

### 8.1 文件结构

```
src/
├── services/
│   ├── ImageEnhanceService.js (新增)          # AI增强核心服务
│   ├── UnifiedDataService.js (修改)           # 新增 addImage() 方法
│   └── ImageStorageService.js (修改)          # 初始化 AI 预设方案
├── screens/desktop/
│   └── CategoryScreen.desktop.js (修改)       # 主要UI修改
│       ├── 新增：操作菜单项 "AI图像增强"
│       ├── 新增：EnhanceModal组件
│       ├── 新增：EnhanceResultModal组件
│       ├── 新增：处理函数
│       └── 新增：样式定义
└── public/
    └── electron.js (修改)                      # 新增 IPC handlers
```

**代码量预估**：
- 新增代码：约 800-900 行
  - ImageEnhanceService.js：约 300 行
  - UnifiedDataService 扩展：约 30 行
  - ImageStorageService 扩展：约 50 行
  - CategoryScreen Modal组件：约 350 行
  - CategoryScreen 处理函数：约 150 行
  - Electron IPC handlers：约 40 行
  - 样式定义：约 100 行

### 8.2 初始化与加载预设方案

```javascript
// ========== 组件初始化，加载预设方案 ==========
const CategoryScreen = ({ route, navigation }) => {
  // ... 其他状态 ...
  
  // 预设方案状态（从设置加载）
  const [enhancePresets, setEnhancePresets] = useState(DEFAULT_ENHANCE_PRESETS);
  
  // 组件挂载时加载预设方案
  useEffect(() => {
    const loadEnhancePresets = async () => {
      try {
        const settings = await UnifiedDataService.readSettings();
        
        // 如果设置中有预设方案，使用设置中的
        if (settings.aiEnhancePresets) {
          setEnhancePresets(settings.aiEnhancePresets);
          logger.debug('✅ 从设置加载AI预设方案:', Object.keys(settings.aiEnhancePresets).length);
        } else {
          // 首次使用，初始化默认预设方案到设置
          settings.aiEnhancePresets = DEFAULT_ENHANCE_PRESETS;
          settings.aiEnhanceDefaultPreset = 'portrait';
          settings.aiEnhanceRecentPrompts = [];
          await UnifiedDataService.writeSettings(settings);
          logger.debug('✅ 初始化默认AI预设方案');
        }
        
        // 设置默认选中的预设
        if (settings.aiEnhanceDefaultPreset) {
          setEnhancePreset(settings.aiEnhanceDefaultPreset);
        }
      } catch (error) {
        logger.error('❌ 加载AI预设方案失败:', error);
        // 降级使用默认值
        setEnhancePresets(DEFAULT_ENHANCE_PRESETS);
      }
    };
    
    loadEnhancePresets();
  }, []);
  
  // ... 其他逻辑 ...
};
```

### 8.3 核心函数

#### **8.3.1 打开增强Modal**

```javascript
/**
 * 打开AI图像增强Modal
 */
const handleOpenEnhance = useCallback(() => {
  const selectedCount = selectedImages.length;
  
  // 验证选中数量
  if (selectedCount < 1 || selectedCount > 9) {
    Alert.alert('提示', '请选择1-9张图片进行AI增强');
    return;
  }
  
  // 重置状态
  setEnhanceStep('config');
  setEnhancePreset('portrait');
  setCustomPrompt('');
  setEnhanceProgress({ total: 0, completed: 0, images: [] });
  
  // 打开Modal
  setShowEnhanceModal(true);
}, [selectedImages]);
```

#### **8.3.2 开始增强处理**

```javascript
/**
 * 开始增强处理
 */
const handleStartEnhance = useCallback(async () => {
  try {
    // 切换到进度状态
    setEnhanceStep('processing');
    
    // 获取选中的图片
    const normalizedCategory = UnifiedDataService.getCategoryId('tobecleaned');
    const selectedImagesList = UnifiedDataService.getSelectedImagesByCategory(normalizedCategory);
    const imagesToEnhance = selectedImagesList.slice(0, 9);
    
    // 准备图片文件
    logger.debug('准备图片文件...');
    const imageFiles = await Promise.all(
      imagesToEnhance.map(async (img) => {
        // 从URI读取文件（Electron环境）
        const response = await fetch(img.uri);
        const blob = await response.blob();
        return new File([blob], img.fileName, { type: 'image/jpeg' });
      })
    );
    
    // 初始化进度
    setEnhanceProgress({
      total: imagesToEnhance.length,
      completed: 0,
      images: imagesToEnhance.map(img => ({
        uri: img.uri,
        originalImageId: img.id,
        status: 'pending'
      }))
    });
    
    // 获取提示词
    const prompt = enhancePreset === 'custom' 
      ? customPrompt 
      : ENHANCE_PRESETS[enhancePreset].prompt;
    
    // 提交任务
    logger.debug('提交增强任务...');
    const submitResult = await submitImageEdit(imageFiles, prompt);
    
    if (!submitResult.success) {
      throw new Error('提交任务失败');
    }
    
    logger.debug('任务已提交:', submitResult.task_id);
    setCurrentTaskId(submitResult.task_id);
    
    // 开始轮询
    pollEnhanceStatus(submitResult.task_id, imagesToEnhance);
    
  } catch (error) {
    logger.error('开始增强失败:', error);
    Alert.alert('错误', '处理失败，请重试');
    setEnhanceStep('config');
  }
}, [enhancePreset, customPrompt]);
```

#### **8.3.3 轮询任务状态**

```javascript
/**
 * 轮询查询任务状态
 */
const pollEnhanceStatus = useCallback(async (taskId, originalImages) => {
  const pollInterval = 2000; // 2秒
  let attempts = 0;
  const maxAttempts = 300; // 最多10分钟
  
  const poll = async () => {
    try {
      attempts++;
      
      // 查询状态
      const status = await getEditTaskStatus(taskId);
      
      logger.debug(`轮询进度: ${status.completed_images}/${status.total_images}`);
      
      // 更新进度
      setEnhanceProgress({
        total: status.total_images,
        completed: status.completed_images,
        images: status.results.map((result, index) => ({
          uri: originalImages[index]?.uri,
          originalImageId: originalImages[index]?.id,
          status: result.status,
          resultUrl: result.result_url
        }))
      });
      
      // 更新浮动提示（如果在后台运行）
      if (showFloatingProgress) {
        floatingProgressRef.current = {
          completed: status.completed_images,
          total: status.total_images
        };
        // 强制刷新浮动提示UI
        setShowFloatingProgress(true);
      }
      
      // 检查是否完成
      if (status.status === 'completed') {
        logger.debug('处理完成');
        clearTimeout(pollTimerRef.current);
        
        // 准备结果数据
        const results = status.results.map((result, index) => ({
          originalUri: originalImages[index].uri,
          resultUrl: result.result_url,
          originalImageId: originalImages[index].id,
          filename: result.filename
        }));
        
        // 隐藏浮动提示（如果显示着）
        setShowFloatingProgress(false);
        
        // 显示结果
        setShowEnhanceModal(false);
        setEnhanceResults(results);
        setCurrentResultIndex(0);
        setShowEnhanceResult(true);
        return;
      }
      
      // 检查是否失败
      if (status.status === 'failed') {
        logger.error('处理失败');
        clearTimeout(pollTimerRef.current);
        setShowEnhanceModal(false);
        Alert.alert('处理失败', '图像增强失败，请重试');
        return;
      }
      
      // 检查是否超时
      if (attempts >= maxAttempts) {
        logger.warn('轮询超时');
        clearTimeout(pollTimerRef.current);
        setShowEnhanceModal(false);
        Alert.alert('处理超时', '图像增强超时，请稍后查看结果');
        return;
      }
      
      // 继续轮询
      pollTimerRef.current = setTimeout(poll, pollInterval);
      
    } catch (error) {
      logger.error('查询状态失败:', error);
      
      // 重试或放弃
      if (attempts < maxAttempts) {
        pollTimerRef.current = setTimeout(poll, pollInterval);
      } else {
        setShowEnhanceModal(false);
        Alert.alert('错误', '无法获取任务状态');
      }
    }
  };
  
  // 开始轮询
  poll();
}, []);

// 清理定时器
useEffect(() => {
  return () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
    }
  };
}, []);
```

#### **8.3.4 保存增强图片**

```javascript
/**
 * 保存增强图片
 * @param {number} index - 图片索引
 * @param {string} saveMode - 保存模式: 'download' | 'add'
 */
const handleSaveEnhancedImage = useCallback(async (index, saveMode) => {
  try {
    const result = enhanceResults[index];
    
    // 下载增强后的图片
    const response = await fetch(result.resultUrl);
    const blob = await response.blob();
    
    if (saveMode === 'download') {
      // 保存到本地（Electron IPC）
      if (typeof window !== 'undefined' && window.require) {
        const { ipcRenderer } = window.require('electron');
        
        // 转换为ArrayBuffer
        const arrayBuffer = await blob.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        // 发送保存请求
        ipcRenderer.send('save-file', {
          buffer: buffer,
          defaultName: `enhanced_${result.filename}`
        });
        
        Alert.alert('成功', '图片已保存到本地');
      }
      
    } else if (saveMode === 'add') {
      // 添加为新图到暂存箱
      try {
        // 1. 从服务器下载增强后的图片
        const response = await fetch(result.resultUrl);
        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        
        // 2. 准备文件保存路径
        const { ipcRenderer } = window.require('electron');
        const path = window.require('path');
        const os = window.require('os');
        
        // 获取系统图片目录
        const picturesDir = path.join(os.homedir(), 'Pictures');
        
        // 在系统图片目录下创建 xualbum 子目录
        const xualbumDir = path.join(picturesDir, 'xualbum');
        await ipcRenderer.invoke('ensure-directory', xualbumDir);
        
        // 生成文件名：原文件名_xt_时间戳.扩展名
        // 例如：image1.jpg → image1_xt_1735261234567.jpg
        const timestamp = Date.now();
        const originalName = path.parse(result.filename).name;  // 不含扩展名
        const ext = path.parse(result.filename).ext;            // 扩展名（含点号）
        const newFileName = `${originalName}_xt_${timestamp}${ext}`;
        const newPath = path.join(xualbumDir, newFileName);
        
        logger.debug('准备保存增强图片:', {
          原文件名: result.filename,
          新文件名: newFileName,
          保存路径: newPath
        });
        
        // 保存文件到 xualbum 目录
        await ipcRenderer.invoke('save-file-to-path', {
          path: newPath,
          buffer: Buffer.from(arrayBuffer)
        });
        
        logger.debug('✅ 增强图片已保存到:', newPath);
        
        // 3. 添加到数据库 - 分类为 tobecleaned（暂存箱）
        const newImageId = `img_${timestamp}_${Math.random().toString(36).substr(2, 9)}`;
        const imageData = {
          id: newImageId,
          fileName: newFileName,
          uri: `file:///${newPath.replace(/\\/g, '/')}`,  // Windows路径转换
          path: newPath,
          category: 'tobecleaned',  // 添加到暂存箱
          timestamp: timestamp,
          takenAt: timestamp,
          
          metadata: {
            source: 'ai_enhanced',
            originalImageId: result.originalImageId,
            enhancePreset: enhancePreset, // 记录使用的增强方案
            enhancedAt: timestamp
          }
        };
        
        await UnifiedDataService.addImage(imageData);
        logger.debug('✅ 图片已添加到数据库:', newImageId);
        
        // 4. 刷新缓存
        await UnifiedDataService.refreshCache();
        
        Alert.alert(
          '添加成功', 
          `增强图片已添加到暂存箱\n\n文件已保存到：\n${xualbumDir}\n\n您可以对比原图和增强图，然后删除不需要的版本`
        );
        
      } catch (error) {
        logger.error('添加图片失败:', error);
        Alert.alert('错误', `添加失败：${error.message}\n\n请重试`);
      }
    }
    
  } catch (error) {
    logger.error('保存图片失败:', error);
    Alert.alert('错误', '保存失败，请重试');
  }
}, [enhanceResults]);

/**
 * 批量保存增强图片
 */
const handleBatchSaveEnhanced = useCallback(async (saveMode) => {
  try {
    for (let i = 0; i < enhanceResults.length; i++) {
      await handleSaveEnhancedImage(i, saveMode);
    }
    Alert.alert('完成', `已批量处理 ${enhanceResults.length} 张图片`);
  } catch (error) {
    logger.error('批量保存失败:', error);
    Alert.alert('错误', '批量保存失败，请重试');
  }
}, [enhanceResults, handleSaveEnhancedImage]);
```

### 8.4 组件实现（关键部分）

#### **8.4.1 操作菜单添加入口**

在现有的操作菜单中添加（第1284行后）：

```javascript
{/* tobecleaned分类的操作菜单 */}
{normalizedCategory === 'tobecleaned' && (
  <>
    {/* 现有的删除和复制按钮 */}
    
    {/* 新增：AI图像增强 */}
    <TouchableOpacity
      style={[
        styles.actionMenuItem,
        (currentSelectedCount < 1 || currentSelectedCount > 9) && styles.actionMenuItemDisabled
      ]}
      onPress={() => {
        setShowActionMenu(false);
        handleOpenEnhance();
      }}
      disabled={currentSelectedCount < 1 || currentSelectedCount > 9}
    >
      <Text style={styles.actionMenuItemText}>
        ✨ AI图像增强 
        {currentSelectedCount > 0 && ` (${currentSelectedCount}/9)`}
      </Text>
    </TouchableOpacity>
  </>
)}
```

#### **8.4.2 EnhanceModal组件**

```javascript
{/* AI图像增强Modal */}
<Modal
  visible={showEnhanceModal}
  transparent={true}
  animationType="slide"
  onRequestClose={() => {
    if (enhanceStep === 'config') {
      setShowEnhanceModal(false);
    } else {
      // 处理中，最小化到后台
      Alert.alert('后台运行', '任务将继续处理，完成后自动弹出结果');
      setShowEnhanceModal(false);
    }
  }}
>
  <View style={styles.enhanceModalOverlay}>
    <View style={styles.enhanceModalContent}>
      
      {/* ========== 配置状态 ========== */}
      {enhanceStep === 'config' && (
        <>
          {/* 标题栏 */}
          <View style={styles.enhanceModalHeader}>
            <Text style={styles.enhanceModalTitle}>AI图像增强</Text>
            <TouchableOpacity onPress={() => setShowEnhanceModal(false)}>
              <Text style={styles.enhanceModalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          
          {/* 图片预览 */}
          <View style={styles.enhanceImagePreview}>
            <Text style={styles.enhanceImageCount}>
              已选择 {selectedImages.length} 张图片 (最多9张)
            </Text>
            <ScrollView horizontal style={styles.enhanceImageList}>
              {UnifiedDataService.getSelectedImagesByCategory('tobecleaned')
                .slice(0, 9)
                .map(img => (
                  <Image 
                    key={img.id}
                    source={{ uri: img.uri }}
                    style={styles.enhanceImageThumb}
                  />
                ))}
            </ScrollView>
          </View>
          
          {/* 方案选择 */}
          <Text style={styles.enhanceSectionTitle}>选择增强方案：</Text>
          <View style={styles.enhancePresetGrid}>
            {Object.entries(ENHANCE_PRESETS).map(([key, preset]) => (
              <TouchableOpacity
                key={key}
                style={[
                  styles.enhancePresetCard,
                  enhancePreset === key && styles.enhancePresetCardActive
                ]}
                onPress={() => {
                  setEnhancePreset(key);
                  if (key !== 'custom') {
                    setCustomPrompt(preset.prompt);
                  }
                }}
              >
                <Text style={styles.enhancePresetIcon}>{preset.icon}</Text>
                <Text style={styles.enhancePresetName}>{preset.name}</Text>
                <Text style={styles.enhancePresetDesc}>{preset.description}</Text>
                {enhancePreset === key && (
                  <View style={styles.enhancePresetCheck}>
                    <Text style={styles.enhancePresetCheckText}>✓</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>
          
          {/* 自定义提示词 */}
          {enhancePreset === 'custom' && (
            <View style={styles.enhanceCustomPrompt}>
              <Text style={styles.enhanceCustomLabel}>自定义提示词：</Text>
              <TextInput
                style={styles.enhanceCustomInput}
                value={customPrompt}
                onChangeText={setCustomPrompt}
                placeholder="例如：修复照片瑕疵，提升清晰度"
                multiline
                numberOfLines={3}
              />
            </View>
          )}
          
          {/* 预计耗时 */}
          <Text style={styles.enhanceTimeEstimate}>
            ⏱️ 预计耗时：约 {selectedImages.length * 18} 秒
          </Text>
          
          {/* 底部按钮 */}
          <View style={styles.enhanceModalActions}>
            <TouchableOpacity
              style={[styles.enhanceButton, styles.enhanceCancelButton]}
              onPress={() => setShowEnhanceModal(false)}
            >
              <Text style={styles.enhanceCancelButtonText}>取消</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.enhanceButton, styles.enhanceSubmitButton]}
              onPress={handleStartEnhance}
            >
              <Text style={styles.enhanceSubmitButtonText}>开始增强</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
      
      {/* ========== 进度状态 ========== */}
      {enhanceStep === 'processing' && (
        <>
          {/* 标题栏 */}
          <View style={styles.enhanceModalHeader}>
            <Text style={styles.enhanceModalTitle}>正在处理图像增强...</Text>
            <TouchableOpacity onPress={() => setShowEnhanceModal(false)}>
              <Text style={styles.enhanceModalClose}>−</Text>
            </TouchableOpacity>
          </View>
          
          {/* 总进度 */}
          <Text style={styles.enhanceProgressText}>
            总进度：{enhanceProgress.completed}/{enhanceProgress.total} 张
          </Text>
          
          {/* 进度条 */}
          <View style={styles.enhanceProgressBarBg}>
            <View 
              style={[
                styles.enhanceProgressBarFill, 
                { 
                  width: `${enhanceProgress.total > 0 
                    ? (enhanceProgress.completed / enhanceProgress.total) * 100 
                    : 0}%` 
                }
              ]} 
            />
          </View>
          
          <Text style={styles.enhanceProgressPercent}>
            {enhanceProgress.total > 0 
              ? Math.round((enhanceProgress.completed / enhanceProgress.total) * 100) 
              : 0}%
          </Text>
          
          {/* 图片状态列表 */}
          <Text style={styles.enhanceSectionTitle}>处理详情：</Text>
          <ScrollView style={styles.enhanceImageStatusList}>
            {enhanceProgress.images.map((img, index) => (
              <View key={index} style={styles.enhanceImageStatus}>
                <Image source={{ uri: img.uri }} style={styles.enhanceStatusThumb} />
                <Text style={styles.enhanceStatusText}>
                  {img.status === 'completed' && '✅ 已完成'}
                  {img.status === 'processing' && '⏳ 处理中...'}
                  {img.status === 'pending' && '⏸️ 等待中'}
                </Text>
              </View>
            ))}
          </ScrollView>
          
          {/* 加载动画 */}
          <ActivityIndicator size="large" color="#007AFF" style={styles.modalIndicator} />
          
          {/* 后台运行按钮 */}
          <TouchableOpacity
            style={styles.enhanceMinimizeButton}
            onPress={() => setShowEnhanceModal(false)}
          >
            <Text style={styles.enhanceMinimizeButtonText}>后台运行</Text>
          </TouchableOpacity>
        </>
      )}
      
    </View>
  </View>
</Modal>
```

#### **8.4.3 浮动进度提示组件**

```javascript
{/* 后台运行浮动提示（显示在屏幕右下角） */}
{showFloatingProgress && (
  <View style={styles.floatingProgress}>
    <Text style={styles.floatingProgressIcon}>🔄</Text>
    <Text style={styles.floatingProgressTitle}>图像增强中</Text>
    <Text style={styles.floatingProgressText}>
      ({floatingProgressRef.current.completed}/{floatingProgressRef.current.total} 已完成)
    </Text>
    <TouchableOpacity
      style={styles.floatingProgressButton}
      onPress={() => {
        // 点击后重新打开进度Modal
        setShowFloatingProgress(false);
        setShowEnhanceModal(true);
        setEnhanceStep('processing');
      }}
    >
      <Text style={styles.floatingProgressButtonText}>点击查看</Text>
    </TouchableOpacity>
  </View>
)}
```

**组件说明**：
- **显示条件**：`showFloatingProgress === true`（点击"后台运行"后显示）
- **位置**：fixed 定位在屏幕右下角
- **功能**：
  - 实时显示处理进度
  - 点击可重新打开进度Modal
  - 处理完成后自动隐藏
- **动画**：可选添加呼吸灯效果（见4.4.8节）

---

## 9. 样式设计

### 9.1 样式定义

```javascript
// 添加到 CategoryScreen 的 styles 中

// ========== AI增强Modal基础样式 ==========
enhanceModalOverlay: {
  flex: 1,
  backgroundColor: 'rgba(0,0,0,0.5)',
  justifyContent: 'center',
  alignItems: 'center',
},
enhanceModalContent: {
  backgroundColor: '#fff',
  borderRadius: 12,
  padding: 24,
  width: '90%',
  maxWidth: 600,
  maxHeight: '80%',
},
enhanceModalHeader: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 20,
  paddingBottom: 12,
  borderBottomWidth: 1,
  borderBottomColor: '#e0e0e0',
},
enhanceModalTitle: {
  fontSize: 20,
  fontWeight: '600',
  color: '#333',
},
enhanceModalClose: {
  fontSize: 24,
  color: '#666',
  fontWeight: '300',
},

// ========== 图片预览 ==========
enhanceImagePreview: {
  marginBottom: 20,
},
enhanceImageCount: {
  fontSize: 14,
  color: '#666',
  marginBottom: 12,
},
enhanceImageList: {
  flexDirection: 'row',
},
enhanceImageThumb: {
  width: 60,
  height: 60,
  borderRadius: 8,
  marginRight: 8,
  backgroundColor: '#f0f0f0',
},

// ========== 方案选择 ==========
enhanceSectionTitle: {
  fontSize: 16,
  fontWeight: '600',
  color: '#333',
  marginBottom: 12,
},
enhancePresetGrid: {
  flexDirection: 'row',
  flexWrap: 'wrap',
  gap: 12,
  marginBottom: 20,
},
enhancePresetCard: {
  width: 'calc(50% - 6px)',
  padding: 16,
  borderRadius: 8,
  borderWidth: 2,
  borderColor: '#e0e0e0',
  alignItems: 'center',
  position: 'relative',
  backgroundColor: '#fff',
},
enhancePresetCardActive: {
  borderColor: '#007AFF',
  backgroundColor: '#F0F8FF',
},
enhancePresetIcon: {
  fontSize: 32,
  marginBottom: 8,
},
enhancePresetName: {
  fontSize: 16,
  fontWeight: '600',
  color: '#333',
  marginBottom: 4,
},
enhancePresetDesc: {
  fontSize: 12,
  color: '#666',
  textAlign: 'center',
},
enhancePresetCheck: {
  position: 'absolute',
  top: 8,
  right: 8,
  backgroundColor: '#007AFF',
  borderRadius: 12,
  width: 24,
  height: 24,
  justifyContent: 'center',
  alignItems: 'center',
},
enhancePresetCheckText: {
  color: '#fff',
  fontSize: 14,
  fontWeight: 'bold',
},

// ========== 自定义提示词 ==========
enhanceCustomPrompt: {
  marginBottom: 16,
},
enhanceCustomLabel: {
  fontSize: 14,
  color: '#333',
  marginBottom: 8,
},
enhanceCustomInput: {
  borderWidth: 1,
  borderColor: '#ddd',
  borderRadius: 8,
  padding: 12,
  fontSize: 14,
  color: '#333',
  minHeight: 80,
  textAlignVertical: 'top',
},

// ========== 预计耗时 ==========
enhanceTimeEstimate: {
  fontSize: 14,
  color: '#666',
  textAlign: 'center',
  marginBottom: 20,
},

// ========== 底部按钮 ==========
enhanceModalActions: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  gap: 12,
},
enhanceButton: {
  flex: 1,
  paddingVertical: 12,
  borderRadius: 8,
  alignItems: 'center',
},
enhanceCancelButton: {
  backgroundColor: '#f0f0f0',
},
enhanceCancelButtonText: {
  fontSize: 16,
  color: '#666',
  fontWeight: '500',
},
enhanceSubmitButton: {
  backgroundColor: '#007AFF',
},
enhanceSubmitButtonText: {
  fontSize: 16,
  color: '#fff',
  fontWeight: '600',
},

// ========== 进度显示 ==========
enhanceProgressText: {
  fontSize: 16,
  color: '#333',
  fontWeight: '500',
  marginBottom: 12,
  textAlign: 'center',
},
enhanceProgressBarBg: {
  width: '100%',
  height: 12,
  backgroundColor: '#e0e0e0',
  borderRadius: 6,
  overflow: 'hidden',
  marginBottom: 8,
},
enhanceProgressBarFill: {
  height: '100%',
  backgroundColor: '#007AFF',
  transition: 'width 0.3s ease',
},
enhanceProgressPercent: {
  fontSize: 24,
  fontWeight: 'bold',
  color: '#007AFF',
  textAlign: 'center',
  marginBottom: 20,
},

// ========== 图片状态列表 ==========
enhanceImageStatusList: {
  maxHeight: 200,
  marginBottom: 16,
  borderWidth: 1,
  borderColor: '#e0e0e0',
  borderRadius: 8,
  padding: 12,
},
enhanceImageStatus: {
  flexDirection: 'row',
  alignItems: 'center',
  marginBottom: 12,
},
enhanceStatusThumb: {
  width: 40,
  height: 40,
  borderRadius: 6,
  marginRight: 12,
  backgroundColor: '#f0f0f0',
},
enhanceStatusText: {
  fontSize: 14,
  color: '#333',
},

// ========== 最小化按钮 ==========
enhanceMinimizeButton: {
  backgroundColor: '#f0f0f0',
  paddingVertical: 12,
  borderRadius: 8,
  alignItems: 'center',
},
enhanceMinimizeButtonText: {
  fontSize: 16,
  color: '#666',
  fontWeight: '500',
},

// ========== 后台运行浮动提示 ==========
floatingProgress: {
  position: 'absolute',
  bottom: 20,
  right: 20,
  backgroundColor: 'rgba(0, 0, 0, 0.85)',
  borderRadius: 12,
  padding: 16,
  minWidth: 160,
  alignItems: 'center',
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.3,
  shadowRadius: 12,
  elevation: 8,
  zIndex: 999,
},
floatingProgressIcon: {
  fontSize: 24,
  marginBottom: 8,
},
floatingProgressTitle: {
  fontSize: 14,
  fontWeight: '600',
  color: '#fff',
  marginBottom: 4,
},
floatingProgressText: {
  fontSize: 12,
  color: '#ccc',
  marginBottom: 12,
},
floatingProgressButton: {
  backgroundColor: 'rgba(255, 255, 255, 0.2)',
  paddingHorizontal: 16,
  paddingVertical: 6,
  borderRadius: 6,
  borderWidth: 1,
  borderColor: 'rgba(255, 255, 255, 0.3)',
},
floatingProgressButtonText: {
  fontSize: 12,
  color: '#fff',
  fontWeight: '500',
},

// ========== 结果展示Modal ==========
enhanceResultContainer: {
  flex: 1,
  backgroundColor: '#000',
},
enhanceResultHeader: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: 16,
  backgroundColor: 'rgba(0,0,0,0.8)',
},
enhanceResultTitle: {
  fontSize: 18,
  fontWeight: '600',
  color: '#fff',
},
enhanceResultClose: {
  fontSize: 24,
  color: '#fff',
},
enhanceResultNav: {
  flexDirection: 'row',
  justifyContent: 'center',
  alignItems: 'center',
  padding: 16,
  backgroundColor: 'rgba(0,0,0,0.8)',
},
enhanceNavButton: {
  paddingHorizontal: 20,
  paddingVertical: 8,
  backgroundColor: '#007AFF',
  borderRadius: 6,
  marginHorizontal: 12,
},
enhanceNavButtonText: {
  color: '#fff',
  fontSize: 14,
  fontWeight: '500',
},
enhanceNavText: {
  color: '#fff',
  fontSize: 16,
},
enhanceCompareContainer: {
  flex: 1,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 20,
},
enhanceCompareItem: {
  flex: 1,
  alignItems: 'center',
},
enhanceCompareLabel: {
  fontSize: 16,
  color: '#fff',
  marginBottom: 12,
  fontWeight: '500',
},
enhanceCompareImage: {
  width: '100%',
  height: 400,
  borderRadius: 8,
},
enhanceCompareDivider: {
  width: 60,
  alignItems: 'center',
},
enhanceCompareArrow: {
  fontSize: 32,
  color: '#fff',
},
enhanceResultActions: {
  flexDirection: 'row',
  justifyContent: 'center',
  padding: 16,
  backgroundColor: 'rgba(0,0,0,0.8)',
  gap: 12,
},
enhanceActionButton: {
  backgroundColor: '#007AFF',
  paddingHorizontal: 16,
  paddingVertical: 10,
  borderRadius: 8,
},
enhanceActionButtonText: {
  color: '#fff',
  fontSize: 14,
  fontWeight: '500',
},
enhanceBatchActions: {
  flexDirection: 'row',
  justifyContent: 'center',
  padding: 16,
  backgroundColor: 'rgba(0,0,0,0.8)',
  gap: 12,
},
enhanceBatchButton: {
  backgroundColor: '#34C759',
  paddingHorizontal: 20,
  paddingVertical: 12,
  borderRadius: 8,
},
enhanceBatchButtonText: {
  color: '#fff',
  fontSize: 14,
  fontWeight: '600',
},

// ========== 禁用状态 ==========
actionMenuItemDisabled: {
  opacity: 0.5,
},
```

---

## 10. 错误处理

### 10.1 错误类型

| 错误类型 | 触发条件 | 处理方式 |
|----------|----------|----------|
| **选中数量错误** | 选中<1张或>9张 | 提示用户，禁用按钮 |
| **网络请求失败** | API调用超时或失败 | 显示错误提示，支持重试 |
| **文件读取失败** | 无法读取图片文件 | 跳过该图片，继续处理其他 |
| **任务提交失败** | 服务器拒绝请求 | 显示错误信息，返回配置界面 |
| **处理超时** | 轮询超过10分钟 | 提示超时，停止轮询 |
| **部分处理失败** | 某些图片处理失败 | 显示成功和失败数量 |
| **保存失败** | 文件写入失败 | 提示错误，支持重试 |

### 10.2 错误处理示例

```javascript
/**
 * 统一错误处理函数
 */
const handleEnhanceError = useCallback((error, context) => {
  logger.error(`增强错误 [${context}]:`, error);
  
  let message = '操作失败，请重试';
  
  if (error.message.includes('网络')) {
    message = '网络连接失败，请检查网络后重试';
  } else if (error.message.includes('超时')) {
    message = '请求超时，请稍后重试';
  } else if (error.message.includes('文件')) {
    message = '文件读取失败，请检查文件权限';
  }
  
  Alert.alert('错误', message, [
    { text: '知道了', style: 'cancel' },
    { text: '重试', onPress: () => {
      // 根据context决定重试逻辑
    }}
  ]);
}, []);
```

---

## 11. 性能优化

### 11.1 优化策略

| 优化项 | 策略 | 预期效果 |
|--------|------|----------|
| **图片加载** | 使用缩略图，延迟加载原图 | 减少内存占用 |
| **轮询优化** | 动态调整轮询间隔 | 减少请求次数 |
| **状态更新** | 使用useCallback避免重渲染 | 提升UI流畅度 |
| **文件操作** | 批量处理，避免阻塞UI | 提升响应速度 |
| **内存管理** | 及时清理大对象和定时器 | 防止内存泄漏 |

### 11.2 具体实现

```javascript
// 动态轮询间隔
const getDynamicPollInterval = (attempts) => {
  if (attempts < 10) return 2000;  // 前10次：2秒
  if (attempts < 30) return 5000;  // 10-30次：5秒
  return 10000;                     // 30次后：10秒
};

// 清理资源
useEffect(() => {
  return () => {
    // 清理定时器
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
    }
    
    // 清理图片缓存
    setEnhanceResults([]);
    setEnhanceProgress({ total: 0, completed: 0, images: [] });
  };
}, []);
```

---

## 12. 测试计划

### 12.1 功能测试

| 测试项 | 测试场景 | 预期结果 |
|--------|----------|----------|
| **入口显示** | 在非tobecleaned分类 | 不显示AI增强选项 |
| | 在tobecleaned分类 | 显示AI增强选项 |
| **数量验证** | 选中0张图片 | 按钮禁用 |
| | 选中1张图片 | 按钮可用 |
| | 选中9张图片 | 按钮可用 |
| | 选中10张图片 | 按钮禁用，提示错误 |
| **方案选择** | 选择预设方案 | 自动填充提示词 |
| | 选择自定义 | 显示输入框 |
| **任务提交** | 正常提交 | 切换到进度状态 |
| | 提交失败 | 显示错误，返回配置 |
| **进度显示** | 处理中 | 实时更新进度 |
| | 后台运行 | 最小化窗口，继续轮询 |
| | 处理完成 | 打开结果Modal |
| **结果展示** | 单张切换 | 正常切换 |
| | 保存操作 | 正确执行 |

### 12.2 性能测试

| 测试项 | 测试条件 | 性能指标 |
|--------|----------|----------|
| **响应时间** | 打开Modal | <200ms |
| **处理时间** | 1张图片 | 15-20秒 |
| | 9张图片 | 120-180秒 |
| **内存占用** | 处理9张图片 | <500MB |
| **CPU占用** | 轮询期间 | <10% |

### 12.3 兼容性测试

- **操作系统**：Windows 10/11, macOS 12+
- **Electron版本**：当前项目使用的版本
- **屏幕分辨率**：1920x1080, 2560x1440, 3840x2160

---

## 13. 后续优化

### 13.1 短期优化（1-2周）

1. ✅ **增加更多预设方案**
   - 黑白转彩色
   - 老照片修复
   - 人像背景虚化

2. ✅ **优化进度显示**
   - 添加进度动画
   - 显示剩余时间估算
   - 支持取消任务

3. ✅ **改进错误提示**
   - 更详细的错误信息
   - 提供解决方案建议

### 13.2 中期优化（1个月）

1. ✅ **批量操作优化**
   - 支持分批提交（超过9张时自动分批）
   - 队列管理

2. ✅ **历史记录**
   - 记录增强历史
   - 支持查看和恢复

3. ✅ **预览功能**
   - 在配置阶段预览效果（快速生成小图）

### 13.3 长期优化（3个月+）

1. ✅ **AI方案推荐**
   - 根据图片内容自动推荐方案
   - 机器学习优化

2. ✅ **本地处理**
   - 探索本地AI模型
   - 减少API依赖

3. ✅ **协作功能**
   - 分享增强方案
   - 社区预设库

---

## 14. 附录

### 14.1 相关文档

- [客户端调用指南](./客户端调用指南.md) - API接口详细说明
- [PC端UI设计](./design/PC端UI设计.md) - UI设计规范

### 14.2 参考资源

- 阿里云图像编辑API文档
- React Native Modal组件文档
- Electron IPC通信文档

### 14.3 更新历史

| 版本 | 日期 | 更新内容 | 作者 |
|------|------|----------|------|
| v1.0 | 2025-10-27 | 初始版本 | 开发团队 |

---

**文档状态**：✅ 设计完成，待开发实现

**预计工作量**：3-5个工作日

**优先级**：P1（高优先级）

**依赖项**：
- 阿里云图像编辑API已配置
- Electron IPC文件操作已实现
- UnifiedDataService已完善

---

## 15. 开发检查清单

- [ ] 添加操作菜单入口
- [ ] 实现EnhanceModal组件（配置+进度）
- [ ] 实现EnhanceResultModal组件
- [ ] 封装API调用函数
- [ ] 实现轮询逻辑
- [ ] 实现保存逻辑（3种方式）
- [ ] 添加样式定义
- [ ] 错误处理完善
- [ ] 功能测试
- [ ] 性能优化
- [ ] 文档更新

---

**文档结束**

