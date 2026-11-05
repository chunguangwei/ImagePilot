import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Switch, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { captionModelReady, downloadCaptionModel, deleteCaptionModel, CAPTION_SIZE_MB } from '../services/classify/lfmCaptionModel';
import { isCaptionBusy } from '../services/classify/LfmCaptionService';

export default function LfmCaptionSettings({ config = {}, onChange, active, colors }) {
  const { i18n } = useTranslation();
  const en = String(i18n.language).startsWith('en');
  const text = (zh, english) => en ? english : zh;
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(null);
  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);
  const abort = useRef(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    captionModelReady().then(ok => { if (mounted.current) { setReady(ok); setChecking(false); } });
    return () => { mounted.current = false; abort.current?.abort(); };
  }, []);
  const report = error => Alert.alert(text('AI 图片描述', 'AI image descriptions'), error?.message || String(error));
  const change = async value => {
    setSaving(true);
    try { await onChange(value); } catch (error) { report(error); }
    finally { if (mounted.current) setSaving(false); }
  };
  const download = async () => {
    if (abort.current) return;
    abort.current = new AbortController(); setProgress(0);
    try {
      await downloadCaptionModel(p => { if (mounted.current) setProgress(p); }, abort.current.signal);
      if (mounted.current) setReady(true);
    } catch (error) { if (!abort.current?.signal.aborted && mounted.current) report(error); }
    finally { abort.current = null; if (mounted.current) setProgress(null); }
  };
  const remove = () => {
    if (isCaptionBusy()) { Alert.alert(text('正在生成描述，请结束后再删除', 'Finish caption generation before deleting the model')); return; }
    Alert.alert(text('删除描述模型？', 'Delete caption model?'), text('不会删除 EmbeddingGemma 或已保存的图片描述。', 'EmbeddingGemma and saved descriptions will be kept.'), [
      { text: text('取消', 'Cancel'), style: 'cancel' },
      { text: text('删除', 'Delete'), style: 'destructive', onPress: async () => {
        setSaving(true);
        try {
          if (isCaptionBusy()) throw new Error(text('正在生成描述', 'Caption generation is running'));
          await onChange({ ...config, enabled: false });
          await deleteCaptionModel(); if (mounted.current) setReady(false);
        } catch (error) { report(error); }
        finally { if (mounted.current) setSaving(false); }
      } },
    ]);
  };
  const button = { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.accent, marginRight: 8, marginTop: 8 };
  return <View style={{ padding: 12, marginBottom: 12, borderWidth: 1, borderColor: colors.accent, borderRadius: 10 }}>
    <Text style={{ color: colors.label, fontSize: 15, fontWeight: '600' }}>{text('AI 图片描述（可选）', 'AI image descriptions (optional)')}</Text>
    <Text style={{ color: colors.secondaryLabel, marginTop: 6 }}>LFM2.5-VL-450M · {CAPTION_SIZE_MB} MB</Text>
    <Text style={{ color: colors.secondaryLabel, marginTop: 6, lineHeight: 20 }}>{text('分类后离线生成描述并写入图片信息，可搜索。中英文共用模型；启用后耗时和耗电会增加。', 'Generate searchable offline captions after classification. Chinese and English share one download. Enabling this adds processing time and battery use.')}</Text>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
      <Text style={{ flex: 1, color: colors.label }}>{text('生成图片描述', 'Generate captions')}</Text>
      <Switch accessibilityLabel={text('生成图片描述', 'Generate captions')} value={!!config.enabled && ready} disabled={!ready || saving || progress !== null} onValueChange={enabled => change({ ...config, enabled })} />
    </View>
    {!active && <Text style={{ color: colors.secondaryLabel }}>{text('选择 EmbeddingGemma 后生效', 'Applies when EmbeddingGemma is selected')}</Text>}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
      {[['auto', text('跟随应用', 'App language')], ['zh', '中文'], ['en', 'English']].map(([language, label]) => <TouchableOpacity key={language} disabled={saving} onPress={() => change({ ...config, language })} accessibilityRole="radio" accessibilityState={{ checked: (config.language || 'auto') === language }} style={[button, { backgroundColor: (config.language || 'auto') === language ? colors.accent : 'transparent' }]}>
        <Text style={{ color: (config.language || 'auto') === language ? '#fff' : colors.accent }}>{label}</Text>
      </TouchableOpacity>)}
    </View>
    {checking ? <ActivityIndicator style={{ marginTop: 12 }} color={colors.accent} /> : progress !== null ? <View style={{ marginTop: 12 }}>
      <Text style={{ color: colors.label }}>{text('下载／校验', 'Downloading / verifying')} {Math.floor(progress * 100)}%</Text>
      <TouchableOpacity style={button} onPress={() => abort.current?.abort()}><Text style={{ color: colors.accent }}>{text('取消下载', 'Cancel download')}</Text></TouchableOpacity>
    </View> : <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
      {ready ? <TouchableOpacity style={button} disabled={saving} onPress={remove}><Text style={{ color: colors.danger }}>{text('删除描述模型', 'Delete caption model')}</Text></TouchableOpacity> : <TouchableOpacity style={button} disabled={saving} onPress={download}><Text style={{ color: colors.accent }}>{text('下载描述模型', 'Download caption model')} · {CAPTION_SIZE_MB} MB</Text></TouchableOpacity>}
    </View>}
  </View>;
}
