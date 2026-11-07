import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import VIcon from './VIcon';

/** One affordance for inline expansion; navigation keeps its right chevron. */
export default function DisclosureRow({ title, subtitle, icon, expanded, onPress, colors: c, disabled = false, style }) {
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel={subtitle ? `${title}，${subtitle}` : title}
    accessibilityState={{ expanded: !!expanded, disabled }} disabled={disabled}
    activeOpacity={0.65} onPress={onPress} style={[styles.row, style, disabled && { opacity: 0.5 }]}>
    {icon && <View style={[styles.icon, { backgroundColor: c.accentSoft }]}>
      <VIcon name={icon} size={20} color={c.readableAccent || c.accent} />
    </View>}
    <View style={styles.copy}>
      <Text style={[styles.title, { color: c.label }]}>{title}</Text>
      {!!subtitle && <Text style={[styles.subtitle, { color: c.readableSecondary || c.secondaryLabel }]}>{subtitle}</Text>}
    </View>
    <VIcon name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={c.readableSecondary || c.secondaryLabel} />
  </TouchableOpacity>;
}
const styles = StyleSheet.create({
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  icon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: '600', lineHeight: 22 },
  subtitle: { fontSize: 13, lineHeight: 19, marginTop: 3 },
});
