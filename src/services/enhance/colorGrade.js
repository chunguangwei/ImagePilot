/**
 * colorGrade —— LUT 风格调色引擎（替代简单通道运算，出电影感/胶片感）。
 *
 * 每个「look」是一组调色参数，逐像素按色彩科学处理：
 *   1) 色调曲线 S-curve（对比，保护暗部高光不死黑死白）
 *   2) Lift/Gain 分通道（阴影抬升 / 高光增益，做褪色或通透）
 *   3) 分离调色 split-toning（阴影染一色、高光染另一色 —— 电影感的关键）
 *   4) Vibrance（智能饱和，越鲜艳的区域加得越少，避免过曝艳俗）
 *   5) 色温/色调微调
 * 纯 JS（jimp 解码 + 像素循环），分块让出事件循环（不卡 UI / 计时器）。
 */

// logger 懒加载：避免模块顶层引 WebAdapters（含 JSX，纯函数单测无法加载）
function warn(...a) {
  try { require('../../adapters/WebAdapters').logger.warn(...a); }
  catch (_) { try { console.warn(...a); } catch (__) { /* noop */ } }
}

const CHUNK_PIXELS = 200000;
async function yieldEventLoop() {
  await new Promise((resolve) => {
    if (typeof setImmediate === 'function') setImmediate(resolve);
    else setTimeout(resolve, 0);
  });
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// S 曲线对比：amount 0=无，>0 增对比（绕 0.5 旋转，平滑）
function sCurve(v, amount) {
  if (!amount) return v;
  // smoothstep 加权混合：越强越贴近三次平滑曲线
  const s = v * v * (3 - 2 * v);
  return clamp01(v + (s - v) * amount);
}

// look 参数表：lift/gain 为 [r,g,b] 0~1 中心 0；shadow/highlight tint 为 [r,g,b] 染色量（-/+）。
// 强度刻意拉满，让不同模板一眼能区分（之前太克制、照片几乎看不出变化）。
const LOOKS = Object.freeze({
  // 暖奶油（婚礼/家庭/情侣）：明显暖调、奶油高光、柔光低对比（收一档防肤色过橙）
  warm_cream: { contrast: 0.18, lift: [0.05, 0.035, 0.0], gain: [0.07, 0.035, -0.04], shadowTint: [0.025, 0.0, 0.025], highlightTint: [0.09, 0.05, -0.05], vibrance: 0.18, temp: 0.08 },
  // 高饱和（旅游/活动/户外）：通透高对比、鲜艳浓郁
  high_saturation: { contrast: 0.42, lift: [-0.02, -0.02, -0.02], gain: [0.05, 0.05, 0.06], shadowTint: [0.0, 0.0, 0.03], highlightTint: [0.03, 0.03, 0.0], vibrance: 0.7, temp: 0.02 },
  // 胶片（在路上）：褪色 + 强青橙分离、低饱和
  film_vintage: { contrast: 0.18, lift: [0.12, 0.09, 0.07], gain: [-0.05, -0.03, 0.0], shadowTint: [-0.06, 0.0, 0.1], highlightTint: [0.13, 0.06, -0.1], vibrance: -0.18, temp: 0.06 },
  // 日系（生活/咖啡）：空气感、淡青粉、低饱和低对比
  japanese_soft: { contrast: 0.06, lift: [0.1, 0.1, 0.11], gain: [0.03, 0.05, 0.05], shadowTint: [-0.02, 0.0, 0.04], highlightTint: [0.05, 0.06, 0.07], vibrance: -0.12, temp: -0.03 },
  // 清新（学习/菜谱）：明亮通透、微冷、绿意
  fresh_clean: { contrast: 0.2, lift: [0.04, 0.05, 0.04], gain: [0.08, 0.1, 0.08], shadowTint: [0.0, 0.04, 0.02], highlightTint: [0.02, 0.06, 0.02], vibrance: 0.32, temp: -0.03 },
  // 糖果（生日/萌宝/宠物/童年）：高亮、高饱和、暖粉高光（收一档防肤色过粉）
  candy_bright: { contrast: 0.16, lift: [0.06, 0.05, 0.05], gain: [0.09, 0.06, 0.05], shadowTint: [0.02, 0.0, 0.03], highlightTint: [0.06, 0.0, 0.04], vibrance: 0.5, temp: 0.04 },
  // 冷灰（运动/职场/品牌/圣诞/中秋）：强青橙电影感、阴影深青、高光暖、降饱和
  cold_grey: { contrast: 0.4, lift: [-0.02, 0.0, 0.04], gain: [0.04, 0.0, -0.05], shadowTint: [-0.07, 0.0, 0.12], highlightTint: [0.11, 0.05, -0.09], vibrance: -0.08, temp: -0.07 },
});

export function hasLook(id) { return !!LOOKS[id]; }
export function lookIds() { return Object.keys(LOOKS); }
export function getLook(id) { return LOOKS[id] || null; }

/** 对单像素 [r,g,b]（0~255）应用 look（k=强度 0~1），返回新 [r,g,b]（0~255）。 */
export function gradePixel(r, g, b, look, k = 1) {
  let R = r / 255, G = g / 255, B = b / 255;
  // 1) Lift（阴影抬升，对暗部权重大）+ Gain（高光增益，对亮部权重大）
  const L = look.lift, Gn = look.gain;
  R = clamp01(R + L[0] * k * (1 - R) + Gn[0] * k * R);
  G = clamp01(G + L[1] * k * (1 - G) + Gn[1] * k * G);
  B = clamp01(B + L[2] * k * (1 - B) + Gn[2] * k * B);
  // 2) S 曲线对比
  R = sCurve(R, look.contrast * k); G = sCurve(G, look.contrast * k); B = sCurve(B, look.contrast * k);
  // 3) 分离调色：按亮度 luma 在阴影色/高光色间分配
  const luma = 0.299 * R + 0.587 * G + 0.114 * B;
  const sh = look.shadowTint, hi = look.highlightTint;
  const wHi = luma, wSh = 1 - luma;
  R = clamp01(R + (sh[0] * wSh + hi[0] * wHi) * k);
  G = clamp01(G + (sh[1] * wSh + hi[1] * wHi) * k);
  B = clamp01(B + (sh[2] * wSh + hi[2] * wHi) * k);
  // 4) Vibrance（智能饱和：离灰越远加得越少）
  if (look.vibrance) {
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    const sat = mx - mn;
    const amt = look.vibrance * k * (1 - sat); // 已鲜艳的少加
    const avg = (R + G + B) / 3;
    R = clamp01(R + (R - avg) * amt); G = clamp01(G + (G - avg) * amt); B = clamp01(B + (B - avg) * amt);
  }
  // 5) 色温（暖+R-B / 冷-R+B）
  if (look.temp) { R = clamp01(R + look.temp * k * 0.5); B = clamp01(B - look.temp * k * 0.5); }
  return [Math.round(R * 255), Math.round(G * 255), Math.round(B * 255)];
}

/**
 * 对 base64 图整图应用 look。返回 data URL（image/jpeg）。
 * @param {string} base64 纯 base64（无 data: 前缀）
 * @param {string} lookId
 * @param {number} intensity 0~1
 */
export async function applyColorGradeToBase64(base64, lookId, intensity = 1) {
  const look = LOOKS[lookId];
  if (!look) return `data:image/jpeg;base64,${base64}`;
  const Jimp = require('jimp');
  const img = await Jimp.read(Buffer.from(base64, 'base64'));
  const d = img.bitmap.data; // RGBA
  const k = Math.max(0, Math.min(1, intensity));
  const chunkBytes = CHUNK_PIXELS * 4;
  for (let start = 0; start < d.length; start += chunkBytes) {
    const end = Math.min(start + chunkBytes, d.length);
    for (let i = start; i < end; i += 4) {
      const out = gradePixel(d[i], d[i + 1], d[i + 2], look, k);
      d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2];
    }
    if (end < d.length) await yieldEventLoop();
  }
  await yieldEventLoop();
  try {
    return await img.getBase64Async(Jimp.MIME_JPEG);
  } catch (e) {
    warn('colorGrade 编码失败:', e?.message || e);
    return `data:image/jpeg;base64,${base64}`;
  }
}

export default { applyColorGradeToBase64, gradePixel, hasLook, lookIds, getLook };
