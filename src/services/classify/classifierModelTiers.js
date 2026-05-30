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
    bundled: true,            // 随 APK 打包，无需下载
    filename: 'mobilenetv3_rw_Opset17.onnx',
    url: null,                 // 不下载
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
    sizeMB: 20,
    speed: '快',
    bundled: false,
    filename: 'mobilenetv3_places365.onnx',
    url: `${BASE}/mobilenetv3_places365.onnx`,
    engine: 'places365',
    readyForUse: false,        // P1：模型 + 推理引擎还没接入
    desc: '识别拍摄场景：厨房 / 海滩 / 办公室 / 教室 等 365 类',
    weak: '不识别具体物品',
    classes: 365,
  },
  clip: {
    key: 'clip',
    label: 'AI 智能识别',
    sublabel: '高级 · 按需下载',
    sizeMB: 50,
    speed: '中等（约慢 2x）',
    bundled: false,
    filename: 'mobileclip_s0.onnx',
    url: `${BASE}/mobileclip_s0.onnx`,
    engine: 'clip',
    readyForUse: false,        // P2：模型 + 推理引擎还没接入
    desc: '用自然语言定义自己的分类（如"我家狗" / "工作截图"），无固定类别',
    weak: '推理比前两种慢约 2x',
    classes: '无固定（自定义）',
  },
};

export const CLASSIFIER_TIER_ORDER = ['basic', 'scene', 'clip'];

/** 默认档：basic（已打包，0 下载） */
export const DEFAULT_CLASSIFIER_TIER = 'basic';

export default { CLASSIFIER_TIERS, CLASSIFIER_TIER_ORDER, DEFAULT_CLASSIFIER_TIER };
