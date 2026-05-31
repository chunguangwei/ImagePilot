/**
 * BackupRestoreScreen — 分类索引备份/还原（A 方案：本地 Downloads JSON）
 *
 * 上半页：导出按钮 → 把当前所有已分类图（不含 NA）+ 自定义分类定义写到
 * `<Downloads>/imagepilot-backup-<yyyymmddhhmm>.json`，给出文件路径给用户拷贝。
 *
 * 下半页：列出 Downloads 目录里现有备份文件；点击任一文件 → 弹确认 →
 * 按 fileName|size|takenAt 匹配本地图、命中即恢复其分类（NA 的图保留 NA，
 * 库里命不中的备份项跳过；自定义分类按 id 去重并入）。
 *
 * 入口：设置页「📦 分类备份与还原」。
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Share,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView, Icon } from '../../adapters/WebAdapters';
import BackupService from '../../services/BackupService';
import { useIosColors } from '../../ui/ios/theme';
import Haptics from '../../utils/haptics';

export default function BackupRestoreScreen({ navigation }) {
  const c = useIosColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const { t } = useTranslation('common');
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [lastExport, setLastExport] = useState(null); // {path, fileName, total, withCategory}

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const items = await BackupService.listBackups();
      setList(items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const onExport = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await BackupService.exportBackup();
      setLastExport(result);
      await reload();
      Haptics.notification('success');
      Alert.alert(
        t('backupRestore.exportSuccessTitle'),
        t('backupRestore.exportSuccessMsg', { path: result.path, withCategory: result.withCategory, total: result.total })
      );
    } catch (e) {
      Alert.alert(t('backupRestore.exportFailedTitle'), e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const onShareFile = async (file) => {
    try {
      // RN 内置 Share 对 Android 不直接支持任意文件 URI，但 message 写明路径让用户走文件管理器
      await Share.share({
        title: t('backupRestore.shareTitle'),
        message: t('backupRestore.shareMessage', { path: file.path }),
      });
    } catch (_) { /* 用户取消即可 */ }
  };

  const onDelete = (file) => {
    Alert.alert(
      t('backupRestore.deleteTitle'),
      t('backupRestore.deleteConfirm', { name: file.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('backupRestore.deleteAction'),
          style: 'destructive',
          onPress: async () => {
            if (busy) return;
            setBusy(true);
            try {
              await BackupService.deleteBackup(file.path);
              if (lastExport && lastExport.path === file.path) {
                setLastExport(null);
              }
              await reload();
              Haptics.notification('warning');
            } catch (e) {
              Haptics.notification('error');
              Alert.alert(t('backupRestore.deleteFailedTitle'), e?.message || String(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  const onRestore = (file) => {
    Alert.alert(
      t('backupRestore.restoreTitle'),
      t('backupRestore.restoreConfirm', { name: file.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('backupRestore.restoreAction'),
          style: 'default',
          onPress: async () => {
            if (busy) return;
            setBusy(true);
            try {
              const payload = await BackupService.readBackup(file.path);
              const result = await BackupService.applyBackup(payload);
              Alert.alert(
                t('backupRestore.restoreCompleteTitle'),
                [
                  t('backupRestore.restoreMatched', { count: result.matched }),
                  t('backupRestore.restoreApplied', { count: result.applied }),
                  t('backupRestore.restoreSkipped', { count: result.skipped }),
                  t('backupRestore.restoreCustomAdded', { count: result.customAdded }),
                ].join('\n')
              );
            } catch (e) {
              Alert.alert(t('backupRestore.restoreFailedTitle'), e?.message || String(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  const fmtBytes = (n) => {
    if (!n) return '';
    if (n < 1024) return `${n}B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
    return `${(n / 1024 / 1024).toFixed(2)}MB`;
  };
  // mtime 已是 ISO，截到分钟显示
  const fmtTime = (iso) => (iso ? iso.replace('T', ' ').slice(0, 16) : '');

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.groupedBg }]}>
      <View style={[styles.header, { backgroundColor: c.card, borderBottomColor: c.separator, borderBottomWidth: 0.5 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: c.label }]}>{t('backupRestore.title')}</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
        <Text style={[styles.tip, { color: c.secondaryLabel }]}>
          {t('backupRestore.intro')}
        </Text>

        {/* 导出 */}
        <View style={[styles.card, { backgroundColor: c.card }]}>
          <Text style={[styles.cardTitle, { color: c.label }]}>{t('backupRestore.exportSection')}</Text>
          <TouchableOpacity style={[styles.primaryBtn, busy && styles.btnDisabled]} onPress={onExport} disabled={busy}>
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryBtnText}>{t('backupRestore.exportBtn')}</Text>
            )}
          </TouchableOpacity>
          {lastExport && (
            <Text style={[styles.tipSmall, { color: c.tertiaryLabel }]}>
              {t('backupRestore.lastExport', { fileName: lastExport.fileName, count: lastExport.withCategory })}
            </Text>
          )}
        </View>

        {/* 已有备份 */}
        <Text style={[styles.sectionTitle, { color: c.label }]}>{t('backupRestore.existing', { count: list.length })}</Text>
        {loading ? (
          <ActivityIndicator style={{ marginTop: 20 }} />
        ) : list.length === 0 ? (
          <View style={[styles.emptyBox, { backgroundColor: c.card }]}>
            <Icon name="folder-open" size={36} color={c.tertiaryLabel} />
            <Text style={[styles.empty, { color: c.tertiaryLabel }]}>{t('backupRestore.empty')}</Text>
          </View>
        ) : (
          list.map((file) => (
            <View key={file.path} style={[styles.item, { backgroundColor: c.card }]}>
              <View style={styles.itemIconWrap}>
                <Icon name="archive" size={18} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.itemName, { color: c.label }]} numberOfLines={1}>{file.name}</Text>
                <Text style={[styles.itemMeta, { color: c.tertiaryLabel }]}>{fmtBytes(file.size)} · {fmtTime(file.mtime)}</Text>
              </View>
              <TouchableOpacity onPress={() => onShareFile(file)} style={styles.actionBtn} activeOpacity={0.6}>
                <Icon name="share" size={18} color={c.accent} />
                <Text style={styles.shareTxt}>{t('backupRestore.actionShare')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => onRestore(file)} style={styles.actionBtn} activeOpacity={0.6} disabled={busy}>
                <Icon name="restore" size={18} color={busy ? '#A8E0B5' : c.success} />
                <Text style={[styles.restoreTxt, busy && { opacity: 0.4 }]}>{t('backupRestore.actionRestore')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => onDelete(file)} style={styles.actionBtn} activeOpacity={0.6} disabled={busy}>
                <Icon name="delete-outline" size={18} color={busy ? '#F5B7B1' : c.danger} />
                <Text style={[styles.deleteTxt, busy && { opacity: 0.4 }]}>{t('backupRestore.actionDelete')}</Text>
              </TouchableOpacity>
            </View>
          ))
        )}

        <Text style={[styles.footTip, { color: c.tertiaryLabel }]}>
          {t('backupRestore.footTip')}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// styles：原 26 个硬色（卡片白/边框/文字）迁到 createStyles(c) 工厂，跟随 light/dark；
// 强调蓝/危险红/成功绿等保留同一语义但走 c.accent / c.danger / c.success 通道。
const createStyles = (c) => StyleSheet.create({
  container: { flex: 1 },
  header: { height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
  backButton: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  backIcon: { fontSize: 32, color: c.accent, fontWeight: 'bold' },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '600', textAlign: 'center' },
  headerRight: { width: 40 },

  tip: { fontSize: 13, lineHeight: 19, marginBottom: 14 },
  tipSmall: { fontSize: 12, marginTop: 8 },
  footTip: { fontSize: 12, lineHeight: 18, marginTop: 16 },

  card: { borderRadius: 12, padding: 16, marginBottom: 16 },
  cardTitle: { fontSize: 15, fontWeight: '600', marginBottom: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '600', marginBottom: 10, marginTop: 4 },

  primaryBtn: { backgroundColor: c.accent, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 17 },
  btnDisabled: { opacity: 0.6 },

  empty: { fontSize: 14, marginTop: 8 },
  emptyBox: { borderRadius: 12, paddingVertical: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },

  item: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, padding: 14, marginBottom: 10 },
  itemIconWrap: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: '#5E5CE6',
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  itemName: { fontSize: 14, fontWeight: '500' },
  itemMeta: { fontSize: 12, marginTop: 3 },
  // 三个动作按钮挤一行：图标 + 文字小一号，紧排
  actionBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingVertical: 6, marginLeft: 2 },
  shareTxt: { color: c.accent, marginLeft: 2, fontSize: 12 },
  restoreTxt: { color: c.success, marginLeft: 2, fontSize: 12, fontWeight: '600' },
  deleteTxt: { color: c.danger, marginLeft: 2, fontSize: 12, fontWeight: '600' },
});
