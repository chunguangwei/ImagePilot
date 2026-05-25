/**
 * superResRunner — AI 超分增强引擎（模型无关，onnxruntime + jimp，离线）
 *
 * 复用 superResTensor 的像素↔张量 + 分块工具；I/O 全部走 config，换模型只改配置。
 * 流程：base64 → jimp 解码 → (可选)限尺寸 → 分块 → 每块 NCHW 张量 → session.run →
 *       输出块还原 RGBA → 拼回整图 → base64。
 *
 * 适配固定输入尺寸的模型（如 Qualcomm Real-ESRGAN-General-x4v3：固定 128×128、x4）：
 * 边缘不足块用 replicate 补齐到 tileSize，跑完按实际尺寸裁剪再拼。
 *
 * onnxruntime-react-native 已在工程链接（分类也用它），故不引入新原生依赖。
 */

import { InferenceSession, Tensor } from 'onnxruntime-react-native';
import Jimp from 'jimp';
import { rgbaToCHW, chwToRGBA, planTiles } from './superResTensor.js';

/** 默认配置：对应 Qualcomm Real-ESRGAN-General-x4v3（固定 128 输入、x4）。换模型改这里。 */
export const DEFAULT_SR_CONFIG = Object.freeze({
  inputName: 'image',     // 模型输入张量名（用 onnxruntime 读 session.inputNames 确认后填）
  outputName: null,        // null = 用第一个输出
  tileSize: 128,           // 固定输入块边长
  fixedInput: true,        // 输入尺寸固定 → 不足块补齐
  scale: 4,                // 放大倍数
  maxInputEdge: 512,       // 处理前把长边限到该值（控制耗时；总输出 = maxInputEdge*scale）
});

/** 从完整 RGBA 取 (x,y) 处 tile×tile 区域；不足处用边缘像素 replicate 补齐。 */
function extractTilePadded(rgba, W, H, x, y, tile) {
  const out = new Uint8ClampedArray(tile * tile * 4);
  for (let ty = 0; ty < tile; ty++) {
    const sy = Math.min(H - 1, y + ty);
    for (let tx = 0; tx < tile; tx++) {
      const sx = Math.min(W - 1, x + tx);
      const si = (sy * W + sx) * 4;
      const di = (ty * tile + tx) * 4;
      out[di] = rgba[si];
      out[di + 1] = rgba[si + 1];
      out[di + 2] = rgba[si + 2];
      out[di + 3] = 255;
    }
  }
  return out;
}

/** 把输出块 RGBA（tileOut×tileOut）裁剪到 (cropW×cropH) 后贴到输出整图 (outW×outH) 的 (dstX,dstY)。 */
function placeTile(outRGBA, outW, outH, tileRGBA, tileOut, dstX, dstY, cropW, cropH) {
  for (let ty = 0; ty < cropH; ty++) {
    const oy = dstY + ty;
    if (oy >= outH) break;
    for (let tx = 0; tx < cropW; tx++) {
      const ox = dstX + tx;
      if (ox >= outW) break;
      const si = (ty * tileOut + tx) * 4;
      const di = (oy * outW + ox) * 4;
      outRGBA[di] = tileRGBA[si];
      outRGBA[di + 1] = tileRGBA[si + 1];
      outRGBA[di + 2] = tileRGBA[si + 2];
      outRGBA[di + 3] = 255;
    }
  }
}

/**
 * @param {object} cfg - 合并到 DEFAULT_SR_CONFIG
 * @param {string} cfg.modelPath - 已解析的 .onnx 路径（调用方用 ModelPathAdapter 等解析后传入）
 */
export function createSuperResRunner(cfg = {}) {
  const config = { ...DEFAULT_SR_CONFIG, ...cfg };
  let _session = null;
  let _inputName = config.inputName;

  async function getSession() {
    if (_session) return _session;
    _session = await InferenceSession.create(config.modelPath);
    // 若未指定输入名，用模型第一个输入名
    if (!_inputName && _session.inputNames && _session.inputNames.length) {
      _inputName = _session.inputNames[0];
    }
    return _session;
  }

  /**
   * 对 base64 图做超分增强，返回 data URL（image/jpeg）。
   * @param {string} base64 - 含/不含 data: 前缀
   * @param {(p:{done:number,total:number})=>void} [onProgress]
   */
  async function enhance(base64, onProgress) {
    const session = await getSession();
    const outName = config.outputName || (session.outputNames && session.outputNames[0]);

    const clean = base64.startsWith('data:') ? base64.split(',')[1] : base64;
    const img = await Jimp.read(Buffer.from(clean, 'base64'));
    // 限尺寸控制耗时
    if (Math.max(img.bitmap.width, img.bitmap.height) > config.maxInputEdge) {
      img.scaleToFit(config.maxInputEdge, config.maxInputEdge);
    }
    const W = img.bitmap.width;
    const H = img.bitmap.height;
    const rgba = img.bitmap.data; // RGBA Uint8

    const scale = config.scale;
    const tile = config.tileSize;
    const outW = W * scale;
    const outH = H * scale;
    const outRGBA = new Uint8ClampedArray(outW * outH * 4);

    const tiles = planTiles(W, H, tile, 0); // 无重叠分块（v1；可后续加重叠+混合去缝）
    let done = 0;
    for (const t of tiles) {
      // 固定输入：补齐到 tile×tile
      const tileRGBA = config.fixedInput
        ? extractTilePadded(rgba, W, H, t.x, t.y, tile)
        : extractTilePadded(rgba, W, H, t.x, t.y, Math.max(t.w, t.h));
      const inTile = config.fixedInput ? tile : Math.max(t.w, t.h);
      const chw = rgbaToCHW(tileRGBA, inTile, inTile);
      const input = new Tensor('float32', chw, [1, 3, inTile, inTile]);
      const result = await session.run({ [_inputName]: input });
      const outT = result[outName];
      const od = outT.data; // Float32Array, dims [1,3,inTile*scale,inTile*scale]
      const outTile = inTile * scale;
      const outTileRGBA = chwToRGBA(od, outTile, outTile);
      // 裁剪到该块实际尺寸 * scale 后贴图
      placeTile(outRGBA, outW, outH, outTileRGBA, outTile, t.x * scale, t.y * scale, t.w * scale, t.h * scale);
      done++;
      if (onProgress) onProgress({ done, total: tiles.length });
    }

    // 用 jimp 把输出 RGBA 包成图片 → base64
    const outImg = await new Promise((res, rej) =>
      new Jimp({ data: Buffer.from(outRGBA), width: outW, height: outH }, (e, im) => (e ? rej(e) : res(im))),
    );
    return outImg.getBase64Async(Jimp.MIME_JPEG);
  }

  return { enhance, getSession };
}

export default createSuperResRunner;
