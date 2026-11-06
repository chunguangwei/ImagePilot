import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';

/** Presentation only: selection and file management remain owned by Settings. */
export default function ClassifierModelPicker({ models, colors: c, busy = false }) {
  const { t } = useTranslation('common');
  const [legacyOpen, setLegacyOpen] = useState(() => models.some(m => m.legacy && m.active));
  const [expanded, setExpanded] = useState({});
  const secondary = c.readableSecondary || c.secondaryLabel;
  const accent = c.readableAccent || c.accent;
  const label = key => t(`settings.modelPicker.${key}`);
  const button = (title, onPress, disabled, danger = false, primary = false) => (
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled}
      onPress={onPress} style={[styles.button, { opacity: disabled ? 0.5 : 1, backgroundColor: primary ? (c.primaryButton || c.accent) : c.fillTertiary }]}>
      <Text style={[styles.buttonText, { color: primary ? '#fff' : danger ? c.danger : accent }]}>{title}</Text>
    </TouchableOpacity>
  );
  const card = m => {
    const percent = Number.isFinite(m.progress) ? Math.round(Math.max(0, Math.min(1, m.progress)) * 100) : 0;
    const active = m.active && m.downloaded && !m.unsupported;
    const state = m.downloading ? (percent === 100 ? 'checking' : 'downloading') : m.unsupported ? 'unavailable' : active ? 'active' : m.downloaded ? 'downloaded' : 'notDownloaded';
    return <View key={m.id} style={[styles.card, { backgroundColor: c.card, borderColor: active ? c.accent : c.separator }]}>
      <Text style={[styles.title, { color: c.label }]}>{m.title}</Text>
      <Text style={[styles.summary, { color: secondary }]}>{m.summary}</Text>
      <View style={styles.statusRow}>
        <Text style={[styles.meta, { color: secondary }]}>{m.sizeMB} MB</Text>
        <Text style={[styles.badge, { color: active ? accent : secondary, backgroundColor: active ? c.accentSoft : c.fillTertiary }]}>{label(state)}</Text>
      </View>
      {m.downloading ? <View accessibilityLiveRegion="polite">
        <View style={styles.statusRow}><ActivityIndicator color={c.accent} /><Text style={{ color: c.label }}>{label(state)}{percent < 100 ? ` ${percent}%` : ''}</Text></View>
        <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percent }} style={[styles.track, { backgroundColor: c.fillTertiary }]}><View style={{ width: `${percent}%`, height: 4, backgroundColor: c.accent }} /></View>
        {button(label(m.cancelling ? 'cancelling' : 'cancel'), m.onCancel, m.cancelling)}
      </View> : !active && button(label(m.unsupported ? 'retry' : m.downloaded ? 'use' : 'downloadUse'), m.onSelect, busy || !m.ready, false, true)}
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: !!expanded[m.id] }}
        onPress={() => setExpanded(prev => ({ ...prev, [m.id]: !prev[m.id] }))} style={styles.disclosure}>
        <Text style={{ color: accent, fontSize: 14 }}>{label(expanded[m.id] ? 'hideDetails' : 'details')} {expanded[m.id] ? '⌃' : '⌄'}</Text>
      </TouchableOpacity>
      {expanded[m.id] && <View>
        <Text style={[styles.summary, { color: secondary }]}>{m.description}</Text>
        {m.onCleanup && button(m.cleanupLabel, m.onCleanup, busy, true)}
        {m.downloaded && !m.bundled && <View style={styles.actions}>
          {button(label('redownload'), m.onRedownload, busy)}
          {button(label('delete'), m.onDelete, busy, true)}
        </View>}
      </View>}
    </View>;
  };
  return <View style={styles.container}>
    {models.filter(m => !m.legacy).map(card)}
    <TouchableOpacity style={styles.disclosure} accessibilityRole="button" accessibilityState={{ expanded: legacyOpen }} onPress={() => setLegacyOpen(v => !v)}>
      <Text style={{ color: accent, fontSize: 15 }}>{label('legacy')} {legacyOpen ? '⌃' : '⌄'}</Text>
    </TouchableOpacity>
    {legacyOpen && models.filter(m => m.legacy).map(card)}
  </View>;
}
const styles = StyleSheet.create({
  container: { marginTop: 16, gap: 12 },
  card: { borderWidth: 1, borderRadius: 14, padding: 16 },
  title: { fontSize: 17, fontWeight: '600', flexShrink: 1 },
  summary: { fontSize: 14, lineHeight: 21, marginTop: 8 },
  meta: { fontSize: 14 },
  badge: { fontSize: 13, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, overflow: 'hidden' },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginVertical: 12 },
  button: { minHeight: 48, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  buttonText: { fontSize: 15, fontWeight: '500', textAlign: 'center' },
  disclosure: { minHeight: 48, justifyContent: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden', marginBottom: 12 },
});
