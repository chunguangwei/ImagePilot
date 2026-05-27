/**
 * jimpFilters — 纯 JS 滤镜（基于 jimp v0.22，CPU 处理，离线，RN+Electron 通用）
 *
 * 无任何原生模块依赖：读图字节 → Jimp 处理 → 输出 base64 data URL。
 * 用 jimp v0.22（扁平模块结构，Metro 友好；v1 的 package-exports 子路径 Metro 无法解析）。
 * 仅使用已实测可用的方法：greyscale/sepia/invert/blur/brightness/contrast。
 */

import Jimp from './jimpCustom.js'; // RN/Hermes 下可用、带 .read 的定制 Jimp（见该文件说明）

// ── 基于像素扫描的色调工具（jimp 无内置 LUT/曲线，用 scan 实现）──
/** 抬黑：把暗部整体抬升 lift（0..255），营造"褪色胶片"感 */
function liftBlacks(img, lift) {
  const s = (255 - lift) / 255;
  const d = img.bitmap.data;
  for (let k = 0; k < d.length; k += 4) {
    for (let c = 0; c < 3; c++) d[k + c] = Math.min(255, lift + d[k + c] * s);
  }
}

/** 暖/冷色温：对红/蓝通道做线性偏移（amt 正暖负冷，单位 ~色阶） */
function temperature(img, amt) {
  const d = img.bitmap.data;
  for (let k = 0; k < d.length; k += 4) {
    d[k] = Math.max(0, Math.min(255, d[k] + amt));       // R
    d[k + 2] = Math.max(0, Math.min(255, d[k + 2] - amt)); // B
  }
}

/** 滤镜注册表：id → { name, apply(jimpImage, intensity) } */
export const JIMP_FILTERS = Object.freeze({
  none: { name: '原图', apply: null },
  grayscale: { name: '黑白', apply: (img) => img.greyscale() },
  sepia: { name: '复古', apply: (img) => img.sepia() },
  bright: { name: '提亮', apply: (img, i) => img.brightness(0.3 * i) },
  contrast: { name: '增强', apply: (img, i) => img.contrast(0.4 * i) },
  // ── #5 滤镜扩展：饱和度 / 色温 / 曲线（褪色胶片）──
  vivid: { name: '鲜艳', apply: (img, i) => { img.color([{ apply: 'saturate', params: [35 * i] }]); img.contrast(0.1 * i); } },
  fade: { name: '淡雅', apply: (img, i) => { img.color([{ apply: 'desaturate', params: [22 * i] }]); liftBlacks(img, Math.round(26 * i)); } },
  warm: { name: '暖色', apply: (img, i) => temperature(img, Math.round(22 * i)) },
  cool: { name: '冷色', apply: (img, i) => temperature(img, -Math.round(22 * i)) },
  film: { name: '胶片', apply: (img, i) => { img.contrast(0.12 * i); img.color([{ apply: 'desaturate', params: [10 * i] }]); liftBlacks(img, Math.round(14 * i)); temperature(img, Math.round(8 * i)); } },
  soften: { name: '柔化', apply: (img, i) => img.blur(Math.max(1, Math.round(1 + i * 5))) },
  invert: { name: '反色', apply: (img) => img.invert() },
});

export const JIMP_FILTER_IDS = Object.freeze(Object.keys(JIMP_FILTERS));

export const hasIntensity = (id) => ['bright', 'contrast', 'soften', 'vivid', 'fade', 'warm', 'cool', 'film'].includes(id);

/**
 * #4 美颜（一期·全局磨皮）：保边平滑 + 提亮 + 暖肤气色。
 * 无人脸检测，对全图做"surface blur"式平滑（模糊图与原图按 keep 混合，
 * keep 越小越平滑），强度越高越柔。返回 data URL（image/jpeg）。
 * @param {string} base64 含/不含 data: 前缀
 * @param {number} intensity 0..1
 */
export async function applyBeautyToBase64(base64, intensity = 0.8) {
  const clean = base64.startsWith('data:') ? base64.split(',')[1] : base64;
  const img = await Jimp.read(Buffer.from(clean, 'base64'));
  const radius = Math.max(2, Math.round(2 + intensity * 4));
  const blurred = img.clone().blur(radius);
  const keep = 0.5 - 0.28 * intensity; // 保留的高频细节比例（越小越磨）
  const od = img.bitmap.data;
  const bd = blurred.bitmap.data;
  for (let k = 0; k < od.length; k += 4) {
    for (let c = 0; c < 3; c++) {
      const v = bd[k + c] + (od[k + c] - bd[k + c]) * keep;
      od[k + c] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
  img.brightness(0.05 * intensity); // 提亮
  img.color([{ apply: 'red', params: [5 * intensity] }, { apply: 'saturate', params: [6 * intensity] }]); // 暖肤+气色
  return img.getBase64Async(Jimp.MIME_JPEG);
}

/**
 * 对 base64 图片应用滤镜，返回处理后的 data URL（image/jpeg）。
 * @param {string} base64 - 无前缀或带 data: 前缀的图片 base64
 * @param {string} filterId
 * @param {number} intensity - 0..1
 * @returns {Promise<string>} data URL（带前缀）
 */
export async function applyJimpFilterToBase64(base64, filterId, intensity = 1) {
  const clean = base64.startsWith('data:') ? base64.split(',')[1] : base64;
  const img = await Jimp.read(Buffer.from(clean, 'base64'));
  const f = JIMP_FILTERS[filterId];
  if (f && f.apply) f.apply(img, intensity);
  return img.getBase64Async(Jimp.MIME_JPEG);
}

export default JIMP_FILTERS;
