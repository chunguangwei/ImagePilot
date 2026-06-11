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

export default function SlideshowScreen({ navigation, route }) {
  const { t } = useTranslation('common');
  const all = Array.isArray(route?.params?.images) ? route.params.images : [];
  // 视频不参与放映（自动翻页放视频体验割裂）
  const images = useMemo(() => all.filter((i) => i && !String(i.mimeType || '').startsWith('video/')), [all]);
  const startIndex = Math.min(Math.max(route?.params?.startIndex || 0, 0), Math.max(images.length - 1, 0));

  const [index, setIndex] = useState(startIndex);
  const [paused, setPaused] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);   // 默认 3s
  const fade = useRef(new Animated.Value(1)).current;
  const timerRef = useRef(null);

  const goTo = useCallback((nextIdx) => {
    if (images.length === 0) return;
    const ni = (nextIdx + images.length) % images.length;
    // 淡出 → 换图 → 淡入
    Animated.timing(fade, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => {
      setIndex(ni);
      Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    });
  }, [images.length, fade]);

  // 自动播放定时器
  useEffect(() => {
    if (paused || images.length <= 1) return undefined;
    timerRef.current = setTimeout(() => goTo(index + 1), SPEEDS[speedIdx]);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [index, paused, speedIdx, goTo, images.length]);

  if (images.length === 0) {
    // 全是视频或空集合：直接退出
    setTimeout(() => navigation.goBack(), 0);
    return null;
  }

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
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]}>
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
