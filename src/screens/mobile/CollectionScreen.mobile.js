/**
 * CollectionScreen —— 通用照片集合网格页
 *
 * route.params: { title, subtitle?, images: [...] }
 * 旅行回忆点进来用；之后任何"一组照片"的展示（精选/回忆集）都可复用。
 * 视频带 ▶+时长角标；点任意项进 ImagePreview（集合内左右滑）。
 */
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, Image, StyleSheet, useWindowDimensions,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView, Icon, getUri } from '../../adapters/WebAdapters';
import { useIosColors } from '../../ui/ios/theme';
import { formatDuration } from '../../components/shared/categoryUI';
import CategoryPickerOverlay from '../../components/shared/CategoryPickerOverlay';
import UnifiedDataService from '../../services/UnifiedDataService';
import { Alert } from 'react-native';

const COLS = 3;
const PAD = 8;
const GAP = 2;

export default function CollectionScreen({ navigation, route }) {
  const { t } = useTranslation('common');
  const c = useIosColors();
  const { width: winW } = useWindowDimensions();
  const itemSize = (winW - PAD * 2 - GAP * (COLS - 1)) / COLS;

  const title = route?.params?.title || t('collection.defaultTitle', { defaultValue: '照片集合' });
  const subtitle = route?.params?.subtitle || '';
  const images = Array.isArray(route?.params?.images) ? route.params.images : [];

  // 多选批量人工分类（长按进入；全选；改分类）
  const [selMode, setSelMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [pickerVisible, setPickerVisible] = useState(false);
  const exitSelMode = () => { setSelMode(false); setSelectedIds(new Set()); setPickerVisible(false); };
  const toggleSel = (id) => {
    setSelectedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const applyCategory = async (categoryId) => {
    const ids = [...selectedIds];
    setPickerVisible(false);
    if (ids.length === 0) return;
    try {
      await UnifiedDataService.updateImagesCategory(ids, categoryId, 'manual');
      try { await UnifiedDataService.imageCache.refreshCache(); } catch (_) {}
      Alert.alert(t('common.tip', { defaultValue: '提示' }), t('search.batchCategorized', { count: ids.length, defaultValue: `已将 ${ids.length} 项移入所选分类` }));
    } catch (e) {
      Alert.alert(t('settings.operationFailed', { defaultValue: '操作失败' }), e?.message || '');
    }
    exitSelMode();
  };

  const renderItem = ({ item, index }) => {
    const uri = getUri(item) || item?.uri;
    const isVideo = String(item?.mimeType || '').startsWith('video/');
    return (
      <TouchableOpacity
        style={{ width: itemSize, height: itemSize, marginRight: (index % COLS === COLS - 1) ? 0 : GAP, marginBottom: GAP }}
        activeOpacity={0.8}
        onPress={() => {
          if (selMode) { toggleSel(item.id); return; }
          navigation.navigate('ImagePreview', {
            image: item, allImages: images, currentIndex: index, fromScreen: 'collection',
          });
        }}
        onLongPress={() => { if (!selMode) { setSelMode(true); setSelectedIds(new Set([item.id])); } }}
      >
        <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
        {isVideo && (
          <View style={[styles.videoBadge, formatDuration(item.duration) ? styles.videoBadgeWide : null]} pointerEvents="none">
            <Text style={styles.videoBadgeIcon}>
              {'▶'}{formatDuration(item.duration) ? ` ${formatDuration(item.duration)}` : ''}
            </Text>
          </View>
        )}
        {selMode && (
          <View style={[styles.selOverlay, selectedIds.has(item.id) && styles.selOverlayOn]} pointerEvents="none">
            {selectedIds.has(item.id) ? <Text style={styles.selCheck}>✓</Text> : null}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.groupedBg || '#F2F2F7' }]}>
      <View style={[styles.header, { backgroundColor: c.card, borderBottomColor: c.separator }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Icon name="arrow-back-ios" size={20} color={c.accent || '#007AFF'} />
        </TouchableOpacity>
        <View style={styles.titleWrap}>
          <Text style={[styles.title, { color: c.label }]} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={[styles.subtitle, { color: c.tertiaryLabel }]} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        {/* 幻灯片放映（视频自动跳过） */}
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.navigate('Slideshow', { images, title })}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Icon name="play-circle-outline" size={24} color={c.accent || '#007AFF'} />
        </TouchableOpacity>
      </View>
      {selMode && (
        <View style={[styles.selBar, { backgroundColor: c.card, borderBottomColor: c.separator }]}>
          <Text style={[styles.selCount, { color: c.label }]}>
            {t('search.selectedCount', { count: selectedIds.size, defaultValue: `已选 ${selectedIds.size}` })}
          </Text>
          <View style={{ flex: 1 }} />
          <TouchableOpacity onPress={() => setSelectedIds(new Set(images.map((i) => i.id)))} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
            <Text style={[styles.selAction, { color: c.accent || '#007AFF' }]}>{t('search.selectAll', { defaultValue: '全选' })}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => selectedIds.size > 0 && setPickerVisible(true)} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
            <Text style={[styles.selAction, { color: selectedIds.size > 0 ? (c.accent || '#007AFF') : c.tertiaryLabel }]}>
              {t('category.changeCategory', { defaultValue: '改分类' })}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => {
            if (selectedIds.size === 0) return;
            const sel = images.filter((it) => selectedIds.has(it.id));
            exitSelMode();
            navigation.navigate('ShowcaseCreate', { images: sel });
          }} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
            <Text style={[styles.selAction, { color: selectedIds.size > 0 ? (c.accent || '#007AFF') : c.tertiaryLabel }]}>
              {t('showcase.entry', { defaultValue: '时刻秀' })}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={exitSelMode} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
            <Text style={[styles.selAction, { color: c.secondaryLabel }]}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </View>
      )}
      <FlatList
        data={images}
        keyExtractor={(item, idx) => String(item.id || idx)}
        renderItem={renderItem}
        numColumns={COLS}
        contentContainerStyle={{ padding: PAD }}
      />
      <CategoryPickerOverlay
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelect={applyCategory}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { width: 36, paddingVertical: 2 },
  titleWrap: { flex: 1, alignItems: 'center' },
  title: { fontSize: 16, fontWeight: '600' },
  subtitle: { fontSize: 11.5, marginTop: 1 },
  thumb: { width: '100%', height: '100%', borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.04)' },
  videoBadge: { position: 'absolute', right: 4, bottom: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  videoBadgeWide: { width: undefined, paddingHorizontal: 6 },
  videoBadgeIcon: { color: '#FFFFFF', fontSize: 11, marginLeft: 1 },
  // 多选
  selBar: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 14, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  selCount: { fontSize: 14, fontWeight: '600' },
  selAction: { fontSize: 14, fontWeight: '600' },
  selOverlay: { ...StyleSheet.absoluteFillObject, borderWidth: 2, borderColor: 'rgba(255,255,255,0.65)', borderRadius: 4, alignItems: 'flex-end' },
  selOverlayOn: { borderColor: '#007AFF', backgroundColor: 'rgba(0,122,255,0.22)' },
  selCheck: { color: '#FFFFFF', fontSize: 13, fontWeight: '800', backgroundColor: '#007AFF', width: 20, height: 20, borderRadius: 10, textAlign: 'center', lineHeight: 20, margin: 4, overflow: 'hidden' },
});
