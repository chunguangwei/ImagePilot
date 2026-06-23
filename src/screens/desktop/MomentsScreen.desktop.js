/**
 * MomentsScreen（桌面端）——「回忆」
 *
 * 与移动端共用 UnifiedDataService 纯内存聚合（毫秒级，零联网、零平台依赖）：
 * 那年今天 / 节日回忆 / 旅行回忆。
 *
 * 桌面端差异：
 * - 多列卡片布局（flexWrap），大屏更舒展。
 * - 砍掉「时刻秀」section（视频导出/分享桌面端不支持）。
 * - 点开看照片：内嵌 grid Modal 展示该卡照片（一期简化，不走 react-navigation）。
 * - 通过 props.onBack 返回（HomeScreen.desktop 的内部页面切换）。
 */
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, ActivityIndicator, Modal } from 'react-native';
import { useTranslation } from 'react-i18next';
import { logger, getUri } from '../../adapters/WebAdapters';
import UnifiedDataService from '../../services/UnifiedDataService';

const MomentsScreen = ({ onBack }) => {
  const { t, i18n } = useTranslation('common');
  const isEn = String(i18n?.language || '').startsWith('en');

  const [loading, setLoading] = useState(true);
  const [memories, setMemories] = useState([]);     // 那年今天
  const [holidayCards, setHolidayCards] = useState([]);
  const [trips, setTrips] = useState([]);
  const [viewer, setViewer] = useState(null);       // { title, images } | null

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // 那年今天（与移动端同逻辑：历年同月同日；时间字段 takenAt || timestamp）
        const all = require('../../services/GlobalImageCache').default.getCache().allImages || [];
        const now = new Date();
        const m = now.getMonth(); const d = now.getDate(); const y = now.getFullYear();
        const mem = [];
        for (const img of all) {
          const ts = (img && (img.takenAt || img.timestamp)) || 0;
          if (!ts || ts <= 0) continue;
          const dt = new Date(ts);
          if (dt.getMonth() === m && dt.getDate() === d && dt.getFullYear() < y) {
            mem.push({ ...img, memoryYear: dt.getFullYear() });
          }
        }
        mem.sort((a, b) => ((b.takenAt || b.timestamp) || 0) - ((a.takenAt || a.timestamp) || 0));

        const [h, tr] = await Promise.all([
          UnifiedDataService.findHolidayMemories({ minPhotos: 3 }),
          UnifiedDataService.findTrips({ minPhotos: 5, maxGapDays: 1 }),
        ]);

        if (!cancelled) {
          setMemories(mem.slice(0, 30));
          setHolidayCards((h && h.cards) || []);
          setTrips((tr && tr.trips) || []);
        }
      } catch (e) {
        logger.error('回忆加载失败:', e);
        if (!cancelled) { setMemories([]); setHolidayCards([]); setTrips([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const fmtDate = (ts) => { const dd = new Date(ts); return `${dd.getFullYear()}.${dd.getMonth() + 1}.${dd.getDate()}`; };

  const renderHeader = () => (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => onBack && onBack()} style={styles.backBtn} activeOpacity={0.7}>
        <Text style={styles.backText}>‹ {t('common.back', { defaultValue: '返回' })}</Text>
      </TouchableOpacity>
      <Text style={styles.title}>{t('moments.title', { defaultValue: '回忆' })}</Text>
      <View style={styles.backBtn} />
    </View>
  );

  const SectionTitle = ({ emoji, title, count }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionEmoji}>{emoji}</Text>
      <Text style={styles.sectionTitle}>{title}</Text>
      {count > 0 ? (
        <View style={styles.countBadge}><Text style={styles.countBadgeText}>{count}</Text></View>
      ) : null}
    </View>
  );

  const WideCard = ({ cover, title, meta, onPress }) => (
    <TouchableOpacity style={styles.wideCard} activeOpacity={0.85} onPress={onPress}>
      <Image source={{ uri: getUri(cover) || cover?.uri }} style={styles.wideImage} resizeMode="cover" />
      <View style={styles.wideOverlay} pointerEvents="none">
        <Text style={styles.wideTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.wideMeta} numberOfLines={1}>{meta}</Text>
      </View>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.container}>
        {renderHeader()}
        <View style={styles.center}><ActivityIndicator size="large" color="#74b1be" /></View>
      </View>
    );
  }

  const empty = memories.length === 0 && holidayCards.length === 0 && trips.length === 0;
  if (empty) {
    return (
      <View style={styles.container}>
        {renderHeader()}
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>🕰️</Text>
          <Text style={styles.emptyText}>{t('moments.empty', { defaultValue: '扫描相册后，这里会浮现你的那年今天、节日与旅行回忆' })}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {renderHeader()}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* 那年今天 */}
        {memories.length > 0 && (
          <View style={styles.section}>
            <SectionTitle emoji="🕰️" title={t('home.memoriesTitle', { defaultValue: '那年今天' })} count={memories.length} />
            <View style={styles.thumbWrap}>
              {memories.map((img, idx) => (
                <TouchableOpacity
                  key={img.id || idx}
                  style={styles.memoryItem}
                  activeOpacity={0.85}
                  onPress={() => setViewer({ title: t('home.memoriesTitle', { defaultValue: '那年今天' }), images: memories })}
                >
                  <Image source={{ uri: getUri(img) || img?.uri }} style={styles.memoryImage} resizeMode="cover" />
                  <View style={styles.yearBadge} pointerEvents="none">
                    <Text style={styles.yearText}>{img.memoryYear}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* 节日回忆 */}
        {holidayCards.length > 0 && (
          <View style={styles.section}>
            <SectionTitle emoji="🎉" title={t('home.holidaysTitle', { defaultValue: '节日回忆' })} count={holidayCards.length} />
            <View style={styles.cardsWrap}>
              {holidayCards.map((card) => {
                const name = isEn ? card.nameEn : card.name;
                const tt = `${card.year} ${name}`;
                return (
                  <WideCard
                    key={`${card.key}-${card.year}`}
                    cover={card.cover}
                    title={tt}
                    meta={`${card.count}`}
                    onPress={() => setViewer({ title: tt, images: card.images })}
                  />
                );
              })}
            </View>
          </View>
        )}

        {/* 旅行回忆 */}
        {trips.length > 0 && (
          <View style={styles.section}>
            <SectionTitle emoji="🧳" title={t('home.tripsTitle', { defaultValue: '旅行回忆' })} count={trips.length} />
            <View style={styles.cardsWrap}>
              {trips.map((trip) => {
                const tt = t('home.tripCardTitle', { city: trip.cityName || trip.city, defaultValue: `${trip.cityName || trip.city}之旅` });
                const meta = `${fmtDate(trip.startDay)} · ${t('home.tripDays', { days: trip.days, defaultValue: `${trip.days}天` })} · ${trip.count}`;
                return (
                  <WideCard
                    key={`${trip.city}-${trip.startDay}`}
                    cover={trip.cover}
                    title={tt}
                    meta={meta}
                    onPress={() => setViewer({ title: tt, images: trip.images })}
                  />
                );
              })}
            </View>
          </View>
        )}
      </ScrollView>

      {/* 点开看照片：内嵌 grid Modal 展示该卡照片 */}
      <Modal visible={!!viewer} transparent animationType="slide" onRequestClose={() => setViewer(null)}>
        <View style={styles.viewerRoot}>
          <View style={styles.viewerHeader}>
            <Text style={styles.viewerTitle} numberOfLines={1}>{viewer?.title || ''}</Text>
            <TouchableOpacity onPress={() => setViewer(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.viewerClose}>{t('common.close', { defaultValue: '关闭' })}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.viewerGrid}>
            {(viewer?.images || []).map((img, idx) => (
              <View key={img?.id || idx} style={styles.viewerCell}>
                <Image source={{ uri: getUri(img) || img?.uri }} style={styles.viewerCellImg} resizeMode="cover" />
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
};

const CARD_WIDTH = 240;

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
  emptyText: { fontSize: 15, color: '#8E8E93', textAlign: 'center', lineHeight: 22, maxWidth: 360 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16 },
  section: { marginBottom: 24 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 },
  sectionEmoji: { fontSize: 18 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: '#1C1C1E' },
  countBadge: { paddingHorizontal: 7, paddingVertical: 1, borderRadius: 9, backgroundColor: 'rgba(120,120,128,0.16)' },
  countBadgeText: { fontSize: 12, fontWeight: '600', color: '#636366' },
  thumbWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  memoryItem: { width: 108, height: 144, borderRadius: 10, overflow: 'hidden', margin: 5, backgroundColor: 'rgba(0,0,0,0.05)' },
  memoryImage: { width: '100%', height: '100%' },
  yearBadge: { position: 'absolute', left: 6, top: 6, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.55)' },
  yearText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  cardsWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  wideCard: { width: CARD_WIDTH, height: 150, borderRadius: 12, overflow: 'hidden', margin: 6, backgroundColor: 'rgba(0,0,0,0.05)' },
  wideImage: { width: '100%', height: '100%' },
  wideOverlay: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: 'rgba(0,0,0,0.45)' },
  wideTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  wideMeta: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2 },
  viewerRoot: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)' },
  viewerHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  viewerTitle: { fontSize: 16, fontWeight: '700', color: '#FFFFFF', flex: 1, marginRight: 12 },
  viewerClose: { fontSize: 16, fontWeight: '600', color: '#0A84FF' },
  viewerGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 6 },
  viewerCell: { width: 160, height: 160, padding: 4 },
  viewerCellImg: { width: '100%', height: '100%', borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.08)' },
});

export default MomentsScreen;
