/**
 * SearchScreen —— 按描述/关键词搜图
 *
 * 输入关键词 → UnifiedDataService.searchImages 匹配 AI 描述(message)+分类名+文件名+城市。
 * 「语义搜索」靠多模态档(Gemma)写的 AI 描述；未打描述的图会提示用户去分类。
 * 结果网格复用图片项（视频带 ▶ 角标，点击调系统播放器；图片进预览）。
 */
import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, Image,
  ActivityIndicator, StyleSheet, NativeModules, Keyboard, Platform, Alert,
  useWindowDimensions,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView, Icon, getUri, logger } from '../../adapters/WebAdapters';
import UnifiedDataService from '../../services/UnifiedDataService';
import { useIosColors } from '../../ui/ios/theme';

const GRID_COLUMNS = 3;
const GRID_PADDING = 8;
const GRID_GAP = 2;

function isVideoRecord(img) {
  return String(img?.mimeType || '').startsWith('video/');
}

export default function SearchScreen({ navigation }) {
  const { t } = useTranslation('common');
  const c = useIosColors();
  const { width: winW } = useWindowDimensions();
  const itemSize = (winW - GRID_PADDING * 2 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [untaggedCount, setUntaggedCount] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef(null);

  const runSearch = useCallback(async (text) => {
    const q = String(text || '').trim();
    if (!q) { setResults([]); setUntaggedCount(0); setSearched(false); return; }
    setSearching(true);
    try {
      const r = await UnifiedDataService.searchImages(q);
      setResults(r.results || []);
      setUntaggedCount(r.untaggedCount || 0);
      setSearched(true);
    } catch (e) {
      logger.warn('搜索失败:', e?.message || e);
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const onChangeQuery = (text) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(text), 300);
  };

  const playVideoRecord = async (image) => {
    const id = image?.id || image?.localIdentifier;
    try {
      const PhotoKitModule = NativeModules && NativeModules.PhotoKitModule;
      if (PhotoKitModule && typeof PhotoKitModule.playVideo === 'function') {
        await PhotoKitModule.playVideo(id); return;
      }
      const MediaStoreModule = NativeModules && NativeModules.MediaStoreModule;
      if (MediaStoreModule && typeof MediaStoreModule.playVideo === 'function') {
        await MediaStoreModule.playVideo(image?.uri || id); return;
      }
    } catch (e) { logger.warn('播放视频失败:', e?.message || e); }
  };

  const onPressItem = (image, index) => {
    // 视频也进预览页（海报帧+居中▶）：可查看信息/改分类/编辑描述，点▶才播放
    navigation.navigate('ImagePreview', {
      image,
      allImages: results,
      currentIndex: index,
      filterType: 'search',
      filterValue: query,
      fromScreen: 'search',
    });
  };

  const renderItem = ({ item, index }) => {
    const uri = getUri(item) || item?.uri;
    return (
      <TouchableOpacity
        style={{ width: itemSize, height: itemSize, marginRight: (index % GRID_COLUMNS === GRID_COLUMNS - 1) ? 0 : GRID_GAP, marginBottom: GRID_GAP }}
        activeOpacity={0.8}
        onPress={() => onPressItem(item, index)}
      >
        <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
        {isVideoRecord(item) && (
          <View style={styles.videoBadge} pointerEvents="none">
            <Text style={styles.videoBadgeIcon}>▶</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.groupedBg || '#F2F2F7' }]}>
      {/* 顶部：返回 + 搜索框 */}
      <View style={[styles.header, { backgroundColor: c.card, borderBottomColor: c.separator }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Icon name="arrow-back-ios" size={20} color={c.accent || '#007AFF'} />
        </TouchableOpacity>
        <View style={[styles.searchBox, { backgroundColor: c.groupedBg || '#EFEFF4' }]}>
          <Icon name="search" size={18} color={c.tertiaryLabel || '#9aa0a6'} />
          <TextInput
            style={[styles.searchInput, { color: c.label }]}
            placeholder={t('search.placeholder', { defaultValue: '搜描述、分类、文件名…' })}
            placeholderTextColor={c.tertiaryLabel || '#9aa0a6'}
            value={query}
            onChangeText={onChangeQuery}
            autoFocus
            returnKeyType="search"
            onSubmitEditing={() => { Keyboard.dismiss(); runSearch(query); }}
            clearButtonMode="while-editing"
          />
        </View>
      </View>

      {/* 未打标提示：有未打 AI 描述的图时，提示语义搜索覆盖不全 */}
      {searched && untaggedCount > 0 && (
        <View style={[styles.hint, { backgroundColor: c.card }]}>
          <Icon name="info-outline" size={15} color={c.tertiaryLabel || '#9aa0a6'} />
          <Text style={[styles.hintText, { color: c.secondaryLabel || '#6C6C70' }]}>
            {t('search.untaggedHint', { count: untaggedCount, defaultValue: `还有 ${untaggedCount} 张图未打 AI 描述，用「多模态」档分类后才能被描述搜索到` })}
          </Text>
        </View>
      )}

      {searching ? (
        <View style={styles.center}><ActivityIndicator color={c.accent || '#007AFF'} /></View>
      ) : !query.trim() ? (
        <View style={styles.center} onStartShouldSetResponder={() => { Keyboard.dismiss(); return false; }}>
          <Icon name="search" size={48} color={c.tertiaryLabel || '#C7C7CC'} />
          <Text style={[styles.emptyText, { color: c.secondaryLabel }]}>
            {t('search.emptyTip', { defaultValue: '输入关键词，按 AI 描述 / 分类 / 文件名搜图' })}
          </Text>
        </View>
      ) : results.length === 0 && searched ? (
        <View style={styles.center} onStartShouldSetResponder={() => { Keyboard.dismiss(); return false; }}>
          <Icon name="image-search" size={48} color={c.tertiaryLabel || '#C7C7CC'} />
          <Text style={[styles.emptyText, { color: c.secondaryLabel }]}>
            {t('search.noResults', { query, defaultValue: `没找到与「${query}」匹配的图` })}
          </Text>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          numColumns={GRID_COLUMNS}
          contentContainerStyle={{ padding: GRID_PADDING }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListHeaderComponent={
            results.length > 0 ? (
              <Text style={[styles.countText, { color: c.secondaryLabel }]}>
                {t('search.resultCount', { count: results.length, defaultValue: `${results.length} 张结果` })}
              </Text>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { paddingRight: 8, paddingVertical: 6 },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 10, paddingHorizontal: 10, height: 38 },
  searchInput: { flex: 1, marginLeft: 6, fontSize: 16, padding: 0 },
  hint: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  hintText: { flex: 1, fontSize: 12.5, lineHeight: 17 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { marginTop: 12, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  countText: { fontSize: 12.5, marginBottom: 6, marginLeft: 2 },
  thumb: { width: '100%', height: '100%', borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.04)' },
  videoBadge: { position: 'absolute', right: 4, bottom: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  videoBadgeIcon: { color: '#FFFFFF', fontSize: 11, marginLeft: 1 },
});
