/**
 * jimpFilters — 纯 JS 滤镜（基于 jimp v0.22，CPU 处理，离线，RN+Electron 通用）
 *
 * 无任何原生模块依赖：读图字节 → Jimp 处理 → 输出 base64 data URL。
 * 用 jimp v0.22（扁平模块结构，Metro 友好；v1 的 package-exports 子路径 Metro 无法解析）。
 * 仅使用已实测可用的方法：greyscale/sepia/invert/blur/brightness/contrast。
 */

import Jimp from './jimpCustom.js'; // RN/Hermes 下可用、带 .read 的定制 Jimp（见该文件说明）

/** 滤镜注册表：id → { name, apply(jimpImage, intensity) } */
export const JIMP_FILTERS = Object.freeze({
  none: { name: '原图', apply: null },
  grayscale: { name: '黑白', apply: (img) => img.greyscale() },
  sepia: { name: '复古', apply: (img) => img.sepia() },
  bright: { name: '提亮', apply: (img, i) => img.brightness(0.3 * i) },
  contrast: { name: '增强', apply: (img, i) => img.contrast(0.4 * i) },
  soften: { name: '柔化', apply: (img, i) => img.blur(Math.max(1, Math.round(1 + i * 5))) },
  invert: { name: '反色', apply: (img) => img.invert() },
});

export const JIMP_FILTER_IDS = Object.freeze(Object.keys(JIMP_FILTERS));

export const hasIntensity = (id) => ['bright', 'contrast', 'soften'].includes(id);

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
