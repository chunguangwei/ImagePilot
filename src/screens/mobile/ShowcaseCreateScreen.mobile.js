/**
 * ShowcaseCreateScreen ——「生成时刻秀」配置页
 *
 * route.params: { images: [...] }（多选入口传入）
 * 配置：名称（可✨润色存描述）、播放模式（淡入/平移/缩放/直切）、单图时长（2/3/5s）。
 * 保存 → showcases 表 → 「时刻」Tab 的时刻秀区（按创建时间倒序）。
 * 背景乐为 Phase A2（需音频播放+文件选择原生依赖，另批接入）。
 */
import React, { useState, useEffect, useRef } from 'react';
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
  { key: 'push', zh: '推入', en: 'Push' },
  { key: 'flip', zh: '翻转', en: 'Flip' },
  { key: 'spring', zh: '弹入', en: 'Bounce' },
  { key: 'rise', zh: '上浮', en: 'Rise' },
  { key: 'none', zh: '直切', en: 'Cut' },
];
const INTERVALS = [2, 3, 5];

export default function ShowcaseCreateScreen({ navigation, route }) {
  const { t, i18n } = useTranslation('common');
  const c = useIosColors();
  const isEn = String(i18n?.language || '').startsWith('en');
  // 编辑模式：route.params.editShowcase 为已有时刻秀记录（含解析后的 images + 各字段）
  // 用 ref 固定首帧捕获——加图选图器 navigate 回来会改写 route.params，
  // 若直接读 route.params 会丢 editShowcase 导致保存被当成「新建」而非覆盖原时刻。
  const editRef = useRef(route?.params?.editShowcase || null);
  const edit = editRef.current;
  const initialImages = edit?.images || (Array.isArray(route?.params?.images) ? route.params.images : []);

  const [imgs, setImgs] = useState(initialImages);
  const [coverId, setCoverId] = useState(edit?.coverId || '');
  const [name, setName] = useState(edit?.name || '');
  const [description, setDescription] = useState(edit?.description || '');
  const [mode, setMode] = useState(edit?.mode || 'fade');
  const [interval, setIntervalSec] = useState(edit?.interval || 3);
  const [polishing, setPolishing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [musicPath, setMusicPath] = useState(edit?.musicPath || '');
  const [musicName, setMusicName] = useState(edit?.musicPath ? (String(edit.musicPath).split('/').pop() || t('showcase.musicSelected', { defaultValue: '背景音乐' })) : '');

  // 从选图器返回：合并新增图片（按 addToken 去重一次，避免重复合并）
  const addToken = route?.params?.addToken;
  useEffect(() => {
    const added = route?.params?.addedImages;
    if (!addToken || !Array.isArray(added) || added.length === 0) return;
    setImgs((prev) => {
      const seen = new Set(prev.map((i) => i.id));
      const merged = prev.slice();
      for (const im of added) { if (im && im.id && !seen.has(im.id)) { merged.push(im); seen.add(im.id); } }
      return merged;
    });
    navigation.setParams({ addedImages: undefined, addToken: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addToken]);

  const removeImg = (id) => setImgs((prev) => prev.filter((i) => i.id !== id));
  const openPicker = () => navigation.navigate('ShowcasePicker', { excludeIds: imgs.map((i) => i.id) });

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
      const { isRewriteAvailable, generateText } = require('../../services/llm/queryRewrite');
      if (!(await isRewriteAvailable())) {
        Alert.alert(t('common.tip', { defaultValue: '提示' }), t('showcase.polishNeedCloud', { defaultValue: '润色需要先在设置中配置在线大模型' }));
        return;
      }
      // 复用纯文本生成链路：模型直接返回描述文本（非 JSON），generateText 内部已兜底解析失败
      const prompt = '忽略附带的占位图片。用户给一组照片的放映集起了名字，请基于名字扩写一句 20~40 字的温暖简体中文描述（适合做相册副标题）。只输出描述本身，不要解释或引号。\n\n名字：' + n;
      const text = await generateText(prompt);
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
    if (imgs.length === 0) {
      Alert.alert(t('common.tip', { defaultValue: '提示' }), t('showcase.needOnePhoto', { defaultValue: '至少保留一张图片' }));
      return;
    }
    setSaving(true);
    try {
      // 封面：所选封面仍在列表里则用之，否则默认首图
      const effectiveCover = (coverId && imgs.some((i) => i.id === coverId)) ? coverId : (imgs[0]?.id || '');
      const ok = await UnifiedDataService.imageStorageService.saveShowcase({
        id: edit?.id || `sc_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
        name: n,
        description: description.trim(),
        imageIds: imgs.map((i) => i.id),
        mode,
        interval,
        musicPath,
        createdAt: edit?.createdAt || new Date().toISOString(),
        coverId: effectiveCover,
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

  // 当前生效封面：所选仍在列表里则用之，否则默认首图
  const effectiveCoverId = (coverId && imgs.some((i) => i.id === coverId)) ? coverId : (imgs[0]?.id || '');

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.groupedBg || '#F2F2F7' }]}>
      <View style={[styles.header, { backgroundColor: c.card, borderBottomColor: c.separator }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Icon name="arrow-back-ios" size={20} color={c.accent || '#007AFF'} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: c.label }]}>{edit ? t('showcase.editTitle', { defaultValue: '编辑时刻秀' }) : t('showcase.createTitle', { defaultValue: '生成时刻秀' })}</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40 }}>
        {/* 预览条（点图设封面 · 角 ✕ 删图 · 末尾「+」加图） */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
          {imgs.map((img) => {
            const isCover = effectiveCoverId === img.id;
            return (
              <View key={img.id} style={styles.thumbWrap}>
                <TouchableOpacity activeOpacity={0.85} onPress={() => setCoverId(img.id)}>
                  <Image source={{ uri: getUri(img) || img.uri }} style={[styles.thumb, isCover && styles.thumbCover]} />
                  {isCover ? (
                    <View style={styles.coverBadge}>
                      <Text style={styles.coverBadgeText}>{t('showcase.cover', { defaultValue: '封面' })}</Text>
                    </View>
                  ) : null}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => removeImg(img.id)} style={styles.removeBtn} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                  <Icon name="close" size={14} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            );
          })}
          <TouchableOpacity onPress={openPicker} style={[styles.thumb, styles.addTile, { borderColor: c.accent || '#007AFF' }]}>
            <Icon name="add" size={28} color={c.accent || '#007AFF'} />
          </TouchableOpacity>
        </ScrollView>
        <Text style={[styles.countText, { color: c.tertiaryLabel }]}>
          {t('showcase.photoCountCover', { count: imgs.length, defaultValue: `共 ${imgs.length} 项 · 点图可设为封面` })}
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
  thumbWrap: { position: 'relative' },
  thumbCover: { borderWidth: 2, borderColor: '#FFB300' },
  coverBadge: {
    position: 'absolute', left: 0, bottom: 0, right: 6,
    backgroundColor: 'rgba(255,179,0,0.92)', borderBottomLeftRadius: 8,
    alignItems: 'center', paddingVertical: 1,
  },
  coverBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  removeBtn: {
    position: 'absolute', top: -4, right: 2, width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
  },
  addTile: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderStyle: 'dashed', backgroundColor: 'transparent' },
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
