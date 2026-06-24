/**
 * SearchScreen（桌面端）——「搜索」
 *
 * 与移动端共用 UnifiedDataService 的纯 JS 文字检索（零模型依赖、零联网）：
 * - 默认搜索 searchImages：AI 描述 + 分类名 + 文件名 + 城市 + 时间/格式/分辨率/方向/大小。
 * - AI 搜索 searchBySemanticText：基于 AI 描述的 bigram 文本语义匹配（写"海边日落"命中相近描述）。
 *
 * 桌面端差异（相对 SearchScreen.mobile）：
 * - 砍掉 CLIP 以图搜图 / AI 识图搜索（Electron 下 onnxruntime-react-native 被打成空桩，调用即崩）。
 * - 砍掉多选批量改分类（一期；看大图走内嵌 Modal，不走 react-navigation）。
 * - ✨润色仅云端那半可用（端侧大模型 web 下不可用，service 内部自动回退云端，不会崩）。
 * - 多列网格 flexWrap，大屏更舒展；点开看大图用内嵌全屏 viewer（图片 Image，视频 web <video>）。
 * - 通过 props.onBack 返回（HomeScreen.desktop 的内部页面切换）。
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, StyleSheet, TouchableOpacity, ScrollView, Image,
  ActivityIndicator, Modal, Platform,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { logger, getUri } from '../../adapters/WebAdapters';
import UnifiedDataService from '../../services/UnifiedDataService';
import { formatDuration } from '../../components/shared/categoryUI';

function isVideoRecord(img) {
  return String(img?.mimeType || '').startsWith('video/');
}

const SearchScreen = ({ onBack }) => {
  const { t } = useTranslation('common');

  const [query, setQuery] = useState('');
  const [searchMode, setSearchMode] = useState('keyword'); // 'keyword' | 'semantic'
  const [results, setResults] = useState([]);
  const [untaggedCount, setUntaggedCount] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [viewer, setViewer] = useState(null);              // { index } | null
  const [rewriteAvailable, setRewriteAvailable] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const debounceRef = useRef(null);

  // ✨润色是否可用（桌面端仅云端配置时为真）
  useEffect(() => {
    (async () => {
      try {
        const { isRewriteAvailable } = require('../../services/llm/queryRewrite');
        setRewriteAvailable(await isRewriteAvailable());
      } catch (_) { setRewriteAvailable(false); }
    })();
  }, []);

  const runSearch = useCallback(async (text, mode = searchMode) => {
    const q = String(text || '').trim();
    if (!q) { setResults([]); setUntaggedCount(0); setSearched(false); return; }
    setSearching(true);
    try {
      const r = mode === 'semantic'
        ? await UnifiedDataService.searchBySemanticText(q)
        : await UnifiedDataService.searchImages(q);
      setResults(r.results || []);
      setUntaggedCount(r.untaggedCount || 0);
      setSearched(true);
    } catch (e) {
      logger.warn('搜索失败:', e?.message || e);
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [searchMode]);

  const onChangeQuery = (text) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(text), 300);
  };

  const onSwitchMode = (mode) => {
    setSearchMode(mode);
    if (query.trim()) runSearch(query, mode);
  };

  /** ✨改写：云端 LLM 把口语查询规整成画面描述，回填并立即语义搜索 */
  const onRewriteQuery = async () => {
    const q = query.trim();
    if (!q || rewriting) return;
    setRewriting(true);
    try {
      const { rewriteSearchQuery } = require('../../services/llm/queryRewrite');
      const better = await rewriteSearchQuery(q, t);
      if (better && better !== q) { setQuery(better); runSearch(better, 'semantic'); }
    } catch (e) {
      if (!String(e?.message || '').includes('E_CANCEL')) {
        logger.warn('改写失败:', e?.message || e);
      }
    } finally {
      setRewriting(false);
    }
  };

  // 内嵌大图 viewer：左右切换 + Esc 关闭（桌面键盘）
  useEffect(() => {
    if (Platform.OS !== 'web' || viewer == null) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setViewer(null);
      else if (e.key === 'ArrowLeft') setViewer((v) => (v && v.index > 0 ? { index: v.index - 1 } : v));
      else if (e.key === 'ArrowRight') setViewer((v) => (v && v.index < results.length - 1 ? { index: v.index + 1 } : v));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewer, results.length]);

  const KEYWORD_EXAMPLES = ['2024', '5月', '视频', 'jpg', '4k', '横屏', '大文件'];
  const SEMANTIC_EXAMPLES = [
    t('search.semanticEx1', { defaultValue: '海边日落' }),
    t('search.semanticEx2', { defaultValue: '一群人聚餐' }),
    t('search.semanticEx3', { defaultValue: '小狗在草地' }),
  ];

  const renderHeader = () => (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => onBack && onBack()} style={styles.backBtn} activeOpacity={0.7}>
        <Text style={styles.backText}>‹ {t('common.back', { defaultValue: '返回' })}</Text>
      </TouchableOpacity>
      <View style={styles.searchBox}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder={t('search.placeholder', { defaultValue: '搜描述、分类、文件名…' })}
          placeholderTextColor="#9AA0A6"
          value={query}
          onChangeText={onChangeQuery}
          autoFocus
          returnKeyType="search"
          onSubmitEditing={() => runSearch(query)}
        />
        {query.length > 0 ? (
          <TouchableOpacity onPress={() => onChangeQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.clearBtn}>✕</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {searchMode === 'semantic' && rewriteAvailable ? (
        <TouchableOpacity onPress={onRewriteQuery} style={styles.rewriteBtn} disabled={rewriting} activeOpacity={0.7}>
          {rewriting
            ? <ActivityIndicator size="small" color="#0A84FF" />
            : <Text style={styles.rewriteText}>✨ {t('search.rewriteBtn', { defaultValue: '润色' })}</Text>}
        </TouchableOpacity>
      ) : <View style={styles.rewriteBtn} />}
    </View>
  );

  const renderModeRow = () => (
    <View style={styles.modeRow}>
      {[
        { key: 'keyword', label: t('search.modeKeyword', { defaultValue: '默认搜索' }) },
        { key: 'semantic', label: t('search.modeSemantic', { defaultValue: 'AI 搜索' }) },
      ].map((m) => (
        <TouchableOpacity
          key={m.key}
          onPress={() => onSwitchMode(m.key)}
          style={[styles.modeChip, searchMode === m.key && styles.modeChipOn]}
          activeOpacity={0.8}
        >
          <Text style={[styles.modeChipText, searchMode === m.key && styles.modeChipTextOn]}>{m.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderEmptyHint = () => {
    const isSemantic = searchMode === 'semantic';
    const examples = isSemantic ? SEMANTIC_EXAMPLES : KEYWORD_EXAMPLES;
    return (
      <View style={styles.center}>
        <Text style={styles.bigIcon}>🔍</Text>
        <Text style={styles.emptyText}>
          {isSemantic
            ? t('search.semanticEmptyTip', { defaultValue: '像说话一样描述想找的画面，试试：' })
            : t('search.emptyTip', { defaultValue: '输入关键词搜照片和视频，试试：' })}
        </Text>
        <View style={styles.exampleWrap}>
          {examples.map((ex) => (
            <TouchableOpacity key={ex} style={styles.exampleChip} onPress={() => { setQuery(ex); runSearch(ex); }} activeOpacity={0.8}>
              <Text style={styles.exampleChipText}>{ex}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.dimsText}>
          {isSemantic
            ? t('search.semanticDimsTip', { defaultValue: '按 AI 描述的语义匹配（多模态档分类过的内容效果最佳）' })
            : t('search.dimsTip', { defaultValue: '支持：AI 描述 · 分类 · 城市 · 时间 · 格式 · 分辨率 · 方向 · 拍摄参数 · 目录 · 大小' })}
        </Text>
      </View>
    );
  };

  const renderViewer = () => {
    if (viewer == null) return null;
    const cur = results[viewer.index];
    if (!cur) return null;
    const uri = getUri(cur) || cur?.uri;
    const isVideo = isVideoRecord(cur);
    const hasPrev = viewer.index > 0;
    const hasNext = viewer.index < results.length - 1;
    return (
      <Modal visible transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <View style={styles.viewerRoot}>
          <View style={styles.viewerHeader}>
            <Text style={styles.viewerCount}>{viewer.index + 1} / {results.length}</Text>
            <TouchableOpacity onPress={() => setViewer(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.viewerClose}>{t('common.close', { defaultValue: '关闭' })}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.viewerBody}>
            <TouchableOpacity
              style={[styles.navBtn, !hasPrev && styles.navBtnDisabled]}
              disabled={!hasPrev}
              onPress={() => setViewer({ index: viewer.index - 1 })}
              activeOpacity={0.7}
            >
              <Text style={styles.navArrow}>‹</Text>
            </TouchableOpacity>
            <View style={styles.viewerStage}>
              {isVideo && Platform.OS === 'web'
                ? React.createElement('video', {
                    src: uri,
                    controls: true,
                    autoPlay: true,
                    style: { maxWidth: '100%', maxHeight: '100%', borderRadius: 8, backgroundColor: '#000' },
                  })
                : <Image source={{ uri }} style={styles.viewerImage} resizeMode="contain" />}
            </View>
            <TouchableOpacity
              style={[styles.navBtn, !hasNext && styles.navBtnDisabled]}
              disabled={!hasNext}
              onPress={() => setViewer({ index: viewer.index + 1 })}
              activeOpacity={0.7}
            >
              <Text style={styles.navArrow}>›</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  };

  return (
    <View style={styles.container}>
      {renderHeader()}
      {renderModeRow()}

      {/* 未打标提示 */}
      {searched && untaggedCount > 0 ? (
        <View style={styles.hint}>
          <Text style={styles.hintText}>
            {t('search.untaggedHint', { count: untaggedCount, defaultValue: `还有 ${untaggedCount} 张图未打 AI 描述，用「多模态」档分类后才能被描述搜索到` })}
          </Text>
        </View>
      ) : null}

      {searching ? (
        <View style={styles.center}><ActivityIndicator size="large" color="#0A84FF" /></View>
      ) : !query.trim() ? (
        renderEmptyHint()
      ) : results.length === 0 && searched ? (
        <View style={styles.center}>
          <Text style={styles.bigIcon}>🖼️</Text>
          <Text style={styles.emptyText}>
            {t('search.noResults', { query, defaultValue: `没找到与「${query}」匹配的图` })}
          </Text>
        </View>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {results.length > 0 ? (
            <Text style={styles.countText}>
              {t('search.resultCount', { count: results.length, defaultValue: `${results.length} 张结果` })}
            </Text>
          ) : null}
          <View style={styles.grid}>
            {results.map((item, index) => {
              const uri = getUri(item) || item?.uri;
              return (
                <TouchableOpacity
                  key={item.id || index}
                  style={styles.cell}
                  activeOpacity={0.85}
                  onPress={() => setViewer({ index })}
                >
                  <Image source={{ uri }} style={styles.cellImg} resizeMode="cover" />
                  {isVideoRecord(item) ? (
                    <View style={styles.videoBadge} pointerEvents="none">
                      <Text style={styles.videoBadgeText}>▶{formatDuration(item.duration) ? ` ${formatDuration(item.duration)}` : ''}</Text>
                    </View>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      )}

      {renderViewer()}
    </View>
  );
};

const CELL = 150;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F3F7' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E0E1E6',
  },
  backBtn: { width: 70, justifyContent: 'center' },
  backText: { fontSize: 16, color: '#0A84FF', fontWeight: '500' },
  searchBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#EFEFF4', borderRadius: 10, paddingHorizontal: 12, height: 40,
  },
  searchIcon: { fontSize: 15, marginRight: 6 },
  searchInput: { flex: 1, fontSize: 16, color: '#1C1C1E', padding: 0, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) },
  clearBtn: { fontSize: 14, color: '#9AA0A6', paddingHorizontal: 4 },
  rewriteBtn: { width: 78, alignItems: 'flex-end', justifyContent: 'center', paddingLeft: 8 },
  rewriteText: { fontSize: 14, color: '#0A84FF', fontWeight: '600' },
  modeRow: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: '#FFFFFF', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E0E1E6',
  },
  modeChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 15, backgroundColor: 'rgba(120,120,128,0.12)' },
  modeChipOn: { backgroundColor: '#0A84FF' },
  modeChipText: { fontSize: 13, fontWeight: '600', color: '#6C6C70' },
  modeChipTextOn: { color: '#FFFFFF' },
  hint: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#FFF8E1' },
  hintText: { fontSize: 12.5, lineHeight: 17, color: '#8A6D00' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  bigIcon: { fontSize: 48, marginBottom: 14 },
  emptyText: { fontSize: 15, color: '#636366', textAlign: 'center', lineHeight: 22, maxWidth: 420 },
  exampleWrap: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 16, maxWidth: 440 },
  exampleChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  exampleChipText: { fontSize: 14, fontWeight: '600', color: '#0A84FF' },
  dimsText: { marginTop: 18, fontSize: 12.5, color: '#9AA0A6', textAlign: 'center', lineHeight: 18, maxWidth: 440 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16 },
  countText: { fontSize: 13, color: '#636366', marginBottom: 10, marginLeft: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: CELL, height: CELL, margin: 4, borderRadius: 8, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.05)' },
  cellImg: { width: '100%', height: '100%' },
  videoBadge: { position: 'absolute', right: 6, bottom: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.6)' },
  videoBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  // 大图 viewer
  viewerRoot: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)' },
  viewerHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  viewerCount: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  viewerClose: { fontSize: 16, fontWeight: '600', color: '#0A84FF' },
  viewerBody: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  viewerStage: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12 },
  viewerImage: { width: '100%', height: '100%' },
  navBtn: { width: 64, alignItems: 'center', justifyContent: 'center', height: '100%' },
  navBtnDisabled: { opacity: 0.25 },
  navArrow: { fontSize: 48, color: '#FFFFFF', fontWeight: '300' },
});

export default SearchScreen;
