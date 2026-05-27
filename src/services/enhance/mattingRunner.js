/**
 * mattingRunner — 抠图/背景移除引擎（U2Net 系，onnxruntime + jimp，离线）
 *
 * 默认对应 u2netp（轻量显著性分割，输入 1×3×320×320，输出多张特征图，取第一张为
 * 显著性掩膜 [0,1]）。流程：base64 → jimp 解码 → 320 输入张量(ImageNet 归一) →
 * session.run → 取首个输出做 min-max 归一为 alpha → 放大回原尺寸 → 前景按 alpha
 * 合成到纯色背景(默认白) → JPEG base64。
 *
 * 输出走 JPEG（jimpCustom 仅装 JPEG 编解码），故为"前景+纯色底"而非透明 PNG；
 * 透明输出需另加 PNG 支持，留待后续。复用工程已链接的 onnxruntime-react-native。
 */

import * as ortNS from 'onnxruntime-react-native';
import Jimp from './jimpCustom.js';

const ort = ortNS.default || ortNS; // CJS 下经 default 取（与 superResRunner 一致）
const { InferenceSession, Tensor } = ort;

const S = 320; // u2netp 固定输入边长
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

export function createMattingRunner(cfg = {}) {
  const config = { inputName: 'input.1', outputName: null, maxEdge: 1280, ...cfg };
  let _session = null;

  async function getSession() {
    if (!_session) _session = await InferenceSession.create(config.modelPath);
    return _session;
  }

  /**
   * 抠图：返回 data URL（image/jpeg），前景合成到纯色背景。
   * @param {string} base64 含/不含 data: 前缀
   * @param {(p:{done:number,total:number})=>void} [onProgress]
   * @param {{bgColor?:[number,number,number]}} [opts] 背景色（默认白）
   */
  async function cutout(base64, onProgress, opts = {}) {
    let stage = 'init';
    try {
      const bg = opts.bgColor || [255, 255, 255];
      stage = '创建会话';
      const session = await getSession();
      const inName = config.inputName || session.inputNames[0];
      const outName = config.outputName || (session.outputNames && session.outputNames[0]);

      const clean = base64.startsWith('data:') ? base64.split(',')[1] : base64;
      stage = '解码';
      const img = await Jimp.read(Buffer.from(clean, 'base64'));
      // 限制处理尺寸，控内存/耗时
      if (Math.max(img.bitmap.width, img.bitmap.height) > config.maxEdge) {
        img.scaleToFit(config.maxEdge, config.maxEdge);
      }
      const W0 = img.bitmap.width;
      const H0 = img.bitmap.height;

      // 320×320 输入张量（/255 → ImageNet 归一，CHW）
      stage = '预处理';
      const small = img.clone().resize(S, S);
      const sd = small.bitmap.data; // RGBA
      const chw = new Float32Array(3 * S * S);
      for (let i = 0; i < S * S; i++) {
        for (let c = 0; c < 3; c++) {
          const v = sd[i * 4 + c] / 255;
          chw[c * S * S + i] = (v - MEAN[c]) / STD[c];
        }
      }
      if (onProgress) onProgress({ done: 0, total: 1 });

      stage = '推理';
      const result = await session.run({ [inName]: new Tensor('float32', chw, [1, 3, S, S]) });
      const outT =
        result[outName] ||
        (session.outputNames && result[session.outputNames[0]]) ||
        result[Object.keys(result)[0]];
      if (!outT || !outT.data) throw new Error(`模型输出为空 outName=${outName}`);
      const m = outT.data; // S*S 显著性 [0,1]

      // min-max 归一为 alpha
      let mn = Infinity;
      let mx = -Infinity;
      for (let i = 0; i < m.length; i++) {
        const v = m[i];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      const range = mx - mn || 1;

      // 320 掩膜 → 灰度 jimp → 放大回原尺寸（双线性，边缘更顺）
      stage = '掩膜缩放';
      const maskSmall = new Uint8ClampedArray(S * S * 4);
      for (let i = 0; i < S * S; i++) {
        const a = Math.round(((m[i] - mn) / range) * 255);
        const o = i * 4;
        maskSmall[o] = a;
        maskSmall[o + 1] = a;
        maskSmall[o + 2] = a;
        maskSmall[o + 3] = 255;
      }
      const maskImg = await new Promise((res, rej) =>
        new Jimp({ data: Buffer.from(maskSmall), width: S, height: S }, (e, im) => (e ? rej(e) : res(im))),
      );
      maskImg.resize(W0, H0);
      const md = maskImg.bitmap.data;

      // 前景按 alpha 合成到纯色底
      stage = '合成';
      const cd = img.bitmap.data;
      for (let i = 0; i < W0 * H0; i++) {
        const a = md[i * 4] / 255;
        for (let c = 0; c < 3; c++) {
          cd[i * 4 + c] = Math.round(cd[i * 4 + c] * a + bg[c] * (1 - a));
        }
        cd[i * 4 + 3] = 255;
      }
      if (onProgress) onProgress({ done: 1, total: 1 });

      stage = '编码';
      return await img.getBase64Async(Jimp.MIME_JPEG);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      throw new Error(`${msg} @stage=[${stage}]`);
    }
  }

  return { cutout, getSession };
}

export default createMattingRunner;
