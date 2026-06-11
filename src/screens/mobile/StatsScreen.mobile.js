/**
 * StatsScreen —— 相册年报/统计
 *
 * UnifiedDataService.getAlbumStats() 纯本地聚合：总量/体积/年度分布/Top分类/Top城市/
 * 拍照最多的一天/最长视频/AI 描述覆盖率。可玩可晒，零联网。
 */
import React, { useState, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet, Share, Platform, NativeModules, Alert } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { useTranslation } from 'react-i18next';
import { SafeAreaView, Icon, useFocusEffect } from '../../adapters/WebAdapters';
import UnifiedDataService from '../../services/UnifiedDataService';
import configService from '../../services/ConfigService';
import { useIosColors } from '../../ui/ios/theme';
import { formatDuration, formatCityName } from '../../components/shared/categoryUI';

function fmtBytes(b) {
  const n = Number(b) || 0;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

export default function StatsScreen({ navigation }) {
  const { t, i18n } = useTranslation('common');
  const c = useIosColors();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const shotRef = useRef(null);

  /** 年报分享成图：截取整页内容 → iOS 系统分享 / 安卓走现有 MultiImageShare（content:// 授权齐全） */
  const shareReport = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const uri = await captureRef(shotRef, {
        format: 'png', quality: 1, result: 'tmpfile',
        snapshotContentContainer: true,   // 截整个滚动内容（不止可视区）
      });
      const fileUrl = uri.startsWith('file://') ? uri : `file://${uri}`;
      if (Platform.OS === 'ios') {
        await Share.share({ url: fileUrl });
      } else {
        const ms = NativeModules.MultiImageShare;
        if (ms && typeof ms.shareMultipleImages === 'function') {
          await ms.shareMultipleImages([fileUrl.replace(/^file:\/\//, '')]);
        } else {
          await Share.share({ message: fileUrl });
        }
      }
    } catch (e) {
      Alert.alert(t('common.tip', { defaultValue: '提示' }), e?.message || t('stats.shareFailed', { defaultValue: '分享失败' }));
    } finally {
      setSharing(false);
    }
  };

  useFocusEffect(useCallback(() => {
    (async () => {
      setLoading(true);
      try { setStats(await UnifiedDataService.getAlbumStats()); }
      finally { setLoading(false); }
    })();
  }, []));

  const catName = (cid) => {
    try {
      const m = configService.getCategoryNameMap() || {};
      const isEn = String(i18n?.language || '').startsWith('en');
      return (m[cid] && (isEn ? (m[cid].english || m[cid].chinese) : (m[cid].chinese || m[cid].english))) || cid;
    } catch (_) { return cid; }
  };

  const Card = ({ children }) => (
    <View style={[styles.card, { backgroundColor: c.card }]}>{children}</View>
  );
  const Row = ({ label, value }) => (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: c.secondaryLabel }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: c.label }]}>{value}</Text>
    </View>
  );

  const maxYear = stats && stats.years.length > 0 ? Math.max(...stats.years.map(([, n]) => n)) : 1;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.groupedBg || '#F2F2F7' }]}>
      <View style={[styles.header, { backgroundColor: c.card, borderBottomColor: c.separator }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Icon name="arrow-back-ios" size={20} color={c.accent || '#007AFF'} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: c.label }]}>{t('stats.title', { defaultValue: '相册报告' })}</Text>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={shareReport}
          disabled={sharing || loading || !stats}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {sharing
            ? <ActivityIndicator size="small" color={c.accent || '#007AFF'} />
            : <Icon name="ios-share" size={22} color={c.accent || '#007AFF'} />}
        </TouchableOpacity>
      </View>

      {loading || !stats ? (
        <View style={styles.center}><ActivityIndicator color={c.accent || '#007AFF'} /></View>
      ) : (
        <ScrollView ref={shotRef} style={{ backgroundColor: c.groupedBg || '#F2F2F7' }} contentContainerStyle={{ padding: 12, paddingBottom: 32 }}>
          {/* 总览 */}
          <Card>
            <Text style={[styles.cardTitle, { color: c.label }]}>📦 {t('stats.overview', { defaultValue: '总览' })}</Text>
            <Row label={t('stats.photos', { defaultValue: '照片' })} value={`${stats.photos}`} />
            <Row label={t('stats.videos', { defaultValue: '视频' })} value={`${stats.videos}${stats.videoSeconds > 0 ? `（${t('stats.totalDuration', { defaultValue: '合计' })} ${formatDuration(stats.videoSeconds)}）` : ''}`} />
            <Row label={t('stats.storage', { defaultValue: '占用空间' })} value={fmtBytes(stats.totalBytes)} />
            {stats.earliest ? (
              <Row label={t('stats.span', { defaultValue: '时间跨度' })}
                value={`${new Date(stats.earliest).getFullYear()} ~ ${new Date(stats.latest).getFullYear()}`} />
            ) : null}
            <Row label={t('stats.aiCoverage', { defaultValue: 'AI 描述覆盖' })}
              value={`${stats.total > 0 ? Math.round((stats.withDesc / stats.total) * 100) : 0}%`} />
          </Card>

          {/* 年度分布 */}
          {stats.years.length > 0 && (
            <Card>
              <Text style={[styles.cardTitle, { color: c.label }]}>📈 {t('stats.byYear', { defaultValue: '年度分布' })}</Text>
              {stats.years.map(([year, n]) => (
                <View key={year} style={styles.barRow}>
                  <Text style={[styles.barLabel, { color: c.secondaryLabel }]}>{year}</Text>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${Math.max(3, Math.round((n / maxYear) * 100))}%`, backgroundColor: c.accent || '#007AFF' }]} />
                  </View>
                  <Text style={[styles.barValue, { color: c.label }]}>{n}</Text>
                </View>
              ))}
            </Card>
          )}

          {/* Top 分类 */}
          {stats.topCategories.length > 0 && (
            <Card>
              <Text style={[styles.cardTitle, { color: c.label }]}>🏷️ {t('stats.topCategories', { defaultValue: '最常拍的内容' })}</Text>
              {stats.topCategories.map(([cid, n], i) => (
                <Row key={cid} label={`${i + 1}. ${catName(cid)}`} value={`${n}`} />
              ))}
            </Card>
          )}

          {/* Top 城市 */}
          {stats.topCities.length > 0 && (
            <Card>
              <Text style={[styles.cardTitle, { color: c.label }]}>🗺️ {t('stats.topCities', { defaultValue: '城市足迹 Top5' })}</Text>
              {stats.topCities.map(([city, n], i) => (
                <Row key={city} label={`${i + 1}. ${formatCityName(city) || city}`} value={`${n}`} />
              ))}
            </Card>
          )}

          {/* 趣味之最 */}
          <Card>
            <Text style={[styles.cardTitle, { color: c.label }]}>🏆 {t('stats.fun', { defaultValue: '相册之最' })}</Text>
            {stats.busiestDay ? (
              <Row label={t('stats.busiestDay', { defaultValue: '拍得最多的一天' })} value={`${stats.busiestDay.day}（${stats.busiestDay.count} 张）`} />
            ) : null}
            {stats.longestVideo && (stats.longestVideo.duration || 0) > 0 ? (
              <Row label={t('stats.longestVideo', { defaultValue: '最长的视频' })} value={formatDuration(stats.longestVideo.duration)} />
            ) : null}
            {!stats.busiestDay && !(stats.longestVideo && stats.longestVideo.duration > 0) ? (
              <Text style={[styles.rowLabel, { color: c.tertiaryLabel }]}>{t('stats.funEmpty', { defaultValue: '扫描后这里会更精彩' })}</Text>
            ) : null}
          </Card>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { width: 36 },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: 12, padding: 14, marginBottom: 10 },
  cardTitle: { fontSize: 15, fontWeight: '700', marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  rowLabel: { fontSize: 14 },
  rowValue: { fontSize: 14, fontWeight: '600' },
  barRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  barLabel: { width: 44, fontSize: 13 },
  barTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: 'rgba(120,120,128,0.12)', marginHorizontal: 8, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 5 },
  barValue: { width: 52, fontSize: 13, textAlign: 'right' },
});
