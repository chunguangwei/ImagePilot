/**
 * MomentsScreen ——「时刻」模块（底部 Tab，与首页齐平）
 *
 * 回忆系大本营：那年今天 / 节日回忆 / 旅行回忆 + 随便看看（header）。
 * 数据全部来自 UnifiedDataService 纯内存聚合（毫秒级），进页/回页刷新。
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Image, StyleSheet, Alert, Share, ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView, useFocusEffect, getUri, logger } from '../../adapters/WebAdapters';
import UnifiedDataService from '../../services/UnifiedDataService';
import GlobalImageCache from '../../services/GlobalImageCache';
import { useIosColors } from '../../ui/ios/theme';
import VIcon from '../../components/shared/VIcon';

export default function MomentsScreen({ navigation }) {
  const { t, i18n } = useTranslation('common');
  const c = useIosColors();
  const isEn = String(i18n?.language || '').startsWith('en');

  const [memories, setMemories] = useState([]);
  const [holidayCards, setHolidayCards] = useState([]);
  const [trips, setTrips] = useState([]);
  const [showcases, setShowcases] = useState([]);   // 时刻秀（用户自建放映集，按创建时间倒序）

  const load = useCallback(async () => {
    try {
      await UnifiedDataService.imageCache.buildCache();
      // 那年今天（与首页同逻辑：历年同月同日）
      const all = GlobalImageCache.getCache().allImages || [];
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
      setMemories(mem.slice(0, 30));
      const [h, tr] = await Promise.all([
        UnifiedDataService.findHolidayMemories(),
        UnifiedDataService.findTrips(),
      ]);
      setHolidayCards((h && h.cards) || []);
      setTrips((tr && tr.trips) || []);
      // 时刻秀：解析 imageIds → 记录（缓存秒查）
      try {
        const list = await UnifiedDataService.imageStorageService.listShowcases();
        const byId = new Map((GlobalImageCache.getCache().allImages || []).map((i) => [i.id, i]));
        setShowcases(list.map((sc) => ({
          ...sc,
          images: sc.imageIds.map((id) => byId.get(id)).filter(Boolean),
        })).filter((sc) => sc.images.length > 0));
      } catch (_) { setShowcases([]); }
    } catch (e) {
      logger.debug('时刻加载失败:', e?.message || e);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  /** 随便看看：按年份分桶随机抽 30 张 → 集合页 */
  const openRandomBrowse = () => {
    try {
      const pool = (GlobalImageCache.getCache().allImages || []).filter((i) => i && i.id);
      if (pool.length === 0) return;
      const byYear = new Map();
      for (const img of pool) {
        const ts = img.takenAt || img.timestamp || 0;
        const yy = ts > 0 ? new Date(ts).getFullYear() : 0;
        if (!byYear.has(yy)) byYear.set(yy, []);
        byYear.get(yy).push(img);
      }
      const buckets = [...byYear.values()].map((arr) => arr.sort(() => Math.random() - 0.5));
      const out = [];
      let bi = 0; let guard = 0;
      while (out.length < 30 && guard < 10000 && buckets.some((b) => b.length > 0)) {
        const b = buckets[bi % buckets.length];
        if (b.length > 0) out.push(b.pop());
        bi++; guard++;
      }
      navigation.navigate('Collection', {
        title: t('home.randomBrowse', { defaultValue: '随便看看' }),
        subtitle: t('home.randomBrowseSub', { count: out.length, defaultValue: `随机 ${out.length} 张 · 回去再点一次换一批` }),
        images: out,
      });
    } catch (e) { logger.debug('随便看看失败:', e?.message || e); }
  };

  const [exporting, setExporting] = useState(null);   // { name, phase, done, total } | null

  /** 导出为视频并分享（iOS 先行；安卓提示即将到来） */
  const exportShowcase = async (sc) => {
    const { isExportSupported, exportShowcaseVideo } = require('../../services/showcaseExport');
    if (!isExportSupported()) {
      Alert.alert(t('common.tip', { defaultValue: '提示' }), t('showcase.exportComingAndroid', { defaultValue: '导出视频功能即将登陆安卓，先用播放功能哦' }));
      return;
    }
    setExporting({ name: sc.name, phase: 'prepare', done: 0, total: sc.images.length });
    try {
      const mp4 = await exportShowcaseVideo(sc, (phase, done, total) => {
        setExporting({ name: sc.name, phase, done, total });
      });
      setExporting(null);
      await Share.share({ url: mp4 });
    } catch (e) {
      setExporting(null);
      Alert.alert(t('settings.operationFailed', { defaultValue: '操作失败' }), e?.message || t('showcase.exportFailed', { defaultValue: '导出失败' }));
    }
  };

  /** 长按菜单：导出为视频 / 删除 */
  const deleteShowcase = (sc) => {
    Alert.alert(
      sc.name,
      t('showcase.actionsMessage', { defaultValue: '要对这个时刻秀做什么？' }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('showcase.editBtn', { defaultValue: '编辑' }),
          onPress: () => navigation.navigate('ShowcaseCreate', { editShowcase: sc }),
        },
        {
          text: t('showcase.exportBtn', { defaultValue: '导出为视频并分享' }),
          onPress: () => exportShowcase(sc),
        },
        {
          text: t('common.delete', { defaultValue: '删除' }), style: 'destructive',
          onPress: () => {
            Alert.alert(
              t('showcase.deleteTitle', { defaultValue: '删除时刻秀' }),
              t('showcase.deleteMessage', { name: sc.name, defaultValue: `删除「${sc.name}」？（不会删除照片本身）` }),
              [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('common.delete', { defaultValue: '删除' }), style: 'destructive',
                  onPress: async () => {
                    try { await UnifiedDataService.imageStorageService.deleteShowcase(sc.id); } catch (_) {}
                    load();
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  const fmtDate = (ts) => { const dd = new Date(ts); return `${dd.getFullYear()}.${dd.getMonth() + 1}.${dd.getDate()}`; };

  const SectionTitle = ({ icon, tint, emoji, title, count, onPlay }) => (
    <View style={styles.sectionHeader}>
      <VIcon name={icon} size={18} color={tint} emoji={emoji} />
      <Text style={[styles.sectionTitle, { color: c.label }]}>{title}</Text>
      {count > 0 ? (
        <View style={[styles.countBadge, { backgroundColor: 'rgba(120,120,128,0.16)' }]}>
          <Text style={[styles.countBadgeText, { color: c.secondaryLabel }]}>{count}</Text>
        </View>
      ) : null}
      <View style={{ flex: 1 }} />
      {onPlay ? (
        <TouchableOpacity onPress={onPlay} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={[styles.playLink, { color: c.accent || '#007AFF' }]}>{t('home.slideshowBtn', { defaultValue: '▶ 放映' })}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  const WideCard = ({ keyId, cover, title, meta, onPress }) => (
    <TouchableOpacity key={keyId} style={styles.wideCard} activeOpacity={0.85} onPress={onPress}>
      <Image source={{ uri: getUri(cover) || cover?.uri }} style={styles.wideImage} resizeMode="cover" />
      <View style={styles.wideOverlay} pointerEvents="none">
        <Text style={styles.wideTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.wideMeta} numberOfLines={1}>{meta}</Text>
      </View>
    </TouchableOpacity>
  );

  const empty = memories.length === 0 && holidayCards.length === 0 && trips.length === 0 && showcases.length === 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.groupedBg || '#F2F2F7' }]}>
      {/* 头部：标题 + 随便看看 */}
      <View style={[styles.header, { backgroundColor: c.card, borderBottomColor: c.separator }]}>
        <Text style={[styles.headerTitle, { color: c.label }]}>{t('moments.title', { defaultValue: '时刻' })}</Text>
        <TouchableOpacity onPress={openRandomBrowse} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <VIcon name="shuffle" size={17} color={c.accent || '#007AFF'} emoji="🎲" />
          <Text style={[styles.playLink, { color: c.accent || '#007AFF' }]}>{t('home.randomBrowse', { defaultValue: '随便看看' })}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingVertical: 12, paddingBottom: 90 }}>
        {empty ? (
          <View style={styles.empty}>
            <Text style={{ fontSize: 44 }}>🕰️</Text>
            <Text style={[styles.emptyText, { color: c.secondaryLabel }]}>
              {t('moments.empty', { defaultValue: '扫描相册后，这里会浮现你的那年今天、节日与旅行回忆' })}
            </Text>
          </View>
        ) : (
          <>
            {/* 时刻秀（用户自建放映集） */}
            {showcases.length > 0 && (
              <View style={styles.section}>
                <SectionTitle icon="film" tint="#AF52DE" emoji="🎬" title={t('showcase.sectionTitle', { defaultValue: '时刻秀' })} count={showcases.length} />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hList}>
                  {showcases.map((sc) => (
                    <TouchableOpacity
                      key={sc.id}
                      style={styles.wideCard}
                      activeOpacity={0.85}
                      onPress={() => navigation.navigate('Slideshow', {
                        images: sc.images, title: sc.name, mode: sc.mode, interval: sc.interval, musicPath: sc.musicPath,
                      })}
                      onLongPress={() => deleteShowcase(sc)}
                    >
                      <Image source={{ uri: getUri(sc.images[0]) || sc.images[0]?.uri }} style={styles.wideImage} resizeMode="cover" />
                      <View style={styles.wideOverlay} pointerEvents="none">
                        <Text style={styles.wideTitle} numberOfLines={1}>{sc.name}</Text>
                        <Text style={styles.wideMeta} numberOfLines={1}>
                          {sc.description ? sc.description : `${sc.images.length} · ${fmtDate(new Date(sc.createdAt).getTime())}`}
                        </Text>
                      </View>
                      <View style={styles.playBadge} pointerEvents="none"><VIcon name="play" size={12} emoji="▶" style={{ marginLeft: 1 }} /></View>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* 那年今天 */}
            {memories.length > 0 && (
              <View style={styles.section}>
                <SectionTitle
                  icon="time" tint="#0A84FF"
                  emoji="🕰️"
                  title={t('home.memoriesTitle', { defaultValue: '那年今天' })}
                  count={memories.length}
                  onPlay={() => navigation.navigate('Slideshow', { images: memories, title: t('home.memoriesTitle', { defaultValue: '那年今天' }) })}
                />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hList}>
                  {memories.map((img, idx) => (
                    <TouchableOpacity
                      key={img.id || idx}
                      style={styles.memoryItem}
                      activeOpacity={0.85}
                      onPress={() => navigation.navigate('ImagePreview', { image: img, allImages: memories, currentIndex: idx, fromScreen: 'moments' })}
                    >
                      <Image source={{ uri: getUri(img) || img?.uri }} style={styles.memoryImage} resizeMode="cover" />
                      <View style={styles.yearBadge} pointerEvents="none">
                        <Text style={styles.yearText}>{img.memoryYear}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* 节日回忆 */}
            {holidayCards.length > 0 && (
              <View style={styles.section}>
                <SectionTitle icon="gift" tint="#FF2D55" emoji="🎉" title={t('home.holidaysTitle', { defaultValue: '节日回忆' })} count={holidayCards.length} />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hList}>
                  {holidayCards.slice(0, 20).map((card) => {
                    const name = isEn ? card.nameEn : card.name;
                    return (
                      <WideCard
                        key={`${card.key}-${card.year}`}
                        keyId={`${card.key}-${card.year}`}
                        cover={card.cover}
                        title={`${card.year} ${name}`}
                        meta={`${card.count}`}
                        onPress={() => navigation.navigate('Collection', { title: `${card.year} ${name}`, subtitle: `${card.count}`, images: card.images })}
                      />
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {/* 旅行回忆 */}
            {trips.length > 0 && (
              <View style={styles.section}>
                <SectionTitle icon="airplane" tint="#FF9500" emoji="🧳" title={t('home.tripsTitle', { defaultValue: '旅行回忆' })} count={trips.length} />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hList}>
                  {trips.slice(0, 20).map((trip) => (
                    <WideCard
                      key={`${trip.city}-${trip.startDay}`}
                      keyId={`${trip.city}-${trip.startDay}`}
                      cover={trip.cover}
                      title={t('home.tripCardTitle', { city: trip.cityName || trip.city, defaultValue: `${trip.cityName || trip.city}之旅` })}
                      meta={`${fmtDate(trip.startDay)} · ${t('home.tripDays', { days: trip.days, defaultValue: `${trip.days}天` })} · ${trip.count}`}
                      onPress={() => navigation.navigate('Collection', {
                        title: t('home.tripCardTitle', { city: trip.cityName || trip.city, defaultValue: `${trip.cityName || trip.city}之旅` }),
                        subtitle: `${fmtDate(trip.startDay)} · ${t('home.tripDays', { days: trip.days, defaultValue: `${trip.days}天` })} · ${trip.count}`,
                        images: trip.images,
                      })}
                    />
                  ))}
                </ScrollView>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* 导出进度胶囊 */}
      {exporting ? (
        <View style={styles.exportPill} pointerEvents="none">
          <ActivityIndicator size="small" color="#FFFFFF" />
          <Text style={styles.exportPillText}>
            {exporting.phase === 'prepare'
              ? t('showcase.exportPreparing', { done: exporting.done, total: exporting.total, defaultValue: `准备图片 ${exporting.done}/${exporting.total}` })
              : t('showcase.exportEncoding', { defaultValue: '正在合成视频…' })}
          </Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 20, fontWeight: '700' },
  playLink: { fontSize: 14, fontWeight: '600' },
  section: { marginBottom: 18 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 10, gap: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '700' },
  countBadge: { paddingHorizontal: 7, paddingVertical: 1, borderRadius: 9 },
  countBadgeText: { fontSize: 12, fontWeight: '600' },
  hList: { paddingHorizontal: 14 },
  memoryItem: { width: 108, height: 144, borderRadius: 10, overflow: 'hidden', marginRight: 8, backgroundColor: 'rgba(0,0,0,0.05)' },
  memoryImage: { width: '100%', height: '100%' },
  yearBadge: { position: 'absolute', left: 6, top: 6, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.55)' },
  yearText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  wideCard: { width: 200, height: 124, borderRadius: 12, overflow: 'hidden', marginRight: 10, backgroundColor: 'rgba(0,0,0,0.05)' },
  wideImage: { width: '100%', height: '100%' },
  wideOverlay: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: 'rgba(0,0,0,0.45)' },
  wideTitle: { color: '#FFFFFF', fontSize: 14.5, fontWeight: '700' },
  wideMeta: { color: 'rgba(255,255,255,0.85)', fontSize: 11.5, marginTop: 1 },
  playBadge: { position: 'absolute', right: 8, top: 8, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  playBadgeIcon: { color: '#FFFFFF', fontSize: 12, marginLeft: 1 },
  exportPill: {
    position: 'absolute', bottom: 100, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.72)', zIndex: 900,
  },
  exportPillText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  empty: { alignItems: 'center', paddingTop: 120, paddingHorizontal: 40 },
  emptyText: { marginTop: 12, fontSize: 14, textAlign: 'center', lineHeight: 21 },
});
