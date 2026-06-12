/**
 * VIcon —— 统一矢量图标（Ionicons，字体已随 App 打包）
 *
 * 替代散落各页的 emoji/Unicode 字符小图标（▶ ⏮ ⏸ ✕ 🎲 等在小尺寸下发虚、不随主题着色）。
 * Ionicons 加载失败时回退 emoji 文本（与 HomeScreen 既有模式一致）。
 */
import React from 'react';
import { Text } from 'react-native';

let Ionicons = null;
try {
  // eslint-disable-next-line global-require
  Ionicons = require('react-native-vector-icons/Ionicons').default;
} catch (_) { Ionicons = null; }

export default function VIcon({ name, size = 18, color = '#FFFFFF', emoji = '', style }) {
  if (Ionicons) return <Ionicons name={name} size={size} color={color} style={style} />;
  return <Text style={[{ fontSize: size, color }, style]}>{emoji}</Text>;
}
