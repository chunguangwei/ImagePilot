// ImagePilot 启动/初始化加载屏（动态）
// 设计理念："智能分类 · 便捷管理 · 仅你可见"
//   - 散落的"光点照片"沿引力汇聚向中心 → 呼应 AI 自动分类的归拢
//   - 中心罗盘式光环（Pilot/领航）呼吸发光 → 品牌符号
//   - 深空黑底 + 单一青蓝强调色，克制高端
// 实现：纯 react-native Animated（开启 native driver），零额外依赖，
//       不引 Reanimated / SVG，可直接发版。
import React, { useEffect, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, Animated, Easing, Dimensions } from 'react-native';

const BG = '#0A0E14';        // 深空黑
const ACCENT = '#3DD4D0';    // 品牌青蓝
const ACCENT_DIM = 'rgba(61,212,208,0.55)';

const { width: SCREEN_W } = Dimensions.get('window');

// 汇聚粒子的数量与起始半径
const PARTICLE_COUNT = 14;
const SPAWN_RADIUS = Math.min(SCREEN_W * 0.42, 170);

export default function SplashLoading({
  title = 'ImagePilot',
  tagline = '智能分类 · 便捷管理 · 仅你可见',
  minDurationMs = 0,   // >0 时：展示满该时长后回调 onFinish（让品牌动效完整播一轮）
  onFinish,            // () => void
}) {
  // 中心光晕呼吸
  const breathe = useRef(new Animated.Value(0)).current;
  // 罗盘环旋转
  const spin = useRef(new Animated.Value(0)).current;
  // 文案/标语渐显
  const fade = useRef(new Animated.Value(0)).current;

  // 每个粒子一个 0→1 进度（汇聚动画），起始角度固定分布
  const particles = useMemo(
    () =>
      Array.from({ length: PARTICLE_COUNT }).map((_, i) => {
        const angle = (i / PARTICLE_COUNT) * Math.PI * 2;
        // 半径略随机错落，避免过于规整
        const r = SPAWN_RADIUS * (0.72 + ((i * 37) % 100) / 360);
        return {
          progress: new Animated.Value(0),
          startX: Math.cos(angle) * r,
          startY: Math.sin(angle) * r,
          size: 3 + (i % 3),       // 3~5px
          delay: i * 170,          // 错峰，形成连续"水流"汇聚感
        };
      }),
    []
  );

  useEffect(() => {
    // 最短展示时长到点后通知 App 可进入主页（动效完整播一轮）
    let finishTimer = null;
    if (minDurationMs > 0 && onFinish) {
      finishTimer = setTimeout(() => onFinish(), minDurationMs);
    }

    // 呼吸：0→1→0 循环
    Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();

    // 旋转：匀速 360°
    Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 5200,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();

    // 标语渐显
    Animated.timing(fade, {
      toValue: 1,
      duration: 900,
      delay: 350,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();

    // 粒子汇聚：每个独立循环，靠 delay 错峰；
    // progress 在 1→0 瞬间跳变时 opacity 恰为 0，跳变不可见。
    const loops = particles.map((p) => {
      const loop = Animated.loop(
        Animated.timing(p.progress, {
          toValue: 1,
          duration: 2300,
          easing: Easing.in(Easing.cubic), // 越靠近中心越快，像被引力吸入
          useNativeDriver: true,
        })
      );
      const timer = setTimeout(() => loop.start(), p.delay);
      return { loop, timer };
    });

    return () => {
      if (finishTimer) clearTimeout(finishTimer);
      breathe.stopAnimation();
      spin.stopAnimation();
      fade.stopAnimation();
      loops.forEach(({ loop, timer }) => {
        clearTimeout(timer);
        loop.stop();
      });
    };
  }, [breathe, spin, fade, particles, minDurationMs, onFinish]);

  // 呼吸：整组柔光 halo 的缩放（范围收窄，避免"硬盘"感）
  const glowScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.12] });
  // 三层 halo 各自的低透明度（叠加成"中心亮、向外快速衰减"的假径向渐变）
  const glowInnerOp = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.16, 0.26] });
  const glowMidOp = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.08, 0.14] });
  const glowOuterOp = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.04, 0.08] });
  const ringOpacity = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0.9] });
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={styles.root}>
      {/* 极淡网格底纹（两条对角辉光带），避免死板纯色 */}
      <View pointerEvents="none" style={styles.gridGlowA} />
      <View pointerEvents="none" style={styles.gridGlowB} />

      {/* 中心舞台 */}
      <View style={styles.stage}>
        {/* 汇聚粒子 */}
        {particles.map((p, idx) => {
          const tx = p.progress.interpolate({ inputRange: [0, 1], outputRange: [p.startX, 0] });
          const ty = p.progress.interpolate({ inputRange: [0, 1], outputRange: [p.startY, 0] });
          const opacity = p.progress.interpolate({
            inputRange: [0, 0.12, 0.82, 1],
            outputRange: [0, 0.9, 0.85, 0],
          });
          const scale = p.progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.4] });
          return (
            <Animated.View
              key={idx}
              pointerEvents="none"
              style={[
                styles.particle,
                {
                  width: p.size,
                  height: p.size,
                  borderRadius: p.size,
                  opacity,
                  transform: [{ translateX: tx }, { translateY: ty }, { scale }],
                },
              ]}
            />
          );
        })}

        {/* 中心呼吸光晕：三层叠加，假径向渐变（中心亮、向外快速衰减），通透不发死 */}
        <Animated.View
          pointerEvents="none"
          style={[styles.glowOuter, { opacity: glowOuterOp, transform: [{ scale: glowScale }] }]}
        />
        <Animated.View
          pointerEvents="none"
          style={[styles.glowMid, { opacity: glowMidOp, transform: [{ scale: glowScale }] }]}
        />
        <Animated.View
          pointerEvents="none"
          style={[styles.glowInner, { opacity: glowInnerOp, transform: [{ scale: glowScale }] }]}
        />

        {/* 旋转罗盘外环（仅顶部一段高亮，转起来像扫描） */}
        <Animated.View style={[styles.compassSpin, { transform: [{ rotate }] }]}>
          <View style={styles.compassArc} />
        </Animated.View>

        {/* 静态双环 + 罗盘刻度 */}
        <Animated.View style={[styles.ringOuter, { opacity: ringOpacity }]} />
        <View style={styles.ringInner} />
        {/* 罗盘四向刻度点 */}
        <View style={[styles.tick, styles.tickN]} />
        <View style={[styles.tick, styles.tickS]} />
        <View style={[styles.tick, styles.tickE]} />
        <View style={[styles.tick, styles.tickW]} />
        {/* 中心核心点 */}
        <View style={styles.core} />
      </View>

      {/* 品牌名 + 标语 */}
      <Animated.View style={[styles.textWrap, { opacity: fade }]}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.tagline}>{tagline}</Text>
      </Animated.View>
    </View>
  );
}

const RING_OUTER = 116;
const RING_INNER = 74;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridGlowA: {
    position: 'absolute',
    top: -120,
    left: -80,
    width: 320,
    height: 320,
    borderRadius: 320,
    backgroundColor: 'rgba(61,212,208,0.06)',
  },
  gridGlowB: {
    position: 'absolute',
    bottom: -140,
    right: -90,
    width: 340,
    height: 340,
    borderRadius: 340,
    backgroundColor: 'rgba(61,212,208,0.05)',
  },
  stage: {
    width: 260,
    height: 260,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 36,
  },
  particle: {
    position: 'absolute',
    backgroundColor: ACCENT,
    shadowColor: ACCENT,
    shadowOpacity: 0.9,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  glowOuter: {
    position: 'absolute',
    width: 244,
    height: 244,
    borderRadius: 244,
    backgroundColor: ACCENT,
  },
  glowMid: {
    position: 'absolute',
    width: 168,
    height: 168,
    borderRadius: 168,
    backgroundColor: ACCENT,
  },
  glowInner: {
    position: 'absolute',
    width: 104,
    height: 104,
    borderRadius: 104,
    backgroundColor: ACCENT,
  },
  compassSpin: {
    position: 'absolute',
    width: RING_OUTER,
    height: RING_OUTER,
    alignItems: 'center',
  },
  compassArc: {
    width: RING_OUTER,
    height: RING_OUTER,
    borderRadius: RING_OUTER,
    borderWidth: 2,
    borderColor: 'transparent',
    borderTopColor: ACCENT,
    borderRightColor: ACCENT_DIM,
  },
  ringOuter: {
    position: 'absolute',
    width: RING_OUTER,
    height: RING_OUTER,
    borderRadius: RING_OUTER,
    borderWidth: 1,
    borderColor: 'rgba(61,212,208,0.35)',
  },
  ringInner: {
    position: 'absolute',
    width: RING_INNER,
    height: RING_INNER,
    borderRadius: RING_INNER,
    borderWidth: 1,
    borderColor: 'rgba(61,212,208,0.22)',
  },
  tick: {
    position: 'absolute',
    width: 3,
    height: 3,
    borderRadius: 3,
    backgroundColor: ACCENT_DIM,
  },
  tickN: { top: (260 - RING_OUTER) / 2 - 1 },
  tickS: { bottom: (260 - RING_OUTER) / 2 - 1 },
  tickE: { right: (260 - RING_OUTER) / 2 - 1 },
  tickW: { left: (260 - RING_OUTER) / 2 - 1 },
  core: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 12,
    backgroundColor: '#EAFFFE',
    shadowColor: ACCENT,
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  textWrap: {
    alignItems: 'center',
    position: 'absolute',
    bottom: 96,
  },
  title: {
    fontSize: 26,
    fontWeight: '600',
    color: '#F2FBFB',
    letterSpacing: 4,
    marginBottom: 10,
  },
  tagline: {
    fontSize: 12.5,
    color: 'rgba(210,230,230,0.66)',
    letterSpacing: 1.5,
  },
});
