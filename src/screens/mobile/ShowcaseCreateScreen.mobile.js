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
  ActivityIndicator, StyleSheet, Alert, Modal,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { captureRef } from 'react-native-view-shot';
import { SafeAreaView, Icon, getUri, logger, RNFS } from '../../adapters/WebAdapters';
import UnifiedDataService from '../../services/UnifiedDataService';
import { useIosColors } from '../../ui/ios/theme';
import ShowcaseTitleCard from '../../components/shared/ShowcaseTitleCard';
import { SHOWCASE_TEMPLATES } from '../../config/showcaseTemplates';
import { applyTemplate } from '../../services/showcase/templateApply';
import ImageProcessor from '../../services/ImageProcessor';

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
  const [coverBrowse, setCoverBrowse] = useState(false); // 封面大图浏览选择器
  const [name, setName] = useState(edit?.name || '');
  const [description, setDescription] = useState(edit?.description || '');
  const [mode, setMode] = useState(edit?.mode || 'fade');
  const [interval, setIntervalSec] = useState(edit?.interval || 3);
  const [polishing, setPolishing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [musicPath, setMusicPath] = useState(edit?.musicPath || '');
  const [musicName, setMusicName] = useState(edit?.musicPath ? (String(edit.musicPath).split('/').pop() || t('showcase.musicSelected', { defaultValue: '背景音乐' })) : '');
  // 模板（编辑模式不重套模板，仅新建可选）
  const [templateId, setTemplateId] = useState('');
  const [applying, setApplying] = useState(null); // {done,total} | null
  const titleCardRef = useRef(null);
  const [cardSpec, setCardSpec] = useState(null); // 离屏待截标题卡

  // 离屏渲染标题卡 → 等背景图 onLoad（不再固定延时硬截，避免 iOS 上图未加载完就截导致
  // view-shot 原生崩溃）→ view-shot 截图 → 返回 file:// uri。带 1.5s 兜底超时与 ref 守卫。
  // 背景图先压成本地小 jpg（iOS ph:// 异步加载 + view-shot 易崩，本地小图最稳）。
  const captureTitleCard = async (spec) => {
    let bg = spec.bgImage;
    try {
      if (bg) {
        const src = getUri(bg) || bg.uri;
        const r = await ImageProcessor.resizeImage(src, 540, 960, { maintainAspectRatio: true, outputFormat: 'jpeg', quality: 85 });
        if (r && r.uri) bg = { uri: r.uri };
      }
    } catch (_) { /* 压缩失败就用原图 */ }
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        setTimeout(async () => {
          try {
            if (!titleCardRef.current) { resolve(null); return; }
            const uri = await captureRef(titleCardRef, { format: 'jpg', quality: 0.92, result: 'tmpfile' });
            resolve(uri ? (uri.startsWith('file://') ? uri : `file://${uri}`) : null);
          } catch (e) {
            logger.warn('标题卡截图失败:', e?.message || e);
            resolve(null);
          } finally {
            setCardSpec(null);
          }
        }, 150);
      };
      setCardSpec({ ...spec, bgImage: bg, onBgReady: finish });
      setTimeout(finish, 1500); // 兜底：图片不触发 onLoad 也要截
    });
  };

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
      const { generateTextWithChoice } = require('../../services/llm/queryRewrite');
      // 端侧+云端都可用时内部会弹框让用户选；只一个可用则直接用；都没有抛 E_NO_MODEL；取消抛 E_CANCEL
      const prompt = '忽略附带的占位图片。用户给一组照片的放映集起了名字，请基于名字扩写一句 20~40 字的温暖简体中文描述（适合做相册副标题）。只输出描述本身，不要解释或引号。\n\n名字：' + n;
      const text = await generateTextWithChoice(prompt, { t });
      if (text) setDescription(text);
    } catch (e) {
      if (String(e?.message || '').includes('E_CANCEL')) { /* 用户取消，静默 */ }
      else if (String(e?.message || '').includes('E_NO_MODEL')) {
        Alert.alert(t('common.tip', { defaultValue: '提示' }), t('showcase.polishNeedCloud', { defaultValue: '润色需要先在设置中配置在线大模型' }));
      } else {
        logger.warn('润色失败:', e?.message || e);
        Alert.alert(t('common.tip', { defaultValue: '提示' }), e?.message || t('search.rewriteFailed', { defaultValue: '改写失败' }));
      }
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
      // 选了模板：预生成滤镜图 + 标题卡，组装 items；其转场/时长/画幅覆盖手选值
      let templateItems = null; let saveMode = mode; let saveInterval = interval; let saveAspect = edit?.aspect || '9:16';
      if (templateId) {
        const slots = {
          name: n,
          date: (() => {
            const im = imgs.find((i) => i.takenAt || i.timestamp);
            const ts = im && (im.takenAt || im.timestamp);
            const d = ts ? new Date(ts) : new Date();
            return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
          })(),
        };
        setApplying({ done: 0, total: imgs.length + 2 });
        const res = await applyTemplate(templateId, imgs, slots, captureTitleCard, (done, total) => setApplying({ done, total }));
        setApplying(null);
        if (res && res.items && res.items.length) { templateItems = res.items; saveMode = res.mode; saveInterval = res.interval; saveAspect = res.aspect || saveAspect; }
      }
      // 封面：优先用用户手动选择的封面（无论普通秀还是模板秀），未选则回退首图
      const effectiveCover = (coverId && imgs.some((i) => i.id === coverId)) ? coverId : (imgs[0]?.id || '');
      const ok = await UnifiedDataService.imageStorageService.saveShowcase({
        id: edit?.id || `sc_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
        name: n,
        description: description.trim(),
        imageIds: imgs.map((i) => i.id),
        mode: saveMode,
        interval: saveInterval,
        musicPath,
        createdAt: edit?.createdAt || new Date().toISOString(),
        coverId: effectiveCover,
        // 编辑模式不重套模板：保留原有模板帧，别让改名字/描述把模板效果清掉
        items: templateItems || (edit && Array.isArray(edit.items) && edit.items.length ? edit.items : null),
        aspect: saveAspect,
      });
      if (!ok) throw new Error(t('showcase.saveFailed', { defaultValue: '保存失败' }));
      // 回到时刻 Tab 看成品
      navigation.navigate('MainTabs', { screen: 'Moments' });
    } catch (e) {
      Alert.alert(t('settings.operationFailed', { defaultValue: '操作失败' }), e?.message || '');
    } finally {
      setApplying(null);
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
        <View style={styles.countRow}>
          <Text style={[styles.countText, { color: c.tertiaryLabel, marginBottom: 0, flex: 1 }]}>
            {t('showcase.photoCountCover', { count: imgs.length, defaultValue: `共 ${imgs.length} 项 · 点图可设为封面` })}
          </Text>
          {imgs.length > 0 ? (
            <TouchableOpacity onPress={() => setCoverBrowse(true)} style={styles.coverBrowseBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="wallpaper" size={16} color={c.accent || '#007AFF'} />
              <Text style={[styles.coverBrowseLink, { color: c.accent || '#007AFF' }]}>{t('showcase.browseCover', { defaultValue: '选封面' })}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* 模板（新建可选；编辑模式不重套模板） */}
        {!edit ? (
          <>
            <Text style={[styles.label, { color: c.label }]}>{t('showcase.templateLabel', { defaultValue: '模板（可选，自动套滤镜+片头片尾）' })}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              <Chip active={!templateId} label={t('showcase.noTemplate', { defaultValue: '无模板' })} onPress={() => setTemplateId('')} />
              {SHOWCASE_TEMPLATES.map((tpl) => (
                <Chip key={tpl.id} active={templateId === tpl.id} label={tpl.name}
                  onPress={() => { setTemplateId(tpl.id); setIntervalSec(tpl.interval || 3); }} />
              ))}
            </ScrollView>
          </>
        ) : null}

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
          <TouchableOpacity style={[styles.input, styles.musicBtn, { backgroundColor: c.card, flexDirection: 'row', alignItems: 'center', gap: 8 }]} onPress={pickMusic}>
            <Icon name="library-music" size={18} color={musicName ? (c.accent || '#007AFF') : c.tertiaryLabel} />
            <Text style={{ color: musicName ? c.label : c.tertiaryLabel, fontSize: 15, flex: 1 }} numberOfLines={1}>
              {musicName || t('showcase.musicPick', { defaultValue: '选择本地音乐文件…' })}
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
            {applying
              ? t('showcase.applyingTemplate', { done: applying.done, total: applying.total, defaultValue: `正在套用模板 ${applying.done}/${applying.total}` })
              : (saving ? t('common.processing', { defaultValue: '处理中…' }) : t('showcase.saveBtn', { defaultValue: '保存到「时刻」' }))}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* 封面大图浏览选择：按时刻卡宽幅比例展示，所见即封面效果 */}
      <Modal visible={coverBrowse} transparent animationType="slide" onRequestClose={() => setCoverBrowse(false)}>
        <View style={styles.coverModalRoot}>
          <View style={[styles.coverModalHeader, { backgroundColor: c.card, borderBottomColor: c.separator }]}>
            <Text style={[styles.coverModalTitle, { color: c.label }]}>{t('showcase.browseCoverTitle', { defaultValue: '选封面（点图设为封面）' })}</Text>
            <TouchableOpacity onPress={() => setCoverBrowse(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={[styles.coverModalClose, { color: c.accent || '#007AFF' }]}>{t('common.done', { defaultValue: '完成' })}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 12 }}>
            {imgs.map((img) => {
              const isCover = effectiveCoverId === img.id;
              return (
                <TouchableOpacity key={img.id} activeOpacity={0.9} onPress={() => { setCoverId(img.id); setCoverBrowse(false); }} style={styles.coverBigWrap}>
                  <Image source={{ uri: getUri(img) || img.uri }} style={styles.coverBig} resizeMode="cover" />
                  {isCover ? (
                    <View style={styles.coverBigBadge}><Text style={styles.coverBigBadgeText}>{t('showcase.cover', { defaultValue: '封面' })}</Text></View>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </Modal>

      {/* 离屏标题卡（view-shot 截图源，屏幕外不可见） */}
      <View style={styles.offscreen} pointerEvents="none">
        {cardSpec ? (
          <View ref={titleCardRef} collapsable={false}>
            <ShowcaseTitleCard
              title={cardSpec.title}
              subtitle={cardSpec.subtitle}
              bgImage={cardSpec.bgImage}
              width={cardSpec.width}
              height={cardSpec.height}
              typo={cardSpec.typo}
              onBgReady={cardSpec.onBgReady}
            />
          </View>
        ) : null}
      </View>
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
  offscreen: { position: 'absolute', left: -10000, top: 0 },
  countRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  coverBrowseBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  coverBrowseLink: { fontSize: 13, fontWeight: '700' },
  coverModalRoot: { flex: 1, backgroundColor: '#000' },
  coverModalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 52, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  coverModalTitle: { fontSize: 16, fontWeight: '700', flex: 1, marginRight: 12 },
  coverModalClose: { fontSize: 16, fontWeight: '700' },
  coverBigWrap: { width: '100%', aspectRatio: 200 / 124, borderRadius: 12, overflow: 'hidden', marginBottom: 12, backgroundColor: 'rgba(255,255,255,0.06)' },
  coverBig: { width: '100%', height: '100%' },
  coverBigBadge: { position: 'absolute', left: 10, bottom: 10, backgroundColor: 'rgba(255,179,0,0.95)', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6 },
  coverBigBadgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
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
