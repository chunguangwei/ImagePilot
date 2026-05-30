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

import React, { useEffect, useState, useCallback } from 'react';
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
import { SafeAreaView, Icon } from '../../adapters/WebAdapters';
import BackupService from '../../services/BackupService';

export default function BackupRestoreScreen({ navigation }) {
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
      Alert.alert(
        '导出成功',
        `已写入：\n${result.path}\n\n共 ${result.withCategory} 张已分类（总 ${result.total} 张）。\n你可以用文件管理器把它发给别的手机做还原。`
      );
    } catch (e) {
      Alert.alert('导出失败', e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const onShareFile = async (file) => {
    try {
      // RN 内置 Share 对 Android 不直接支持任意文件 URI，但 message 写明路径让用户走文件管理器
      await Share.share({
        title: 'ImagePilot 备份',
        message: `ImagePilot 备份文件：\n${file.path}`,
      });
    } catch (_) { /* 用户取消即可 */ }
  };

  const onDelete = (file) => {
    Alert.alert(
      '删除备份',
      `确认删除 ${file.name}？\n该操作不可恢复，但本地相册分类不受影响。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
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
            } catch (e) {
              Alert.alert('删除失败', e?.message || String(e));
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
      '还原备份',
      `将按 ${file.name} 中的分类索引匹配本地相册，命中即恢复其分类（仅覆盖命中项，未命中的图不动）。是否继续？`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '还原',
          style: 'default',
          onPress: async () => {
            if (busy) return;
            setBusy(true);
            try {
              const payload = await BackupService.readBackup(file.path);
              const result = await BackupService.applyBackup(payload);
              Alert.alert(
                '还原完成',
                [
                  `命中: ${result.matched}`,
                  `已写入: ${result.applied}`,
                  `跳过(未命中): ${result.skipped}`,
                  `合并新自定义分类: ${result.customAdded}`,
                ].join('\n')
              );
            } catch (e) {
              Alert.alert('还原失败', e?.message || String(e));
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
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>分类备份与还原</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
        <Text style={styles.tip}>
          导出：把每张已分类图的分类 + 自定义分类定义打包到 JSON，落在公共 Downloads 目录。{'\n'}
          还原：从 Downloads 选一个备份，按 文件名 + 大小 + 拍摄时间 命中本地相册即恢复分类，未命中的图不动。
        </Text>

        {/* 导出 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>导出当前分类</Text>
          <TouchableOpacity style={[styles.primaryBtn, busy && styles.btnDisabled]} onPress={onExport} disabled={busy}>
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryBtnText}>导出备份</Text>
            )}
          </TouchableOpacity>
          {lastExport && (
            <Text style={styles.tipSmall}>
              最近：{lastExport.fileName}（已分类 {lastExport.withCategory} 张）
            </Text>
          )}
        </View>

        {/* 已有备份 */}
        <Text style={styles.sectionTitle}>已有备份（{list.length}）</Text>
        {loading ? (
          <ActivityIndicator style={{ marginTop: 20 }} />
        ) : list.length === 0 ? (
          <View style={styles.emptyBox}>
            <Icon name="folder-open" size={36} color="#C7C7CC" />
            <Text style={styles.empty}>Downloads 目录下还没备份文件</Text>
          </View>
        ) : (
          list.map((file) => (
            <View key={file.path} style={styles.item}>
              <View style={styles.itemIconWrap}>
                <Icon name="archive" size={18} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName} numberOfLines={1}>{file.name}</Text>
                <Text style={styles.itemMeta}>{fmtBytes(file.size)} · {fmtTime(file.mtime)}</Text>
              </View>
              <TouchableOpacity onPress={() => onShareFile(file)} style={styles.actionBtn} activeOpacity={0.6}>
                <Icon name="share" size={18} color="#007AFF" />
                <Text style={styles.shareTxt}>分享</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => onRestore(file)} style={styles.actionBtn} activeOpacity={0.6} disabled={busy}>
                <Icon name="restore" size={18} color={busy ? '#A8E0B5' : '#34C759'} />
                <Text style={[styles.restoreTxt, busy && { opacity: 0.4 }]}>还原</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => onDelete(file)} style={styles.actionBtn} activeOpacity={0.6} disabled={busy}>
                <Icon name="delete-outline" size={18} color={busy ? '#F5B7B1' : '#FF3B30'} />
                <Text style={[styles.deleteTxt, busy && { opacity: 0.4 }]}>删除</Text>
              </TouchableOpacity>
            </View>
          ))
        )}

        <Text style={styles.footTip}>
          想跨手机还原？把 Downloads 下的 {`imagepilot-backup-*.json`} 拷到新机相同位置，回到本页即可看到并还原。
        </Text>
      </ScrollView>
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
  tipSmall: { color: '#8E8E93', fontSize: 12, marginTop: 8 },
  footTip: { color: '#8E8E93', fontSize: 12, lineHeight: 18, marginTop: 16 },

  card: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 16, marginBottom: 16 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#000000', marginBottom: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#000000', marginBottom: 10, marginTop: 4 },

  primaryBtn: { backgroundColor: '#007AFF', borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 17 },
  btnDisabled: { opacity: 0.6 },

  empty: { color: '#8E8E93', fontSize: 14, marginTop: 8 },
  emptyBox: { backgroundColor: '#FFFFFF', borderRadius: 12, paddingVertical: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },

  item: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 12, padding: 14, marginBottom: 10 },
  itemIconWrap: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: '#5E5CE6',
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  itemName: { fontSize: 14, fontWeight: '500', color: '#000000' },
  itemMeta: { fontSize: 12, color: '#8E8E93', marginTop: 3 },
  // 三个动作按钮挤一行：图标 + 文字小一号，紧排
  actionBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingVertical: 6, marginLeft: 2 },
  shareTxt: { color: '#007AFF', marginLeft: 2, fontSize: 12 },
  restoreTxt: { color: '#34C759', marginLeft: 2, fontSize: 12, fontWeight: '600' },
  deleteTxt: { color: '#FF3B30', marginLeft: 2, fontSize: 12, fontWeight: '600' },
});
