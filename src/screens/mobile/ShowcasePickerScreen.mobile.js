/**
 * ShowcasePickerScreen ——「时刻秀加图」全相册多选选图器
 *
 * route.params: { excludeIds: [已在时刻里的图 id] }
 * 选完点「确定」→ navigate 回 ShowcaseCreate，带 { addedImages, addToken }（仅新增的图）。
 * 已在时刻里的图灰显「已添加」、不可选（移除在编辑页用 ✕）。
 */
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View, Text, Image, FlatList, TouchableOpacity, ScrollView, StyleSheet, Dimensions,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView, Icon, getUri } from '../../adapters/WebAdapters';
import { useIosColors } from '../../ui/ios/theme';
import GlobalImageCache from '../../services/GlobalImageCache';
import configService from '../../services/ConfigService';

const ALL_CAT = '__all__';

const SCREEN_W = Dimensions.get('window').width;
const COLS = 4;
const GAP = 2;
const CELL = Math.floor((SCREEN_W - GAP * (COLS + 1)) / COLS);

export default function ShowcasePickerScreen({ navigation, route }) {
  const { t, i18n } = useTranslation('common');
  const c = useIosColors();
  const isEn = String(i18n?.language || '').startsWith('en');
  const excludeIds = useMemo(
    () => new Set(Array.isArray(route?.params?.excludeIds) ? route.params.excludeIds : []),
    [route?.params?.excludeIds]
  );

  // 全部已索引相册图（含视频，支持混播）
  const all = useMemo(
    () => (GlobalImageCache.getCache().allImages || []).filter((i) => i && i.id),
    []
  );

  const [picked, setPicked] = useState(() => new Set());
  const [activeCat, setActiveCat] = useState(ALL_CAT);
  const [customCats, setCustomCats] = useState([]);

  // 自定义分类（解析分类名用）
  useEffect(() => {
    (async () => {
      try {
        const cfgSvc = (await import('../../services/llm/adapters/UnifiedDataConfigService')).default;
        const cfg = await cfgSvc.getAIProviderConfig();
        setCustomCats(Array.isArray(cfg?.customCategories) ? cfg.customCategories : []);
      } catch (_) { /* 忽略 */ }
    })();
  }, []);

  const catName = useCallback((cid) => {
    try {
      const m = configService.getCategoryNameMap() || {};
      const b = m[cid] && (isEn ? (m[cid].english || m[cid].chinese) : (m[cid].chinese || m[cid].english));
      if (b) return b;
      const cu = customCats.find((x) => x && x.id === cid);
      return (cu && cu.name) || cid;
    } catch (_) { return cid; }
  }, [isEn, customCats]);

  // 相册里实际出现的分类（按出现次数降序），供筛选条
  const cats = useMemo(() => {
    const cnt = new Map();
    for (const im of all) {
      const cid = im.category;
      if (!cid || cid === 'NA' || cid === 'NA_video') continue;
      cnt.set(cid, (cnt.get(cid) || 0) + 1);
    }
    return [...cnt.entries()].sort((a, b) => b[1] - a[1]).map(([cid]) => cid);
  }, [all]);

  const data = useMemo(
    () => (activeCat === ALL_CAT ? all : all.filter((i) => i.category === activeCat)),
    [all, activeCat]
  );

  const toggle = useCallback((id) => {
    if (excludeIds.has(id)) return; // 已添加的不可选
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, [excludeIds]);

  const confirm = useCallback(() => {
    const sel = all.filter((i) => picked.has(i.id));
    navigation.navigate('ShowcaseCreate', { addedImages: sel, addToken: Date.now() });
  }, [all, picked, navigation]);

  const renderItem = useCallback(({ item }) => {
    const isExcluded = excludeIds.has(item.id);
    const isPicked = picked.has(item.id);
    return (
      <TouchableOpacity activeOpacity={0.8} onPress={() => toggle(item.id)} style={styles.cell}>
        <Image source={{ uri: getUri(item) || item.uri }} style={styles.thumb} resizeMode="cover" />
        {isExcluded ? (
          <View style={styles.excludedOverlay}>
            <Text style={styles.excludedText}>{t('showcase.alreadyAdded', { defaultValue: '已添加' })}</Text>
          </View>
        ) : (
          <View style={[styles.check, isPicked && { backgroundColor: c.accent || '#007AFF', borderColor: c.accent || '#007AFF' }]}>
            {isPicked ? <Icon name="check" size={15} color="#FFFFFF" /> : null}
          </View>
        )}
      </TouchableOpacity>
    );
  }, [excludeIds, picked, toggle, c.accent, t]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.groupedBg || '#F2F2F7' }]}>
      <View style={[styles.header, { backgroundColor: c.card, borderBottomColor: c.separator }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Icon name="arrow-back-ios" size={20} color={c.accent || '#007AFF'} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: c.label }]}>{t('showcase.addPhotosTitle', { defaultValue: '添加照片' })}</Text>
        <TouchableOpacity onPress={confirm} disabled={picked.size === 0} style={styles.headerBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={[styles.confirm, { color: picked.size === 0 ? c.tertiaryLabel : (c.accent || '#007AFF') }]}>
            {picked.size > 0
              ? t('showcase.addConfirmN', { count: picked.size, defaultValue: `确定(${picked.size})` })
              : t('common.confirm', { defaultValue: '确定' })}
          </Text>
        </TouchableOpacity>
      </View>

      {/* 分类筛选条 */}
      {cats.length > 0 ? (
        <View style={[styles.filterBar, { backgroundColor: c.card, borderBottomColor: c.separator }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 8, alignItems: 'center' }}>
            {[ALL_CAT, ...cats].map((cid) => {
              const active = activeCat === cid;
              const label = cid === ALL_CAT ? t('showcase.catAll', { defaultValue: '全部' }) : catName(cid);
              return (
                <TouchableOpacity
                  key={cid}
                  onPress={() => setActiveCat(cid)}
                  style={[styles.catChip, { backgroundColor: active ? (c.accent || '#007AFF') : 'rgba(120,120,128,0.12)' }]}
                >
                  <Text style={[styles.catChipText, { color: active ? '#FFFFFF' : (c.secondaryLabel || '#6C6C70') }]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      <FlatList
        data={data}
        keyExtractor={(it) => String(it.id)}
        renderItem={renderItem}
        numColumns={COLS}
        contentContainerStyle={{ padding: GAP }}
        initialNumToRender={COLS * 6}
        windowSize={7}
        removeClippedSubviews
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    height: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: { minWidth: 64, justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '700' },
  filterBar: { height: 44, borderBottomWidth: StyleSheet.hairlineWidth, justifyContent: 'center' },
  catChip: { paddingHorizontal: 13, paddingVertical: 6, borderRadius: 15, marginRight: 8 },
  catChipText: { fontSize: 13, fontWeight: '600' },
  confirm: { fontSize: 16, fontWeight: '700', textAlign: 'right' },
  cell: { width: CELL, height: CELL, margin: GAP / 2, marginLeft: GAP, marginBottom: GAP },
  thumb: { width: '100%', height: '100%', borderRadius: 4, backgroundColor: 'rgba(120,120,128,0.12)' },
  check: {
    position: 'absolute', top: 5, right: 5, width: 22, height: 22, borderRadius: 11,
    borderWidth: 1.5, borderColor: '#FFFFFF', backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center', justifyContent: 'center',
  },
  excludedOverlay: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },
  excludedText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
});
