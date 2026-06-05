/**
 * FilterEditorScreen（移动版）— 本地滤镜修图（jimp，纯 JS，离线，无原生依赖）
 *
 * 读图字节 → jimp 处理 → 预览(Image) → 保存到相册目录。CPU 处理，非实时：
 * 切滤镜/强度后重新处理。入口：ImagePreview「🎨 滤镜」→ navigate('FilterEditor',{imageUri})。
 * 本屏由 App.js 懒加载（jimp 仅在进入时才加载）。
 */

import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, Image, TouchableOpacity, ScrollView, StyleSheet, Dimensions, Alert, ActivityIndicator, StatusBar, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { RNFS, getLocalPath, ModelPathAdapter, SafeAreaView } from '../../adapters/WebAdapters';
import UnifiedDataService from '../../services/UnifiedDataService';
import { useIosColors } from '../../ui/ios/theme';
import ImageProcessor from '../../services/ImageProcessor';
import { JIMP_FILTERS, JIMP_FILTER_IDS, hasIntensity, applyJimpFilterToBase64 } from '../../services/enhance/jimpFilters.js';

const SR_MODEL = 'real_esrgan_x4v3_merged.onnx'; // 单文件（权重内嵌）；改名以绕过旧外部权重版的缓存

export default function FilterEditorScreen({ route, navigation }) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation('common');
  const c = useIosColors();
  const scheme = useColorScheme();
  const styles = React.useMemo(() => createStyles(c, scheme === 'dark'), [c, scheme]);
  const imageUri = route?.params?.imageUri;
  const [srcBase64, setSrcBase64] = useState(null); // 原图 base64（一次性读入）
  const [resultUri, setResultUri] = useState(imageUri); // 预览 data URL
  const [filterId, setFilterId] = useState('none');
  const [intensity, setIntensity] = useState(1.0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiProgress, setAiProgress] = useState(0);
  const [comparing, setComparing] = useState(false); // 按住对比原图时为 true

  const INTENSITY_LEVELS = React.useMemo(() => ([
    { key: 'weak', label: t('filterEditor.intensityWeak'), value: 0.33 },
    { key: 'medium', label: t('filterEditor.intensityMedium'), value: 0.66 },
    { key: 'strong', label: t('filterEditor.intensityStrong'), value: 1.0 },
  ]), [t]);

  const win = Dimensions.get('window');
  // 预留底部 chrome（AI 增强按钮+强度行+滤镜条）与安全区，避免滤镜条被挤到屏幕外/被手势条遮挡
  const size = Math.min(win.width, win.height - 300 - insets.bottom);

  // 一次性读入原图字节。content:// / 组合路径都不可靠，统一用 ImageProcessor.resizeImage
  // 产出一个可读的 file 临时文件再读（与分类/增强流程一致，避免 getLocalPath 给出不存在的路径）。
  useEffect(() => {
    (async () => {
      try {
        if (!imageUri) throw new Error(t('filterEditor.imageMissing'));
        const resized = await ImageProcessor.resizeImage(imageUri, 1024, 1024, {
          maintainAspectRatio: true,
          outputFormat: 'jpeg',
          quality: 90,
        });
        const uri = resized?.uri;
        if (!uri) throw new Error(t('filterEditor.resizeNoUri'));
        // resize 产出的是干净 file:// URI，直接剥前缀得绝对路径；
        // 不走 getLocalPath（它对该 URI 会返回缺前导斜杠的相对路径 → RNFS ENOENT）。
        const path = uri.startsWith('file://') ? uri.replace(/^file:\/\//, '') : (getLocalPath(uri) || uri);
        const b64 = await RNFS.readFile(path, 'base64');
        setSrcBase64(b64);
      } catch (e) {
        setError(t('filterEditor.readImageFailed', { error: e?.message || String(e) }));
      }
    })();
  }, [imageUri, t]);

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

  // 有处理后的 data: 结果即可保存（滤镜或 AI 增强）；也即可与原图对比
  const canSave = !!resultUri && String(resultUri).startsWith('data:');
  const hasResult = canSave;
  // 对比时显示原图，否则显示处理结果
  const previewUri = comparing && hasResult ? imageUri : resultUri;

  const onSave = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      // 用跨平台的 saveImageToGallery（Android MediaStore / iOS PhotoKit），它接受 data: URL
      // 并写入系统相册。原实现写死 RNFS.PicturesDirectoryPath（安卓专属，iOS 为 undefined
      // → 路径变 "undefined/xualbum/..." → ENOENT）。
      await RNFS.saveImageToGallery(resultUri, `filtered_${Date.now()}.jpg`);
      Alert.alert(t('filterEditor.savedTitle'), t('filterEditor.savedToAlbum'));
    } catch (e) {
      Alert.alert(t('filterEditor.saveFailedTitle'), e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  // 暂存：保存到相册 + 建库记录（继承原图分类/元数据）+ 放入暂存箱，
  // 这样编辑结果能直接在「暂存箱」里看到（与 AI 修图一致的落库方式 + 额外暂存）。
  const original = route?.params?.image;
  const onStage = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const fileName = `filtered_${Date.now()}.jpg`;
      const res = await RNFS.saveImageToGallery(resultUri, fileName);
      const contentUri = res?.uri || '';
      const path = res?.path || '';
      const newUri = path ? `${contentUri}||${path}` : contentUri;
      if (!newUri) throw new Error(t('filterEditor.saveFailedTitle'));
      const now = Date.now();
      const id = UnifiedDataService.getStableId(newUri);
      const record = {
        id,
        uri: newUri,
        fileName: res?.fileName || fileName,
        category: original?.category || 'other',
        confidence: original?.confidence ?? 1.0,
        timestamp: now,
        takenAt: original?.takenAt || now,
        width: original?.width || 0,
        height: original?.height || 0,
        ...(original?.imageDimensions && { imageDimensions: original.imageDimensions }),
        ...(original?.city && { city: original.city }),
        ...(original?.color && { color: original.color }),
      };
      await UnifiedDataService.writeImageDetailedInfo([record], true);
      await UnifiedDataService.addToStagingBox([id]);
      Alert.alert(t('filterEditor.stagedTitle'), t('filterEditor.stagedMessage'));
    } catch (e) {
      Alert.alert(t('filterEditor.saveFailedTitle'), e?.message || String(e));
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
      // 选超分模型(小/大/自定义)并按需下载（APK 不再打包）
      const { ensureModel, resolveSuperRes } = await import('../../services/enhance/modelSource');
      const { filename, url } = await resolveSuperRes();
      const modelPath = await ensureModel(filename, url, (p) => setAiProgress(Math.round(p * 100)));
      const mod = await import('../../services/enhance/superResRunner.js');
      const createSuperResRunner = mod.createSuperResRunner || mod.default;
      const runner = createSuperResRunner({ modelPath });
      const out = await runner.enhance(srcBase64, ({ done, total }) =>
        setAiProgress(Math.round((done / total) * 100)),
      );
      setResultUri(out);
      setFilterId('none');
    } catch (e) {
      setError(t('filterEditor.aiEnhanceFailed', { error: e?.message || String(e) }));
    } finally {
      setAiBusy(false);
    }
  };

  const filterLabel = (id) => {
    // i18n 优先，缺 key 时回退到注册表 name（中文）
    const key = `filterEditor.filters.${id}`;
    const v = t(key);
    return v === key ? JIMP_FILTERS[id]?.name || id : v;
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.headerBtn}>{t('filterEditor.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('filterEditor.title')}</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity onPress={onStage} disabled={busy || aiBusy || !canSave}>
            <Text style={[styles.headerBtn, (busy || aiBusy || !canSave) && styles.disabled]}>{t('filterEditor.stage')}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onSave} disabled={busy || aiBusy || !canSave}>
            <Text style={[styles.headerBtn, styles.headerBtnPrimary, (busy || aiBusy || !canSave) && styles.disabled]}>{t('common.save')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.preview, { height: size }]}>
        {error ? (
          <Text style={styles.err}>{error}</Text>
        ) : (
          <>
            <Image source={{ uri: previewUri }} style={{ width: size, height: size, resizeMode: 'contain' }} />
            {/* 角标：当前在看原图还是效果 */}
            {hasResult && !busy && !aiBusy && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{comparing ? t('filterEditor.compareOriginalBadge') : t('filterEditor.compareResultBadge')}</Text>
              </View>
            )}
            {/* 按住对比原图 */}
            {hasResult && !busy && !aiBusy && (
              <TouchableOpacity
                style={[styles.compareBtn, comparing && styles.compareBtnActive]}
                activeOpacity={1}
                onPressIn={() => setComparing(true)}
                onPressOut={() => setComparing(false)}>
                <Text style={styles.compareBtnText}>{t('filterEditor.compareHoldHint')}</Text>
              </TouchableOpacity>
            )}
            {(busy || aiBusy) && (
              <View style={styles.overlay}>
                <ActivityIndicator color="#FFFFFF" />
                <Text style={styles.overlayText}>{aiBusy ? t('filterEditor.aiEnhancing', { percent: aiProgress }) : t('filterEditor.processing')}</Text>
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
        <Text style={styles.aiBtnText}>{t('filterEditor.aiEnhanceButton')}</Text>
      </TouchableOpacity>

      {hasIntensity(filterId) && (
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t('filterEditor.intensityLabel')}</Text>
          {INTENSITY_LEVELS.map((lv) => (
            <TouchableOpacity
              key={lv.key}
              style={[styles.chip, Math.abs(intensity - lv.value) < 0.05 && styles.chipActive]}
              onPress={() => setIntensity(lv.value)}>
              <Text style={styles.chipText}>{lv.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <ScrollView horizontal style={[styles.filterBar, { marginBottom: insets.bottom }]} showsHorizontalScrollIndicator={false}>
        {JIMP_FILTER_IDS.map((id) => (
          <TouchableOpacity
            key={id}
            style={[styles.filterChip, filterId === id && styles.filterChipActive]}
            onPress={() => setFilterId(id)}>
            <Text style={[styles.filterChipText, filterId === id && styles.filterChipTextActive]}>
              {filterLabel(id)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (c, isDark) => StyleSheet.create({
  // 在 light 主题下用 groupedBg（不再全黑），dark 下用 card 黑面板
  container: { flex: 1, backgroundColor: isDark ? c.groupedBg : c.groupedBg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  headerBtn: { color: c.accent, fontSize: 16, fontWeight: '500' },
  headerBtnPrimary: { fontWeight: '700' },
  disabled: { color: c.tertiaryLabel },
  title: { color: c.label, fontSize: 17, fontWeight: '600' },
  // 预览区保持深底，避免照片缩放后透出与外壳同色，便于聚焦图片本身
  preview: { justifyContent: 'center', alignItems: 'center', backgroundColor: '#000000' },
  err: { color: c.danger, padding: 20, textAlign: 'center' },
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)' },
  overlayText: { color: '#FFFFFF', marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8 },
  rowLabel: { color: c.label, marginRight: 12 },
  chip: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 16, backgroundColor: c.fill, marginRight: 8 },
  chipActive: { backgroundColor: c.accent },
  chipText: { color: c.label },
  filterBar: { maxHeight: 64, paddingHorizontal: 8, paddingVertical: 10 },
  filterChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 18, backgroundColor: c.fill, marginHorizontal: 5 },
  filterChipActive: { backgroundColor: c.accent },
  filterChipText: { color: c.label },
  filterChipTextActive: { color: '#FFFFFF', fontWeight: '600' },
  aiBtn: { marginHorizontal: 14, marginVertical: 6, paddingVertical: 13, borderRadius: 12, backgroundColor: c.accent, alignItems: 'center' },
  disabledBtn: { opacity: 0.5 },
  aiBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  badge: { position: 'absolute', top: 10, left: 10, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.55)' },
  badgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  compareBtn: { position: 'absolute', bottom: 12, alignSelf: 'center', paddingHorizontal: 18, paddingVertical: 9, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  compareBtnActive: { backgroundColor: 'rgba(0,122,255,0.85)' },
  compareBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
});
