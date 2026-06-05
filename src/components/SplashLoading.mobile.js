// ImagePilot 内置动效启动屏
// 设计理念："智能分类 · 便捷管理 · 仅你可见"
//   - 中心：罗盘核心（Pilot/领航，品牌符号），呼吸辉光 + 极缓自转
//   - 四周：照片卡片从「后方」飞向中心，由远及近放大，最后被「收进」中心消失
//     → 直观表达 AI 把散落照片自动归拢分类。每次启动随机分布。
//   - 深空黑底 + 单一青蓝强调色，克制高端
// 实现：纯 react-native Animated（native driver），零额外依赖（不引 Reanimated/SVG）。
import React, { useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  Dimensions,
} from 'react-native';

const BG = '#03060B';        // 深空黑（贴合核心图底色）
const ACCENT = '#3DD4D0';    // 品牌青蓝

const COMPASS = require('../assets/splash-compass.png');
const { width: SCREEN_W } = Dimensions.get('window');

const PHOTO_COUNT = 8;       // 飞入的照片卡片数量
const SPARK_COUNT = 10;      // 背景微光点

// 随机工具（启动时一次性生成分布，整轮稳定）
function rand(min, max) {
  return min + Math.random() * (max - min);
}

export default function SplashLoading({
  title = 'ImagePilot',
  tagline = '智能分类 · 便捷管理 · 仅你可见',
  minDurationMs = 0,    // >0：展示满该时长后回调 onFinish（自动进入）
  onFinish,
  skippable = false,    // 是否显示「跳过」按钮，允许用户提前进入
  skipAfterMs = 1200,   // 多少毫秒后出现跳过按钮
}) {
  const breathe = useRef(new Animated.Value(0)).current; // 中心辉光呼吸
  const spin = useRef(new Animated.Value(0)).current;    // 罗盘极缓自转
  const fade = useRef(new Animated.Value(0)).current;    // 文案渐显
  const finishedRef = useRef(false);
  const [remain, setRemain] = React.useState(minDurationMs > 0 ? Math.ceil(minDurationMs / 1000) : 0);
  const [canSkip, setCanSkip] = React.useState(false);

  const finish = React.useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinish && onFinish();
  }, [onFinish]);

  // 照片卡片：随机角度/起始景深/尺寸/节奏，每张一个 0→1 进度
  const photos = useMemo(
    () =>
      Array.from({ length: PHOTO_COUNT }).map((_, i) => {
        const angle = (i / PHOTO_COUNT) * Math.PI * 2 + rand(-0.35, 0.35);
        const startR = rand(SCREEN_W * 0.5, SCREEN_W * 0.72); // 起始离中心半径（远）
        return {
          progress: new Animated.Value(0),
          angle,
          startR,
          w: rand(30, 46),
          rotFrom: rand(-28, 28),
          delay: Math.round(rand(0, 1800)),
          dur: Math.round(rand(2200, 3200)),
          tint: i % 3, // 卡片配色微变
        };
      }),
    []
  );

  // 背景微光点（缓慢明灭，营造星尘景深）
  const sparks = useMemo(
    () =>
      Array.from({ length: SPARK_COUNT }).map(() => ({
        twinkle: new Animated.Value(Math.random()),
        x: rand(-SCREEN_W * 0.45, SCREEN_W * 0.45),
        y: rand(-260, 260),
        size: rand(1.5, 3),
        dur: Math.round(rand(1200, 2600)),
      })),
    []
  );

  useEffect(() => {
    // 到时自动进入 + 倒计时显示
    let finishTimer = null;
    let countTimer = null;
    let skipTimer = null;
    if (minDurationMs > 0 && onFinish) {
      const startedAt = Date.now();
      finishTimer = setTimeout(finish, minDurationMs);
      countTimer = setInterval(() => {
        const left = Math.max(0, minDurationMs - (Date.now() - startedAt));
        setRemain(Math.ceil(left / 1000));
        if (left <= 0 && countTimer) { clearInterval(countTimer); countTimer = null; }
      }, 250);
    }
    if (skippable && onFinish) {
      skipTimer = setTimeout(() => setCanSkip(true), Math.max(0, skipAfterMs));
    }

    Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();

    // 罗盘极缓自转（很慢，仅添一丝生命感）
    Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 14000, easing: Easing.linear, useNativeDriver: true })
    ).start();

    Animated.timing(fade, { toValue: 1, duration: 900, delay: 350, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();

    // 照片卡片各自循环飞入，靠 delay 错峰
    const photoLoops = photos.map((p) => {
      const loop = Animated.loop(
        Animated.timing(p.progress, { toValue: 1, duration: p.dur, easing: Easing.in(Easing.cubic), useNativeDriver: true })
      );
      const timer = setTimeout(() => loop.start(), p.delay);
      return { loop, timer };
    });

    // 微光点明灭
    const sparkLoops = sparks.map((s) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(s.twinkle, { toValue: 1, duration: s.dur, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(s.twinkle, { toValue: 0.2, duration: s.dur, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      )
    );
    sparkLoops.forEach((l) => l.start());

    return () => {
      if (finishTimer) clearTimeout(finishTimer);
      if (countTimer) clearInterval(countTimer);
      if (skipTimer) clearTimeout(skipTimer);
      breathe.stopAnimation();
      spin.stopAnimation();
      fade.stopAnimation();
      photoLoops.forEach(({ loop, timer }) => { clearTimeout(timer); loop.stop(); });
      sparkLoops.forEach((l) => l.stop());
    };
  }, [breathe, spin, fade, photos, sparks, minDurationMs, onFinish, finish, skippable, skipAfterMs]);

  const glowScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1.1] });
  const glowInnerOp = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.16, 0.26] });
  const glowMidOp = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.08, 0.14] });
  const glowOuterOp = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.04, 0.08] });
  const compassScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.99, 1.03] });
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={styles.root}>
      {/* 右上角：跳过 + 倒计时 */}
      {skippable && canSkip && (
        <TouchableOpacity style={styles.skipBtn} activeOpacity={0.8} onPress={finish}>
          <Text style={styles.skipText}>跳过{remain > 0 ? ` ${remain}s` : ''}</Text>
        </TouchableOpacity>
      )}

      {/* 角落辉光底纹 */}
      <View pointerEvents="none" style={styles.gridGlowA} />
      <View pointerEvents="none" style={styles.gridGlowB} />

      <View style={styles.stage}>
        {/* 背景微光点 */}
        {sparks.map((s, i) => (
          <Animated.View
            key={`s${i}`}
            pointerEvents="none"
            style={[
              styles.spark,
              {
                width: s.size,
                height: s.size,
                borderRadius: s.size,
                opacity: s.twinkle,
                transform: [{ translateX: s.x }, { translateY: s.y }],
              },
            ]}
          />
        ))}

        {/* 三层柔光 halo（假径向渐变，中心亮、向外快速衰减） */}
        <Animated.View pointerEvents="none" style={[styles.glowOuter, { opacity: glowOuterOp, transform: [{ scale: glowScale }] }]} />
        <Animated.View pointerEvents="none" style={[styles.glowMid, { opacity: glowMidOp, transform: [{ scale: glowScale }] }]} />
        <Animated.View pointerEvents="none" style={[styles.glowInner, { opacity: glowInnerOp, transform: [{ scale: glowScale }] }]} />

        {/* 照片卡片：从后方飞向中心，由远及近放大，最后被吸入消失 */}
        {photos.map((p, i) => {
          const r = p.progress.interpolate({ inputRange: [0, 1], outputRange: [p.startR, 0] });
          const tx = Animated.multiply(r, Math.cos(p.angle));
          const ty = Animated.multiply(r, Math.sin(p.angle));
          const scale = p.progress.interpolate({ inputRange: [0, 0.2, 0.72, 1], outputRange: [0.32, 0.7, 1.0, 0.1] });
          const opacity = p.progress.interpolate({ inputRange: [0, 0.12, 0.74, 1], outputRange: [0, 0.95, 0.9, 0] });
          const rot = p.progress.interpolate({ inputRange: [0, 1], outputRange: [`${p.rotFrom}deg`, '0deg'] });
          return (
            <Animated.View
              key={`p${i}`}
              pointerEvents="none"
              style={[
                styles.photo,
                PHOTO_TINTS[p.tint],
                { width: p.w, height: p.w * 0.78, opacity, transform: [{ translateX: tx }, { translateY: ty }, { scale }, { rotate: rot }] },
              ]}
            >
              {/* 照片内的极简「风景」motif：地平线 + 圆点（太阳） */}
              <View style={styles.photoSun} />
              <View style={styles.photoHorizon} />
            </Animated.View>
          );
        })}

        {/* 中心罗盘核心（呼吸缩放 + 极缓自转） */}
        <Animated.Image
          source={COMPASS}
          resizeMode="contain"
          style={[styles.compass, { transform: [{ scale: compassScale }, { rotate }] }]}
        />
      </View>

      {/* 品牌名 + 标语 */}
      <Animated.View style={[styles.textWrap, { opacity: fade }]}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.tagline}>{tagline}</Text>
      </Animated.View>
    </View>
  );
}

const COMPASS_SIZE = 188;

// 卡片配色微变（青/暖/中性），统一低饱和，避免花
const PHOTO_TINTS = [
  { backgroundColor: 'rgba(22,46,52,0.92)', borderColor: 'rgba(150,230,228,0.7)' },
  { backgroundColor: 'rgba(46,40,30,0.92)', borderColor: 'rgba(230,205,160,0.6)' },
  { backgroundColor: 'rgba(30,38,52,0.92)', borderColor: 'rgba(180,205,235,0.6)' },
];

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' },
  gridGlowA: { position: 'absolute', top: -120, left: -80, width: 320, height: 320, borderRadius: 320, backgroundColor: 'rgba(61,212,208,0.06)' },
  gridGlowB: { position: 'absolute', bottom: -140, right: -90, width: 340, height: 340, borderRadius: 340, backgroundColor: 'rgba(61,212,208,0.05)' },
  stage: { width: 300, height: 300, alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  spark: { position: 'absolute', backgroundColor: ACCENT },
  glowOuter: { position: 'absolute', width: 252, height: 252, borderRadius: 252, backgroundColor: ACCENT },
  glowMid: { position: 'absolute', width: 176, height: 176, borderRadius: 176, backgroundColor: ACCENT },
  glowInner: { position: 'absolute', width: 116, height: 116, borderRadius: 116, backgroundColor: ACCENT },
  compass: { position: 'absolute', width: COMPASS_SIZE, height: COMPASS_SIZE },
  photo: {
    position: 'absolute',
    borderRadius: 6,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: ACCENT,
    shadowOpacity: 0.5,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  photoSun: { position: 'absolute', top: 4, right: 5, width: 5, height: 5, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.75)' },
  photoHorizon: { width: '78%', height: 1.5, marginBottom: 5, backgroundColor: 'rgba(255,255,255,0.45)' },
  skipBtn: {
    position: 'absolute',
    top: 56,
    right: 16,
    zIndex: 10,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(180,235,232,0.4)',
  },
  skipText: { color: 'rgba(225,245,244,0.92)', fontSize: 13, fontWeight: '600', letterSpacing: 0.5 },
  textWrap: { alignItems: 'center', position: 'absolute', bottom: 92 },
  title: { fontSize: 26, fontWeight: '600', color: '#F2FBFB', letterSpacing: 4, marginBottom: 10 },
  tagline: { fontSize: 12.5, color: 'rgba(210,230,230,0.66)', letterSpacing: 1.5 },
});
