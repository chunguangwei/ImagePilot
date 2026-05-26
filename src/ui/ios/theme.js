/**
 * iOS 风格设计令牌（浅色 / 白色简洁）
 *
 * 取值贴近 iOS Human Interface 的系统色与分组列表观感：
 * 浅灰分组背景 + 纯白卡片 + 细分隔线 + 克制的蓝色强调色。
 * 全应用 iOS 风格屏幕/组件统一引用本文件，改色只改这里。
 */

export const colors = {
  // 背景
  groupedBg: '#F2F2F7', // 分组列表页背景（浅灰）
  card: '#FFFFFF', // 卡片/单元格表面（白）
  cardPressed: '#D1D1D6', // 按下态
  separator: '#C6C6C8', // 分隔线

  // 文字
  label: '#000000', // 主文字
  secondaryLabel: '#6C6C70', // 次要文字
  tertiaryLabel: '#8E8E93', // 辅助/占位

  // 强调与状态
  accent: '#007AFF', // 主强调（iOS 蓝），克制使用
  accentSoft: '#EAF2FF', // 浅蓝填充（tinted 按钮底）
  danger: '#FF3B30', // 危险/删除
  success: '#34C759', // 开关开/成功
  chevron: '#C4C4C6', // 列表右侧箭头
};

export const radius = { card: 12, button: 12, chip: 16, sheet: 16 };

export const spacing = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 24 };

// 字号层级（近似 iOS Text Styles）
export const font = {
  largeTitle: 34,
  title: 22,
  headline: 17, // 加粗强调
  body: 17,
  callout: 16,
  subhead: 15,
  footnote: 13,
  caption: 12,
};

export const ios = { colors, radius, spacing, font };
export default ios;
