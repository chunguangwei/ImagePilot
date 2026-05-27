/**
 * SkeuomorphicCamera — 纯 RN View 合成的拟物化相机图标。
 * 不依赖图片资源/字体，任意像素密度都清晰；用作「按内容分类」等空缩略图占位。
 *
 * 通过层叠 View + 边框 + 阴影伪造体积感：机身高光条、取景器凸起、闪光灯、
 * 镜头同心环与玻璃反光、快门键。size 为机身宽度，其余尺寸按比例派生。
 */
import React from 'react';
import { View } from 'react-native';

export default function SkeuomorphicCamera({ size = 56, tint = '#FFFFFF' }) {
  const bodyW = size;
  const bodyH = Math.round(size * 0.74);
  const lens = Math.round(size * 0.46);
  const r = Math.round(size * 0.16);

  return (
    <View style={{ width: bodyW, height: bodyH + Math.round(size * 0.1), alignItems: 'center', justifyContent: 'flex-end' }}>
      {/* 取景器凸起（机身顶部中央偏左的小方块） */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: Math.round(size * 0.22),
          width: Math.round(size * 0.26),
          height: Math.round(size * 0.16),
          borderTopLeftRadius: Math.round(size * 0.05),
          borderTopRightRadius: Math.round(size * 0.05),
          backgroundColor: 'rgba(255,255,255,0.30)',
        }}
      />
      {/* 机身 */}
      <View
        style={{
          width: bodyW,
          height: bodyH,
          borderRadius: r,
          backgroundColor: 'rgba(255,255,255,0.32)',
          borderWidth: 1.5,
          borderColor: 'rgba(255,255,255,0.6)',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {/* 顶部高光条 */}
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: Math.round(bodyH * 0.32),
            backgroundColor: 'rgba(255,255,255,0.18)',
          }}
        />
        {/* 闪光灯（左上小点） */}
        <View
          style={{
            position: 'absolute',
            top: Math.round(size * 0.1),
            left: Math.round(size * 0.12),
            width: Math.round(size * 0.1),
            height: Math.round(size * 0.1),
            borderRadius: Math.round(size * 0.05),
            backgroundColor: 'rgba(255,255,255,0.6)',
          }}
        />
        {/* 快门键（右上小点） */}
        <View
          style={{
            position: 'absolute',
            top: Math.round(size * 0.1),
            right: Math.round(size * 0.12),
            width: Math.round(size * 0.07),
            height: Math.round(size * 0.07),
            borderRadius: Math.round(size * 0.035),
            backgroundColor: 'rgba(255,255,255,0.45)',
          }}
        />
        {/* 镜头外环 */}
        <View
          style={{
            width: lens,
            height: lens,
            borderRadius: lens / 2,
            backgroundColor: 'rgba(0,0,0,0.18)',
            borderWidth: Math.max(2, Math.round(size * 0.05)),
            borderColor: tint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* 镜头玻璃 */}
          <View
            style={{
              width: Math.round(lens * 0.6),
              height: Math.round(lens * 0.6),
              borderRadius: Math.round(lens * 0.3),
              backgroundColor: 'rgba(255,255,255,0.35)',
              alignItems: 'flex-start',
              justifyContent: 'flex-start',
            }}
          >
            {/* 反光高光点 */}
            <View
              style={{
                width: Math.round(lens * 0.18),
                height: Math.round(lens * 0.18),
                borderRadius: Math.round(lens * 0.09),
                marginTop: Math.round(lens * 0.1),
                marginLeft: Math.round(lens * 0.12),
                backgroundColor: 'rgba(255,255,255,0.85)',
              }}
            />
          </View>
        </View>
      </View>
    </View>
  );
}
