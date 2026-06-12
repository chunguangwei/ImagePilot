/**
 * DepthSlider —— 纯 JS 横向滑杆（修图深度选择）。
 *
 * 不引 @react-native-community/slider：本工程无 autolinking，新原生依赖要接
 * settings.gradle/build.gradle/MainApplication 三件套 + pod install，一个滑杆不值得。
 * PanResponder 实现：grant 用 locationX 定起点，move 用 dx 累加（locationX 在 move
 * 期间离开视图会漂，dx 稳定）；点按轨道任意处直接跳到该值并触发 onComplete。
 *
 * props:
 * - value: 0..1 当前值（受控）
 * - onChange(v): 拖动中实时回调（仅更新 UI，勿做重活）
 * - onComplete(v): 松手回调（这里触发重处理）
 * - min: 最小值（默认 0.1——深度 0 没有意义）
 * - trackWidth: 轨道宽（默认 200）
 * - disabled
 */
import React, { useRef } from 'react';
import { View, PanResponder, StyleSheet } from 'react-native';

const THUMB = 22;

export default function DepthSlider({
  value = 0.8, onChange, onComplete, min = 0.1, trackWidth = 200, disabled = false,
}) {
  // PanResponder 只建一次，回调/参数全走 ref 防闭包过期
  const ref = useRef({});
  ref.current = { onChange, onComplete, min, trackWidth, disabled };
  const startRatio = useRef(0);

  const clampVal = (ratio) => {
    const { min: mn } = ref.current;
    const v = Math.min(1, Math.max(mn, ratio));
    return Math.round(v * 100) / 100;
  };

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !ref.current.disabled,
    onMoveShouldSetPanResponder: () => !ref.current.disabled,
    // 横向拖动不让父级（图片左右切换等）抢手势
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (evt) => {
      startRatio.current = evt.nativeEvent.locationX / ref.current.trackWidth;
      const v = clampVal(startRatio.current);
      if (ref.current.onChange) ref.current.onChange(v);
    },
    onPanResponderMove: (_, g) => {
      const v = clampVal(startRatio.current + g.dx / ref.current.trackWidth);
      if (ref.current.onChange) ref.current.onChange(v);
    },
    onPanResponderRelease: (_, g) => {
      const v = clampVal(startRatio.current + g.dx / ref.current.trackWidth);
      if (ref.current.onComplete) ref.current.onComplete(v);
    },
  })).current;

  const fillW = Math.max(0, Math.min(1, value)) * trackWidth;
  return (
    <View
      style={[styles.touchArea, { width: trackWidth, opacity: disabled ? 0.4 : 1 }]}
      {...pan.panHandlers}
    >
      <View style={styles.track}>
        <View style={[styles.fill, { width: fillW }]} />
      </View>
      <View style={[styles.thumb, { left: fillW - THUMB / 2 }]} pointerEvents="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  // 纵向加肥触摸区（轨道本身只有 4px 高）
  touchArea: { height: 36, justifyContent: 'center' },
  track: {
    height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
  },
  fill: { height: 4, borderRadius: 2, backgroundColor: '#FFFFFF' },
  thumb: {
    position: 'absolute', top: (36 - THUMB) / 2,
    width: THUMB, height: THUMB, borderRadius: THUMB / 2,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 3, shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
});
