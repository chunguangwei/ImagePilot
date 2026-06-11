/**
 * DuplicatesScreen —— 重复照片清理
 *
 * UnifiedDataService.findExactDuplicates() 找字节级重复（size+takenAt+尺寸 全同，
 * 直方图复核），按组展示：每组第一张「保留」，其余可一键删除（复用 writeDeleteImages
 * 删除链路：iOS 系统确认、安卓失败走系统授权提示）。
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, Image, ScrollView,
  ActivityIndicator, StyleSheet, Alert,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView, Icon, getUri, logger, useFocusEffect } from '../../adapters/WebAdapters';
import UnifiedDataService from '../../services/UnifiedDataService';
import { useIosColors } from '../../ui/ios/theme';

function formatBytes(bytes) {
  const b = Number(bytes) || 0;
  if (b >= 1024 * 1024 * 1024) return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(b / 1024))} KB`;
}

export default function DuplicatesScreen({ navigation }) {
  const { t } = useTranslation('common');
  const c = useIosColors();

  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState([]);
  const [totalRedundant, setTotalRedundant] = useState(0);
  const [totalWastedBytes, setTotalWastedBytes] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await UnifiedDataService.findExactDuplicates();
      setGroups(r.groups || []);
      setTotalRedundant(r.totalRedundant || 0);
      setTotalWastedBytes(r.totalWastedBytes || 0);
    } catch (e) {
      logger.warn('查找重复照片失败:', e?.message || e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  /** 删除指定 ids（组内冗余或全部冗余），完成后重新检测 */
  const deleteIds = async (ids, confirmMessage) => {
    Alert.alert(
      t('duplicates.confirmTitle', { defaultValue: '清理重复照片' }),
      confirmMessage,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete', { defaultValue: '删除' }),
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            setDeleteProgress({ done: 0, total: ids.length });
            try {
              const result = await UnifiedDataService.writeDeleteImages(ids, (p) => {
                setDeleteProgress({ done: p.filesDeleted || 0, total: ids.length });
              });
              const failed = (result && result.filesFailed) || 0;
              if (failed > 0) {
                Alert.alert(
                  t('category.deleteComplete', { defaultValue: '删除完成' }),
                  t('category.deletePartialSuccessMessage', { deleted: (result && result.filesDeleted) || 0, failed, defaultValue: `成功 ${(result && result.filesDeleted) || 0} 张，失败 ${failed} 张` })
                );
              }
            } catch (e) {
              Alert.alert(t('settings.operationFailed', { defaultValue: '操作失败' }), e?.message || '');
            } finally {
              setDeleting(false);
              setDeleteProgress(null);
              await load();
            }
          },
        },
      ]
    );
  };

  const cleanGroup = (group) => {
    deleteIds(
      group.redundantIds,
      t('duplicates.confirmGroupMessage', {
        count: group.redundantIds.length,
        size: formatBytes(group.wastedBytes),
        defaultValue: `删除该组 ${group.redundantIds.length} 张重复（保留 1 张），释放 ${formatBytes(group.wastedBytes)}。`,
      })
    );
  };

  const cleanAll = () => {
    const ids = groups.flatMap((g) => g.redundantIds);
    deleteIds(
      ids,
      t('duplicates.confirmAllMessage', {
        count: ids.length,
        size: formatBytes(totalWastedBytes),
        defaultValue: `删除全部 ${ids.length} 张重复（每组各保留 1 张），释放 ${formatBytes(totalWastedBytes)}。`,
      })
    );
  };

  const renderGroup = ({ item: group }) => (
    <View style={[styles.groupCard, { backgroundColor: c.card }]}>
      <View style={styles.groupHeader}>
        <Text style={[styles.groupTitle, { color: c.label }]}>
          {t('duplicates.groupTitle', { count: group.images.length, defaultValue: `${group.images.length} 张相同` })}
          <Text style={{ color: c.tertiaryLabel, fontWeight: '400' }}>
            {'  '}{formatBytes(group.images[0]?.size)}/张
          </Text>
        </Text>
        <TouchableOpacity onPress={() => cleanGroup(group)} disabled={deleting} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={[styles.groupClean, { color: '#FF3B30' }]}>
            {t('duplicates.cleanGroup', { defaultValue: '清理该组' })}
          </Text>
        </TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {group.images.map((img, idx) => (
          <TouchableOpacity
            key={img.id}
            style={styles.thumbWrap}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('ImagePreview', {
              image: img, allImages: group.images, currentIndex: idx, fromScreen: 'duplicates',
            })}
          >
            <Image source={{ uri: getUri(img) || img.uri }} style={styles.thumb} resizeMode="cover" />
            <View style={[styles.roleBadge, { backgroundColor: idx === 0 ? 'rgba(52,199,89,0.9)' : 'rgba(255,59,48,0.85)' }]} pointerEvents="none">
              <Text style={styles.roleBadgeText}>
                {idx === 0 ? t('duplicates.keep', { defaultValue: '保留' }) : t('duplicates.remove', { defaultValue: '删除' })}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.groupedBg || '#F2F2F7' }]}>
      {/* 头部 */}
      <View style={[styles.header, { backgroundColor: c.card, borderBottomColor: c.separator }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Icon name="arrow-back-ios" size={20} color={c.accent || '#007AFF'} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: c.label }]} numberOfLines={1}>
          {t('duplicates.title', { defaultValue: '重复照片清理' })}
        </Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.accent || '#007AFF'} />
          <Text style={[styles.emptyText, { color: c.secondaryLabel }]}>
            {t('duplicates.scanning', { defaultValue: '正在比对全库照片…' })}
          </Text>
        </View>
      ) : groups.length === 0 ? (
        <View style={styles.center}>
          <Icon name="check-circle-outline" size={52} color="#34C759" />
          <Text style={[styles.emptyText, { color: c.secondaryLabel }]}>
            {t('duplicates.empty', { defaultValue: '没有发现重复照片 🎉' })}
          </Text>
        </View>
      ) : (
        <>
          <Text style={[styles.summary, { color: c.secondaryLabel }]}>
            {t('duplicates.summary', {
              groups: groups.length, count: totalRedundant, size: formatBytes(totalWastedBytes),
              defaultValue: `${groups.length} 组重复 · 可删 ${totalRedundant} 张 · 释放 ${formatBytes(totalWastedBytes)}`,
            })}
          </Text>
          <FlatList
            data={groups}
            keyExtractor={(g) => g.key}
            renderItem={renderGroup}
            contentContainerStyle={{ padding: 12, paddingBottom: 90 }}
          />
          {/* 底部一键清理 */}
          <View style={[styles.bottomBar, { backgroundColor: c.card, borderTopColor: c.separator }]}>
            <TouchableOpacity
              style={[styles.cleanAllBtn, { backgroundColor: deleting ? 'rgba(255,59,48,0.5)' : '#FF3B30' }]}
              onPress={cleanAll}
              disabled={deleting}
            >
              <Text style={styles.cleanAllText}>
                {deleting && deleteProgress
                  ? t('duplicates.deleting', { done: deleteProgress.done, total: deleteProgress.total, defaultValue: `删除中 ${deleteProgress.done}/${deleteProgress.total}…` })
                  : t('duplicates.cleanAll', { size: formatBytes(totalWastedBytes), defaultValue: `一键清理全部（释放 ${formatBytes(totalWastedBytes)}）` })}
              </Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { width: 36, paddingVertical: 2 },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { marginTop: 12, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  summary: { fontSize: 13, paddingHorizontal: 14, paddingTop: 10 },
  groupCard: { borderRadius: 12, padding: 10, marginBottom: 10 },
  groupHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  groupTitle: { fontSize: 14, fontWeight: '600' },
  groupClean: { fontSize: 13, fontWeight: '600' },
  thumbWrap: { width: 86, height: 86, borderRadius: 8, overflow: 'hidden', marginRight: 6, backgroundColor: 'rgba(0,0,0,0.05)' },
  thumb: { width: '100%', height: '100%' },
  roleBadge: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingVertical: 2, alignItems: 'center' },
  roleBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, paddingBottom: 24, borderTopWidth: StyleSheet.hairlineWidth },
  cleanAllBtn: { borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  cleanAllText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
