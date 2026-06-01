/**
 * settings/widgets.js — SettingsScreen.mobile.js 的纯表现 widget。
 *
 * 之前是父组件内的 render helper 函数（闭包读 styles/c/t），导致父组件 2500 行
 * 难导航。抽到 sibling 文件后，父组件少 ~25 行 + widget 形态独立可单元测试。
 *
 * 设计：widget 是无状态纯组件，依赖通过 props 传入（styles/c）。Ionicons 在
 *      widget 内部 lazy-require（与父组件相同的 try/catch fallback 模式），避免
 *      父组件强行把 Icon 当作 prop 传。
 *
 * 注意：跨 widget 共享样式仍在 SettingsScreen 的 createStyles 工厂里维护
 *      （actionButton/actionButtonRow/.../infoItem/.../sectionTitle），父组件
 *      作为 styles 拥有者；widget 是消费者。
 */

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

// Ionicons 与父组件保持一致的 fallback 行为：拿不到字体也能渲染（不带 icon）
let WIonicons = null;
try { WIonicons = require('react-native-vector-icons/Ionicons').default; } catch (_) { WIonicons = null; }

/**
 * iOS 风格的行动按钮单元格（带图标 + 标题 + 描述 + 右侧 chevron）。
 *
 * @param styles      父组件 createStyles(c) 出来的样式表
 * @param c           主题 tokens（label/accent/danger/tertiaryLabel/chevron）
 * @param icon        Ionicons name；WIonicons 不可用时静默不渲染
 * @param title       主标题
 * @param description 副标题/说明
 * @param onPress     点击回调
 * @param danger      危险态（红字 + 不显示 chevron）
 * @param descColor   description 颜色覆盖（用于 iOS 相册权限 tone：limited 用 warning 色）
 */
export function ActionButton({ styles, c, icon, title, description, onPress, danger = false, descColor }) {
  return (
    <TouchableOpacity
      style={[styles.actionButton, { backgroundColor: c.card }]}
      onPress={onPress}
      activeOpacity={0.6}
    >
      <View style={styles.actionButtonRow}>
        <View style={styles.actionButtonMain}>
          <Text style={[styles.actionButtonText, { color: c.label }, danger && styles.dangerText]}>
            {WIonicons ? <WIonicons name={icon} size={17} color={danger ? c.danger : c.accent} /> : null} {title}
          </Text>
          <Text style={[styles.actionButtonDescription, { color: descColor || c.tertiaryLabel }]}>{description}</Text>
        </View>
        {!danger ? <Text style={[styles.actionChevron, { color: c.chevron }]}>›</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

/** "应用信息"区的左右对齐键值条目（如 版本号 1.5.1） */
export function InfoItem({ styles, label, value }) {
  return (
    <View style={styles.infoItem}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

/** 分组标题（iOS Settings 原生 section header：小字、灰、letterSpacing） */
export function SectionTitle({ styles, title }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

export default { ActionButton, InfoItem, SectionTitle };
