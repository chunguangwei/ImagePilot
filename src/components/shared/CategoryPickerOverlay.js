/**
 * CategoryPickerOverlay —— 通用分类选择浮层（批量人工分类用）
 *
 * 内置 + 自定义分类合并展示（排除 NA_video：与 NA 同名"待分类"会选混，数据层会按介质路由）。
 * inline overlay（非 RN Modal，规避 iOS Modal 偶发不关的老坑）。
 * props: visible, onClose, onSelect(categoryId)
 */
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import configService from '../../services/ConfigService';
import { sortCategoryList, getCategoryIconMeta } from './categoryUI';
import { Icon } from '../../adapters/WebAdapters';
import { useIosColors } from '../../ui/ios/theme';

export default function CategoryPickerOverlay({ visible, onClose, onSelect }) {
  const { t, i18n } = useTranslation('common');
  const c = useIosColors();
  const isEn = String(i18n?.language || '').startsWith('en');
  const [customList, setCustomList] = useState([]);

  useEffect(() => {
    if (!visible) return;
    (async () => {
      try {
        const cfgSvc = (await import('../../services/llm/adapters/UnifiedDataConfigService')).default;
        const cfg = await cfgSvc.getAIProviderConfig();
        setCustomList(Array.isArray(cfg.customCategories) ? cfg.customCategories : []);
      } catch (_) { setCustomList([]); }
    })();
  }, [visible]);

  if (!visible) return null;

  const builtIn = (configService.getAllCategoriesWithUI() || []).filter((x) => x.id !== 'NA_video');
  const merged = [...builtIn];
  for (const cu of customList) {
    if (!merged.some((x) => x.id === cu.id)) merged.push({ id: cu.id, chinese: cu.name, english: cu.name });
  }
  const categories = sortCategoryList(merged);

  return (
    <TouchableOpacity
      activeOpacity={1}
      onPress={onClose}
      style={[StyleSheet.absoluteFill, styles.backdrop]}
    >
      <TouchableOpacity activeOpacity={1} onPress={() => {}} style={[styles.sheet, { backgroundColor: c.card }]}>
        <Text style={[styles.title, { color: c.label }]}>{t('imagePreview.selectCategory', { defaultValue: '选择分类' })}</Text>
        <ScrollView style={styles.list}>
          {categories.map((cat) => {
            const meta = getCategoryIconMeta(cat.id, customList);
            const name = isEn ? (cat.english || cat.chinese) : (cat.chinese || cat.english);
            return (
              <TouchableOpacity
                key={cat.id}
                style={[styles.row, { borderBottomColor: c.separator }]}
                onPress={() => onSelect(cat.id)}
              >
                <Icon name="label" size={18} color={meta.color} />
                <Text style={[styles.rowText, { color: c.label }]}>{name}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <TouchableOpacity style={styles.cancel} onPress={onClose}>
          <Text style={[styles.cancelText, { color: c.secondaryLabel }]}>{t('common.cancel')}</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end', zIndex: 1000 },
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 14, maxHeight: '70%' },
  title: { fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 6 },
  list: { paddingHorizontal: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { fontSize: 15.5 },
  cancel: { paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontSize: 16, fontWeight: '600' },
});
