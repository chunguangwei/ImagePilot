import React, { useEffect } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { getUri } from '../../adapters/WebAdapters';

/**
 * 标题卡：9:16 容器，背景取一张图（暗化）+ 居中标题/副标题。供 view-shot 截图。
 * onBgReady：背景图加载完（或加载失败 / 无背景图）后回调——调用方据此再截图，
 * 避免在图片未加载完时截导致 iOS view-shot 原生崩溃。
 */
export default function ShowcaseTitleCard({ bgImage, title, subtitle, color = '#FFFFFF', width = 270, height = 480, typo, onBgReady }) {
  // 无背景图：下一帧即就绪（无需等图片加载）
  useEffect(() => {
    if (!bgImage && onBgReady) onBgReady();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 排版预设：按模板风格变字重/字号/字距/描边/斜体，让不同模板标题卡观感不同
  const t = typo || {};
  const baseSize = Math.round(Math.min(width, height) * 0.1); // 随卡片尺寸缩放
  const titleStyle = {
    color,
    fontSize: Math.round(baseSize * (t.sizeScale || 1)),
    fontWeight: t.weight || '800',
    letterSpacing: typeof t.letterSpacing === 'number' ? t.letterSpacing : 1,
    fontStyle: t.italic ? 'italic' : 'normal',
    textShadowColor: t.shadow ? 'rgba(0,0,0,0.55)' : 'transparent',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: t.shadow ? 4 : 0,
  };
  return (
    <View style={[styles.card, { width, height }]}>
      {bgImage ? (
        <Image
          source={{ uri: getUri(bgImage) || bgImage?.uri }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onLoad={() => onBgReady && onBgReady()}
          onError={() => onBgReady && onBgReady()}
        />
      ) : null}
      <View style={[StyleSheet.absoluteFill, styles.scrim]} />
      <View style={styles.center}>
        {title ? <Text style={[styles.title, titleStyle]} numberOfLines={3}>{title}</Text> : null}
        {subtitle ? <Text style={[styles.subtitle, { color }]} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#000', overflow: 'hidden' },
  scrim: { backgroundColor: 'rgba(0,0,0,0.4)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  title: { fontSize: 26, fontWeight: '800', textAlign: 'center', letterSpacing: 1 },
  subtitle: { fontSize: 15, fontWeight: '600', textAlign: 'center', marginTop: 12, opacity: 0.92 },
});
