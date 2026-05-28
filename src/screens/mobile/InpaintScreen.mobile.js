/**
 * InpaintScreen（移动版）— AI 物体消除（MI-GAN，设备端，离线）
 *
 * 在图上用手指涂抹要消除的区域（圆形笔刷，红色半透明提示）→「消除」→ 模型修复 →
 * 预览结果，可「按住看原图」对比、保存到相册。入口：ImagePreview「AI修图」菜单→物体消除。
 * 无原生绘图库：PanResponder 采集笔画(显示坐标)+ View 圆点叠加做反馈；笔画在推理时由
 * inpaintRunner 按实际图像尺寸栅格化为 mask（见 services/enhance/inpaintRunner.js）。
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Dimensions, PanResponder, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RNFS, Alert, logger } from '../../adapters/WebAdapters';
import { inpaintLocally } from '../../services/enhance/localEnhance';

const BRUSHES = [
  { label: '细', value: 14 },
  { label: '中', value: 26 },
  { label: '粗', value: 42 },
];

export default function InpaintScreen({ route, navigation }) {
  const insets = useSafeAreaInsets();
  const imageUri = route?.params?.imageUri;
  const win = Dimensions.get('window');

  const [disp, setDisp] = useState(null); // 图像显示尺寸 {w,h}
  const [strokes, setStrokes] = useState([]); // [{ brushRadius, points:[{x,y}] }]
  const [brush, setBrush] = useState(26);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState('process'); // 'download' | 'process'
  const [resultUri, setResultUri] = useState(null);
  const [error, setError] = useState(null);
  const [comparing, setComparing] = useState(false);
  const [saved, setSaved] = useState(false);

  // PanResponder 闭包里读不到最新 state，用 ref 兜
  const brushRef = useRef(brush); brushRef.current = brush;
  const busyRef = useRef(busy); busyRef.current = busy;
  const resultRef = useRef(resultUri); resultRef.current = resultUri;
  const curRef = useRef(null);

  const maxW = win.width;
  const maxH = win.height - (insets.top + insets.bottom) - 280;

  useEffect(() => {
    if (!imageUri) { setError('未传入图片'); return; }
    Image.getSize(
      imageUri,
      (w, h) => { const s = Math.min(maxW / w, maxH / h); setDisp({ w: Math.round(w * s), h: Math.round(h * s) }); },
      () => setError('无法读取图片尺寸'),
    );
  }, [imageUri]);

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !resultRef.current && !busyRef.current,
    onMoveShouldSetPanResponder: () => !resultRef.current && !busyRef.current,
    onPanResponderGrant: (e) => {
      const { locationX, locationY } = e.nativeEvent;
      curRef.current = { brushRadius: brushRef.current, points: [{ x: locationX, y: locationY }] };
      setStrokes((s) => [...s, curRef.current]);
    },
    onPanResponderMove: (e) => {
      const { locationX, locationY } = e.nativeEvent;
      const st = curRef.current;
      if (!st) return;
      const last = st.points[st.points.length - 1];
      const dx = locationX - last.x;
      const dy = locationY - last.y;
      const min = brushRef.current * 0.35;
      if (dx * dx + dy * dy < min * min) return; // 采样：移动够远才记一点，控点数
      st.points.push({ x: locationX, y: locationY });
      setStrokes((s) => [...s.slice(0, -1), { ...st, points: [...st.points] }]);
    },
    onPanResponderRelease: () => { curRef.current = null; },
  })).current;

  const hasMask = strokes.some((s) => s.points && s.points.length > 0);

  const onErase = async () => {
    if (!hasMask || busy) return;
    setBusy(true); setError(null); setProgress(0);
    try {
      const out = await inpaintLocally(
        imageUri,
        { strokes, displayW: disp.w, displayH: disp.h, brushRadius: brush },
        ({ done, total, phase: ph }) => { setPhase(ph || 'process'); setProgress(total ? done / total : 0); },
      );
      setResultUri(out);
    } catch (e) {
      logger.error('❌ 物体消除失败:', e);
      setError('消除失败：' + (e?.message || String(e)));
    } finally {
      setBusy(false);
    }
  };

  const onUndo = () => setStrokes((s) => s.slice(0, -1));
  const onClear = () => setStrokes([]);
  const onRedraw = () => { setResultUri(null); setSaved(false); setComparing(false); }; // 回到涂抹（保留笔画）

  const onSave = async () => {
    if (!resultUri || saved) return;
    try {
      const fileName = `erased_${Date.now()}.jpg`;
      await RNFS.saveImageToGallery(resultUri, fileName); // data URL 由原生 MediaStore 落盘
      setSaved(true);
      Alert.alert('已保存', '已保存到相册');
    } catch (e) {
      Alert.alert('保存失败', e?.message || String(e));
    }
  };

  const previewUri = resultUri && !comparing ? resultUri : imageUri;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.headerBtn}>‹ 返回</Text></TouchableOpacity>
        <Text style={styles.title}>物体消除</Text>
        <TouchableOpacity onPress={onSave} disabled={!resultUri || saved}>
          <Text style={[styles.headerBtn, (!resultUri || saved) && styles.disabled]}>{saved ? '已保存' : '保存'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.canvasWrap}>
        {error ? (
          <Text style={styles.err}>{error}</Text>
        ) : !disp ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <View style={{ width: disp.w, height: disp.h }} {...pan.panHandlers}>
            <Image source={{ uri: previewUri }} style={{ width: disp.w, height: disp.h }} resizeMode="contain" />
            {/* 笔画圆点叠加（仅涂抹阶段显示） */}
            {!resultUri && strokes.map((st, si) => (
              st.points.map((p, pi) => (
                <View key={`${si}-${pi}`} pointerEvents="none" style={{
                  position: 'absolute', left: p.x - st.brushRadius, top: p.y - st.brushRadius,
                  width: st.brushRadius * 2, height: st.brushRadius * 2, borderRadius: st.brushRadius,
                  backgroundColor: 'rgba(255,59,48,0.45)',
                }} />
              ))
            ))}
            {resultUri && (
              <View style={styles.badge}><Text style={styles.badgeText}>{comparing ? '原图' : '已消除'}</Text></View>
            )}
            {busy && (
              <View style={styles.overlay}>
                <ActivityIndicator color="#fff" />
                <Text style={styles.overlayText}>{phase === 'download' ? '下载模型' : '消除中'}… {Math.round(progress * 100)}%</Text>
              </View>
            )}
          </View>
        )}
      </View>

      {/* 提示 */}
      <Text style={styles.tip}>
        {resultUri ? '已消除涂抹区域' : '用手指涂抹要消除的物体'}
      </Text>

      {/* 控制区 */}
      {!resultUri ? (
        <>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>笔刷</Text>
            {BRUSHES.map((b) => (
              <TouchableOpacity key={b.label} style={[styles.chip, brush === b.value && styles.chipActive]} onPress={() => setBrush(b.value)}>
                <Text style={styles.chipText}>{b.label}</Text>
              </TouchableOpacity>
            ))}
            <View style={{ flex: 1 }} />
            <TouchableOpacity style={styles.toolBtn} onPress={onUndo} disabled={!hasMask}><Text style={[styles.toolText, !hasMask && styles.disabled]}>撤销</Text></TouchableOpacity>
            <TouchableOpacity style={styles.toolBtn} onPress={onClear} disabled={!hasMask}><Text style={[styles.toolText, !hasMask && styles.disabled]}>清除</Text></TouchableOpacity>
          </View>
          <TouchableOpacity style={[styles.primaryBtn, (!hasMask || busy) && styles.primaryBtnDisabled]} onPress={onErase} disabled={!hasMask || busy}>
            <Text style={styles.primaryBtnText}>🩹 消除涂抹区域</Text>
          </TouchableOpacity>
        </>
      ) : (
        <View style={styles.resultRow}>
          <TouchableOpacity style={styles.secondaryBtn} onPress={onRedraw}><Text style={styles.secondaryText}>继续涂抹</Text></TouchableOpacity>
          <TouchableOpacity
            style={styles.compareBtn}
            activeOpacity={1}
            onPressIn={() => setComparing(true)}
            onPressOut={() => setComparing(false)}>
            <Text style={styles.compareText}>👁 按住看原图</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.primaryBtnSmall, saved && styles.primaryBtnDisabled]} onPress={onSave} disabled={saved}>
            <Text style={styles.primaryBtnText}>{saved ? '已保存' : '保存到相册'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, paddingTop: 44 },
  headerBtn: { color: '#0A84FF', fontSize: 16, fontWeight: '500' },
  disabled: { color: '#8E8E93' },
  title: { color: '#fff', fontSize: 17, fontWeight: '600' },
  canvasWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  err: { color: '#FF453A', padding: 20, textAlign: 'center' },
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
  overlayText: { color: '#fff', marginTop: 8 },
  badge: { position: 'absolute', top: 10, left: 10, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.55)' },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  tip: { color: '#EBEBF5', textAlign: 'center', paddingVertical: 8, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8 },
  rowLabel: { color: '#EBEBF5', marginRight: 12 },
  chip: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 16, backgroundColor: '#2C2C2E', marginRight: 8 },
  chipActive: { backgroundColor: '#007AFF' },
  chipText: { color: '#fff' },
  toolBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  toolText: { color: '#0A84FF', fontSize: 15 },
  primaryBtn: { marginHorizontal: 14, marginVertical: 10, paddingVertical: 13, borderRadius: 12, backgroundColor: '#007AFF', alignItems: 'center' },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  resultRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10 },
  secondaryBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  secondaryText: { color: '#fff', fontSize: 14 },
  compareBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.12)' },
  compareText: { color: '#fff', fontSize: 14 },
  primaryBtnSmall: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 12, backgroundColor: '#007AFF' },
});
