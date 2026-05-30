/**
 * inpaintRunner — AI 物体消除/修复引擎（MI-GAN pipeline，onnxruntime + jimp，离线）
 *
 * 默认对应 migan_pipeline_v2.onnx（自带预/后处理：内部裁剪到 mask 周边、resize 512、
 * 归一、推理、贴回原尺寸并融合）。I/O（开发机用 onnxruntime-node 实测）：
 *   image: uint8 [1,3,H,W] RGB 平面排布(NCHW)
 *   mask : uint8 [1,1,H,W]，255=保留，0=待修复区域
 *   result: uint8 [1,3,H,W] RGB，与输入同尺寸
 *
 * 调用方传入"涂抹笔画(显示坐标)+显示尺寸+笔刷半径"，本引擎按解码后的实际尺寸把笔画
 * 栅格化成 mask（圆形笔刷），保证与图像张量对齐。复用工程已链接的 onnxruntime-react-native。
 */

import * as ortNS from 'onnxruntime-react-native';
import Jimp from './jimpCustom.js';
import { loadOnnxSession } from './loadOnnxSession.js';

const ort = ortNS.default || ortNS;
const { Tensor } = ort;

export function createInpaintRunner(cfg = {}) {
  const config = { inputImage: 'image', inputMask: 'mask', output: 'result', ...cfg };
  let _session = null;

  async function getSession() {
    if (!_session) _session = await loadOnnxSession(config.modelPath);
    return _session;
  }

  /**
   * 物体消除：返回 data URL（image/jpeg）。
   * @param {string} base64 含/不含 data: 前缀（已限尺寸的工作图）
   * @param {{strokes:Array<Array<{x:number,y:number}>>, displayW:number, displayH:number, brushRadius:number}} maskSpec
   *        strokes 为显示坐标系下的多条笔画；displayW/H 为图像显示尺寸；brushRadius 为显示像素半径
   * @param {(p:{done:number,total:number})=>void} [onProgress]
   */
  async function inpaint(base64, maskSpec, onProgress) {
    let stage = 'init';
    try {
      stage = '创建会话';
      const session = await getSession();
      const clean = base64.startsWith('data:') ? base64.split(',')[1] : base64;
      stage = '解码';
      const img = await Jimp.read(Buffer.from(clean, 'base64'));
      const W = img.bitmap.width;
      const H = img.bitmap.height;
      const HW = W * H;
      const d = img.bitmap.data; // RGBA

      // image → NCHW 平面 uint8 RGB
      const imgArr = new Uint8Array(3 * HW);
      for (let i = 0; i < HW; i++) {
        imgArr[i] = d[i * 4];
        imgArr[HW + i] = d[i * 4 + 1];
        imgArr[2 * HW + i] = d[i * 4 + 2];
      }

      // 笔画栅格化为 mask（255 保留，0 待修复）。显示坐标→图像坐标按比例缩放，圆形笔刷。
      stage = '生成掩膜';
      const mask = new Uint8Array(HW).fill(255);
      const { strokes = [], displayW = W, displayH = H, brushRadius = 20 } = maskSpec || {};
      const sx = W / (displayW || W);
      const sy = H / (displayH || H);
      let painted = 0;
      for (const stroke of strokes) {
        // 支持两种笔画形态：点数组，或 { points, brushRadius }（按笔画各自的笔刷）
        const pts = Array.isArray(stroke) ? stroke : (stroke.points || []);
        const br = (Array.isArray(stroke) ? brushRadius : (stroke.brushRadius || brushRadius));
        const r = Math.max(1, Math.round(br * sx));
        const r2 = r * r;
        for (const p of pts) {
          const cx = Math.round(p.x * sx);
          const cy = Math.round(p.y * sy);
          for (let dy = -r; dy <= r; dy++) {
            const yy = cy + dy;
            if (yy < 0 || yy >= H) continue;
            for (let dx = -r; dx <= r; dx++) {
              if (dx * dx + dy * dy > r2) continue;
              const xx = cx + dx;
              if (xx < 0 || xx >= W) continue;
              if (mask[yy * W + xx] === 255) painted++;
              mask[yy * W + xx] = 0;
            }
          }
        }
      }
      if (painted === 0) throw new Error('未涂抹任何区域');
      if (onProgress) onProgress({ done: 0, total: 1 });

      stage = '推理';
      const out = await session.run({
        [config.inputImage]: new Tensor('uint8', imgArr, [1, 3, H, W]),
        [config.inputMask]: new Tensor('uint8', mask, [1, 1, H, W]),
      });
      const rT = out[config.output] || out[session.outputNames[0]] || out[Object.keys(out)[0]];
      if (!rT || !rT.data) throw new Error('模型输出为空');
      const od = rT.data; // NCHW uint8
      const oH = rT.dims[2];
      const oW = rT.dims[3];
      const oHW = oH * oW;

      stage = '出图';
      const outRGBA = new Uint8ClampedArray(oW * oH * 4);
      for (let i = 0; i < oHW; i++) {
        outRGBA[i * 4] = od[i];
        outRGBA[i * 4 + 1] = od[oHW + i];
        outRGBA[i * 4 + 2] = od[2 * oHW + i];
        outRGBA[i * 4 + 3] = 255;
      }
      const outImg = await new Promise((res, rej) =>
        new Jimp({ data: Buffer.from(outRGBA), width: oW, height: oH }, (e, im) => (e ? rej(e) : res(im))),
      );
      if (onProgress) onProgress({ done: 1, total: 1 });
      stage = '编码';
      return await outImg.getBase64Async(Jimp.MIME_JPEG);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      throw new Error(`${msg} @stage=[${stage}]`);
    }
  }

  return { inpaint, getSession };
}

export default createInpaintRunner;
