/**
 * 触觉反馈薄包装（跨端）
 *
 * iOS：走原生 HapticsModule（UIImpactFeedbackGenerator /
 *      UINotificationFeedbackGenerator / UISelectionFeedbackGenerator）
 *
 * Android：走 RN 内置 Vibration API。Android 没 iOS 的 generator 概念，
 *      用震动 pattern (ms) 模拟相近手感：
 *        impact light    → 8ms
 *        impact medium   → 15ms
 *        impact heavy    → 30ms
 *        notification success → 单脉冲 25ms
 *        notification warning → 两脉冲 25+50+25
 *        notification error   → 三脉冲 25+50+25+50+25
 *        selection           → 5ms 微震
 *      需 AndroidManifest 含 `android.permission.VIBRATE`（已加）。
 *
 * web：no-op
 *
 * API：
 *   Haptics.impact('light' | 'medium' | 'heavy')
 *   Haptics.notification('success' | 'warning' | 'error')
 *   Haptics.selection()
 *
 * 所有调用 fire-and-forget；返回值 undefined（不需要 await）。
 */

import { NativeModules, Platform, Vibration } from 'react-native';

const HapticsModule = Platform.OS === 'ios' ? NativeModules?.HapticsModule : null;

// === Android Vibration pattern 映射 ===
const ANDROID_IMPACT_MS = { light: 8, medium: 15, heavy: 30 };
const ANDROID_NOTIFICATION_PATTERN = {
  success: [0, 25],
  warning: [0, 25, 50, 25],
  error: [0, 25, 50, 25, 50, 25],
};
const ANDROID_SELECTION_MS = 5;

export const impact = (style = 'light') => {
  if (Platform.OS === 'ios') {
    if (HapticsModule && typeof HapticsModule.impact === 'function') {
      try { HapticsModule.impact(style); } catch (_) { /* 静默 */ }
    }
    return;
  }
  if (Platform.OS === 'android') {
    try { Vibration.vibrate(ANDROID_IMPACT_MS[style] || ANDROID_IMPACT_MS.light); } catch (_) { /* 静默 */ }
  }
};

export const notification = (type = 'success') => {
  if (Platform.OS === 'ios') {
    if (HapticsModule && typeof HapticsModule.notification === 'function') {
      try { HapticsModule.notification(type); } catch (_) { /* 静默 */ }
    }
    return;
  }
  if (Platform.OS === 'android') {
    try { Vibration.vibrate(ANDROID_NOTIFICATION_PATTERN[type] || ANDROID_NOTIFICATION_PATTERN.success); } catch (_) { /* 静默 */ }
  }
};

export const selection = () => {
  if (Platform.OS === 'ios') {
    if (HapticsModule && typeof HapticsModule.selection === 'function') {
      try { HapticsModule.selection(); } catch (_) { /* 静默 */ }
    }
    return;
  }
  if (Platform.OS === 'android') {
    try { Vibration.vibrate(ANDROID_SELECTION_MS); } catch (_) { /* 静默 */ }
  }
};

export default { impact, notification, selection };
