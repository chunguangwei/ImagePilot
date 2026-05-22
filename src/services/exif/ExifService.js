/**
 * ExifService — 跨平台 EXIF 读取（GPS 坐标 + 拍摄时间）
 *
 * 底层用 exifr（package.json.deps.snippet.json 已列）。exifr 在 RN/Electron/Node 均可用，
 * 接受 Buffer / Uint8Array / ArrayBuffer / 文件路径 / Blob。
 *
 * 设计：
 *   - exifr 实例**注入**（构造时传入），便于单测与按需加载；缺失时方法优雅返回 null。
 *   - 暴露纯函数 dmsToDecimal / parseExifDate，可脱离 exifr 单测。
 *
 * 用法：
 *   import * as exifr from 'exifr';
 *   const svc = new ExifService({ exifr });
 *   const { coords, takenAt } = await svc.read(fileOrBuffer);
 */

/** EXIF GPS 的度分秒（DMS）转十进制度；ref 为 'N'/'S'/'E'/'W' */
export function dmsToDecimal(dms, ref) {
  if (typeof dms === 'number') {
    // exifr 常已转为十进制
    return applyRef(dms, ref);
  }
  if (Array.isArray(dms) && dms.length >= 1) {
    const [d = 0, m = 0, s = 0] = dms;
    return applyRef(d + m / 60 + s / 3600, ref);
  }
  return null;
}

function applyRef(value, ref) {
  if (value == null || Number.isNaN(value)) return null;
  const neg = ref === 'S' || ref === 'W';
  return neg ? -Math.abs(value) : value;
}

/**
 * 解析 EXIF 日期。exifr 通常已返回 Date；也兼容 "YYYY:MM:DD HH:mm:ss" 字符串。
 * @returns {Date|null}
 */
export function parseExifDate(input) {
  if (!input) return null;
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
  if (typeof input === 'string') {
    // EXIF 标准格式 "2026:05:22 13:45:01"
    const m = input.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (m) {
      const [, y, mo, d, h, mi, s] = m.map(Number);
      const dt = new Date(y, mo - 1, d, h, mi, s);
      return Number.isNaN(dt.getTime()) ? null : dt;
    }
    const dt = new Date(input);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  return null;
}

export class ExifService {
  /**
   * @param {Object} [deps]
   * @param {object} [deps.exifr] - exifr 模块（含 gps()/parse()）；缺省则 read() 返回空结果
   */
  constructor({ exifr } = {}) {
    this.exifr = exifr || null;
  }

  get available() {
    return !!this.exifr;
  }

  /**
   * 读取一张图片的 GPS 与拍摄时间。
   * @param {*} input - Buffer / Uint8Array / ArrayBuffer / 路径 / Blob（exifr 支持的任意输入）
   * @returns {Promise<{coords: {lat:number, lon:number}|null, takenAt: Date|null}>}
   */
  async read(input) {
    if (!this.available || input == null) return { coords: null, takenAt: null };

    const coords = await this._readGps(input);
    const takenAt = await this._readDate(input);
    return { coords, takenAt };
  }

  async _readGps(input) {
    try {
      if (typeof this.exifr.gps === 'function') {
        const g = await this.exifr.gps(input);
        if (g && typeof g.latitude === 'number' && typeof g.longitude === 'number') {
          return { lat: g.latitude, lon: g.longitude };
        }
        return null;
      }
      // 退化：从 parse 结果拼 GPS
      const tags = await this.exifr.parse(input, { gps: true });
      if (tags && typeof tags.latitude === 'number' && typeof tags.longitude === 'number') {
        return { lat: tags.latitude, lon: tags.longitude };
      }
      if (tags?.GPSLatitude) {
        const lat = dmsToDecimal(tags.GPSLatitude, tags.GPSLatitudeRef);
        const lon = dmsToDecimal(tags.GPSLongitude, tags.GPSLongitudeRef);
        if (lat != null && lon != null) return { lat, lon };
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  async _readDate(input) {
    try {
      const tags = await this.exifr.parse(input, {
        pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate'],
      });
      return (
        parseExifDate(tags?.DateTimeOriginal) ||
        parseExifDate(tags?.CreateDate) ||
        parseExifDate(tags?.ModifyDate) ||
        null
      );
    } catch (_) {
      return null;
    }
  }
}

export default ExifService;
