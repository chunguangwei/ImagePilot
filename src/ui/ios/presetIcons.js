/**
 * AI 修图预设 / 图片操作 的 Ionicons 名称映射（统一 iOS 单色线性图标，替代彩色 emoji）。
 * Ionicons 字体已打包（android/app/src/main/assets/fonts/Ionicons.ttf）。
 */

// 预设 id → Ionicons 名（AI修图 菜单 + 设置页预设配置 共用）
export const PRESET_ICONS = {
  portrait: 'happy-outline',        // 人像美颜
  enhance: 'color-wand-outline',    // 清晰增强（魔法棒；本机 Ionicons 无 sparkles）
  color: 'color-palette-outline',   // 色彩优化
  document: 'card-outline',         // 证件处理
  custom: 'options-outline',        // 自定义
  cutout: 'cut-outline',            // 背景移除
  inpaint: 'bandage-outline',       // 物体消除
};
export const PRESET_ICON_FALLBACK = 'color-wand-outline';

export function presetIcon(id) {
  return PRESET_ICONS[id] || PRESET_ICON_FALLBACK;
}

// 图片预览底部操作栏 图标
export const ACTION_ICONS = {
  stage: 'file-tray-outline',       // 暂存
  remove: 'arrow-undo-outline',     // 从暂存箱移除
  delete: 'trash-outline',          // 删除
  enhance: 'color-wand-outline',    // AI修图
  filter: 'color-filter-outline',   // 滤镜
  category: 'pricetag-outline',     // 分类
  share: 'share-outline',           // 分享
  clearClassify: 'refresh-outline', // 清理分类（退回待分类）
  aiClassify: 'hardware-chip-outline', // 对选中图跑 AI 分类
};

export default { PRESET_ICONS, presetIcon, ACTION_ICONS };
