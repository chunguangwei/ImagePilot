import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import DisclosureRow from '../../../components/shared/DisclosureRow';

export default function SettingsGroup({ title, subtitle, icon, colors, defaultExpanded = false, children }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return <View style={[styles.card, { backgroundColor: colors.card }]}>
    <DisclosureRow title={title} subtitle={expanded ? undefined : subtitle} icon={icon}
      expanded={expanded} onPress={() => setExpanded(value => !value)} colors={colors} style={styles.header} />
    {/* Keep mounted so closing a group never resets a picker or an active operation. */}
    <View style={!expanded && styles.hidden} accessibilityElementsHidden={!expanded}
      importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'}>{children}</View>
  </View>;
}
const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 12, borderRadius: 18, overflow: 'hidden' },
  header: { paddingHorizontal: 16, paddingVertical: 16 },
  hidden: { display: 'none' },
});
