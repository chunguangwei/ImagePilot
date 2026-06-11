/**
 * SearchScreen —— 按描述/关键词搜图
 *
 * 输入关键词 → UnifiedDataService.searchImages 匹配 AI 描述(message)+分类名+文件名+城市。
 * 「语义搜索」靠多模态档(Gemma)写的 AI 描述；未打描述的图会提示用户去分类。
 * 结果网格复用图片项（视频带 ▶ 角标，点击调系统播放器；图片进预览）。
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, Image,
  ActivityIndicator, StyleSheet, NativeModules, Keyboard, Platform, Alert,
  useWindowDimensions,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView, Icon, getUri, logger } from '../../adapters/WebAdapters';
import UnifiedDataService from '../../services/UnifiedDataService';
import { useIosColors } from '../../ui/ios/theme';
import { formatDuration } from '../../components/shared/categoryUI';

const GRID_COLUMNS = 3;
const GRID_PADDING = 8;
const GRID_GAP = 2;

function isVideoRecord(img) {
  return String(img?.mimeType || '').startsWith('video/');
}

export default function SearchScreen({ navigation, route }) {
  const { t } = useTranslation('common');
  const c = useIosColors();
  const { width: winW } = useWindowDimensions();
  const itemSize = (winW - GRID_PADDING * 2 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;

  // 以图搜图模式：从预览页「找相似」进入，带目标图记录；隐藏文字输入。
  // similarMode: 'color'=颜色直方图（长得像） | 'vector'=CLIP 向量（内容像）
  const similarTo = route?.params?.similarTo || null;
  const similarMode = route?.params?.similarMode || 'color';

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [untaggedCount, setUntaggedCount] = useState(0);
  const [indexedCount, setIndexedCount] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  // AI 搜图：选一张图 → 本地/云模型打分类+描述 → 与库中分类/描述比相似度（语义级，含视频）
  const [aiTarget, setAiTarget] = useState(null);          // { uri }
  const [aiPhase, setAiPhase] = useState('');              // 'classifying' | 'matching' | ''
  const debounceRef = useRef(null);

  /** 用指定引擎给目标图打分类+描述，然后做语义比对 */
  const runAISearch = async (pickedUri, forceLocal) => {
    setAiTarget({ uri: pickedUri });
    setSearching(true);
    setSearched(false);
    try {
      setAiPhase('classifying');
      let cat = null; let desc = '';
      if (forceLocal) {
        const { classifyImageByTier, readActiveTier } = require('../../services/classify/classifyByTier');
        const ImageClassifierService = require('../../services/ImageClassifierService').default;
        const classifier = new ImageClassifierService();
        await classifier.initialize();
        const tier = await readActiveTier();
        const r = await classifyImageByTier(pickedUri, tier, { imageClassifier: classifier });
        cat = r?.topPrediction?.appCategory || null;
        desc = r?.vlmLabel || '';
      } else {
        // 云端：压缩 → base64 → 单图批量调 orchestrator（与扫描云端分类同链路）
        const aiProviderConfigService = (await import('../../services/llm/adapters/UnifiedDataConfigService')).default;
        const aiCfg = await aiProviderConfigService.getAIProviderConfig();
        const ImageProcessor = require('../../services/ImageProcessor').default;
        const { RNFS } = require('../../adapters/WebAdapters');
        const resized = await ImageProcessor.resizeImage(pickedUri, 768, 768, { maintainAspectRatio: true, outputFormat: 'jpeg', quality: 85 });
        const localPath = String(resized?.uri || '').replace(/^file:\/\//, '');
        const base64 = await RNFS.readFile(localPath, 'base64');
        const { classifyCloudBatchV2 } = await import('../../services/llm/llmClassifyOrchestrator.js');
        const out = await classifyCloudBatchV2({
          imageClassifier: null, platform: Platform.OS,
          inputs: [{ id: 'ai-search-target', imageBase64: base64 }],
          validResults: [{ imageData: { id: 'ai-search-target', uri: pickedUri }, hash: 'ai-search-target' }],
          aiCfg,
        });
        const item = (out?.items || [])[0];
        if (item && item.success && item.data) {
          cat = item.data.category || null;
          desc = item.data.description || '';
        }
      }
      // 把识别结果亮给用户（搜不到时能看出是识别错了还是库里确实没有）
      let catName = '';
      try {
        const nameMap = require('../../services/ConfigService').default.getCategoryNameMap() || {};
        catName = (cat && nameMap[cat] && (nameMap[cat].chinese || nameMap[cat].english)) || cat || '';
      } catch (_) { catName = cat || ''; }
      setAiTarget({ uri: pickedUri, catName, desc });

      setAiPhase('matching');
      // 三路融合：语义（分类+描述）｜颜色（直方图，同图必命中）｜CLIP 向量（已建索引时，内容级最准）
      const [semantic, visual, vector] = await Promise.all([
        (cat || desc)
          ? UnifiedDataService.searchByAISemantics({ category: cat, desc })
          : Promise.resolve({ results: [] }),
        UnifiedDataService.searchSimilarImages({ uri: pickedUri }, { limit: 40, minScore: 0.5 }).catch(() => ({ results: [] })),
        (async () => {
          try {
            const svc = require('../../services/ClipVectorIndexService').default;
            if (!(await svc.isReady())) return { results: [] };
            const stats = await svc.getIndexStats();
            if (!stats.indexed) return { results: [] };
            return await svc.search({ uri: pickedUri }, { limit: 40 });
          } catch (_) { return { results: [] }; }
        })(),
      ]);
      const byId = new Map();
      for (const v of (vector.results || [])) {
        byId.set(v.id, { ...v, aiScore: Math.max(0.65, v.vectorScore || 0) });   // 向量命中权重最高
      }
      for (const v of (visual.results || [])) {
        const prev = byId.get(v.id);
        const score = Math.max(0.6, v.similarScore || 0);   // 视觉命中至少与同分类持平
        if (prev) { prev.aiScore = Math.max(prev.aiScore, score); }
        else { byId.set(v.id, { ...v, aiScore: score }); }
      }
      for (const s of (semantic.results || [])) {
        const prev = byId.get(s.id);
        if (prev) { prev.aiScore = Math.max(prev.aiScore, s.aiScore); }
        else { byId.set(s.id, s); }
      }
      const merged = Array.from(byId.values()).sort((a, b) => b.aiScore - a.aiScore || ((b.takenAt || 0) - (a.takenAt || 0)));
      setResults(merged.slice(0, 80));
      setSearched(true);
    } catch (e) {
      logger.warn('AI 搜图失败:', e?.message || e);
      Alert.alert(t('common.tip', { defaultValue: '提示' }), e?.message || 'AI 搜图失败');
      setAiTarget(null);
    } finally {
      setAiPhase('');
      setSearching(false);
    }
  };

  /** AI 搜图入口：选图 → （已配云端时可选引擎）→ runAISearch */
  const onPressAISearch = async () => {
    try {
      const { launchImageLibrary } = require('react-native-image-picker');
      const res = await launchImageLibrary({ mediaType: 'photo', selectionLimit: 1, quality: 0.92 });
      const asset = res && res.assets && res.assets[0];
      if (!asset || !asset.uri) return;
      let isLLMConfigured = false;
      try {
        const aiProviderConfigService = (await import('../../services/llm/adapters/UnifiedDataConfigService')).default;
        const aiCfg = await aiProviderConfigService.getAIProviderConfig();
        isLLMConfigured = !!(aiCfg && aiCfg.active && aiCfg.active !== 'local-onnx');
      } catch (_) {}
      if (isLLMConfigured) {
        Alert.alert(
          t('search.aiSearchTitle', { defaultValue: 'AI 搜图' }),
          t('search.aiSearchEngineAsk', { defaultValue: '用哪种引擎识别这张图？' }),
          [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('home.aiClassifyUseLocal', { defaultValue: '离线识别' }), onPress: () => runAISearch(asset.uri, true) },
            { text: t('home.aiClassifyUseCloud', { defaultValue: '云端识别' }), onPress: () => runAISearch(asset.uri, false) },
          ]
        );
      } else {
        runAISearch(asset.uri, true);
      }
    } catch (e) {
      logger.warn('选图失败:', e?.message || e);
    }
  };

  // CLIP 向量检索状态
  const [vecStats, setVecStats] = useState(null);       // { indexed, total }
  const [vecBuilding, setVecBuilding] = useState(false);
  const [vecError, setVecError] = useState('');

  const runVectorSearch = async () => {
    setSearching(true); setSearched(false); setVecError('');
    try {
      const svc = require('../../services/ClipVectorIndexService').default;
      const stats = await svc.getIndexStats();
      setVecStats(stats);
      const r = await svc.search(similarTo);
      setResults(r.results || []);
      setSearched(true);
    } catch (e) {
      logger.warn('向量检索失败:', e?.message || e);
      setVecError(e?.message || '向量检索失败');
      setResults([]); setSearched(true);
    } finally {
      setSearching(false);
    }
  };

  const buildVectorIndex = async () => {
    if (vecBuilding) return;
    setVecBuilding(true);
    try {
      const svc = require('../../services/ClipVectorIndexService').default;
      await svc.buildIndex((done, total) => setVecStats({ indexed: done, total }));
      await runVectorSearch();
    } catch (e) {
      Alert.alert(t('common.tip', { defaultValue: '提示' }), e?.message || '建索引失败');
    } finally {
      setVecBuilding(false);
    }
  };

  // 以图搜图：进入即查（颜色=特征索引毫秒级；向量=CLIP 编码目标图一次+点积）
  useEffect(() => {
    if (!similarTo) return;
    if (similarMode === 'vector') { runVectorSearch(); return; }
    (async () => {
      setSearching(true);
      try {
        const r = await UnifiedDataService.searchSimilarImages(similarTo);
        setResults(r.results || []);
        setIndexedCount(r.indexedCount || 0);
        setSearched(true);
      } catch (e) {
        logger.warn('以图搜图失败:', e?.message || e);
        setResults([]); setSearched(true);
      } finally {
        setSearching(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 文字搜索两种模式：关键字（子串精确匹配）/ 语义（bigram 包含度，写"狗在草地跑"能命中相近描述）
  const [searchMode, setSearchMode] = useState('keyword');

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
    // 相似度角标：向量/颜色/AI 搜图模式下显示"像的程度"（百分比）
    const score = item.vectorScore ?? item.similarScore ?? item.aiScore;
    const showScore = (similarTo || aiTarget) && typeof score === 'number';
    return (
      <TouchableOpacity
        style={{ width: itemSize, height: itemSize, marginRight: (index % GRID_COLUMNS === GRID_COLUMNS - 1) ? 0 : GRID_GAP, marginBottom: GRID_GAP }}
        activeOpacity={0.8}
        onPress={() => onPressItem(item, index)}
      >
        <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
        {showScore && (
          <View style={styles.scoreBadge} pointerEvents="none">
            <Text style={styles.scoreBadgeText}>{Math.round(Math.min(1, score) * 100)}%</Text>
          </View>
        )}
        {isVideoRecord(item) && (
          <View style={[styles.videoBadge, formatDuration(item.duration) ? styles.videoBadgeWide : null]} pointerEvents="none">
            <Text style={styles.videoBadgeIcon}>
              {'▶'}{formatDuration(item.duration) ? ` ${formatDuration(item.duration)}` : ''}
            </Text>
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
        {similarTo ? (
          // 以图搜图模式：目标图缩略图 + 标题（无输入框）
          <View style={[styles.searchBox, { backgroundColor: c.groupedBg || '#EFEFF4' }]}>
            <Image source={{ uri: getUri(similarTo) || similarTo?.uri }} style={styles.similarTargetThumb} />
            <Text style={[styles.similarTitle, { color: c.label }]} numberOfLines={1}>
              {similarMode === 'vector'
                ? (t('search.similarTitleVector', { defaultValue: 'AI 相似（内容语义）' }))
                : (t('search.similarTitleColor', { defaultValue: '颜色相似（构图/色调）' }))}
            </Text>
          </View>
        ) : aiTarget ? (
          // AI 搜图模式：目标图缩略图 + 标题 + 关闭（回文字搜索）
          <View style={[styles.searchBox, { backgroundColor: c.groupedBg || '#EFEFF4' }]}>
            <Image source={{ uri: aiTarget.uri }} style={styles.similarTargetThumb} />
            <Text style={[styles.similarTitle, { color: c.label }]} numberOfLines={1}>
              {t('search.aiSearchTitle', { defaultValue: 'AI 搜图' })}
            </Text>
            <TouchableOpacity onPress={() => { setAiTarget(null); setResults([]); setSearched(false); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="close" size={18} color={c.tertiaryLabel || '#9aa0a6'} />
            </TouchableOpacity>
          </View>
        ) : (
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
        )}
        {/* AI 搜图入口：选一张图 → AI 识别 → 按分类+描述语义找相似（文字搜索模式下显示） */}
        {!similarTo && !aiTarget && (
          <TouchableOpacity onPress={onPressAISearch} style={styles.aiSearchBtn} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
            <Icon name="image-search" size={22} color={c.accent || '#007AFF'} />
          </TouchableOpacity>
        )}
      </View>

      {/* 关键字 / 语义 模式切换（文字搜索时显示） */}
      {!similarTo && !aiTarget && (
        <View style={[styles.modeRow, { backgroundColor: c.card, borderBottomColor: c.separator }]}>
          {[
            { key: 'keyword', label: t('search.modeKeyword', { defaultValue: '默认搜索' }) },
            { key: 'semantic', label: t('search.modeSemantic', { defaultValue: 'AI 搜索' }) },
          ].map((m) => (
            <TouchableOpacity
              key={m.key}
              onPress={() => { setSearchMode(m.key); if (query.trim()) runSearch(query, m.key); }}
              style={[styles.modeChip, searchMode === m.key && { backgroundColor: c.accent || '#007AFF' }]}
            >
              <Text style={[styles.modeChipText, { color: searchMode === m.key ? '#FFFFFF' : (c.secondaryLabel || '#6C6C70') }]}>
                {m.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* AI 搜图：亮出识别结果（搜不到时能看出是识别错了还是库里没有） */}
      {aiTarget && (aiTarget.catName || aiTarget.desc) ? (
        <View style={[styles.hint, { backgroundColor: c.card }]}>
          <Icon name="info-outline" size={15} color={c.tertiaryLabel || '#9aa0a6'} />
          <Text style={[styles.hintText, { color: c.secondaryLabel || '#6C6C70' }]} numberOfLines={2}>
            {t('search.aiRecognizedAs', { defaultValue: 'AI 识别' })}：{aiTarget.catName}{aiTarget.desc ? ` · ${aiTarget.desc}` : ''}
          </Text>
        </View>
      ) : null}

      {/* 向量索引不全提示：可点击补建（增量，只编码新图） */}
      {similarTo && similarMode === 'vector' && vecStats && vecStats.total > vecStats.indexed && results.length > 0 ? (
        <TouchableOpacity style={[styles.hint, { backgroundColor: c.card }]} onPress={buildVectorIndex} disabled={vecBuilding}>
          <Icon name="info-outline" size={15} color={c.tertiaryLabel || '#9aa0a6'} />
          <Text style={[styles.hintText, { color: c.secondaryLabel || '#6C6C70' }]}>
            {vecBuilding
              ? t('search.vectorBuilding', { done: vecStats.indexed, total: vecStats.total, defaultValue: `建索引中 ${vecStats.indexed}/${vecStats.total}…` })
              : t('search.vectorPartialIndex', { indexed: vecStats.indexed, total: vecStats.total, defaultValue: `向量索引 ${vecStats.indexed}/${vecStats.total}，点此补全（覆盖更多图）` })}
          </Text>
        </TouchableOpacity>
      ) : null}

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
        <View style={styles.center}>
          <ActivityIndicator color={c.accent || '#007AFF'} />
          {aiPhase ? (
            <Text style={[styles.emptyText, { color: c.secondaryLabel }]}>
              {aiPhase === 'classifying'
                ? t('search.aiSearchClassifying', { defaultValue: 'AI 识别图片中…（多模态档较慢）' })
                : t('search.aiSearchMatching', { defaultValue: '正在比对相似内容…' })}
            </Text>
          ) : null}
        </View>
      ) : aiTarget && results.length === 0 && searched ? (
        <View style={styles.center}>
          <Icon name="image-search" size={48} color={c.tertiaryLabel || '#C7C7CC'} />
          <Text style={[styles.emptyText, { color: c.secondaryLabel }]}>
            {t('search.aiSearchNoResults', { defaultValue: '没有找到语义相近的内容（库里同类/相近描述的图越多，效果越好）' })}
          </Text>
        </View>
      ) : similarTo && results.length === 0 && searched ? (
        <View style={styles.center}>
          <Icon name="image-search" size={48} color={c.tertiaryLabel || '#C7C7CC'} />
          {similarMode === 'vector' ? (
            <>
              <Text style={[styles.emptyText, { color: c.secondaryLabel }]}>
                {vecError
                  ? vecError
                  : (vecStats && vecStats.indexed === 0)
                    ? t('search.vectorNoIndex', { defaultValue: '还没有 AI 向量索引：点下方按钮建立（每张图约 0.1~0.3 秒，仅需一次）' })
                    : t('search.similarNoResults', { defaultValue: '没有找到相似的照片' })}
              </Text>
              {!vecError && (
                <TouchableOpacity
                  onPress={buildVectorIndex}
                  disabled={vecBuilding}
                  style={[styles.modeChip, { marginTop: 14, backgroundColor: c.accent || '#007AFF', paddingHorizontal: 16, paddingVertical: 8 }]}
                >
                  <Text style={[styles.modeChipText, { color: '#FFFFFF' }]}>
                    {vecBuilding
                      ? t('search.vectorBuilding', { done: vecStats?.indexed || 0, total: vecStats?.total || 0, defaultValue: `建索引中 ${vecStats?.indexed || 0}/${vecStats?.total || 0}…` })
                      : t('search.vectorBuildBtn', { defaultValue: '建立 AI 向量索引' })}
                  </Text>
                </TouchableOpacity>
              )}
            </>
          ) : (
            <Text style={[styles.emptyText, { color: c.secondaryLabel }]}>
              {indexedCount === 0
                ? t('search.similarNoIndex', { defaultValue: '还没有建立特征索引：在首页「相似照片」里跑一次「重新检测」后即可以图搜图' })
                : t('search.similarNoResults', { defaultValue: '没有找到相似的照片' })}
            </Text>
          )}
        </View>
      ) : !similarTo && !query.trim() ? (
        <View style={styles.center} onStartShouldSetResponder={() => { Keyboard.dismiss(); return false; }}>
          <Icon name="search" size={48} color={c.tertiaryLabel || '#C7C7CC'} />
          {searchMode === 'semantic' ? (
            <>
              {/* AI 搜索（语义）：像说话一样描述画面，与关键字维度不是一个逻辑 */}
              <Text style={[styles.emptyText, { color: c.secondaryLabel }]}>
                {t('search.semanticEmptyTip', { defaultValue: '像说话一样描述想找的画面，试试：' })}
              </Text>
              <View style={styles.exampleWrap}>
                {[
                  t('search.semanticEx1', { defaultValue: '海边日落' }),
                  t('search.semanticEx2', { defaultValue: '一群人聚餐' }),
                  t('search.semanticEx3', { defaultValue: '小狗在草地' }),
                ].map((ex) => (
                  <TouchableOpacity
                    key={ex}
                    style={[styles.exampleChip, { backgroundColor: c.card }]}
                    onPress={() => { setQuery(ex); runSearch(ex); }}
                  >
                    <Text style={[styles.exampleChipText, { color: c.accent || '#007AFF' }]}>{ex}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[styles.dimsText, { color: c.tertiaryLabel }]}>
                {t('search.semanticDimsTip', { defaultValue: '按 AI 描述的语义匹配（多模态档分类过的内容效果最佳）' })}
              </Text>
            </>
          ) : (
            <>
              <Text style={[styles.emptyText, { color: c.secondaryLabel }]}>
                {t('search.emptyTip', { defaultValue: '输入关键词搜照片和视频，试试：' })}
              </Text>
              {/* 可点的示例词：点一下直接搜（占位符放不下的"可搜维度"在这里展示） */}
              <View style={styles.exampleWrap}>
                {['2024', '5月', '视频', 'jpg', '4k', '横屏', '大文件'].map((ex) => (
                  <TouchableOpacity
                    key={ex}
                    style={[styles.exampleChip, { backgroundColor: c.card }]}
                    onPress={() => { setQuery(ex); runSearch(ex); }}
                  >
                    <Text style={[styles.exampleChipText, { color: c.accent || '#007AFF' }]}>{ex}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[styles.dimsText, { color: c.tertiaryLabel }]}>
                {t('search.dimsTip', { defaultValue: '支持：AI 描述 · 分类 · 城市 · 时间 · 格式 · 分辨率 · 方向 · 拍摄参数 · 目录 · 大小' })}
              </Text>
            </>
          )}
        </View>
      ) : !similarTo && results.length === 0 && searched ? (
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
  // 以图搜图模式头部
  similarTargetThumb: { width: 28, height: 28, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.06)' },
  similarTitle: { flex: 1, marginLeft: 8, fontSize: 15, fontWeight: '600' },
  // AI 搜图入口与模式切换
  aiSearchBtn: { paddingLeft: 10, paddingVertical: 6 },
  modeRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  modeChip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, backgroundColor: 'rgba(120,120,128,0.12)' },
  modeChipText: { fontSize: 13, fontWeight: '600' },
  hint: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  hintText: { flex: 1, fontSize: 12.5, lineHeight: 17 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { marginTop: 12, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  // 空态示例词（可点直搜）+ 维度说明
  exampleWrap: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 14, maxWidth: 320 },
  exampleChip: { paddingHorizontal: 13, paddingVertical: 6, borderRadius: 15 },
  exampleChipText: { fontSize: 13.5, fontWeight: '600' },
  dimsText: { marginTop: 16, fontSize: 12, textAlign: 'center', lineHeight: 18, maxWidth: 320 },
  countText: { fontSize: 12.5, marginBottom: 6, marginLeft: 2 },
  thumb: { width: '100%', height: '100%', borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.04)' },
  videoBadge: { position: 'absolute', right: 4, bottom: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  scoreBadge: { position: 'absolute', left: 4, top: 4, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 7, backgroundColor: 'rgba(0,0,0,0.55)' },
  scoreBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
  videoBadgeWide: { width: undefined, paddingHorizontal: 6 },
  videoBadgeIcon: { color: '#FFFFFF', fontSize: 11, marginLeft: 1 },
});
