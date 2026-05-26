/**
 * iOS 风格基础组件（浅色 / 白色简洁）
 *
 * 提供分组列表的标准积木：Screen（浅灰背景容器）、Section（分组+页眉页脚）、
 * Row（单元格：图标/标题/副标题/右值/箭头/开关）、Card（白色圆角卡片）、Button。
 * 设计参考 iOS 分组 Table View：白色单元格、行间细分隔线、44pt 触控区。
 */

import React from 'react';
import { View, Text, Switch, Pressable, ScrollView, StyleSheet } from 'react-native';
import { colors, radius, spacing, font } from './theme';

/** 浅灰背景的可滚动页面容器 */
export function Screen({ children, style, contentStyle, scroll = true }) {
  if (scroll) {
    return (
      <ScrollView style={[s.screen, style]} contentContainerStyle={[s.screenContent, contentStyle]}>
        {children}
      </ScrollView>
    );
  }
  return <View style={[s.screen, s.screenContent, style, contentStyle]}>{children}</View>;
}

/** 分组：可选页眉（小号大写灰字）/ 页脚（说明文字）+ 白色圆角卡片 */
export function Section({ header, footer, children, style }) {
  return (
    <View style={[s.section, style]}>
      {header ? <Text style={s.sectionHeader}>{header}</Text> : null}
      <View style={s.card}>{flattenRows(children)}</View>
      {footer ? <Text style={s.sectionFooter}>{footer}</Text> : null}
    </View>
  );
}

// 在 Row 之间插入分隔线（最后一行不加）
function flattenRows(children) {
  const arr = React.Children.toArray(children).filter(Boolean);
  return arr.map((child, i) => (
    <View key={child.key || i}>
      {child}
      {i < arr.length - 1 ? <View style={s.separator} /> : null}
    </View>
  ));
}

/**
 * 列表单元格。
 * props: icon(string/node), title, subtitle, value(右侧灰字), onPress,
 *        chevron(bool, 默认有 onPress 时显示), danger(bool), right(自定义右侧节点),
 *        switchValue/onSwitch(渲染右侧开关), first/last(圆角，单独使用时)
 */
export function Row({
  icon, title, subtitle, value, onPress, chevron, danger, right,
  switchValue, onSwitch, titleStyle,
}) {
  const showChevron = chevron != null ? chevron : (!!onPress && switchValue == null);
  const body = (
    <View style={s.row}>
      {icon != null ? (
        <Text style={s.rowIcon}>{icon}</Text>
      ) : null}
      <View style={s.rowMain}>
        <Text style={[s.rowTitle, danger && s.rowTitleDanger, titleStyle]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={s.rowSubtitle} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {value != null ? <Text style={s.rowValue} numberOfLines={1}>{value}</Text> : null}
      {right != null ? right : null}
      {onSwitch ? (
        <Switch
          value={!!switchValue}
          onValueChange={onSwitch}
          trackColor={{ false: '#E9E9EA', true: colors.success }}
          thumbColor="#FFFFFF"
        />
      ) : null}
      {showChevron ? <Text style={s.chevron}>›</Text> : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable android_ripple={{ color: colors.cardPressed }} onPress={onPress} style={({ pressed }) => [pressed && s.rowPressed]}>
      {body}
    </Pressable>
  );
}

/** 白色圆角卡片（自由内容） */
export function Card({ children, style }) {
  return <View style={[s.card, s.cardPadded, style]}>{children}</View>;
}

/** iOS 风格按钮：filled（实心蓝）/ tinted（浅蓝底蓝字）/ plain（纯文字）/ danger */
export function Button({ title, onPress, variant = 'filled', danger, disabled, style }) {
  const v = danger ? 'danger' : variant;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      android_ripple={{ color: 'rgba(0,0,0,0.08)' }}
      style={({ pressed }) => [
        s.btn,
        v === 'filled' && s.btnFilled,
        v === 'tinted' && s.btnTinted,
        v === 'danger' && s.btnDanger,
        v === 'plain' && s.btnPlain,
        disabled && s.btnDisabled,
        pressed && !disabled && s.btnPressed,
        style,
      ]}
    >
      <Text style={[
        s.btnText,
        v === 'filled' && s.btnTextFilled,
        v === 'tinted' && s.btnTextTinted,
        v === 'danger' && s.btnTextDanger,
        v === 'plain' && s.btnTextPlain,
      ]}>{title}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBg },
  screenContent: { paddingVertical: spacing.md, paddingBottom: spacing.xl * 2 },

  section: { marginBottom: spacing.lg, paddingHorizontal: spacing.md },
  sectionHeader: { color: colors.tertiaryLabel, fontSize: font.footnote, marginBottom: 6, marginLeft: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.3 },
  sectionFooter: { color: colors.tertiaryLabel, fontSize: font.footnote, marginTop: 6, marginLeft: spacing.sm, lineHeight: 17 },

  card: { backgroundColor: colors.card, borderRadius: radius.card, overflow: 'hidden' },
  cardPadded: { padding: spacing.md },

  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator, marginLeft: spacing.md },

  row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 11, backgroundColor: colors.card },
  rowPressed: { backgroundColor: colors.cardPressed },
  rowIcon: { fontSize: 18, marginRight: spacing.sm, width: 24, textAlign: 'center' },
  rowMain: { flex: 1, justifyContent: 'center' },
  rowTitle: { color: colors.label, fontSize: font.body },
  rowTitleDanger: { color: colors.danger },
  rowSubtitle: { color: colors.secondaryLabel, fontSize: font.footnote, marginTop: 2, lineHeight: 17 },
  rowValue: { color: colors.tertiaryLabel, fontSize: font.body, marginLeft: spacing.sm, maxWidth: 160 },
  chevron: { color: colors.chevron, fontSize: 22, marginLeft: 6, fontWeight: '400' },

  btn: { minHeight: 48, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  btnFilled: { backgroundColor: colors.accent },
  btnTinted: { backgroundColor: colors.accentSoft },
  btnDanger: { backgroundColor: colors.danger },
  btnPlain: { backgroundColor: 'transparent' },
  btnDisabled: { opacity: 0.4 },
  btnPressed: { opacity: 0.85 },
  btnText: { fontSize: font.headline, fontWeight: '600' },
  btnTextFilled: { color: '#FFFFFF' },
  btnTextTinted: { color: colors.accent },
  btnTextDanger: { color: '#FFFFFF' },
  btnTextPlain: { color: colors.accent },
});

export default { Screen, Section, Row, Card, Button };
