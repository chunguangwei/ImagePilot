/**
 * SmartRenameService — 智能改名（借鉴 PhotoClassifierWithAI）
 *
 * 默认模板：`{date}-{city}-{label}`，扩展名自动附加 → 形如 `20260522-上海-风景.jpg`
 * 用户可定制模板（token 见下）。纯逻辑、无 I/O，便于测试；实际改名由上层注入的 renamer 执行。
 *
 * 支持 token（{} 包裹）：
 *   {date}    拍摄日期 YYYYMMDD（无则 fallback）
 *   {year} {month} {day}   年/月/日（补零）
 *   {time}    HHmmss
 *   {city}    语义地点名或城市（SemanticLocationService.resolveLabel 的 label）
 *   {label}   分类标签（contentCategory 经 labelMap 映射的友好名）
 *   {category} 原始 contentCategory
 *   {seq}     批量序号（去重时也会用到）
 *   {original} 原文件名（不含扩展名）
 */

const DEFAULT_TEMPLATE = '{date}-{city}-{label}';

const ZH_LABELS = {
  single_person: '人物',
  social: '合影',
  pet: '宠物',
  food: '美食',
  scenery: '风景',
  id_card: '证件',
  screenshot: '截图',
  qrcode: '二维码',
  other: '其他',
};
const EN_LABELS = {
  single_person: 'person',
  social: 'group',
  pet: 'pet',
  food: 'food',
  scenery: 'scenery',
  id_card: 'idcard',
  screenshot: 'screenshot',
  qrcode: 'qrcode',
  other: 'other',
};

/** 文件名非法字符清洗（跨平台保守集）+ 折叠空白/连字符 */
export function sanitizeFilename(name, { replacement = '_', maxLength = 120 } = {}) {
  let s = String(name)
    .replace(/[\/\\:*?"<>|\x00-\x1f]/g, replacement) // Win/Unix 非法字符 + 控制字符
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '') // 去首尾点/空格（Windows 不允许结尾点）
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length > maxLength) s = s.slice(0, maxLength);
  return s || 'untitled';
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

export class SmartRenameService {
  /**
   * @param {Object} [opts]
   * @param {string} [opts.template]    - 命名模板
   * @param {'zh'|'en'} [opts.lang]     - 标签语言
   * @param {Record<string,string>} [opts.labelMap] - 覆盖默认标签映射
   * @param {string} [opts.dateFallback] - 无拍摄日期时占位（默认 'nodate'）
   * @param {string} [opts.cityFallback] - 无地点时占位（默认 zh:'未知地点' / en:'unknown'）
   */
  constructor(opts = {}) {
    this.template = opts.template || DEFAULT_TEMPLATE;
    this.lang = opts.lang === 'en' ? 'en' : 'zh';
    this.labelMap = opts.labelMap || (this.lang === 'en' ? EN_LABELS : ZH_LABELS);
    this.dateFallback = opts.dateFallback || 'nodate';
    this.cityFallback = opts.cityFallback || (this.lang === 'en' ? 'unknown' : '未知地点');
  }

  /**
   * 为单张图片生成新文件名（含扩展名，不含目录）。
   * @param {Object} photo
   * @param {Date|null} [photo.takenAt]
   * @param {string|null} [photo.city]          - 已解析的地点/城市标签
   * @param {string} [photo.contentCategory]    - 分类结果
   * @param {string} [photo.originalName]        - 原文件名（可含扩展名）
   * @param {number} [photo.seq]                 - 序号
   * @param {string} [photo.ext]                 - 强制扩展名（否则从 originalName 推断）
   * @param {string} [template]                  - 覆盖默认模板
   * @returns {string}
   */
  buildName(photo, template) {
    const tpl = template || this.template;
    const ext = this._resolveExt(photo);
    const tokens = this._tokens(photo);
    let base = tpl.replace(/\{(\w+)\}/g, (_, key) => (key in tokens ? tokens[key] : ''));
    base = sanitizeFilename(base);
    return ext ? `${base}.${ext}` : base;
  }

  /**
   * 批量生成命名计划，并保证唯一（同名追加 -2 / -3…）。
   * @param {Array} photos - 每项同 buildName 的 photo
   * @param {Object} [opts]
   * @param {Set<string>} [opts.taken] - 已占用文件名（目录中现有文件），用于跨批去重
   * @param {string} [opts.template]
   * @returns {Array<{originalName?:string, newName:string, changed:boolean}>}
   */
  buildBatch(photos, opts = {}) {
    const taken = new Set(opts.taken || []);
    const out = [];
    photos.forEach((photo, i) => {
      const seq = typeof photo.seq === 'number' ? photo.seq : i + 1;
      let name = this.buildName({ ...photo, seq }, opts.template);
      name = this._dedupe(name, taken);
      taken.add(name.toLowerCase());
      out.push({
        originalName: photo.originalName,
        newName: name,
        changed: !photo.originalName || photo.originalName !== name,
      });
    });
    return out;
  }

  // ---------- 内部 ----------
  _tokens(photo) {
    const d = photo.takenAt instanceof Date && !Number.isNaN(photo.takenAt.getTime()) ? photo.takenAt : null;
    const yyyymmdd = d ? `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` : this.dateFallback;
    const cat = photo.contentCategory || 'other';
    return {
      date: yyyymmdd,
      year: d ? String(d.getFullYear()) : this.dateFallback,
      month: d ? pad2(d.getMonth() + 1) : '',
      day: d ? pad2(d.getDate()) : '',
      time: d ? `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}` : '',
      city: (photo.city && String(photo.city).trim()) || this.cityFallback,
      label: this.labelMap[cat] || this.labelMap.other || cat,
      category: cat,
      seq: photo.seq != null ? String(photo.seq) : '',
      original: photo.originalName ? this._stripExt(photo.originalName) : '',
    };
  }

  _resolveExt(photo) {
    if (photo.ext) return String(photo.ext).replace(/^\./, '').toLowerCase();
    if (photo.originalName && photo.originalName.includes('.')) {
      return photo.originalName.split('.').pop().toLowerCase();
    }
    return 'jpg';
  }

  _stripExt(name) {
    const i = name.lastIndexOf('.');
    return i > 0 ? name.slice(0, i) : name;
  }

  _dedupe(name, takenLower) {
    if (!takenLower.has(name.toLowerCase())) return name;
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let n = 2;
    let candidate;
    do {
      candidate = `${base}-${n}${ext}`;
      n++;
    } while (takenLower.has(candidate.toLowerCase()));
    return candidate;
  }
}

export default SmartRenameService;
