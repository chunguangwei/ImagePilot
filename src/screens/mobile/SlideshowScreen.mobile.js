/**
 * SlideshowScreen —— 幻灯片放映
 *
 * route.params: { images: [...], startIndex?: number, title?: string }
 * 全屏自动播放（淡入过渡，默认 3s/张，视频跳过）；点按暂停并显示控制条
 * （上一张/播放暂停/下一张/速度/关闭）。再点隐藏控制条继续播。
 */
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, Image, StyleSheet, Animated, StatusBar,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { getUri } from '../../adapters/WebAdapters';

const SPEEDS = [2000, 3000, 5000];
// 播放模式：fade 淡入 | slide 平移 | zoom 缓慢放大(Ken Burns 简化) | none 直切

export default function SlideshowScreen({ navigation, route }) {
  const { t } = useTranslation('common');
  const all = Array.isArray(route?.params?.images) ? route.params.images : [];
  // 视频不参与放映（自动翻页放视频体验割裂）
  const images = useMemo(() => all.filter((i) => i && !String(i.mimeType || '').startsWith('video/')), [all]);
  const startIndex = Math.min(Math.max(route?.params?.startIndex || 0, 0), Math.max(images.length - 1, 0));
  const mode = route?.params?.mode || 'fade';
  const initialInterval = route?.params?.interval ? Math.round(route.params.interval * 1000) : 3000;

  const [index, setIndex] = useState(startIndex);
  const [paused, setPaused] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(() => {
    const i = SPEEDS.indexOf(initialInterval);
    return i >= 0 ? i : 1;
  });
  const fade = useRef(new Animated.Value(1)).current;
  const slide = useRef(new Animated.Value(0)).current;
  const zoom = useRef(new Animated.Value(1)).current;
  const timerRef = useRef(null);

  const goTo = useCallback((nextIdx) => {
    if (images.length === 0) return;
    const ni = (nextIdx + images.length) % images.length;
    if (mode === 'none') {
      setIndex(ni);
      return;
    }
    if (mode === 'slide') {
      // 滑出 → 换图 → 从另一侧滑入
      Animated.timing(slide, { toValue: -1, duration: 200, useNativeDriver: true }).start(() => {
        setIndex(ni);
        slide.setValue(1);
        Animated.timing(slide, { toValue: 0, duration: 200, useNativeDriver: true }).start();
      });
      return;
    }
    // fade / zoom 共用淡入淡出；zoom 在停留期间缓慢放大（见 effect）
    Animated.timing(fade, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => {
      setIndex(ni);
      if (mode === 'zoom') zoom.setValue(1);
      Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    });
  }, [images.length, fade, slide, zoom, mode]);

  // zoom 模式：每张停留期间 1 → 1.08 缓慢放大
  useEffect(() => {
    if (mode !== 'zoom' || paused) return undefined;
    zoom.setValue(1);
    const anim = Animated.timing(zoom, { toValue: 1.08, duration: SPEEDS[speedIdx], useNativeDriver: true });
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, mode, paused, speedIdx]);

  // 自动播放定时器
  useEffect(() => {
    if (paused || images.length <= 1) return undefined;
    timerRef.current = setTimeout(() => goTo(index + 1), SPEEDS[speedIdx]);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [index, paused, speedIdx, goTo, images.length]);

  // 全是视频或空集合：安全退出（effect 中导航，避免 render 期副作用竞态）
  useEffect(() => {
    if (images.length === 0) navigation.goBack();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images.length]);
  if (images.length === 0) return null;

  const img = images[index];
  const uri = getUri(img) || img?.uri;

  return (
    <View style={styles.container}>
      <StatusBar hidden />
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={() => setControlsVisible((v) => !v)}
      >
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            mode === 'slide'
              ? { transform: [{ translateX: slide.interpolate({ inputRange: [-1, 0, 1], outputRange: [-60, 0, 60] }) }], opacity: slide.interpolate({ inputRange: [-1, 0, 1], outputRange: [0, 1, 0] }) }
              : mode === 'zoom'
                ? { opacity: fade, transform: [{ scale: zoom }] }
                : mode === 'none'
                  ? null
                  : { opacity: fade },
          ]}
        >
          <Image source={{ uri }} style={styles.image} resizeMode="contain" />
        </Animated.View>
      </TouchableOpacity>

      {controlsVisible && (
        <>
          {/* 顶部：关闭 + 进度 */}
          <View style={styles.topBar}>
            <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.ctrlText}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.counter}>{index + 1} / {images.length}</Text>
            <TouchableOpacity
              onPress={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.ctrlText}>{SPEEDS[speedIdx] / 1000}s</Text>
            </TouchableOpacity>
          </View>
          {/* 底部：上一张 / 播放暂停 / 下一张 */}
          <View style={styles.bottomBar}>
            <TouchableOpacity onPress={() => goTo(index - 1)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.ctrlText}>⏮</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setPaused((p) => !p)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={[styles.ctrlText, styles.playBtn]}>{paused ? '▶' : '⏸'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => goTo(index + 1)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.ctrlText}>⏭</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  image: { width: '100%', height: '100%' },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: 54, paddingHorizontal: 22, paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center',
    paddingBottom: 44, paddingTop: 14,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  ctrlText: { color: '#FFFFFF', fontSize: 20, fontWeight: '600' },
  playBtn: { fontSize: 26 },
  counter: { color: 'rgba(255,255,255,0.9)', fontSize: 14, fontWeight: '600' },
});
