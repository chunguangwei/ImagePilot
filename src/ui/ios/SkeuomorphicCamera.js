/**
 * SkeuomorphicCamera — 纯 RN View 合成的拟物化相机图标。
 * 不依赖图片资源/字体，任意像素密度都清晰；用作「按内容分类」等空缩略图占位。
 *
 * 通过层叠 View + 边框伪造体积感：机身高光条、取景器凸起、闪光灯、镜头同心环与玻璃反光、快门键。
 * size 为机身宽度，其余尺寸按比例派生。
 * scheme：'onColor'（彩色卡片上，白色半透明，默认）/ 'onLight'（浅色底上，灰色，保证可见）。
 */
import React from 'react';
import { View } from 'react-native';

const PALETTES = {
  onColor: {
    bump: 'rgba(255,255,255,0.30)', body: 'rgba(255,255,255,0.32)', border: 'rgba(255,255,255,0.6)',
    highlight: 'rgba(255,255,255,0.18)', flash: 'rgba(255,255,255,0.6)', shutter: 'rgba(255,255,255,0.45)',
    lensInner: 'rgba(0,0,0,0.18)', lensRing: '#FFFFFF', glass: 'rgba(255,255,255,0.35)', reflect: 'rgba(255,255,255,0.85)',
  },
  onLight: {
    bump: 'rgba(0,0,0,0.10)', body: 'rgba(0,0,0,0.05)', border: '#C7C7CC',
    highlight: 'rgba(0,0,0,0.04)', flash: '#C7C7CC', shutter: '#C7C7CC',
    lensInner: 'rgba(0,0,0,0.08)', lensRing: '#AEAEB2', glass: 'rgba(0,0,0,0.06)', reflect: 'rgba(255,255,255,0.9)',
  },
};

export default function SkeuomorphicCamera({ size = 56, scheme = 'onColor', tint }) {
  const C = PALETTES[scheme] || PALETTES.onColor;
  const ring = tint || C.lensRing; // 兼容旧的 tint 入参（覆盖镜头环颜色）
  const bodyW = size;
  const bodyH = Math.round(size * 0.74);
  const lens = Math.round(size * 0.46);
  const r = Math.round(size * 0.16);

  return (
    <View style={{ width: bodyW, height: bodyH + Math.round(size * 0.1), alignItems: 'center', justifyContent: 'flex-end' }}>
      {/* 取景器凸起 */}
      <View style={{
        position: 'absolute', top: 0, left: Math.round(size * 0.22),
        width: Math.round(size * 0.26), height: Math.round(size * 0.16),
        borderTopLeftRadius: Math.round(size * 0.05), borderTopRightRadius: Math.round(size * 0.05),
        backgroundColor: C.bump,
      }} />
      {/* 机身 */}
      <View style={{
        width: bodyW, height: bodyH, borderRadius: r, backgroundColor: C.body,
        borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      }}>
        {/* 顶部高光条 */}
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: Math.round(bodyH * 0.32), backgroundColor: C.highlight }} />
        {/* 闪光灯 */}
        <View style={{ position: 'absolute', top: Math.round(size * 0.1), left: Math.round(size * 0.12), width: Math.round(size * 0.1), height: Math.round(size * 0.1), borderRadius: Math.round(size * 0.05), backgroundColor: C.flash }} />
        {/* 快门键 */}
        <View style={{ position: 'absolute', top: Math.round(size * 0.1), right: Math.round(size * 0.12), width: Math.round(size * 0.07), height: Math.round(size * 0.07), borderRadius: Math.round(size * 0.035), backgroundColor: C.shutter }} />
        {/* 镜头外环 */}
        <View style={{
          width: lens, height: lens, borderRadius: lens / 2, backgroundColor: C.lensInner,
          borderWidth: Math.max(2, Math.round(size * 0.05)), borderColor: ring, alignItems: 'center', justifyContent: 'center',
        }}>
          {/* 镜头玻璃 */}
          <View style={{ width: Math.round(lens * 0.6), height: Math.round(lens * 0.6), borderRadius: Math.round(lens * 0.3), backgroundColor: C.glass, alignItems: 'flex-start', justifyContent: 'flex-start' }}>
            {/* 反光高光点 */}
            <View style={{ width: Math.round(lens * 0.18), height: Math.round(lens * 0.18), borderRadius: Math.round(lens * 0.09), marginTop: Math.round(lens * 0.1), marginLeft: Math.round(lens * 0.12), backgroundColor: C.reflect }} />
          </View>
        </View>
      </View>
    </View>
  );
}
