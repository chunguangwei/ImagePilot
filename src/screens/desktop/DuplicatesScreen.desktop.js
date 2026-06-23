/**
 * DuplicatesScreen（桌面端）——「重复清理」
 *
 * 与移动端共用 UnifiedDataService.findExactDuplicates()（字节级重复，纯本地比对）：
 * 按组展示，每组 images[0]「保留」、其余 redundantIds「删除」，复用 writeDeleteImages 删除链路。
 *
 * 桌面端差异：
 * - 多列/横向缩略图卡片布局（flexWrap），大屏更舒展。
 * - 删除确认走自绘 dialog（Modal），不用 Alert.alert（照 CategoryScreen.desktop 的 Modal 模式）。
 * - 删除进度走自绘 Modal（已删/失败/总计）。
 * - 通过 props.onBack 返回（HomeScreen.desktop 的内部页面切换）。
 */
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, ActivityIndicator, Modal } from 'react-native';
import { useTranslation } from 'react-i18next';
import { logger, getUri } from '../../adapters/WebAdapters';
import UnifiedDataService from '../../services/UnifiedDataService';

function fmtBytes(b) {
  const n = Number(b) || 0;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

const DuplicatesScreen = ({ onBack }) => {
  const { t } = useTranslation('common');

  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState([]);
  const [totalRedundant, setTotalRedundant] = useState(0);
  const [totalWastedBytes, setTotalWastedBytes] = useState(0);

  // 自绘确认 dialog：{ ids, message } | null
  const [confirm, setConfirm] = useState(null);
  // 删除进度 Modal：{ filesDeleted, filesFailed, total } | null
  const [progress, setProgress] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await UnifiedDataService.findExactDuplicates();
      setGroups((r && r.groups) || []);
      setTotalRedundant((r && r.totalRedundant) || 0);
      setTotalWastedBytes((r && r.totalWastedBytes) || 0);
    } catch (e) {
      logger.error('查找重复照片失败:', e);
      setGroups([]); setTotalRedundant(0); setTotalWastedBytes(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // 确认后真正执行删除
  const doDelete = async (ids) => {
    setConfirm(null);
    if (!ids || ids.length === 0) return;
    setDeleting(true);
    setProgress({ filesDeleted: 0, filesFailed: 0, total: ids.length });
    try {
      await UnifiedDataService.writeDeleteImages(ids, (p) => {
        setProgress({
          filesDeleted: (p && p.filesDeleted) || 0,
          filesFailed: (p && p.filesFailed) || 0,
          total: (p && p.total) || ids.length,
        });
      });
    } catch (e) {
      logger.error('删除重复照片失败:', e);
    } finally {
      setDeleting(false);
      setProgress(null);
      await load(); // 完成后重新检测刷新
    }
  };

  const cleanGroup = (group) => {
    setConfirm({
      ids: group.redundantIds,
      message: t('duplicates.confirmGroupMessage', {
        count: group.redundantIds.length,
        size: fmtBytes(group.wastedBytes),
        defaultValue: `删除该组 ${group.redundantIds.length} 张重复（保留 1 张），释放 ${fmtBytes(group.wastedBytes)}。`,
      }),
    });
  };

  const cleanAll = () => {
    const ids = groups.flatMap((g) => g.redundantIds);
    setConfirm({
      ids,
      message: t('duplicates.confirmAllMessage', {
        count: ids.length,
        size: fmtBytes(totalWastedBytes),
        defaultValue: `删除全部 ${ids.length} 张重复（每组各保留 1 张），释放 ${fmtBytes(totalWastedBytes)}。`,
      }),
    });
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => onBack && onBack()} style={styles.backBtn} activeOpacity={0.7}>
        <Text style={styles.backText}>‹ {t('common.back', { defaultValue: '返回' })}</Text>
      </TouchableOpacity>
      <Text style={styles.title}>{t('duplicates.title', { defaultValue: '重复照片清理' })}</Text>
      <View style={styles.backBtn} />
    </View>
  );

  const renderGroup = (group) => (
    <View key={group.key} style={styles.groupCard}>
      <View style={styles.groupHeader}>
        <Text style={styles.groupTitle}>
          {t('duplicates.groupTitle', { count: group.images.length, defaultValue: `${group.images.length} 张相同` })}
          <Text style={styles.groupSub}>
            {'  '}{fmtBytes(group.wastedBytes)}
          </Text>
        </Text>
        <TouchableOpacity onPress={() => cleanGroup(group)} disabled={deleting} activeOpacity={0.7}>
          <Text style={styles.groupClean}>{t('duplicates.cleanGroup', { defaultValue: '清理该组' })}</Text>
        </TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {group.images.map((img, idx) => (
          <View key={img.id || idx} style={styles.thumbWrap}>
            <Image source={{ uri: getUri(img) || img?.uri }} style={styles.thumb} resizeMode="cover" />
            <View
              style={[styles.roleBadge, { backgroundColor: idx === 0 ? 'rgba(52,199,89,0.9)' : 'rgba(255,59,48,0.85)' }]}
              pointerEvents="none"
            >
              <Text style={styles.roleBadgeText}>
                {idx === 0 ? t('duplicates.keep', { defaultValue: '保留' }) : t('duplicates.remove', { defaultValue: '删除' })}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.container}>
        {renderHeader()}
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#74b1be" />
          <Text style={styles.emptySub}>{t('duplicates.scanning', { defaultValue: '正在比对全库照片…' })}</Text>
        </View>
      </View>
    );
  }

  if (groups.length === 0) {
    return (
      <View style={styles.container}>
        {renderHeader()}
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>✅</Text>
          <Text style={styles.emptyText}>{t('duplicates.empty', { defaultValue: '没有发现重复照片 🎉' })}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {renderHeader()}

      {/* 顶部汇总 */}
      <View style={styles.summaryBar}>
        <Text style={styles.summaryText}>
          {t('duplicates.summary', {
            groups: groups.length, count: totalRedundant, size: fmtBytes(totalWastedBytes),
            defaultValue: `${groups.length} 组重复 · 可删 ${totalRedundant} 张 · 释放 ${fmtBytes(totalWastedBytes)}`,
          })}
        </Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {groups.map(renderGroup)}
      </ScrollView>

      {/* 底部一键清理全部 */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.cleanAllBtn, deleting && styles.cleanAllBtnDisabled]}
          onPress={cleanAll}
          disabled={deleting}
          activeOpacity={0.85}
        >
          <Text style={styles.cleanAllText}>
            {t('duplicates.cleanAll', { size: fmtBytes(totalWastedBytes), defaultValue: `一键清理全部（释放 ${fmtBytes(totalWastedBytes)}）` })}
          </Text>
        </TouchableOpacity>
      </View>

      {/* 自绘删除确认 dialog（照 CategoryScreen.desktop 的 Modal 模式，不用 Alert） */}
      <Modal visible={!!confirm} transparent animationType="fade" onRequestClose={() => setConfirm(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.confirmContent}>
            <Text style={styles.modalTitle}>{t('duplicates.confirmTitle', { defaultValue: '清理重复照片' })}</Text>
            <Text style={styles.modalMessage}>{confirm?.message || ''}</Text>
            <View style={styles.confirmBtnRow}>
              <TouchableOpacity style={[styles.confirmBtn, styles.confirmCancel]} onPress={() => setConfirm(null)} activeOpacity={0.8}>
                <Text style={styles.confirmCancelText}>{t('common.cancel', { defaultValue: '取消' })}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmBtn, styles.confirmDelete]} onPress={() => doDelete(confirm?.ids)} activeOpacity={0.8}>
                <Text style={styles.confirmDeleteText}>{t('common.delete', { defaultValue: '删除' })}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 删除进度 Modal */}
      <Modal visible={!!progress} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('category.deleting', { defaultValue: '删除中...' })}</Text>
            <Text style={styles.modalMessage}>
              {t('duplicates.deleting', {
                done: progress?.filesDeleted || 0,
                total: progress?.total || 0,
                defaultValue: `删除中 ${progress?.filesDeleted || 0}/${progress?.total || 0}…`,
              })}
              {progress?.filesFailed ? `  ·  ${t('category.failed', { defaultValue: '失败' })} ${progress.filesFailed}` : ''}
            </Text>
            <ActivityIndicator size="small" color="#74b1be" style={styles.modalIndicator} />
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F3F7' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E0E1E6',
  },
  backBtn: { width: 100, justifyContent: 'center' },
  backText: { fontSize: 16, color: '#0A84FF', fontWeight: '500' },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: '#1C1C1E' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 17, fontWeight: '600', color: '#3A3A3C', marginBottom: 6, textAlign: 'center' },
  emptySub: { fontSize: 14, color: '#8E8E93', textAlign: 'center', marginTop: 12 },
  summaryBar: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  summaryText: { fontSize: 14, color: '#636366' },
  scroll: { flex: 1 },
  scrollContent: { padding: 12, paddingBottom: 100 },
  groupCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  groupHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  groupTitle: { fontSize: 15, fontWeight: '700', color: '#1C1C1E' },
  groupSub: { fontSize: 13, fontWeight: '400', color: '#8E8E93' },
  groupClean: { fontSize: 14, fontWeight: '600', color: '#FF3B30' },
  thumbWrap: { width: 104, height: 104, borderRadius: 8, overflow: 'hidden', marginRight: 8, backgroundColor: 'rgba(0,0,0,0.05)' },
  thumb: { width: '100%', height: '100%' },
  roleBadge: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingVertical: 3, alignItems: 'center' },
  roleBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    padding: 14, paddingBottom: 20,
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E0E1E6',
  },
  cleanAllBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', backgroundColor: '#FF3B30' },
  cleanAllBtnDisabled: { backgroundColor: 'rgba(255,59,48,0.5)' },
  cleanAllText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  // 自绘 dialog / 进度 Modal
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: { backgroundColor: '#FFFFFF', padding: 22, borderRadius: 14, alignItems: 'center', minWidth: 260 },
  confirmContent: { backgroundColor: '#FFFFFF', padding: 22, borderRadius: 14, width: 360, maxWidth: '90%' },
  modalTitle: { color: '#1C1C1E', fontSize: 18, fontWeight: '700', marginBottom: 10, textAlign: 'center' },
  modalMessage: { color: '#3A3A3C', fontSize: 14, lineHeight: 21, marginBottom: 18, textAlign: 'center' },
  modalIndicator: { marginTop: 6 },
  confirmBtnRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  confirmBtn: { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 10 },
  confirmCancel: { backgroundColor: 'rgba(120,120,128,0.14)' },
  confirmCancelText: { fontSize: 15, fontWeight: '600', color: '#3A3A3C' },
  confirmDelete: { backgroundColor: '#FF3B30' },
  confirmDeleteText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
});

export default DuplicatesScreen;
