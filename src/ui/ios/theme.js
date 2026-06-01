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

import React, { useState } from 'react';
import { useColorScheme } from 'react-native';

// === 浅色（iOS Light Appearance）===
export const lightColors = {
  // 背景
  groupedBg: '#F2F2F7', // systemGroupedBackground
  card: '#FFFFFF', // secondarySystemGroupedBackground
  cardPressed: '#D1D1D6',
  separator: '#C6C6C8', // separator

  // iOS systemFill 系列：用于无主色的中性按钮 / chip / pill
  fill: 'rgba(120, 120, 128, 0.20)',          // systemFill
  fillSecondary: 'rgba(120, 120, 128, 0.16)', // secondarySystemFill
  fillTertiary: 'rgba(118, 118, 128, 0.12)',  // tertiarySystemFill

  // 文字
  label: '#000000',
  secondaryLabel: '#3C3C4399', // 60% on light
  tertiaryLabel: '#8E8E93',

  // 强调
  accent: '#007AFF',
  accentSoft: '#EAF2FF',
  danger: '#FF3B30',
  dangerSoft: '#FFE5E3',     // 红 destructive 的轻底（HIG: systemRed @ ~12%）
  success: '#34C759',
  successSoft: '#E8F5E9',
  warning: '#FF9500',        // iOS systemOrange
  warningSoft: '#FFF3E0',
  chevron: '#C4C4C6',
};

// === 深色（iOS Dark Appearance）===
// 参考 Apple HIG semantic colors：systemGroupedBackground / secondarySystemGroupedBackground 等
export const darkColors = {
  groupedBg: '#000000', // dark mode systemGroupedBackground
  card: '#1C1C1E', // secondarySystemGroupedBackground
  cardPressed: '#2C2C2E',
  separator: '#38383A', // separator dark

  // iOS systemFill 系列 dark 值（与 light 不同的不透明度）
  fill: 'rgba(120, 120, 128, 0.36)',
  fillSecondary: 'rgba(120, 120, 128, 0.32)',
  fillTertiary: 'rgba(118, 118, 128, 0.24)',

  label: '#FFFFFF',
  secondaryLabel: '#EBEBF599', // 60% on dark
  tertiaryLabel: '#EBEBF54D', // 30% on dark (更柔和；之前 8E8E93 在 dark 太亮)

  accent: '#0A84FF', // iOS dark accent 比浅色蓝稍亮
  accentSoft: 'rgba(10, 132, 255, 0.20)',  // 比 22 略深，dark 上更清晰
  danger: '#FF453A',
  dangerSoft: 'rgba(255, 69, 58, 0.20)',
  success: '#30D158',
  successSoft: 'rgba(48, 209, 88, 0.20)',
  warning: '#FF9F0A',
  warningSoft: 'rgba(255, 159, 10, 0.20)',
  chevron: '#48484A',
};

// 向后兼容：旧 import { colors } 用的就是浅色
export const colors = lightColors;

/**
 * 主题 Context：让用户在 Settings 里手动覆盖系统外观（'system' | 'light' | 'dark'）。
 * - 'system'：跟随 useColorScheme()（默认，向后兼容历史行为）
 * - 'light' / 'dark'：强制覆盖，无视系统
 *
 * 默认值兜底为 'system' + 空 setter，使 useThemeColors 在 Provider 外仍可用
 * （走系统外观，不会抛 null context 错）。
 */
export const ThemeContext = React.createContext({ scheme: 'system', setScheme: () => {} });

export function ThemeProvider({ children, initialScheme = 'system' }) {
  const [scheme, setScheme] = useState(initialScheme);
  return (
    <ThemeContext.Provider value={{ scheme, setScheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * 按当前主题（用户选择 > 系统外观）返回调色板。
 * - useColorScheme() → 'light' | 'dark' | null（系统外观；null 按 light）
 * - context.scheme === 'system' 时跟随系统，否则强制为 'light' / 'dark'
 *
 * 跨端注意：Android 要让原生 Activity theme 走 DayNight 才能让
 * StatusBar / 系统 chrome 跟 light/dark 切；JS 侧的 useColorScheme 在两端都自动跟
 * 系统外观（android/values/styles.xml 改 AppTheme parent 之后生效）。
 */
export function useThemeColors() {
  const sysScheme = useColorScheme();
  const { scheme } = React.useContext(ThemeContext);
  const effective = scheme === 'system' ? (sysScheme === 'dark' ? 'dark' : 'light') : scheme;
  return effective === 'dark' ? darkColors : lightColors;
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
