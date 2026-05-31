/**
 * DocScanScreen（移动版）— 证件/文档扫描 B 期：自动找边 + 可调四角 + 透视矫正 + 扫描增强
 *
 * 进入时用 u2netp 自动检测文档四角（best-effort，失败用默认内缩框），叠加可拖动的四角手柄
 * 与连线（业界扫描 App 的标准交互）。用户对齐证件边缘后「矫正并增强」→ 单应透视拉正 +
 * A 期扫描增强 → 预览结果（可对比原图/重新矫正/保存到相册）。
 * 无原生绘图库：四角=带 PanResponder 的圆形 View，连线=按角度旋转的细 View。
 * 入口：ImagePreview「AI修图」→ 证件处理。
 *
 * 主题：黑底沉浸式编辑画布；useIosColors 仅给非沉浸 chrome（强调蓝/危险红）做随主题切换。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Dimensions, PanResponder, ActivityIndicator, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { RNFS, Alert, logger, SafeAreaView } from '../../adapters/WebAdapters';
import { detectDocCorners, dewarpDocument } from '../../services/enhance/localEnhance';
import { useIosColors } from '../../ui/ios/theme';

const HANDLE = 30; // 手柄触控直径

export default function DocScanScreen({ route, navigation }) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation('common');
  const c = useIosColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const imageUri = route?.params?.imageUri;
  const win = Dimensions.get('window');

  const [disp, setDisp] = useState(null); // 图像显示尺寸 {w,h}
  const [corners, setCorners] = useState(null); // [TL,TR,BR,BL] 显示坐标
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resultUri, setResultUri] = useState(null);
  const [error, setError] = useState(null);
  const [comparing, setComparing] = useState(false);
  const [saved, setSaved] = useState(false);

  const cornersRef = useRef(corners);
  useEffect(() => { cornersRef.current = corners; }, [corners]);
  const busyRef = useRef(busy); busyRef.current = busy;
  const resultRef = useRef(resultUri); resultRef.current = resultUri;
  const dragStart = useRef(null);

  const maxW = win.width;
  const maxH = win.height - (insets.top + insets.bottom) - 220;

  useEffect(() => {
    if (!imageUri) { setError(t('docScan.noImage')); return; }
    Image.getSize(
      imageUri,
      (w, h) => {
        const s = Math.min(maxW / w, maxH / h);
        const dw = Math.round(w * s); const dh = Math.round(h * s);
        setDisp({ w: dw, h: dh });
        const ins = 0.06;
        setCorners([
          { x: dw * ins, y: dh * ins }, { x: dw * (1 - ins), y: dh * ins },
          { x: dw * (1 - ins), y: dh * (1 - ins) }, { x: dw * ins, y: dh * (1 - ins) },
        ]);
        // 自动找边（best-effort）
        (async () => {
          try {
            const f = await detectDocCorners(imageUri);
            if (f && f.length === 4) setCorners(f.map((p) => ({ x: p.x * dw, y: p.y * dh })));
          } catch (_) { /* 失败保留默认框 */ }
        })();
      },
      () => setError(t('docScan.cannotReadSize')),
    );
  }, [imageUri]);

  const handleResponders = useMemo(() => {
    if (!disp) return [];
    const clamp = (v, max) => (v < 0 ? 0 : v > max ? max : v);
    return [0, 1, 2, 3].map((i) => PanResponder.create({
      onStartShouldSetPanResponder: () => !resultRef.current && !busyRef.current,
      onMoveShouldSetPanResponder: () => !resultRef.current && !busyRef.current,
      onPanResponderGrant: () => { const cs = cornersRef.current; dragStart.current = cs ? { ...cs[i] } : null; },
      onPanResponderMove: (e, g) => {
        if (!dragStart.current) return;
        const nx = clamp(dragStart.current.x + g.dx, disp.w);
        const ny = clamp(dragStart.current.y + g.dy, disp.h);
        setCorners((cs) => cs.map((p, idx) => (idx === i ? { x: nx, y: ny } : p)));
      },
    }));
  }, [disp]);

  const onApply = async () => {
    if (!corners || busy) return;
    setBusy(true); setError(null); setProgress(0);
    try {
      const quadFrac = corners.map((p) => ({ x: p.x / disp.w, y: p.y / disp.h }));
      const out = await dewarpDocument(imageUri, quadFrac, ({ done, total }) => setProgress(total ? done / total : 0));
      setResultUri(out);
    } catch (e) {
      logger.error('❌ docScan dewarp failed:', e);
      const raw = e?.message || String(e);
      const msg = /E_TIMEOUT/.test(raw) ? raw.replace('E_TIMEOUT', '').trim() : t('docScan.correctFailedMsg', { error: raw });
      Alert.alert(t('docScan.correctFailedTitle'), msg); // 仅弹窗提示，保留四角界面可重试
    } finally {
      setBusy(false);
    }
  };

  const onRedo = () => { setResultUri(null); setSaved(false); setComparing(false); };
  const onSave = async () => {
    if (!resultUri || saved) return;
    try {
      await RNFS.saveImageToGallery(resultUri, `scan_${Date.now()}.jpg`);
      setSaved(true);
      Alert.alert(t('docScan.savedTitle'), t('docScan.savedToGallery'));
    } catch (e) {
      Alert.alert(t('docScan.saveFailed'), e?.message || String(e));
    }
  };

  // 四角连线（细 View，绕中点旋转）
  const renderEdges = () => corners && [0, 1, 2, 3].map((i) => {
    const a = corners[i]; const b = corners[(i + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2;
    return (
      <View key={`edge-${i}`} pointerEvents="none" style={{
        position: 'absolute', left: mx - len / 2, top: my - 1, width: len, height: 2,
        backgroundColor: c.accent, transform: [{ rotateZ: `${ang}rad` }],
      }} />
    );
  });

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.headerBtn}>‹ {t('docScan.back')}</Text></TouchableOpacity>
        <Text style={styles.title}>{t('docScan.title')}</Text>
        <TouchableOpacity onPress={onSave} disabled={!resultUri || saved}>
          <Text style={[styles.headerBtn, (!resultUri || saved) && styles.disabled]}>{saved ? t('docScan.saved') : t('docScan.save')}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.canvasWrap}>
        {error ? (
          <Text style={styles.err}>{error}</Text>
        ) : !disp ? (
          <ActivityIndicator color="#fff" />
        ) : resultUri ? (
          <View style={{ width: disp.w, height: disp.h }}>
            <Image source={{ uri: comparing ? imageUri : resultUri }} style={{ width: disp.w, height: disp.h }} resizeMode="contain" />
            <View style={styles.badge}><Text style={styles.badgeText}>{comparing ? t('docScan.badgeOriginal') : t('docScan.badgeDone')}</Text></View>
          </View>
        ) : (
          <View style={{ width: disp.w, height: disp.h }}>
            <Image source={{ uri: imageUri }} style={{ width: disp.w, height: disp.h }} resizeMode="contain" />
            {renderEdges()}
            {corners && corners.map((p, i) => (
              <View key={`h-${i}`} {...handleResponders[i].panHandlers} style={[styles.handle, { left: p.x - HANDLE / 2, top: p.y - HANDLE / 2 }]}>
                <View style={styles.handleDot} />
              </View>
            ))}
            {busy && (
              <View style={styles.overlay}>
                <ActivityIndicator color="#fff" />
                <Text style={styles.overlayText}>{t('docScan.progress', { percent: Math.round(progress * 100) })}</Text>
              </View>
            )}
          </View>
        )}
      </View>

      <Text style={styles.tip}>{resultUri ? t('docScan.tipDone') : t('docScan.tipDraw')}</Text>

      {!resultUri ? (
        <TouchableOpacity style={[styles.primaryBtn, busy && styles.primaryBtnDisabled]} onPress={onApply} disabled={busy}>
          <Text style={styles.primaryBtnText}>{t('docScan.applyBtn')}</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.resultRow}>
          <TouchableOpacity style={styles.secondaryBtn} onPress={onRedo}><Text style={styles.secondaryText}>{t('docScan.retryBtn')}</Text></TouchableOpacity>
          <TouchableOpacity style={styles.compareBtn} activeOpacity={1} onPressIn={() => setComparing(true)} onPressOut={() => setComparing(false)}>
            <Text style={styles.compareText}>{t('docScan.compareHold')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.primaryBtnSmall, saved && styles.primaryBtnDisabled]} onPress={onSave} disabled={saved}>
            <Text style={styles.primaryBtnText}>{saved ? t('docScan.saved') : t('docScan.saveToGallery')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

// 黑底沉浸式编辑画布；蓝色（返回/保存/手柄/边线/主按钮）走 c.accent 跟随主题切换。
const createStyles = (c) => StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  headerBtn: { color: c.accent, fontSize: 16, fontWeight: '500' },
  disabled: { color: '#8E8E93' },
  title: { color: '#fff', fontSize: 17, fontWeight: '600' },
  canvasWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  err: { color: c.danger, padding: 20, textAlign: 'center' },
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
  overlayText: { color: '#fff', marginTop: 8 },
  badge: { position: 'absolute', top: 10, left: 10, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.55)' },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  handle: { position: 'absolute', width: HANDLE, height: HANDLE, borderRadius: HANDLE / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(10,132,255,0.25)', borderWidth: 2, borderColor: c.accent },
  handleDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  tip: { color: '#EBEBF5', textAlign: 'center', paddingVertical: 10, fontSize: 13 },
  primaryBtn: { marginHorizontal: 14, marginBottom: 16, paddingVertical: 13, borderRadius: 12, backgroundColor: c.accent, alignItems: 'center' },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  resultRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingBottom: 16 },
  secondaryBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  secondaryText: { color: '#fff', fontSize: 14 },
  compareBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.12)' },
  compareText: { color: '#fff', fontSize: 14 },
  primaryBtnSmall: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 12, backgroundColor: c.accent },
});
