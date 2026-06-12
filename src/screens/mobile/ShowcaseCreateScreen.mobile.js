/**
 * ShowcaseCreateScreen ——「生成时刻秀」配置页
 *
 * route.params: { images: [...] }（多选入口传入）
 * 配置：名称（可✨润色存描述）、播放模式（淡入/平移/缩放/直切）、单图时长（2/3/5s）。
 * 保存 → showcases 表 → 「时刻」Tab 的时刻秀区（按创建时间倒序）。
 * 背景乐为 Phase A2（需音频播放+文件选择原生依赖，另批接入）。
 */
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, Image, ScrollView,
  ActivityIndicator, StyleSheet, Alert,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView, Icon, getUri, logger, RNFS } from '../../adapters/WebAdapters';
import UnifiedDataService from '../../services/UnifiedDataService';
import { useIosColors } from '../../ui/ios/theme';

const MODES = [
  { key: 'fade', zh: '淡入', en: 'Fade' },
  { key: 'slide', zh: '平移', en: 'Slide' },
  { key: 'zoom', zh: '缩放', en: 'Zoom' },
  { key: 'none', zh: '直切', en: 'Cut' },
];
const INTERVALS = [2, 3, 5];

export default function ShowcaseCreateScreen({ navigation, route }) {
  const { t, i18n } = useTranslation('common');
  const c = useIosColors();
  const isEn = String(i18n?.language || '').startsWith('en');
  const images = Array.isArray(route?.params?.images) ? route.params.images : [];

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState('fade');
  const [interval, setIntervalSec] = useState(3);
  const [polishing, setPolishing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [musicPath, setMusicPath] = useState('');
  const [musicName, setMusicName] = useState('');

  /** 选本地音乐：文件选择器 → 拷贝到应用目录（持久可读，原路径授权会过期） */
  const pickMusic = async () => {
    try {
      const DocumentPicker = require('react-native-document-picker').default;
      const res = await DocumentPicker.pickSingle({ type: [DocumentPicker.types.audio], copyTo: 'documentDirectory' });
      const src = res.fileCopyUri || res.uri;
      if (!src) return;
      const dir = `${RNFS.DocumentDirectoryPath}/showcase-music`;
      try { await RNFS.mkdir(dir); } catch (_) {}
      const safeName = String(res.name || `music_${Date.now()}.mp3`).replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_');
      const dest = `${dir}/${Date.now()}_${safeName}`;
      await RNFS.copyFile(src.replace(/^file:\/\//, ''), dest);
      setMusicPath(dest);
      setMusicName(res.name || safeName);
    } catch (e) {
      const DocumentPicker = require('react-native-document-picker').default;
      if (DocumentPicker.isCancel && DocumentPicker.isCancel(e)) return;
      logger.warn('选音乐失败:', e?.message || e);
      Alert.alert(t('common.tip', { defaultValue: '提示' }), e?.message || t('showcase.musicPickFailed', { defaultValue: '选择音乐失败' }));
    }
  };

  /** ✨润色：把名字扩写成一句温暖描述（云端 LLM，已配置时可用） */
  const polish = async () => {
    const n = name.trim();
    if (!n || polishing) return;
    setPolishing(true);
    try {
      const { isRewriteAvailable, rewriteSearchQuery } = require('../../services/llm/queryRewrite');
      if (!(await isRewriteAvailable())) {
        Alert.alert(t('common.tip', { defaultValue: '提示' }), t('showcase.polishNeedCloud', { defaultValue: '润色需要先在设置中配置在线大模型' }));
        return;
      }
      // 复用改写链路，提示词换成"扩写成相册描述"
      const { LLMProviderService } = require('../../services/llm/LLMProviderService.js');
      const cfgSvc = require('../../services/llm/adapters/UnifiedDataConfigService.js').default;
      const keyStore = require('../../services/llm/keyStoreSingleton.js').default;
      const svc = new LLMProviderService({ configService: cfgSvc, keyStore });
      const provider = await svc.getActiveProvider();
      const TINY = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=';
      const prompt = '忽略附带的占位图片。用户给一组照片的放映集起了名字，请基于名字扩写一句 20~40 字的温暖简体中文描述（适合做相册副标题）。只输出描述本身，不要解释或引号。\n\n名字：' + n;
      const r = await provider.classify(TINY, prompt);
      const text = String((r && (r.rawText || r.text)) || '').trim().replace(/^["'「『]+|["'」』]+$/g, '').split('\n')[0].trim();
      if (text) setDescription(text);
    } catch (e) {
      logger.warn('润色失败:', e?.message || e);
      Alert.alert(t('common.tip', { defaultValue: '提示' }), e?.message || t('search.rewriteFailed', { defaultValue: '改写失败' }));
    } finally {
      setPolishing(false);
    }
  };

  const save = async () => {
    const n = name.trim();
    if (!n) {
      Alert.alert(t('common.tip', { defaultValue: '提示' }), t('showcase.nameRequired', { defaultValue: '给这组时刻起个名字吧' }));
      return;
    }
    if (images.length === 0) return;
    setSaving(true);
    try {
      const ok = await UnifiedDataService.imageStorageService.saveShowcase({
        id: `sc_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
        name: n,
        description: description.trim(),
        imageIds: images.map((i) => i.id),
        mode,
        interval,
        musicPath,
        createdAt: new Date().toISOString(),
      });
      if (!ok) throw new Error(t('showcase.saveFailed', { defaultValue: '保存失败' }));
      // 回到时刻 Tab 看成品
      navigation.navigate('MainTabs', { screen: 'Moments' });
    } catch (e) {
      Alert.alert(t('settings.operationFailed', { defaultValue: '操作失败' }), e?.message || '');
    } finally {
      setSaving(false);
    }
  };

  const Chip = ({ active, label, onPress }) => (
    <TouchableOpacity
      style={[styles.chip, { backgroundColor: active ? (c.accent || '#007AFF') : 'rgba(120,120,128,0.12)' }]}
      onPress={onPress}
    >
      <Text style={[styles.chipText, { color: active ? '#FFFFFF' : (c.secondaryLabel || '#6C6C70') }]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.groupedBg || '#F2F2F7' }]}>
      <View style={[styles.header, { backgroundColor: c.card, borderBottomColor: c.separator }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Icon name="arrow-back-ios" size={20} color={c.accent || '#007AFF'} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: c.label }]}>{t('showcase.createTitle', { defaultValue: '生成时刻秀' })}</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40 }}>
        {/* 预览条 */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
          {images.slice(0, 12).map((img) => (
            <Image key={img.id} source={{ uri: getUri(img) || img.uri }} style={styles.thumb} />
          ))}
          {images.length > 12 ? (
            <View style={[styles.thumb, styles.thumbMore, { backgroundColor: c.card }]}>
              <Text style={{ color: c.secondaryLabel, fontWeight: '700' }}>+{images.length - 12}</Text>
            </View>
          ) : null}
        </ScrollView>
        <Text style={[styles.countText, { color: c.tertiaryLabel }]}>
          {t('showcase.photoCount', { count: images.length, defaultValue: `共 ${images.length} 项（视频在放映时跳过）` })}
        </Text>

        {/* 名称 + 润色 */}
        <Text style={[styles.label, { color: c.label }]}>{t('showcase.nameLabel', { defaultValue: '名称' })}</Text>
        <View style={styles.nameRow}>
          <TextInput
            style={[styles.input, { backgroundColor: c.card, color: c.label }]}
            value={name}
            onChangeText={setName}
            placeholder={t('showcase.namePlaceholder', { defaultValue: '如：宝宝的夏天、毕业旅行…' })}
            placeholderTextColor={c.tertiaryLabel}
            maxLength={30}
          />
          <TouchableOpacity onPress={polish} disabled={polishing || !name.trim()} style={styles.polishBtn} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
            {polishing
              ? <ActivityIndicator size="small" color={c.accent || '#007AFF'} />
              : <Icon name="auto-fix-high" size={22} color={name.trim() ? (c.accent || '#007AFF') : c.tertiaryLabel} />}
          </TouchableOpacity>
        </View>

        {/* 描述（润色结果可改） */}
        <Text style={[styles.label, { color: c.label }]}>{t('showcase.descLabel', { defaultValue: '描述（可选，✨可按名字生成）' })}</Text>
        <TextInput
          style={[styles.input, styles.descInput, { backgroundColor: c.card, color: c.label }]}
          value={description}
          onChangeText={setDescription}
          placeholder={t('showcase.descPlaceholder', { defaultValue: '一句话描述这组时刻…' })}
          placeholderTextColor={c.tertiaryLabel}
          multiline
          maxLength={80}
        />

        {/* 播放模式 */}
        <Text style={[styles.label, { color: c.label }]}>{t('showcase.modeLabel', { defaultValue: '播放模式' })}</Text>
        <View style={styles.chipRow}>
          {MODES.map((m) => (
            <Chip key={m.key} active={mode === m.key} label={isEn ? m.en : m.zh} onPress={() => setMode(m.key)} />
          ))}
        </View>

        {/* 单图时长 */}
        <Text style={[styles.label, { color: c.label }]}>{t('showcase.intervalLabel', { defaultValue: '单图时长' })}</Text>
        <View style={styles.chipRow}>
          {INTERVALS.map((sec) => (
            <Chip key={sec} active={interval === sec} label={`${sec}s`} onPress={() => setIntervalSec(sec)} />
          ))}
        </View>

        {/* 背景乐：本地音频文件（不接系统音乐库——DRM 曲目读不出来） */}
        <Text style={[styles.label, { color: c.label }]}>{t('showcase.musicLabel', { defaultValue: '背景音乐（可选）' })}</Text>
        <View style={styles.nameRow}>
          <TouchableOpacity style={[styles.input, styles.musicBtn, { backgroundColor: c.card }]} onPress={pickMusic}>
            <Text style={{ color: musicName ? c.label : c.tertiaryLabel, fontSize: 15 }} numberOfLines={1}>
              {musicName || t('showcase.musicPick', { defaultValue: '🎵 选择本地音乐文件…' })}
            </Text>
          </TouchableOpacity>
          {musicPath ? (
            <TouchableOpacity onPress={() => { setMusicPath(''); setMusicName(''); }} style={styles.polishBtn} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
              <Icon name="close" size={20} color={c.secondaryLabel} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* 保存 */}
        <TouchableOpacity
          style={[styles.saveBtn, { backgroundColor: saving ? 'rgba(0,122,255,0.5)' : (c.accent || '#007AFF') }]}
          onPress={save}
          disabled={saving}
        >
          <Text style={styles.saveText}>
            {saving ? t('common.processing', { defaultValue: '处理中…' }) : t('showcase.saveBtn', { defaultValue: '保存到「时刻」' })}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { width: 36 },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600' },
  thumb: { width: 64, height: 64, borderRadius: 8, marginRight: 6, backgroundColor: 'rgba(0,0,0,0.05)' },
  thumbMore: { alignItems: 'center', justifyContent: 'center' },
  countText: { fontSize: 12, marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '600', marginTop: 12, marginBottom: 8 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  descInput: { minHeight: 60, textAlignVertical: 'top' },
  polishBtn: { padding: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 16 },
  chipText: { fontSize: 14, fontWeight: '600' },
  musicBtn: { justifyContent: 'center' },
  saveBtn: { marginTop: 22, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  saveText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
