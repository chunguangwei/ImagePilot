/**
 * superResTensor — 超分(Real-ESRGAN 等)推理的像素↔张量工具 + 大图分块
 *
 * 纯函数、零依赖，可在骨架单测；fork 端把 jimp 解码出的 RGBA 喂进来、
 * 用 onnxruntime 跑模型、再用本模块还原为 RGBA。
 *
 * 约定：模型输入 NCHW float32、RGB、归一化到 [0,1]（Real-ESRGAN 通用约定）。
 * 输出同形 [1,3,H*scale,W*scale]，值域 ~[0,1]（postprocess 会 clamp）。
 */

/**
 * RGBA(Uint8) → CHW float32（RGB，/255）。
 * @param {Uint8Array|Uint8ClampedArray|number[]} rgba - 长度 w*h*4
 * @param {number} w
 * @param {number} h
 * @returns {Float32Array} 长度 3*w*h，顺序 [R(plane), G(plane), B(plane)]
 */
export function rgbaToCHW(rgba, w, h) {
  const n = w * h;
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    out[i] = rgba[i * 4] / 255;             // R plane
    out[n + i] = rgba[i * 4 + 1] / 255;     // G plane
    out[2 * n + i] = rgba[i * 4 + 2] / 255; // B plane
  }
  return out;
}

/**
 * CHW float32（RGB，[0,1]）→ RGBA(Uint8ClampedArray)，alpha=255。
 * @param {Float32Array|number[]} chw - 长度 3*w*h
 * @param {number} w
 * @param {number} h
 * @returns {Uint8ClampedArray} 长度 w*h*4
 */
export function chwToRGBA(chw, w, h) {
  const n = w * h;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4] = Math.round(chw[i] * 255);
    out[i * 4 + 1] = Math.round(chw[n + i] * 255);
    out[i * 4 + 2] = Math.round(chw[2 * n + i] * 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * 计算大图分块（带重叠，避免接缝 + 控制显存/内存）。
 * 返回每块的 {x,y,w,h}（输入坐标系）；重叠区在拼接时按块边裁掉。
 * @param {number} width
 * @param {number} height
 * @param {number} [tile=256] - 块边长（输入像素）
 * @param {number} [overlap=16] - 相邻块重叠像素
 * @returns {Array<{x:number,y:number,w:number,h:number}>}
 */
export function planTiles(width, height, tile = 256, overlap = 16) {
  if (width <= tile && height <= tile) return [{ x: 0, y: 0, w: width, h: height }];
  const step = Math.max(1, tile - overlap);
  const out = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const w = Math.min(tile, width - x);
      const h = Math.min(tile, height - y);
      out.push({ x, y, w, h });
      if (x + w >= width) break;
    }
    if (y + Math.min(tile, height - y) >= height) break;
  }
  return out;
}

/** 是否需要分块（任一边超过 tile） */
export function needsTiling(width, height, tile = 256) {
  return width > tile || height > tile;
}
