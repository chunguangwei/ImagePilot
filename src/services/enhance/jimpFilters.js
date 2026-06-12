/**
 * jimpFilters — 纯 JS 滤镜（基于 jimp v0.22，CPU 处理，离线，RN+Electron 通用）
 *
 * 无任何原生模块依赖：读图字节 → Jimp 处理 → 输出 base64 data URL。
 * 用 jimp v0.22（扁平模块结构，Metro 友好；v1 的 package-exports 子路径 Metro 无法解析）。
 * 仅使用已实测可用的方法：greyscale/sepia/invert/blur/brightness/contrast。
 */

import Jimp from './jimpCustom.js'; // RN/Hermes 下可用、带 .read 的定制 Jimp（见该文件说明）

// 像素扫描分块上限：Hermes 单批跑完 ~256K 像素需要 200~400ms。每跑一批 await macrotask
// 让 JS 线程喘一口气——否则用户在「人像美颜/色彩优化/文档扫描」处理中点返回按钮，
// goBack() / Alert 都被排在持续运行的循环后面，UI 看起来"完全不响应"。
// 这个上限取得偏小是为了让 1024×1024 的图（~1M 像素）大约 4 次让出，60FPS 用户体感顺滑。
const PIXEL_LOOP_YIELD_CHUNK = 256 * 1024;
async function yieldToEventLoop() {
  // setImmediate 在 RN Hermes 上等价于 macrotask（不可用时回退 setTimeout 0）
  await new Promise((resolve) => {
    if (typeof setImmediate === 'function') setImmediate(resolve);
    else setTimeout(resolve, 0);
  });
}

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
/**
 * #4b 美颜（三期·仅人脸·保边磨皮）：人脸椭圆内只平滑「低反差的肤色像素」——
 * 五官/发丝是高反差边缘（原图与模糊图差值大），差值越大保留越多原图（surface blur 思路）；
 * 再叠 YCbCr 肤色门控，眼白/瞳孔/深色眉发不参与磨皮。修复二期"整脸一律混模糊图把五官糊掉"的问题。
 * faces: 归一化 [{x,y,width,height}]（左上原点）。脸框外扩（宽1.5x/高1.7x）盖住额头下巴。
 */
export async function applyBeautyToFacesBase64(base64, intensity = 0.8, faces = []) {
  const clean = base64.startsWith('data:') ? base64.split(',')[1] : base64;
  const img = await Jimp.read(Buffer.from(clean, 'base64'));
  const W = img.bitmap.width; const H = img.bitmap.height;
  const radius = Math.max(2, Math.round(2 + intensity * 2)); // 磨皮只需小半径（大半径靠边缘保护也救不回轮廓）
  await yieldToEventLoop();
  const blurred = img.clone().blur(radius);
  await yieldToEventLoop();
  const maxBlend = 0.4 + 0.3 * intensity;  // 纯平滑肤色处最多混入模糊图的比例（全强度 0.64）
  // 边缘保护双阈值：亮度差 ≤T1 视为皮肤纹理/瑕疵全力磨，≥T2 视为五官/轮廓完全保留，中间线性过渡
  const EDGE_T1 = 14; const EDGE_T2 = 40;
  const od = img.bitmap.data;
  const bd = blurred.bitmap.data;
  // 每张脸：外扩椭圆 + 羽化权重（d∈[0.65,1] 线性衰减到 0）
  const ellipses = faces.map((f) => {
    const cx = (f.x + f.width / 2) * W;
    const cy = (f.y + f.height / 2) * H;
    const rx = Math.max(8, (f.width * 1.5 * W) / 2);
    const ry = Math.max(8, (f.height * 1.7 * H) / 2);
    return {
      cx, cy, rx, ry,
      x0: Math.max(0, Math.floor(cx - rx)), x1: Math.min(W - 1, Math.ceil(cx + rx)),
      y0: Math.max(0, Math.floor(cy - ry)), y1: Math.min(H - 1, Math.ceil(cy + ry)),
    };
  });
  const brighten = 255 * 0.05 * intensity;   // 肤色处提亮
  const warm = 5 * intensity;                // 肤色处暖肤（红通道）
  let rowsDone = 0;
  for (const e of ellipses) {
    for (let y = e.y0; y <= e.y1; y++) {
      const dy = (y - e.cy) / e.ry;
      for (let x = e.x0; x <= e.x1; x++) {
        const dx = (x - e.cx) / e.rx;
        const d = dx * dx + dy * dy;
        if (d > 1) continue;
        const wgt = d <= 0.65 ? 1 : (1 - d) / 0.35;   // 椭圆羽化
        const k = x * 4 + y * W * 4;
        const r = od[k]; const g = od[k + 1]; const b = od[k + 2];
        // ① 肤色门控（YCbCr 经典窗口，窗口边缘 ±8 软过渡）×亮度门控（深棕瞳孔/眉/发
        //    也落在 YCbCr 肤色窗内，但亮度远低于皮肤——Y<50 完全不动，50→80 渐入）
        const cb = 128 - 0.169 * r - 0.331 * g + 0.5 * b;
        const cr = 128 + 0.5 * r - 0.419 * g - 0.081 * b;
        const sCb = cb < 77 ? Math.max(0, 1 - (77 - cb) / 8) : cb > 127 ? Math.max(0, 1 - (cb - 127) / 8) : 1;
        const sCr = cr < 133 ? Math.max(0, 1 - (133 - cr) / 8) : cr > 177 ? Math.max(0, 1 - (cr - 177) / 8) : 1;
        const yLuma = 0.299 * r + 0.587 * g + 0.114 * b;
        const yW = yLuma <= 50 ? 0 : yLuma >= 80 ? 1 : (yLuma - 50) / 30;
        const skinW = sCb * sCr * yW;
        if (skinW <= 0) continue;
        // ② 边缘保护：原图 vs 模糊图亮度差大 = 五官/轮廓，T1~T2 间线性压低混合量
        const diff = Math.abs(r - bd[k]) * 0.3 + Math.abs(g - bd[k + 1]) * 0.59 + Math.abs(b - bd[k + 2]) * 0.11;
        if (diff >= EDGE_T2) continue;
        const edgeW = diff <= EDGE_T1 ? 1 : (EDGE_T2 - diff) / (EDGE_T2 - EDGE_T1);
        const blend = maxBlend * wgt * skinW * edgeW;
        const tone = wgt * skinW;
        for (let c = 0; c < 3; c++) {
          let v = od[k + c] + (bd[k + c] - od[k + c]) * blend;
          v += (c === 0 ? brighten + warm : brighten) * tone;  // 提亮+暖肤只作用于肤色
          od[k + c] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
      }
      // 分行让出事件循环（同全图版策略）
      rowsDone++;
      if (rowsDone % 64 === 0) await yieldToEventLoop();
    }
  }
  await yieldToEventLoop();
  return img.getBase64Async(Jimp.MIME_JPEG);
}

export async function applyBeautyToBase64(base64, intensity = 0.8) {
  const clean = base64.startsWith('data:') ? base64.split(',')[1] : base64;
  const img = await Jimp.read(Buffer.from(clean, 'base64'));
  const radius = Math.max(2, Math.round(2 + intensity * 4));
  // blur() 是整图同步操作（jimp 内部多趟扫描），1024px 图能阻塞 0.5~1s 且无内部让步点。
  // 前后各让一次，确保「处理中」计时器/返回手势在 blur 边界能跑。
  await yieldToEventLoop();
  const blurred = img.clone().blur(radius);
  await yieldToEventLoop();
  const keep = 0.5 - 0.28 * intensity; // 保留的高频细节比例（越小越磨）
  const od = img.bitmap.data;
  const bd = blurred.bitmap.data;
  // 分块扫描 + 让出事件循环——让用户「处理中」期间点返回箭头时 goBack/Alert 能跑（见 jimpFilters 顶部注释）
  const chunkBytes = PIXEL_LOOP_YIELD_CHUNK * 4; // 每像素 RGBA 4 字节
  for (let chunkStart = 0; chunkStart < od.length; chunkStart += chunkBytes) {
    const chunkEnd = Math.min(chunkStart + chunkBytes, od.length);
    for (let k = chunkStart; k < chunkEnd; k += 4) {
      for (let c = 0; c < 3; c++) {
        const v = bd[k + c] + (od[k + c] - bd[k + c]) * keep;
        od[k + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
    if (chunkEnd < od.length) await yieldToEventLoop();
  }
  img.brightness(0.05 * intensity); // 提亮
  img.color([{ apply: 'red', params: [5 * intensity] }, { apply: 'saturate', params: [6 * intensity] }]); // 暖肤+气色
  await yieldToEventLoop(); // getBase64Async 编码同样阻塞，前面让一次给计时器收尾
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

/**
 * #证件处理（A 期·扫描增强，纯 jimp，免模型）：光照归一(去阴影) + 提对比 + 提饱和。
 *
 * 行业文档扫描管线的"增强"环节（不含透视矫正，B 期再加）。做法：用大尺度模糊估计
 * 背景光照，按"目标均值/局部光照"算逐像素增益（限幅 0.6~1.8，避免把证件照片/彩色块洗白），
 * 抹平不均匀阴影；再提对比、轻提饱和让文字更清楚、底色更干净。对纸质文档与含照片的
 * 证件都适用（不用会洗白照片的"除法二值化"）。
 * @param {string} base64 含/不含 data: 前缀
 * @param {number} intensity 0..1（去阴影强度）
 */
export async function applyDocumentScanToBase64(base64, intensity = 0.9) {
  const clean = base64.startsWith('data:') ? base64.split(',')[1] : base64;
  const img = await Jimp.read(Buffer.from(clean, 'base64'));
  const W = img.bitmap.width;
  const H = img.bitmap.height;

  // 光照估计：缩小 → 模糊 → 放大（廉价的大尺度模糊近似）
  const bg = img.clone();
  bg.resize(Math.max(1, Math.round(W / 4)), Math.max(1, Math.round(H / 4)));
  bg.blur(8);
  bg.resize(W, H);
  const bd = bg.bitmap.data;

  // 背景目标均值（亮度）—— 分块求和 + 让出事件循环
  let sum = 0;
  const n = W * H;
  for (let i = 0; i < n; i += PIXEL_LOOP_YIELD_CHUNK) {
    const end = Math.min(i + PIXEL_LOOP_YIELD_CHUNK, n);
    for (let j = i; j < end; j++) {
      const k = j * 4;
      sum += 0.299 * bd[k] + 0.587 * bd[k + 1] + 0.114 * bd[k + 2];
    }
    if (end < n) await yieldToEventLoop();
  }
  const meanBg = sum / n || 1;

  // 逐像素增益：把局部光照拉到目标均值；限幅避免洗白内容（同样分块让步）
  const od = img.bitmap.data;
  for (let i = 0; i < n; i += PIXEL_LOOP_YIELD_CHUNK) {
    const end = Math.min(i + PIXEL_LOOP_YIELD_CHUNK, n);
    for (let j = i; j < end; j++) {
      const k = j * 4;
      const lumBg = 0.299 * bd[k] + 0.587 * bd[k + 1] + 0.114 * bd[k + 2] || 1;
      let gain = meanBg / lumBg;
      if (gain < 0.6) gain = 0.6; else if (gain > 1.8) gain = 1.8;
      gain = 1 + (gain - 1) * intensity;
      for (let c = 0; c < 3; c++) {
        const v = od[k + c] * gain;
        od[k + c] = v > 255 ? 255 : v < 0 ? 0 : v;
      }
    }
    if (end < n) await yieldToEventLoop();
  }

  img.contrast(0.18 * intensity);                 // 文字更分明
  img.color([{ apply: 'saturate', params: [10 * intensity] }]); // 彩色证件更鲜
  await yieldToEventLoop(); // 编码前让一次给计时器/返回手势
  return img.getBase64Async(Jimp.MIME_JPEG);
}

/**
 * 色彩优化（纯 jimp，免模型）：单次像素扫描完成 饱和/对比/亮度。
 *
 * 之前用 `img.color([{apply:'saturate'}]).contrast().brightness()` 链式调用，
 * 每个滤镜内部都做一遍 RGB↔HSL 转换 + 整图遍历——Hermes 下 1024x768 三遍下来要
 * 30~60s，常被 60s 超时打断（用户看到"卡很久"）。这里改成一次性遍历，
 * 用"亮度差"近似饱和度提升（向像素亮度反方向拉色彩），数学量级减少近 10 倍。
 *
 * 公式（每像素）：
 *   L = 0.299R + 0.587G + 0.114B
 *   c' = clamp(L + (c - L) * sat) for c in {R,G,B}     // 饱和度
 *   c'' = clamp((c' - 128) * (1 + con) + 128)         // 对比度
 *   c''' = clamp(c'' + bri * 255)                     // 亮度
 *
 * @param {string} base64 含/不含 data: 前缀
 * @param {number} intensity 0..1
 */
export async function applyColorEnhanceToBase64(base64, intensity = 0.85) {
  const clean = base64.startsWith('data:') ? base64.split(',')[1] : base64;
  const img = await Jimp.read(Buffer.from(clean, 'base64'));
  const sat = 1 + 0.35 * intensity;     // 饱和度增益（中等）
  const con = 0.12 * intensity;         // 对比度增益（温和）
  const bri = 0.03 * intensity;         // 亮度增益（轻微）
  const d = img.bitmap.data;
  // 分块扫描 + 让出事件循环（同 applyBeautyToBase64 注释）
  const chunkBytes = PIXEL_LOOP_YIELD_CHUNK * 4;
  for (let chunkStart = 0; chunkStart < d.length; chunkStart += chunkBytes) {
    const chunkEnd = Math.min(chunkStart + chunkBytes, d.length);
    for (let k = chunkStart; k < chunkEnd; k += 4) {
      const r = d[k], g = d[k + 1], b = d[k + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      let nr = lum + (r - lum) * sat;
      let ng = lum + (g - lum) * sat;
      let nb = lum + (b - lum) * sat;
      nr = (nr - 128) * (1 + con) + 128 + bri * 255;
      ng = (ng - 128) * (1 + con) + 128 + bri * 255;
      nb = (nb - 128) * (1 + con) + 128 + bri * 255;
      d[k]     = nr < 0 ? 0 : nr > 255 ? 255 : nr;
      d[k + 1] = ng < 0 ? 0 : ng > 255 ? 255 : ng;
      d[k + 2] = nb < 0 ? 0 : nb > 255 ? 255 : nb;
    }
    if (chunkEnd < d.length) await yieldToEventLoop();
  }
  await yieldToEventLoop(); // 编码前让一次给计时器/返回手势
  return img.getBase64Async(Jimp.MIME_JPEG);
}

export default JIMP_FILTERS;
