/**
 * ImagePreprocessor — 图片预处理（移动端 base64 OOM 防御）
 *
 * 问题：移动端把整张原图（动辄 4000×3000、十几 MB）直接读成 base64 喂给 LLM，
 *   极易触发 OOM / 卡顿，且 vision 分类根本不需要这么高分辨率。
 *
 * 对策：调用 LLM 前统一把长边 resize 到 maxEdge（默认 1024），再编码 base64。
 *
 * 平台差异通过 adapter 注入（与 SecureKeyStore 同款思路）：
 *   - resize/encode 的底层实现各平台不同（RN 用 image 库，Electron 用 canvas/sharp）。
 *   - 无 adapter 时退化为 passthrough（仅做 data: 前缀剥离），保证逻辑可跑、可测。
 */

export const DEFAULT_MAX_EDGE = 1024;
export const DEFAULT_QUALITY = 0.8;

export class ImagePreprocessor {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.maxEdge=1024] - 长边上限（像素）
   * @param {number} [opts.quality=0.8]  - JPEG 质量 0~1
   * @param {ResizeAdapter} [opts.adapter] - 平台 resize 实现；缺省为 passthrough
   */
  constructor(opts = {}) {
    this.maxEdge = opts.maxEdge || DEFAULT_MAX_EDGE;
    this.quality = typeof opts.quality === 'number' ? opts.quality : DEFAULT_QUALITY;
    this.adapter = opts.adapter || null;
  }

  /**
   * 预处理一张图片，返回**不带 data: 前缀**的 base64（Provider 期望的格式）。
   *
   * @param {Object} input - 至少提供 uri / path / base64 之一
   * @param {string} [input.uri]    - 文件/内容 URI（移动端常见）
   * @param {string} [input.path]   - 本地路径（PC 常见）
   * @param {string} [input.base64] - 已有 base64（可能含 data: 前缀）
   * @param {number} [input.width]  - 已知原始宽（可选，用于跳过无谓 resize）
   * @param {number} [input.height]
   * @returns {Promise<{base64: string, resized: boolean, width?: number, height?: number}>}
   */
  async process(input) {
    if (!input || (!input.uri && !input.path && !input.base64)) {
      throw new Error('ImagePreprocessor.process: need uri | path | base64');
    }

    // 已知尺寸且本就小于上限 → 无需 resize，直接走 passthrough
    const alreadySmall =
      typeof input.width === 'number' &&
      typeof input.height === 'number' &&
      Math.max(input.width, input.height) <= this.maxEdge;

    if (this.adapter && !alreadySmall) {
      const r = await this.adapter.resize(input, { maxEdge: this.maxEdge, quality: this.quality });
      return {
        base64: stripDataPrefix(r.base64),
        resized: true,
        width: r.width,
        height: r.height,
      };
    }

    // passthrough：无 adapter 或已足够小。要求调用方至少给了 base64。
    if (!input.base64) {
      throw new Error(
        'ImagePreprocessor: no resize adapter configured and no base64 provided. ' +
          'Inject a platform adapter (RN/Electron) or pass input.base64.',
      );
    }
    return {
      base64: stripDataPrefix(input.base64),
      resized: false,
      width: input.width,
      height: input.height,
    };
  }

  /** 计算 resize 后尺寸（保持比例，长边 = maxEdge），供 adapter 参考 */
  static fitLongEdge(width, height, maxEdge) {
    const longest = Math.max(width, height);
    if (longest <= maxEdge) return { width, height, scale: 1 };
    const scale = maxEdge / longest;
    return {
      width: Math.round(width * scale),
      height: Math.round(height * scale),
      scale,
    };
  }
}

/** 去掉 data:image/...;base64, 前缀 */
export function stripDataPrefix(b64) {
  if (typeof b64 !== 'string') return b64;
  return b64.startsWith('data:') ? b64.slice(b64.indexOf(',') + 1) : b64;
}

/**
 * @typedef {Object} ResizeAdapter
 * @property {(input: object, opts: {maxEdge:number, quality:number}) =>
 *   Promise<{base64:string, width:number, height:number}>} resize
 */

// ============ 平台 Adapter 示例（按需在各端实现并注入） ============

/**
 * React Native adapter 示例（依赖 @bam.tech/react-native-image-resizer 或等价库）。
 * 仅作接线参考，安装对应库后启用：
 *
 *   import ImageResizer from '@bam.tech/react-native-image-resizer';
 *   import * as FileSystem from 'expo-file-system'; // 或 react-native-fs
 *   const adapter = createRNImageAdapter({ ImageResizer, readBase64: FileSystem.readAsStringAsync });
 *   const pre = new ImagePreprocessor({ adapter });
 */
export function createRNImageAdapter({ ImageResizer, readBase64 }) {
  return {
    async resize(input, { maxEdge, quality }) {
      const src = input.uri || input.path;
      const out = await ImageResizer.createResizedImage(
        src,
        maxEdge,
        maxEdge,
        'JPEG',
        Math.round(quality * 100),
        0,
      );
      const base64 = await readBase64(out.uri, { encoding: 'base64' });
      return { base64, width: out.width, height: out.height };
    },
  };
}

/**
 * Electron / Node adapter 示例（依赖 sharp）。
 *
 *   import sharp from 'sharp';
 *   const adapter = createSharpAdapter({ sharp });
 *   const pre = new ImagePreprocessor({ adapter });
 */
export function createSharpAdapter({ sharp }) {
  return {
    async resize(input, { maxEdge, quality }) {
      const src = input.path || input.uri;
      const pipeline = sharp(src)
        .rotate() // 依据 EXIF 方向自动旋正
        .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: Math.round(quality * 100) });
      const buf = await pipeline.toBuffer();
      const meta = await sharp(buf).metadata();
      return { base64: buf.toString('base64'), width: meta.width, height: meta.height };
    },
  };
}

export default ImagePreprocessor;
