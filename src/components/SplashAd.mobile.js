// 远程图 / 广告启动屏（由 SplashConfigService 下发）
// 能力：全屏图替换、点击跳转外链、倒计时 + 跳过按钮、到时自动进入。
// 任何渲染异常都会通过 onFinish 让 App 回到正常流程，不卡死。
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Linking,
  StatusBar,
} from 'react-native';

export default function SplashAd({
  source,                 // { uri }
  link = '',
  linkEnabled = false,
  durationMs = 4000,
  skippable = true,
  skipAfterMs = 1000,
  onFinish,               // () => void：到时 / 跳过 / 出错都调用
}) {
  const [remain, setRemain] = useState(Math.ceil(durationMs / 1000));
  const [canSkip, setCanSkip] = useState(skippable && skipAfterMs <= 0);
  const finishedRef = useRef(false);

  const finish = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinish && onFinish();
  };

  useEffect(() => {
    // 倒计时（秒）：每秒刷新一次显示
    const startedAt = Date.now();
    const tick = setInterval(() => {
      const left = Math.max(0, durationMs - (Date.now() - startedAt));
      setRemain(Math.ceil(left / 1000));
      if (left <= 0) {
        clearInterval(tick);
        finish();
      }
    }, 250);

    // 跳过按钮延迟出现
    let skipTimer = null;
    if (skippable && skipAfterMs > 0) {
      skipTimer = setTimeout(() => setCanSkip(true), skipAfterMs);
    }

    return () => {
      clearInterval(tick);
      if (skipTimer) clearTimeout(skipTimer);
    };
  }, [durationMs, skippable, skipAfterMs]);

  const handlePressImage = async () => {
    if (!linkEnabled || !link) return;
    try {
      const ok = await Linking.canOpenURL(link);
      if (ok) {
        await Linking.openURL(link);
        // 跳转外链后即结束启动屏（用户回来直接进主页）
        finish();
      }
    } catch (_) {
      /* 打开失败：忽略，继续展示直到倒计时结束 */
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      <TouchableWithoutFeedback onPress={handlePressImage}>
        <Image
          source={source}
          style={styles.image}
          resizeMode="cover"
          // 图片加载失败 → 直接结束，回退主流程（避免黑屏停留）
          onError={finish}
        />
      </TouchableWithoutFeedback>

      {/* 右上角：跳过 + 倒计时 */}
      {skippable && canSkip && (
        <TouchableOpacity style={styles.skipBtn} activeOpacity={0.8} onPress={finish}>
          <Text style={styles.skipText}>跳过 {remain}s</Text>
        </TouchableOpacity>
      )}

      {/* 左下角：广告标识（合规，避免误触争议） */}
      {linkEnabled && (
        <View style={styles.adTag} pointerEvents="none">
          <Text style={styles.adTagText}>广告</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  image: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  skipBtn: {
    position: 'absolute',
    top: 56,
    right: 16,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  skipText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600', letterSpacing: 0.5 },
  adTag: {
    position: 'absolute',
    left: 16,
    bottom: 34,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  adTagText: { color: 'rgba(255,255,255,0.7)', fontSize: 10 },
});
