/**
 * SlideshowScreen —— 幻灯片放映
 *
 * route.params: { images: [...], startIndex?: number, title?: string }
 * 全屏自动播放（淡入过渡，默认 3s/张，视频跳过）；点按暂停并显示控制条
 * （上一张/播放暂停/下一张/速度/关闭）。再点隐藏控制条继续播。
 */
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, Image, StyleSheet, Animated, StatusBar, useWindowDimensions,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { NativeModules, Platform } from 'react-native';
import Video from 'react-native-video';
import { getUri, logger } from '../../adapters/WebAdapters';

function isVideoItem(it) {
  return String(it?.mimeType || '').startsWith('video/');
}

const SPEEDS = [2000, 3000, 5000];
// 播放模式：fade 淡入 | slide 平移 | zoom 缓慢放大(Ken Burns 简化) | none 直切

export default function SlideshowScreen({ navigation, route }) {
  const { t } = useTranslation('common');
  const { width: winW } = useWindowDimensions();
  const all = Array.isArray(route?.params?.images) ? route.params.images : [];
  // 视频混播：视频原地播放至结束自动下一张（有背景乐时视频静音，避免两路声音打架）
  const images = useMemo(() => all.filter(Boolean), [all]);
  const startIndex = Math.min(Math.max(route?.params?.startIndex || 0, 0), Math.max(images.length - 1, 0));
  const mode = route?.params?.mode || 'fade';
  const initialInterval = route?.params?.interval ? Math.round(route.params.interval * 1000) : 3000;
  const musicPath = route?.params?.musicPath || '';

  const [index, setIndex] = useState(startIndex);
  const [paused, setPaused] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(() => {
    const i = SPEEDS.indexOf(initialInterval);
    return i >= 0 ? i : 1;
  });
  const [videoUrl, setVideoUrl] = useState(null);   // 当前视频项的可播 URL（iOS 需原生解析）
  const fade = useRef(new Animated.Value(1)).current;
  const slide = useRef(new Animated.Value(0)).current;
  const zoom = useRef(new Animated.Value(1)).current;
  const timerRef = useRef(null);
  const soundRef = useRef(null);

  // 背景乐：进场加载循环播放，暂停联动，退出释放（react-native-sound）
  useEffect(() => {
    if (!musicPath) return undefined;
    let sound = null;
    try {
      const Sound = require('react-native-sound');
      Sound.setCategory('Playback');   // iOS 静音键下也出声（放映场景预期行为）
      sound = new Sound(musicPath, '', (err) => {
        if (err) return;   // 加载失败静默（不阻断放映）
        sound.setNumberOfLoops(-1);
        sound.play();
      });
      soundRef.current = sound;
    } catch (_) { /* 模块不可用不阻断放映 */ }
    return () => {
      try { if (sound) { sound.stop(); sound.release(); } } catch (_) {}
      soundRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [musicPath]);

  // 暂停/继续联动音乐
  useEffect(() => {
    const sd = soundRef.current;
    if (!sd) return;
    try { if (paused) sd.pause(); else sd.play(); } catch (_) {}
  }, [paused]);

  const goTo = useCallback((nextIdx) => {
    if (images.length === 0) return;
    const ni = (nextIdx + images.length) % images.length;
    if (mode === 'none') {
      setIndex(ni);
      return;
    }
    if (mode === 'slide' || mode === 'push' || mode === 'flip' || mode === 'rise') {
      // 两段式：出场 → 换图 → 入场（各模式用 transform 插值区分）
      Animated.timing(slide, { toValue: -1, duration: mode === 'flip' ? 240 : 200, useNativeDriver: true }).start(() => {
        setIndex(ni);
        slide.setValue(1);
        Animated.timing(slide, { toValue: 0, duration: mode === 'flip' ? 240 : 200, useNativeDriver: true }).start();
      });
      return;
    }
    if (mode === 'spring') {
      // 弹入：直接换图，新图从 0.6 弹到 1
      setIndex(ni);
      zoom.setValue(0.6);
      Animated.spring(zoom, { toValue: 1, friction: 6, tension: 60, useNativeDriver: true }).start();
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

  // 自动播放定时器（视频项由 onEnd 驱动翻页，不吃定时器）
  useEffect(() => {
    if (paused || images.length <= 1) return undefined;
    if (isVideoItem(images[index])) return undefined;
    timerRef.current = setTimeout(() => goTo(index + 1), SPEEDS[speedIdx]);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [index, paused, speedIdx, goTo, images.length]);

  // 视频项：解析可播放 URL（iOS ph:// 需原生取 file://；安卓 content:// 直接播）
  useEffect(() => {
    const it = images[index];
    setVideoUrl(null);
    if (!it || !isVideoItem(it)) return;
    (async () => {
      try {
        if (Platform.OS === 'ios') {
          const localId = String(it.uri || '').replace(/^ph:\/\//, '');
          const url = await NativeModules.PhotoKitModule.getVideoFileUrl(localId);
          setVideoUrl(url);
        } else {
          const u = getUri(it) || it.uri;
          setVideoUrl(u);
        }
      } catch (e) {
        logger.warn('视频解析失败，跳过:', e?.message || e);
        goTo(index + 1);   // 拿不到就跳下一张
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

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
              : mode === 'push'
                ? { transform: [{ translateX: slide.interpolate({ inputRange: [-1, 0, 1], outputRange: [-winW, 0, winW] }) }] }
                : mode === 'flip'
                  ? { transform: [{ perspective: 800 }, { rotateY: slide.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-85deg', '0deg', '85deg'] }) }], opacity: slide.interpolate({ inputRange: [-1, -0.2, 0, 0.2, 1], outputRange: [0, 1, 1, 1, 0] }) }
                  : mode === 'rise'
                    ? { transform: [{ translateY: slide.interpolate({ inputRange: [-1, 0, 1], outputRange: [-44, 0, 44] }) }], opacity: slide.interpolate({ inputRange: [-1, 0, 1], outputRange: [0, 1, 0] }) }
                    : mode === 'spring'
                      ? { transform: [{ scale: zoom }] }
                      : mode === 'zoom'
                        ? { opacity: fade, transform: [{ scale: zoom }] }
                        : mode === 'none'
                          ? null
                          : { opacity: fade },
          ]}
        >
          {isVideoItem(img) ? (
            videoUrl ? (
              <Video
                source={{ uri: videoUrl }}
                style={styles.image}
                resizeMode="contain"
                paused={paused}
                muted={!!musicPath}
                onEnd={() => goTo(index + 1)}
                onError={() => goTo(index + 1)}
              />
            ) : (
              <View style={[styles.image, { backgroundColor: '#000000' }]} />
            )
          ) : (
            <Image source={{ uri }} style={styles.image} resizeMode="contain" />
          )}
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
