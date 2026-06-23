/**
 * StatsScreen（桌面端）—— 相册报告 / 统计
 *
 * 与移动端共用 UnifiedDataService.getAlbumStats()（纯本地聚合，零联网）：
 * 总量/体积/年度分布/Top 分类/Top 城市/拍照最多的一天/最长视频/AI 描述覆盖率。
 *
 * 桌面端差异：
 * - 多列卡片布局（flexWrap），大屏更舒展。
 * - 不做分享成图（view-shot 桌面端不可用）。
 * - 通过 props.onBack 返回（HomeScreen.desktop 的内部页面切换，不走 react-navigation）。
 */
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { logger } from '../../adapters/WebAdapters';
import UnifiedDataService from '../../services/UnifiedDataService';
import configService from '../../services/ConfigService';
import { formatDuration, formatCityName } from '../../components/shared/categoryUI';

function fmtBytes(b) {
  const n = Number(b) || 0;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

const StatsScreen = ({ onBack }) => {
  const { t, i18n } = useTranslation('common');
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const s = await UnifiedDataService.getAlbumStats();
        if (!cancelled) setStats(s);
      } catch (e) {
        logger.error('相册报告统计失败:', e);
        if (!cancelled) setStats(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // catId → 显示名（自定义分类已注入 ConfigService，能解析成用户起的名字）
  const catName = (cid) => {
    try {
      const lang = String(i18n?.language || '').startsWith('en') ? 'english' : 'chinese';
      return configService.getCategoryDisplayName(cid, lang) || cid;
    } catch (_) { return cid; }
  };

  const Row = ({ label, value }) => (
    <View style={styles.row}>
      <Text style={styles.rowLabel} numberOfLines={1}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );

  const Card = ({ icon, title, children }) => (
    <View style={styles.card}>
      <View style={styles.cardTitleRow}>
        {icon ? <Text style={styles.cardIcon}>{icon}</Text> : null}
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );

  const renderHeader = () => (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => onBack && onBack()} style={styles.backBtn} activeOpacity={0.7}>
        <Text style={styles.backText}>‹ {t('common.back', { defaultValue: '返回' })}</Text>
      </TouchableOpacity>
      <Text style={styles.title}>{t('stats.title', { defaultValue: '相册报告' })}</Text>
      <View style={styles.backBtn} />
    </View>
  );

  if (loading || !stats) {
    return (
      <View style={styles.container}>
        {renderHeader()}
        <View style={styles.center}><ActivityIndicator size="large" color="#74b1be" /></View>
      </View>
    );
  }

  // 空态：一张照片都没有
  if (!stats.total || stats.total === 0) {
    return (
      <View style={styles.container}>
        {renderHeader()}
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>📊</Text>
          <Text style={styles.emptyText}>{t('category.noImages', { defaultValue: '暂无照片' })}</Text>
          <Text style={styles.emptySub}>{t('home.scanOrAdjustSettings', { defaultValue: '扫描相册后这里会有数据' })}</Text>
        </View>
      </View>
    );
  }

  const years = Array.isArray(stats.years) ? stats.years : [];
  const maxYear = years.length > 0 ? Math.max(...years.map(([, n]) => n)) : 1;
  const topCategories = Array.isArray(stats.topCategories) ? stats.topCategories : [];
  const topCities = Array.isArray(stats.topCities) ? stats.topCities : [];
  const hasFun = stats.busiestDay || (stats.longestVideo && (stats.longestVideo.duration || 0) > 0);

  return (
    <View style={styles.container}>
      {renderHeader()}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.cardsWrap}>
          {/* 总览 */}
          <Card icon="📦" title={t('stats.overview', { defaultValue: '总览' })}>
            <Row label={t('stats.photos', { defaultValue: '照片' })} value={`${stats.photos}`} />
            <Row
              label={t('stats.videos', { defaultValue: '视频' })}
              value={`${stats.videos}${stats.videoSeconds > 0 ? ` · ${t('stats.totalDuration', { defaultValue: '合计' })} ${formatDuration(stats.videoSeconds)}` : ''}`}
            />
            <Row label={t('stats.storage', { defaultValue: '占用空间' })} value={fmtBytes(stats.totalBytes)} />
            {stats.earliest ? (
              <Row
                label={t('stats.span', { defaultValue: '时间跨度' })}
                value={`${new Date(stats.earliest).getFullYear()} ~ ${new Date(stats.latest).getFullYear()}`}
              />
            ) : null}
            <Row
              label={t('stats.aiCoverage', { defaultValue: 'AI 描述覆盖' })}
              value={`${stats.total > 0 ? Math.round((stats.withDesc / stats.total) * 100) : 0}%`}
            />
          </Card>

          {/* 年度分布 */}
          {years.length > 0 && (
            <Card icon="📊" title={t('stats.byYear', { defaultValue: '年度分布' })}>
              {years.map(([year, n]) => (
                <View key={year} style={styles.barRow}>
                  <Text style={styles.barLabel}>{year}</Text>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${Math.max(3, Math.round((n / maxYear) * 100))}%` }]} />
                  </View>
                  <Text style={styles.barValue}>{n}</Text>
                </View>
              ))}
            </Card>
          )}

          {/* Top 分类 */}
          {topCategories.length > 0 && (
            <Card icon="🏷️" title={t('stats.topCategories', { defaultValue: '最常拍的内容' })}>
              {topCategories.map(([cid, n], i) => (
                <Row key={cid} label={`${i + 1}. ${catName(cid)}`} value={`${n}`} />
              ))}
            </Card>
          )}

          {/* Top 城市 */}
          {topCities.length > 0 && (
            <Card icon="🏙️" title={t('stats.topCities', { defaultValue: '城市足迹 Top5' })}>
              {topCities.map(([city, n], i) => (
                <Row key={city} label={`${i + 1}. ${formatCityName(city) || city}`} value={`${n}`} />
              ))}
            </Card>
          )}

          {/* 相册之最 */}
          <Card icon="🏆" title={t('stats.fun', { defaultValue: '相册之最' })}>
            {stats.busiestDay ? (
              <Row label={t('stats.busiestDay', { defaultValue: '拍得最多的一天' })} value={`${stats.busiestDay.day} · ${stats.busiestDay.count}`} />
            ) : null}
            {stats.longestVideo && (stats.longestVideo.duration || 0) > 0 ? (
              <Row label={t('stats.longestVideo', { defaultValue: '最长的视频' })} value={formatDuration(stats.longestVideo.duration)} />
            ) : null}
            {!hasFun ? (
              <Text style={styles.funEmpty}>{t('stats.funEmpty', { defaultValue: '扫描后这里会更精彩' })}</Text>
            ) : null}
          </Card>
        </View>
      </ScrollView>
    </View>
  );
};

const CARD_WIDTH = 360;

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
  emptyText: { fontSize: 17, fontWeight: '600', color: '#3A3A3C', marginBottom: 6 },
  emptySub: { fontSize: 14, color: '#8E8E93', textAlign: 'center' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, alignItems: 'center' },
  cardsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    width: '100%',
    maxWidth: CARD_WIDTH * 3 + 48,
  },
  card: {
    width: CARD_WIDTH,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 18,
    margin: 8,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  cardIcon: { fontSize: 18, marginRight: 8 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#1C1C1E' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7 },
  rowLabel: { fontSize: 14, color: '#636366', flex: 1, marginRight: 12 },
  rowValue: { fontSize: 14, fontWeight: '600', color: '#1C1C1E' },
  barRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  barLabel: { width: 52, fontSize: 13, color: '#636366' },
  barTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: 'rgba(120,120,128,0.14)', marginHorizontal: 10, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 5, backgroundColor: '#0A84FF' },
  barValue: { width: 56, fontSize: 13, color: '#1C1C1E', textAlign: 'right', fontWeight: '600' },
  funEmpty: { fontSize: 14, color: '#AEAEB2', paddingVertical: 6 },
});

export default StatsScreen;
