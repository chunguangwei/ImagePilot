/**
 * FilterEditorScreen（移动版）— 本地滤镜修图（jimp，纯 JS，离线，无原生依赖）
 *
 * 读图字节 → jimp 处理 → 预览(Image) → 保存到相册目录。CPU 处理，非实时：
 * 切滤镜/强度后重新处理。入口：ImagePreview「🎨 滤镜」→ navigate('FilterEditor',{imageUri})。
 * 本屏由 App.js 懒加载（jimp 仅在进入时才加载）。
 */

import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, Image, TouchableOpacity, ScrollView, StyleSheet, Dimensions, Alert, ActivityIndicator } from 'react-native';
import { RNFS, getLocalPath, ModelPathAdapter, logger } from '../../adapters/WebAdapters';
import ImageProcessor from '../../services/ImageProcessor';
import { JIMP_FILTERS, JIMP_FILTER_IDS, hasIntensity, applyJimpFilterToBase64 } from '../../services/enhance/jimpFilters.js';

const SR_MODEL = 'real_esrgan_x4v3_merged.onnx'; // 单文件（权重内嵌）；改名以绕过旧外部权重版的缓存

const INTENSITY_LEVELS = [
  { label: '弱', value: 0.33 },
  { label: '中', value: 0.66 },
  { label: '强', value: 1.0 },
];

export default function FilterEditorScreen({ route, navigation }) {
  const imageUri = route?.params?.imageUri;
  const [srcBase64, setSrcBase64] = useState(null); // 原图 base64（一次性读入）
  const [resultUri, setResultUri] = useState(imageUri); // 预览 data URL
  const [filterId, setFilterId] = useState('none');
  const [intensity, setIntensity] = useState(1.0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiProgress, setAiProgress] = useState(0);

  const win = Dimensions.get('window');
  const size = Math.min(win.width, win.height - 220);

  // 一次性读入原图字节。content:// / 组合路径都不可靠，统一用 ImageProcessor.resizeImage
  // 产出一个可读的 file 临时文件再读（与分类/增强流程一致，避免 getLocalPath 给出不存在的路径）。
  useEffect(() => {
    (async () => {
      try {
        if (!imageUri) throw new Error('未传入图片');
        const resized = await ImageProcessor.resizeImage(imageUri, 1024, 1024, {
          maintainAspectRatio: true,
          outputFormat: 'jpeg',
          quality: 90,
        });
        const uri = resized?.uri;
        if (!uri) throw new Error('缩放未返回有效 URI');
        // resize 产出的是干净 file:// URI，直接剥前缀得绝对路径；
        // 不走 getLocalPath（它对该 URI 会返回缺前导斜杠的相对路径 → RNFS ENOENT）。
        const path = uri.startsWith('file://') ? uri.replace(/^file:\/\//, '') : (getLocalPath(uri) || uri);
        const b64 = await RNFS.readFile(path, 'base64');
        setSrcBase64(b64);
      } catch (e) {
        setError('读图失败：' + (e?.message || String(e)));
      }
    })();
  }, [imageUri]);

  // 应用滤镜（切滤镜/强度时重处理）
  const reprocess = useCallback(async (fid, inten) => {
    if (!srcBase64) return;
    if (fid === 'none') { setResultUri(imageUri); return; }
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await applyJimpFilterToBase64(srcBase64, fid, inten);
      setResultUri(dataUrl);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [srcBase64, imageUri]);

  useEffect(() => { reprocess(filterId, intensity); }, [filterId, intensity, reprocess]);

  // 有处理后的 data: 结果即可保存（滤镜或 AI 增强）
  const canSave = !!resultUri && String(resultUri).startsWith('data:');

  const onSave = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const base64 = String(resultUri).split(',')[1] || '';
      const dir = `${RNFS.PicturesDirectoryPath}/xualbum`;
      await RNFS.mkdir(dir).catch(() => {});
      const path = `${dir}/filtered_${Date.now()}.jpg`;
      await RNFS.writeFile(path, base64, 'base64');
      Alert.alert('已保存', `已保存到:\n${path}`);
    } catch (e) {
      Alert.alert('保存失败', e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  // AI 增强（超分）：onnxruntime + Real-ESRGAN，较慢，分块进度
  const aiEnhance = async () => {
    if (!srcBase64 || aiBusy) return;
    setAiBusy(true);
    setAiProgress(0);
    setError(null);
    try {
      await ModelPathAdapter.ensureModelExists(SR_MODEL);
      const modelPath = ModelPathAdapter.getModelPath(SR_MODEL);
      const { createSuperResRunner } = await import('../../services/enhance/superResRunner.js');
      const runner = createSuperResRunner({ modelPath });
      const out = await runner.enhance(srcBase64, ({ done, total }) =>
        setAiProgress(Math.round((done / total) * 100)),
      );
      setResultUri(out);
      setFilterId('none');
    } catch (e) {
      logger.error('[AI增强] 失败:', e?.message || String(e), e?.stack || '');
      setError('AI 增强失败：' + (e?.message || String(e)));
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.headerBtn}>← 返回</Text>
        </TouchableOpacity>
        <Text style={styles.title}>滤镜修图</Text>
        <TouchableOpacity onPress={onSave} disabled={busy || aiBusy || !canSave}>
          <Text style={[styles.headerBtn, (busy || aiBusy || !canSave) && styles.disabled]}>保存</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.preview, { height: size }]}>
        {error ? (
          <Text style={styles.err}>{error}</Text>
        ) : (
          <>
            <Image source={{ uri: resultUri }} style={{ width: size, height: size, resizeMode: 'contain' }} />
            {(busy || aiBusy) && (
              <View style={styles.overlay}>
                <ActivityIndicator color="#fff" />
                <Text style={styles.overlayText}>{aiBusy ? `AI 增强中… ${aiProgress}%（较慢，请稍候）` : '处理中…'}</Text>
              </View>
            )}
          </>
        )}
      </View>

      {/* AI 增强（超分）按钮 */}
      <TouchableOpacity
        style={[styles.aiBtn, aiBusy && styles.disabledBtn]}
        disabled={aiBusy || !srcBase64}
        onPress={aiEnhance}>
        <Text style={styles.aiBtnText}>✨ AI 增强（超分修复，较慢）</Text>
      </TouchableOpacity>

      {hasIntensity(filterId) && (
        <View style={styles.row}>
          <Text style={styles.rowLabel}>强度</Text>
          {INTENSITY_LEVELS.map((lv) => (
            <TouchableOpacity
              key={lv.label}
              style={[styles.chip, Math.abs(intensity - lv.value) < 0.05 && styles.chipActive]}
              onPress={() => setIntensity(lv.value)}>
              <Text style={styles.chipText}>{lv.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <ScrollView horizontal style={styles.filterBar} showsHorizontalScrollIndicator={false}>
        {JIMP_FILTER_IDS.map((id) => (
          <TouchableOpacity
            key={id}
            style={[styles.filterChip, filterId === id && styles.filterChipActive]}
            onPress={() => setFilterId(id)}>
            <Text style={[styles.filterChipText, filterId === id && styles.filterChipTextActive]}>
              {JIMP_FILTERS[id].name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, paddingTop: 44 },
  headerBtn: { color: '#fff', fontSize: 16 },
  disabled: { color: '#777' },
  title: { color: '#fff', fontSize: 17, fontWeight: '600' },
  preview: { justifyContent: 'center', alignItems: 'center' },
  err: { color: '#ff6b6b', padding: 20, textAlign: 'center' },
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)' },
  overlayText: { color: '#fff', marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8 },
  rowLabel: { color: '#ccc', marginRight: 12 },
  chip: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 16, backgroundColor: '#333', marginRight: 8 },
  chipActive: { backgroundColor: '#007AFF' },
  chipText: { color: '#fff' },
  filterBar: { maxHeight: 64, paddingHorizontal: 8, paddingVertical: 10 },
  filterChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 18, backgroundColor: '#222', marginHorizontal: 5 },
  filterChipActive: { backgroundColor: '#fff' },
  filterChipText: { color: '#ddd' },
  filterChipTextActive: { color: '#000', fontWeight: '600' },
  aiBtn: { marginHorizontal: 14, marginVertical: 6, paddingVertical: 12, borderRadius: 10, backgroundColor: '#6C2BD9', alignItems: 'center' },
  disabledBtn: { opacity: 0.5 },
  aiBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
