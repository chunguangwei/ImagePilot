/**
 * iOS 风格设计令牌 + dark/light 主题
 *
 * 取值贴近 iOS Human Interface 系统色：分组列表浅灰背景 + 卡片表面 +
 * 细分隔线 + 克制的蓝色强调色。两套调色板（light/dark）按系统外观自动切。
 *
 * 用法：
 *   import { useIosColors } from '../../ui/ios/theme';
 *   const c = useIosColors();
 *   <View style={[styles.container, { backgroundColor: c.groupedBg }]} />
 *
 * 注意：原 `colors` 命名导出仍然指向 lightColors，向后兼容；
 * 想跟随系统主题切换的页面统一改 useIosColors() 拿动态版本。
 */

import { useColorScheme } from 'react-native';

// === 浅色（iOS Light Appearance）===
export const lightColors = {
  // 背景
  groupedBg: '#F2F2F7', // systemGroupedBackground
  card: '#FFFFFF', // secondarySystemGroupedBackground
  cardPressed: '#D1D1D6',
  separator: '#C6C6C8', // separator

  // 文字
  label: '#000000',
  secondaryLabel: '#3C3C4399', // 60% on light
  tertiaryLabel: '#8E8E93',

  // 强调
  accent: '#007AFF',
  accentSoft: '#EAF2FF',
  danger: '#FF3B30',
  success: '#34C759',
  chevron: '#C4C4C6',
};

// === 深色（iOS Dark Appearance）===
// 参考 Apple HIG semantic colors：systemGroupedBackground / secondarySystemGroupedBackground 等
export const darkColors = {
  groupedBg: '#000000', // dark mode systemGroupedBackground
  card: '#1C1C1E', // secondarySystemGroupedBackground
  cardPressed: '#2C2C2E',
  separator: '#38383A', // separator dark

  label: '#FFFFFF',
  secondaryLabel: '#EBEBF599', // 60% on dark
  tertiaryLabel: '#8E8E93', // 中灰两个 mode 都可读

  accent: '#0A84FF', // iOS dark accent 比浅色蓝稍亮
  accentSoft: '#0A84FF22',
  danger: '#FF453A',
  success: '#30D158',
  chevron: '#48484A',
};

// 向后兼容：旧 import { colors } 用的就是浅色
export const colors = lightColors;

/**
 * 按系统外观返回当前调色板（跨端：iOS + Android 都用同一钩子）。
 * - useColorScheme() → 'light' | 'dark' | null（用户没明确选；按 null 走 light）
 *
 * 跨端注意：Android 要让原生 Activity theme 走 DayNight 才能让
 * StatusBar / 系统 chrome 跟 light/dark 切；JS 侧的 useColorScheme 在两端都自动跟
 * 系统外观（android/values/styles.xml 改 AppTheme parent 之后生效）。
 */
export function useThemeColors() {
  const scheme = useColorScheme();
  return scheme === 'dark' ? darkColors : lightColors;
}

// 旧名 useIosColors 保留为别名（之前 7 个屏在用）；新代码统一用 useThemeColors。
export const useIosColors = useThemeColors;

export const radius = { card: 12, button: 12, chip: 16, sheet: 16 };

export const spacing = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 24 };

// 字号层级（近似 iOS Text Styles）
export const font = {
  largeTitle: 34,
  title: 22,
  headline: 17,
  body: 17,
  callout: 16,
  subhead: 15,
  footnote: 13,
  caption: 12,
};

export const ios = { colors, lightColors, darkColors, useIosColors, useThemeColors, radius, spacing, font };
export default ios;
