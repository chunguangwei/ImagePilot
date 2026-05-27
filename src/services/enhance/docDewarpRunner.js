/**
 * docDewarpRunner — 证件/文档透视矫正（B 期）：自动找边(复用 u2netp) + 单应透视重采样 + 扫描增强。
 *
 * - detectCorners：用已打包的 u2netp 显著性分割得到文档区域，取四个极值角点
 *   （TL=min(x+y), BR=max(x+y), TR=max(x−y), BL=min(x−y)），返回 0~1 归一坐标（与分辨率无关，
 *   供 UI 缩放成手柄位置）；区域过小/失败返回 null，由调用方用默认框兜底。
 * - dewarp：给定四角(归一坐标) → 解单应(rect→quad) → 逐输出像素反向映射+双线性采样 → 拉正，
 *   再走 A 期扫描增强(applyDocumentScanToBase64)。纯 JS，不需模型。
 *
 * 透视/采样数学在开发机用 jimp(+onnxruntime-node 验角点) 实测通过后移植。
 */

import * as ortNS from 'onnxruntime-react-native';
import Jimp from './jimpCustom.js';
import { applyDocumentScanToBase64 } from './jimpFilters.js';

const ort = ortNS.default || ortNS;
const { InferenceSession, Tensor } = ort;

const S = 320;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

let _session = null;
let _sessionPath = null;
async function getSession(modelPath) {
  if (_session && _sessionPath === modelPath) return _session;
  _session = await InferenceSession.create(modelPath);
  _sessionPath = modelPath;
  return _session;
}

/** 自动找四角，返回 [TL,TR,BR,BL] 的归一坐标(0~1) 或 null（区域过小/失败） */
export async function detectCorners(base64, modelPath) {
  try {
    const clean = base64.startsWith('data:') ? base64.split(',')[1] : base64;
    const img = await Jimp.read(Buffer.from(clean, 'base64'));
    const sm = img.clone().resize(S, S);
    const d = sm.bitmap.data;
    const chw = new Float32Array(3 * S * S);
    for (let i = 0; i < S * S; i++) {
      for (let c = 0; c < 3; c++) {
        const v = d[i * 4 + c] / 255;
        chw[c * S * S + i] = (v - MEAN[c]) / STD[c];
      }
    }
    const session = await getSession(modelPath);
    const inName = session.inputNames[0];
    const outName = session.outputNames[0];
    const out = await session.run({ [inName]: new Tensor('float32', chw, [1, 3, S, S]) });
    const m = (out[outName] || out[Object.keys(out)[0]]).data;
    let mn = Infinity; let mx = -Infinity;
    for (let i = 0; i < m.length; i++) { const v = m[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    const th = mn + (mx - mn) * 0.5;
    let cnt = 0;
    let tl = { s: Infinity }; let br = { s: -Infinity }; let tr = { s: -Infinity }; let bl = { s: Infinity };
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (m[y * S + x] > th) {
          cnt++;
          const sp = x + y; const dp = x - y;
          if (sp < tl.s) tl = { s: sp, x, y };
          if (sp > br.s) br = { s: sp, x, y };
          if (dp > tr.s) tr = { s: dp, x, y };
          if (dp < bl.s) bl = { s: dp, x, y };
        }
      }
    }
    if (cnt / (S * S) < 0.05) return null; // 区域太小，放弃自动识别
    const f = (p) => ({ x: p.x / S, y: p.y / S });
    return [f(tl), f(tr), f(br), f(bl)];
  } catch (e) {
    return null; // 失败 → 调用方用默认框
  }
}

// ── 单应 + 透视重采样 ──
function solve8(A, b) {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    const dv = M[col][col];
    if (Math.abs(dv) < 1e-12) return null;
    for (let c = col; c <= n; c++) M[col][c] /= dv;
    for (let r = 0; r < n; r++) if (r !== col) { const fct = M[r][col]; for (let c = col; c <= n; c++) M[r][c] -= fct * M[col][c]; }
  }
  return M.map((row) => row[n]);
}
function homography(src, dst) {
  const A = []; const b = [];
  for (let i = 0; i < 4; i++) {
    const { x: X, y: Y } = src[i]; const { x: u, y: v } = dst[i];
    A.push([X, Y, 1, 0, 0, 0, -u * X, -u * Y]); b.push(u);
    A.push([0, 0, 0, X, Y, 1, -v * X, -v * Y]); b.push(v);
  }
  const h = solve8(A, b);
  if (!h) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}
function applyH(H, x, y) { const w = H[6] * x + H[7] * y + H[8]; return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w]; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

/**
 * 透视矫正 + 扫描增强。
 * @param {string} base64 工作图（已限尺寸）
 * @param {Array<{x:number,y:number}>} quadFrac 四角归一坐标 [TL,TR,BR,BL]
 * @param {(p:{done:number,total:number})=>void} [onProgress]
 * @returns {Promise<string>} data URL（image/jpeg）
 */
export async function dewarp(base64, quadFrac, onProgress) {
  let stage = 'init';
  try {
    const clean = base64.startsWith('data:') ? base64.split(',')[1] : base64;
    stage = '解码';
    const img = await Jimp.read(Buffer.from(clean, 'base64'));
    const W = img.bitmap.width; const H = img.bitmap.height;
    const quad = quadFrac.map((p) => ({ x: p.x * W, y: p.y * H })); // TL,TR,BR,BL

    let outW = Math.round(Math.max(dist(quad[0], quad[1]), dist(quad[3], quad[2])));
    let outH = Math.round(Math.max(dist(quad[0], quad[3]), dist(quad[1], quad[2])));
    const cap = 1600;
    const sc = Math.min(1, cap / Math.max(outW, outH, 1));
    outW = Math.max(8, Math.round(outW * sc));
    outH = Math.max(8, Math.round(outH * sc));

    const rect = [{ x: 0, y: 0 }, { x: outW - 1, y: 0 }, { x: outW - 1, y: outH - 1 }, { x: 0, y: outH - 1 }];
    const Hm = homography(rect, quad); // rect → 原图 quad
    if (!Hm) throw new Error('单应计算失败（四角可能共线）');
    if (onProgress) onProgress({ done: 0, total: 1 });

    stage = '透视重采样';
    const sd = img.bitmap.data;
    const out = new Uint8ClampedArray(outW * outH * 4);
    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const [sx, sy] = applyH(Hm, x, y);
        const x0 = Math.floor(sx); const y0 = Math.floor(sy);
        const fx = sx - x0; const fy = sy - y0;
        const o = (y * outW + x) * 4;
        if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= H - 1) { out[o] = out[o + 1] = out[o + 2] = 0; out[o + 3] = 255; continue; }
        for (let c = 0; c < 3; c++) {
          const i00 = (y0 * W + x0) * 4 + c;
          const i10 = (y0 * W + x0 + 1) * 4 + c;
          const i01 = ((y0 + 1) * W + x0) * 4 + c;
          const i11 = ((y0 + 1) * W + x0 + 1) * 4 + c;
          out[o + c] = sd[i00] * (1 - fx) * (1 - fy) + sd[i10] * fx * (1 - fy) + sd[i01] * (1 - fx) * fy + sd[i11] * fx * fy;
        }
        out[o + 3] = 255;
      }
    }
    stage = '封装';
    const warped = await new Promise((res, rej) =>
      new Jimp({ data: Buffer.from(out), width: outW, height: outH }, (e, im) => (e ? rej(e) : res(im))),
    );
    const b64 = await warped.getBase64Async(Jimp.MIME_JPEG);
    stage = '扫描增强';
    const enhanced = await applyDocumentScanToBase64(b64, 0.9); // 复用 A 期增强
    if (onProgress) onProgress({ done: 1, total: 1 });
    return enhanced;
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    throw new Error(`${msg} @stage=[${stage}]`);
  }
}

export default { detectCorners, dewarp };
