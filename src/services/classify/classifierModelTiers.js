/**
 * classifierModelTiers — 设备端分类模型三档配置
 *
 * Phase 0：先把"三档结构 + 设置 + 下载机制 + UI"搭起来。
 * 「物体识别」(basic) 走现有 MobileNetV3-ImageNet（已打包，无需下载）。
 * 「场景识别」(scene, Places365) 和「AI 智能识别」(clip, MobileCLIP) 留占位。
 * 后续 PR 接入实际 ONNX 模型 + 推理引擎。
 *
 * 三档定位：
 * - basic：物体（猫/车/食物 等 1000 类）— ImageNet 任务
 * - scene：场景（厨房/海滩/办公室 等 365 类）— Places365 任务
 * - clip ：自然语言（用户自定义类如"我家狗"）— CLIP 多模态
 *
 * 模型下载托管在 chunguangwei/ImagePilot Release（github.com 可达，
 * api.github.com 被某些设备 403）。
 */

const BASE = 'https://github.com/chunguangwei/ImagePilot/releases/download/models-v1';

/** 三档配置。 readyForUse=false 表示推理引擎暂未接入，UI 应当 disable 选项。 */
export const CLASSIFIER_TIERS = {
  basic: {
    key: 'basic',
    label: '物体识别',
    sublabel: '默认 · 已内置',
    sizeMB: 22,
    speed: '快',
    bundled: true,             // 基础识别随 App 打包（安卓 assets/models、iOS 资源包）→ 零下载、离线开箱即用
    filename: 'mobilenetv3_rw_Opset17.onnx',
    url: `${BASE}/mobilenetv3_rw_Opset17.onnx`,
    engine: 'imagenet',        // 推理引擎标识
    readyForUse: true,         // 推理实现已就绪（沿用现有 MobileNetV3 链路）
    desc: '识别照片里的物品、动物、食物、设备等具体对象',
    weak: '不擅长抽象场景判断（如室内/室外/职业场合）',
    classes: 1000,
  },
  scene: {
    key: 'scene',
    label: '场景识别',
    sublabel: '推荐 · 按需下载',
    sizeMB: 45,
    speed: '快',
    bundled: false,
    // P1 实测模型：ResNet18-Places365 (CSAILVision)，标准 ONNX 转换
    // 用户需要上传 onnx 到 GitHub Release models-v1 才能下载
    filename: 'resnet18_places365.onnx',
    url: `${BASE}/resnet18_places365.onnx`,
    engine: 'places365',
    readyForUse: true,         // P1：推理引擎已接入，模型按需下载
    desc: '识别拍摄场景：厨房 / 海滩 / 办公室 / 教室 等 365 类',
    weak: '不识别具体物品',
    classes: 365,
  },
  clip: {
    key: 'clip',
    label: 'AI 智能识别',
    sublabel: '高级 · 按需下载',
    sizeMB: 147,
    speed: '中等',
    bundled: false,
    // CLIP 档用 MobileCLIP2-S2（fp32，安卓 fp16 掉精度故用 fp32）。模型注册表见 clipModels.js
    // （现仅此一个；结构保留便于将来扩展）。下方 filename/url 供设置页下载/状态判断。
    // 文本侧 embeddings 随包内嵌（clipTextEmbeddings.mobileclip2_s2.json），换模型零改推理代码。
    filename: 'mobileclip2_s2_fp32_image_encoder.onnx',
    url: `${BASE}/mobileclip2_s2_fp32_image_encoder.onnx`,
    engine: 'clip',
    readyForUse: true,
    desc: 'AI 语义识别，更懂抽象场景与氛围',
    weak: '比基础档稍慢；自定义类请用云端 AI 分类',
    classes: 20,
  },
  vlm: {
    key: 'vlm',
    label: '多模态大模型',
    sublabel: '最精准 · 按需下载',
    // VLM 档体积/下载按所选变体（vlmModels.js）动态取；这里给默认 Qwen3-VL-2B 的体积占位。
    sizeMB: 1838,
    speed: '最慢',
    bundled: false,
    // vlm 档是双文件（model+mmproj），下载/状态判断走 vlmModels + ensureLargeModel，
    // 不用下面单一 filename/url（保留占位以兼容旧的按 tier 读取逻辑）。
    filename: 'Qwen3-VL-2B-Instruct-Q4_K_M.gguf',
    url: '',
    engine: 'vlm',
    readyForUse: true,
    desc: '大模型看图理解，最懂内容与细节；单张/小批量精修最佳',
    weak: '秒级/张，整库批量慢、发热、建议插电',
    classes: 20,
  },
};

export const CLASSIFIER_TIER_ORDER = ['basic', 'scene', 'clip', 'vlm'];

/** 默认档：basic（已打包，0 下载） */
export const DEFAULT_CLASSIFIER_TIER = 'basic';

export default { CLASSIFIER_TIERS, CLASSIFIER_TIER_ORDER, DEFAULT_CLASSIFIER_TIER };
