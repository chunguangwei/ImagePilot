/**
 * 触觉反馈薄包装
 *
 * iOS：走原生 HapticsModule（UIImpactFeedbackGenerator /
 *      UINotificationFeedbackGenerator / UISelectionFeedbackGenerator）
 * Android / web：no-op，调用方不用判平台
 *
 * API：
 *   Haptics.impact('light' | 'medium' | 'heavy')       // 撞击型，按钮点击 / 滑过
 *   Haptics.notification('success' | 'warning' | 'error')  // 通知型，操作结果
 *   Haptics.selection()                                 // 极轻，列表选中条目跳变
 *
 * 调用都是 fire-and-forget；返回 Promise 只是因为原生 bridge，不需要 await。
 */

import { NativeModules, Platform } from 'react-native';

const HapticsModule = Platform.OS === 'ios' ? NativeModules?.HapticsModule : null;

const _noop = () => {};

export const impact = (style = 'light') => {
  if (HapticsModule && typeof HapticsModule.impact === 'function') {
    try { HapticsModule.impact(style); } catch (_) { /* 静默 */ }
  }
};

export const notification = (type = 'success') => {
  if (HapticsModule && typeof HapticsModule.notification === 'function') {
    try { HapticsModule.notification(type); } catch (_) { /* 静默 */ }
  }
};

export const selection = () => {
  if (HapticsModule && typeof HapticsModule.selection === 'function') {
    try { HapticsModule.selection(); } catch (_) { /* 静默 */ }
  }
};

export default { impact, notification, selection };
