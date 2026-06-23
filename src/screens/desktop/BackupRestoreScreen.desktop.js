/**
 * BackupRestoreScreen（桌面端）—— 分类索引备份与还原
 *
 * 与移动端共用 applyBackup 还原逻辑（经 BackupService.desktop 复用），文件 IO 走 Electron。
 *
 * 流程：
 * - 「导出备份」→ select-folder 选目录 → exportBackup(dir) → 自绘提示成功 + 刷新列表。
 * - 「选择备份目录」→ select-folder 选目录 → listBackups(dir) 展示该目录下的备份文件。
 * - 每项「还原」→ 自绘确认 → restoreBackup → 提示 {matched, applied, skipped, customAdded}。
 * - 每项「删除」→ 自绘确认 → deleteBackup → 刷新列表。
 *
 * 桌面端差异：
 * - 砍掉分享（桌面端文件本就可见）。
 * - 确认/提示走自绘 Modal（desktop Alert 不稳），不用 Alert.alert。
 * - 通过 props.onBack 返回（HomeScreen.desktop 的内部页面切换）。
 */
import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Modal } from 'react-native';
import { useTranslation } from 'react-i18next';
import { logger } from '../../adapters/WebAdapters';
import BackupServiceDesktop from '../../services/BackupService.desktop';

function fmtBytes(n) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
// mtime 已是 ISO，截到分钟显示
function fmtTime(iso) {
  return iso ? iso.replace('T', ' ').slice(0, 16) : '';
}

const BackupRestoreScreen = ({ onBack }) => {
  const { t } = useTranslation('common');

  const [dir, setDir] = useState(null);
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // 自绘确认 dialog：{ kind:'restore'|'delete', file } | null
  const [confirm, setConfirm] = useState(null);
  // 自绘提示 dialog：{ title, message } | null
  const [notice, setNotice] = useState(null);

  const pickFolder = useCallback(async () => {
    try {
      if (typeof window === 'undefined' || !window.require) {
        setNotice({
          title: t('backupRestore.exportFailedTitle', { defaultValue: '导出失败' }),
          message: t('backup.desktopOnly', { defaultValue: '备份仅在桌面端可用' }),
        });
        return null;
      }
      const { ipcRenderer } = window.require('electron');
      const picked = await ipcRenderer.invoke('select-folder');
      if (!picked || !picked.success || !picked.path) return null; // 用户取消
      return picked.path.replace(/\\/g, '/');
    } catch (e) {
      logger.error('选择备份目录失败:', e);
      return null;
    }
  }, [t]);

  const loadList = useCallback(async (targetDir) => {
    if (!targetDir) return;
    setLoading(true);
    try {
      const items = await BackupServiceDesktop.listBackups(targetDir);
      setList(items);
    } catch (e) {
      logger.error('读取备份列表失败:', e);
      setList([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // 选择/打开备份目录
  const onChooseDir = useCallback(async () => {
    const picked = await pickFolder();
    if (!picked) return;
    setDir(picked);
    await loadList(picked);
  }, [pickFolder, loadList]);

  // 导出备份
  const onExport = useCallback(async () => {
    if (busy) return;
    const picked = await pickFolder();
    if (!picked) return;
    setBusy(true);
    try {
      const result = await BackupServiceDesktop.exportBackup(picked);
      setDir(picked);
      await loadList(picked);
      setNotice({
        title: t('backupRestore.exportSuccessTitle', { defaultValue: '导出成功' }),
        message: t('backupRestore.exportSuccessMsg', {
          path: result.path,
          withCategory: result.withCategory,
          total: result.total,
          defaultValue: `已导出 ${result.withCategory} 张已分类（共 ${result.total} 张）到\n${result.path}`,
        }),
      });
    } catch (e) {
      logger.error('导出备份失败:', e);
      setNotice({
        title: t('backupRestore.exportFailedTitle', { defaultValue: '导出失败' }),
        message: e?.message || String(e),
      });
    } finally {
      setBusy(false);
    }
  }, [busy, pickFolder, loadList, t]);

  // 还原（确认后执行）
  const doRestore = useCallback(async (file) => {
    setConfirm(null);
    if (!file || busy) return;
    setBusy(true);
    try {
      const result = await BackupServiceDesktop.restoreBackup(file.path);
      setNotice({
        title: t('backupRestore.restoreCompleteTitle', { defaultValue: '还原完成' }),
        message: [
          t('backupRestore.restoreMatched', { count: result.matched, defaultValue: `匹配 ${result.matched} 张` }),
          t('backupRestore.restoreApplied', { count: result.applied, defaultValue: `已还原 ${result.applied} 张分类` }),
          t('backupRestore.restoreSkipped', { count: result.skipped, defaultValue: `跳过 ${result.skipped} 项（本地未找到）` }),
          t('backupRestore.restoreCustomAdded', { count: result.customAdded, defaultValue: `新增 ${result.customAdded} 个自定义分类` }),
        ].join('\n'),
      });
    } catch (e) {
      logger.error('还原备份失败:', e);
      setNotice({
        title: t('backupRestore.restoreFailedTitle', { defaultValue: '还原失败' }),
        message: e?.message || String(e),
      });
    } finally {
      setBusy(false);
    }
  }, [busy, t]);

  // 删除（确认后执行）
  const doDelete = useCallback(async (file) => {
    setConfirm(null);
    if (!file || busy) return;
    setBusy(true);
    try {
      await BackupServiceDesktop.deleteBackup(file.path);
      await loadList(dir);
    } catch (e) {
      logger.error('删除备份失败:', e);
      setNotice({
        title: t('backupRestore.deleteFailedTitle', { defaultValue: '删除失败' }),
        message: e?.message || String(e),
      });
    } finally {
      setBusy(false);
    }
  }, [busy, dir, loadList, t]);

  const renderHeader = () => (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => onBack && onBack()} style={styles.backBtn} activeOpacity={0.7}>
        <Text style={styles.backText}>‹ {t('common.back', { defaultValue: '返回' })}</Text>
      </TouchableOpacity>
      <Text style={styles.title}>{t('backupRestore.title', { defaultValue: '备份与还原' })}</Text>
      <View style={styles.backBtn} />
    </View>
  );

  return (
    <View style={styles.container}>
      {renderHeader()}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.intro}>
          {t('backupRestore.intro', {
            defaultValue: '把「已分类成果 + 自定义分类」导出成 JSON，换机或重装后一键还原（不备份照片本体）。',
          })}
        </Text>

        {/* 导出 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('backupRestore.exportSection', { defaultValue: '导出备份' })}</Text>
          <TouchableOpacity
            style={[styles.primaryBtn, busy && styles.btnDisabled]}
            onPress={onExport}
            disabled={busy}
            activeOpacity={0.85}
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryBtnText}>{t('backupRestore.exportBtn', { defaultValue: '选择目录并导出' })}</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* 备份目录 / 列表 */}
        <View style={styles.card}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle}>{t('backupRestore.existing', { count: list.length, defaultValue: '已有备份' })}</Text>
            <TouchableOpacity onPress={onChooseDir} disabled={busy} activeOpacity={0.7}>
              <Text style={styles.linkBtn}>{t('backup.chooseDir', { defaultValue: '选择备份目录' })}</Text>
            </TouchableOpacity>
          </View>

          {dir ? <Text style={styles.dirText} numberOfLines={1}>{dir}</Text> : null}

          {loading ? (
            <ActivityIndicator style={{ marginTop: 18 }} color="#74b1be" />
          ) : !dir ? (
            <Text style={styles.emptyText}>{t('backup.pickDirHint', { defaultValue: '先选择一个目录查看其中的备份文件' })}</Text>
          ) : list.length === 0 ? (
            <Text style={styles.emptyText}>{t('backupRestore.empty', { defaultValue: '该目录下还没有备份文件' })}</Text>
          ) : (
            list.map((file) => (
              <View key={file.path} style={styles.item}>
                <View style={styles.itemIconWrap}>
                  <Text style={styles.itemIcon}>🗄️</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.itemName} numberOfLines={1}>{file.name}</Text>
                  <Text style={styles.itemMeta}>{fmtBytes(file.size)} · {fmtTime(file.mtime)}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => setConfirm({ kind: 'restore', file })}
                  style={styles.actionBtn}
                  disabled={busy}
                  activeOpacity={0.6}
                >
                  <Text style={[styles.restoreTxt, busy && { opacity: 0.4 }]}>{t('backupRestore.actionRestore', { defaultValue: '还原' })}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setConfirm({ kind: 'delete', file })}
                  style={styles.actionBtn}
                  disabled={busy}
                  activeOpacity={0.6}
                >
                  <Text style={[styles.deleteTxt, busy && { opacity: 0.4 }]}>{t('backupRestore.actionDelete', { defaultValue: '删除' })}</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* 自绘确认 dialog（还原 / 删除） */}
      <Modal visible={!!confirm} transparent animationType="fade" onRequestClose={() => setConfirm(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.confirmContent}>
            <Text style={styles.modalTitle}>
              {confirm?.kind === 'delete'
                ? t('backupRestore.deleteTitle', { defaultValue: '删除备份' })
                : t('backupRestore.restoreTitle', { defaultValue: '还原备份' })}
            </Text>
            <Text style={styles.modalMessage}>
              {confirm?.kind === 'delete'
                ? t('backupRestore.deleteConfirm', { name: confirm?.file?.name, defaultValue: `确定删除 ${confirm?.file?.name}？` })
                : t('backupRestore.restoreConfirm', { name: confirm?.file?.name, defaultValue: `从 ${confirm?.file?.name} 还原分类成果？` })}
            </Text>
            <View style={styles.confirmBtnRow}>
              <TouchableOpacity style={[styles.confirmBtn, styles.confirmCancel]} onPress={() => setConfirm(null)} activeOpacity={0.8}>
                <Text style={styles.confirmCancelText}>{t('common.cancel', { defaultValue: '取消' })}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, confirm?.kind === 'delete' ? styles.confirmDelete : styles.confirmOk]}
                onPress={() => (confirm?.kind === 'delete' ? doDelete(confirm.file) : doRestore(confirm?.file))}
                activeOpacity={0.8}
              >
                <Text style={confirm?.kind === 'delete' ? styles.confirmDeleteText : styles.confirmOkText}>
                  {confirm?.kind === 'delete'
                    ? t('backupRestore.deleteAction', { defaultValue: '删除' })
                    : t('backupRestore.restoreAction', { defaultValue: '还原' })}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 自绘提示 dialog */}
      <Modal visible={!!notice} transparent animationType="fade" onRequestClose={() => setNotice(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.confirmContent}>
            <Text style={styles.modalTitle}>{notice?.title || ''}</Text>
            <Text style={styles.modalMessage}>{notice?.message || ''}</Text>
            <View style={styles.confirmBtnRow}>
              <TouchableOpacity style={[styles.confirmBtn, styles.confirmOk]} onPress={() => setNotice(null)} activeOpacity={0.8}>
                <Text style={styles.confirmOkText}>{t('common.ok', { defaultValue: '好的' })}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 全局 busy 遮罩（导出/还原中） */}
      <Modal visible={busy && !confirm} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ActivityIndicator size="large" color="#74b1be" />
            <Text style={styles.busyText}>{t('common.processing', { defaultValue: '处理中…' })}</Text>
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
  scroll: { flex: 1 },
  scrollContent: { padding: 16, alignItems: 'center' },
  intro: { fontSize: 13, lineHeight: 19, color: '#636366', marginBottom: 14, width: '100%', maxWidth: 640 },
  card: {
    width: '100%',
    maxWidth: 640,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 18,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#1C1C1E', marginBottom: 10 },
  linkBtn: { fontSize: 14, fontWeight: '600', color: '#0A84FF', marginBottom: 10 },
  dirText: { fontSize: 12, color: '#8E8E93', marginBottom: 10 },
  primaryBtn: { backgroundColor: '#0A84FF', borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 16 },
  btnDisabled: { opacity: 0.6 },
  emptyText: { fontSize: 14, color: '#AEAEB2', paddingVertical: 10 },
  item: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 12, paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#EFEFF2',
  },
  itemIconWrap: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(94,92,230,0.12)',
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  itemIcon: { fontSize: 18 },
  itemName: { fontSize: 14, fontWeight: '500', color: '#1C1C1E' },
  itemMeta: { fontSize: 12, color: '#8E8E93', marginTop: 3 },
  actionBtn: { paddingHorizontal: 8, paddingVertical: 6, marginLeft: 4 },
  restoreTxt: { color: '#34C759', fontSize: 14, fontWeight: '600' },
  deleteTxt: { color: '#FF3B30', fontSize: 14, fontWeight: '600' },
  // 自绘 dialog / 进度 Modal
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: { backgroundColor: '#FFFFFF', padding: 22, borderRadius: 14, alignItems: 'center', minWidth: 200 },
  confirmContent: { backgroundColor: '#FFFFFF', padding: 22, borderRadius: 14, width: 380, maxWidth: '90%' },
  modalTitle: { color: '#1C1C1E', fontSize: 18, fontWeight: '700', marginBottom: 10, textAlign: 'center' },
  modalMessage: { color: '#3A3A3C', fontSize: 14, lineHeight: 21, marginBottom: 18, textAlign: 'center' },
  busyText: { color: '#3A3A3C', fontSize: 14, marginTop: 12 },
  confirmBtnRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  confirmBtn: { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 10 },
  confirmCancel: { backgroundColor: 'rgba(120,120,128,0.14)' },
  confirmCancelText: { fontSize: 15, fontWeight: '600', color: '#3A3A3C' },
  confirmDelete: { backgroundColor: '#FF3B30' },
  confirmDeleteText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  confirmOk: { backgroundColor: '#0A84FF' },
  confirmOkText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
});

export default BackupRestoreScreen;
