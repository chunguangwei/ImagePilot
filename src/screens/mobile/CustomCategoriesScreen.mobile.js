/**
 * CustomCategoriesScreen（移动版）— 自定义分类管理（A 方案）
 *
 * 自定义分类项形状：[{ id, name, rule, iconKey }]
 *   - id：英文，给云端大模型输出用（创建后不可改，避免历史归属图断链）
 *   - name / rule / iconKey：可编辑
 *
 * 删除时：先把已落到该分类的图改回 'NA'（待分类），再从 settings.aiProvider.customCategories
 * 移除——避免"删分类→图消失"的体感。
 *
 * 入口：设置页「🏷️ 自定义分类」。
 */

import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView, Icon } from '../../adapters/WebAdapters';
import configService from '../../services/llm/adapters/UnifiedDataConfigService';
import UnifiedDataService from '../../services/UnifiedDataService';
import { CUSTOM_ICON_PRESETS, getCategoryIconMeta } from '../../components/shared/categoryUI';
import { useIosColors } from '../../ui/ios/theme';
import Haptics from '../../utils/haptics';

// 内置分类 id（自定义 id 不应与之冲突）
const BUILTIN_IDS = ['single_person', 'social_activities', 'travel_scenery', 'pets', 'foods', 'idcard', 'screenshot', 'electronics', 'qrcode', 'other', 'NA'];

export default function CustomCategoriesScreen({ navigation }) {
  const theme = useIosColors();
  const { t } = useTranslation('common');
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  // 新增表单
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [rule, setRule] = useState('');
  const [iconKey, setIconKey] = useState(CUSTOM_ICON_PRESETS[0].key);
  // 编辑弹窗（editing 为 { id, name, rule, iconKey } 时打开）
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await configService.getAIProviderConfig();
        setList(Array.isArray(cfg.customCategories) ? cfg.customCategories : []);
      } catch (e) {
        Alert.alert(t('customCategories.loadFailedTitle'), e?.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = async (next) => {
    setList(next);
    try {
      await configService.setCustomCategories(next);
    } catch (e) {
      Alert.alert(t('customCategories.saveFailedTitle'), e?.message || String(e));
    }
  };

  const onAdd = async () => {
    const cid = id.trim();
    const cname = name.trim();
    if (!cid || !cname) {
      Alert.alert(t('customCategories.pleaseFillTitle'), t('customCategories.pleaseFillMessage'));
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(cid)) {
      Alert.alert(t('customCategories.idFormatTitle'), t('customCategories.idFormatMessage'));
      return;
    }
    if (BUILTIN_IDS.includes(cid) || list.some((c) => c.id === cid)) {
      Alert.alert(t('customCategories.idDuplicateTitle'), t('customCategories.idDuplicateMessage'));
      return;
    }
    await persist([...list, { id: cid, name: cname, rule: rule.trim(), iconKey }]);
    setId(''); setName(''); setRule(''); setIconKey(CUSTOM_ICON_PRESETS[0].key);
    Haptics.notification('success');
  };

  // 打开编辑弹窗：拷贝一份编辑态，id 不可改（避免历史归属图断链）
  const onOpenEdit = (c) => {
    setEditing({
      id: c.id,
      name: c.name || '',
      rule: c.rule || '',
      iconKey: c.iconKey || CUSTOM_ICON_PRESETS[0].key,
    });
  };

  const onSaveEdit = async () => {
    if (!editing) return;
    const cname = editing.name.trim();
    if (!cname) {
      Alert.alert(t('customCategories.pleaseFillTitle'), t('customCategories.nameRequiredMessage'));
      return;
    }
    const next = list.map((c) =>
      c.id === editing.id ? { ...c, name: cname, rule: editing.rule.trim(), iconKey: editing.iconKey } : c
    );
    await persist(next);
    setEditing(null);
  };

  // 删除：先把该自定义分类下的图改回「待分类(NA)」，再从列表移除。
  // 避免"删分类→图消失"的体感——图仍在，只是回到待分类等用户/AI 重新归。
  const onDelete = (cid) => {
    Alert.alert(
      t('customCategories.deleteTitle'),
      t('customCategories.deleteMessage', { cid }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('customCategories.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              const inCat = await UnifiedDataService.readImagesByCategory(cid);
              const ids = Array.isArray(inCat) ? inCat.map((img) => img && img.id).filter(Boolean) : [];
              if (ids.length > 0) {
                // 'manual' 表示是用户操作（与"改分类"一致），不会被后续 AI 再分类覆盖
                await UnifiedDataService.updateImagesCategory(ids, 'NA', 'manual');
              }
              await persist(list.filter((c) => c.id !== cid));
              Haptics.notification('warning');
            } catch (e) {
              Haptics.notification('error');
              Alert.alert(t('customCategories.deleteFailedTitle'), e?.message || String(e));
            }
          },
        },
      ]
    );
  };

  // 图标网格：受控选中态由 selectedKey + onSelect 决定，新增/编辑两处共用
  const IconGrid = ({ selectedKey, onSelect }) => (
    <View style={styles.iconGrid}>
      {CUSTOM_ICON_PRESETS.map((p) => {
        const selected = selectedKey === p.key;
        return (
          <TouchableOpacity
            key={p.key}
            style={[styles.iconCell, { backgroundColor: p.color, opacity: selected ? 1 : 0.5 }, selected && styles.iconCellSelected]}
            onPress={() => onSelect(p.key)}
            activeOpacity={0.8}
          >
            <Icon name={p.icon} size={20} color="#FFFFFF" />
          </TouchableOpacity>
        );
      })}
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.groupedBg }]}>
      <View style={[styles.header, { backgroundColor: theme.card, borderBottomColor: theme.separator, borderBottomWidth: 0.5 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.label }]}>{t('customCategories.screenTitle')}</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
        <Text style={[styles.tip, { color: theme.secondaryLabel }]}>
          {t('customCategories.tip')}
        </Text>

        {/* 新增表单 */}
        <View style={[styles.card, { backgroundColor: theme.card }]}>
          <Text style={[styles.cardTitle, { color: theme.label }]}>{t('customCategories.addCardTitle')}</Text>
          <TextInput style={[styles.input, { backgroundColor: theme.groupedBg, color: theme.label, borderColor: theme.separator }]} placeholder={t('customCategories.idPlaceholder')} placeholderTextColor={theme.tertiaryLabel} value={id} onChangeText={setId} autoCapitalize="none" />
          <TextInput style={[styles.input, { backgroundColor: theme.groupedBg, color: theme.label, borderColor: theme.separator }]} placeholder={t('customCategories.namePlaceholder')} placeholderTextColor={theme.tertiaryLabel} value={name} onChangeText={setName} />
          <TextInput style={[styles.input, styles.multiline, { backgroundColor: theme.groupedBg, color: theme.label, borderColor: theme.separator }]} placeholder={t('customCategories.rulePlaceholder')} placeholderTextColor={theme.tertiaryLabel} value={rule} onChangeText={setRule} multiline />

          <Text style={[styles.iconPickerLabel, { color: theme.secondaryLabel }]}>{t('customCategories.iconPickerLabel')}</Text>
          <IconGrid selectedKey={iconKey} onSelect={setIconKey} />

          <TouchableOpacity style={styles.addBtn} onPress={onAdd}>
            <Text style={styles.addBtnText}>{t('customCategories.addBtn')}</Text>
          </TouchableOpacity>
        </View>

        {/* 已有列表 */}
        <Text style={[styles.cardTitle, { color: theme.label }]}>{t('customCategories.listTitle', { count: list.length })}</Text>
        {loading ? (
          <ActivityIndicator style={{ marginTop: 20 }} />
        ) : list.length === 0 ? (
          <Text style={[styles.empty, { color: theme.tertiaryLabel }]}>{t('customCategories.empty')}</Text>
        ) : (
          list.map((c) => {
            const meta = getCategoryIconMeta(c.id, list);
            return (
              <View key={c.id} style={[styles.item, { backgroundColor: theme.card }]}>
                <View style={[styles.itemIconWrap, { backgroundColor: meta.color }]}>
                  <Icon name={meta.iconName} size={18} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.itemName, { color: theme.label }]}>{c.name} <Text style={[styles.itemId, { color: theme.tertiaryLabel }]}>({c.id})</Text></Text>
                  {!!c.rule && <Text style={[styles.itemRule, { color: theme.secondaryLabel }]}>{c.rule}</Text>}
                </View>
                <TouchableOpacity onPress={() => onOpenEdit(c)} style={styles.actionBtn} activeOpacity={0.6}>
                  <Icon name="edit" size={18} color="#007AFF" />
                  <Text style={styles.edit}>{t('customCategories.edit')}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => onDelete(c.id)} style={styles.actionBtn} activeOpacity={0.6}>
                  <Icon name="delete-outline" size={18} color="#FF3B30" />
                  <Text style={styles.del}>{t('customCategories.delete')}</Text>
                </TouchableOpacity>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* 编辑弹窗：id 只读，其余可改
          —— iOS 上 RN <Modal> 在 visible:true→false 切换偶发不响应 hide（同 SettingsScreen /
             ImagePreviewScreen 经历），改用 absolute fill inline overlay：setState(null)
             直接卸载组件，不走原生 modal 生命周期。 */}
      {!!editing && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)', zIndex: 999, justifyContent: 'flex-end' }]}>
          <TouchableOpacity
            activeOpacity={1}
            style={StyleSheet.absoluteFill}
            onPress={() => setEditing(null)}
          />
          <View style={styles.modalCard} pointerEvents="box-none">
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('customCategories.editModalTitle')}</Text>
              <Text style={styles.modalSubtitle}>{editing?.id}</Text>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
              <TextInput
                style={styles.input}
                placeholder={t('customCategories.editNamePlaceholder')}
                placeholderTextColor="#8E8E93"
                value={editing?.name || ''}
                onChangeText={(v) => setEditing((s) => ({ ...s, name: v }))}
              />
              <TextInput
                style={[styles.input, styles.multiline]}
                placeholder={t('customCategories.editRulePlaceholder')}
                placeholderTextColor="#8E8E93"
                value={editing?.rule || ''}
                onChangeText={(v) => setEditing((s) => ({ ...s, rule: v }))}
                multiline
              />
              <Text style={styles.iconPickerLabel}>{t('customCategories.iconPickerLabel')}</Text>
              <IconGrid
                selectedKey={editing?.iconKey}
                onSelect={(k) => setEditing((s) => ({ ...s, iconKey: k }))}
              />
            </ScrollView>
            <View style={styles.modalFooter}>
              <TouchableOpacity style={[styles.modalBtn, styles.modalBtnGhost]} onPress={() => setEditing(null)}>
                <Text style={styles.modalBtnGhostText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.modalBtnPrimary]} onPress={onSaveEdit}>
                <Text style={styles.modalBtnPrimaryText}>{t('common.save')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F2F7' },
  header: { height: 56, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
  backButton: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  backIcon: { fontSize: 32, color: '#007AFF', fontWeight: 'bold' },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '600', color: '#000000', textAlign: 'center' },
  headerRight: { width: 40 },

  tip: { color: '#6C6C70', fontSize: 13, lineHeight: 19, marginBottom: 14 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 16, marginBottom: 20 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#000000', marginBottom: 10 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderColor: '#C6C6C8', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 10, fontSize: 15, color: '#000000', backgroundColor: '#F2F2F7' },
  multiline: { height: 70, textAlignVertical: 'top' },
  addBtn: { backgroundColor: '#007AFF', borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  addBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 17 },
  empty: { color: '#8E8E93', marginTop: 12, fontSize: 15 },

  item: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 12, padding: 16, marginBottom: 10 },
  itemIconWrap: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  itemName: { fontSize: 15, fontWeight: '500', color: '#000000' },
  itemId: { fontSize: 12, color: '#8E8E93' },
  itemRule: { fontSize: 13, color: '#6C6C70', marginTop: 4, lineHeight: 18 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6, marginLeft: 4 },
  edit: { color: '#007AFF', marginLeft: 4, fontSize: 14 },
  del: { color: '#FF3B30', marginLeft: 4, fontSize: 14 },

  // 图标选择面板
  iconPickerLabel: { fontSize: 13, color: '#6C6C70', marginTop: 4, marginBottom: 8 },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 14 },
  iconCell: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 10, marginBottom: 10,
  },
  iconCellSelected: { borderWidth: 2, borderColor: '#007AFF' },

  // 编辑弹窗（inline overlay：背景遮罩用 absoluteFill + 内联 style，不再走 RN Modal）
  modalCard: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '85%' },
  modalHeader: { padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5EA' },
  modalTitle: { fontSize: 17, fontWeight: '600', color: '#000000' },
  modalSubtitle: { fontSize: 13, color: '#8E8E93', marginTop: 2 },
  modalFooter: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E5E5EA' },
  modalBtn: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  modalBtnGhost: { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: '#E5E5EA' },
  modalBtnGhostText: { color: '#8E8E93', fontSize: 16 },
  modalBtnPrimary: {},
  modalBtnPrimaryText: { color: '#007AFF', fontSize: 16, fontWeight: '600' },
});
