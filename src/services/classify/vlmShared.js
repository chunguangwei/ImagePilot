/**
 * vlmShared — VLM 分类档的跨平台共享逻辑（与具体推理引擎无关）。
 *
 * iOS（VLMClassifier.ios.js，llama.rn/Qwen）与 Android（VLMClassifier.android.js，
 * LiteRT-LM/Gemma）都复用这里的：分类清单、prompt 构建、结果解析、语言、图像预处理。
 * 两端只在"用什么引擎跑推理"不同，prompt/解析/落库逻辑完全一致。
 */

import { NativeModules, Platform } from 'react-native';
import i18n from '../../i18n';

// eslint-disable-next-line global-require
const RNFS = require('react-native-fs');

/** 设备物理内存（MB）。iOS 走 HapticsModule、Android 走 GemmaModule 的 totalMemoryMB。
 *  取不到返回 0（= 未知，调用方不拦截）。用于本地大模型下载前判断机型是否跑得动。 */
export async function getDeviceTotalMemMB() {
  try {
    const mod = Platform.OS === 'android' ? NativeModules.GemmaModule : NativeModules.HapticsModule;
    if (mod && typeof mod.totalMemoryMB === 'function') {
      const mb = await mod.totalMemoryMB();
      return Number(mb) || 0;
    }
  } catch (_) {}
  return 0;
}
let ImageResizer = null;
try { ImageResizer = require('react-native-image-resizer').default || require('react-native-image-resizer'); }
catch (_) { ImageResizer = null; }

/** 当前 App 语言 → 'en' | 'zh'（决定 prompt 用英文/中文分类名与描述语言）。 */
export function currentLang() {
  try {
    const l = String(i18n.language || 'zh').toLowerCase();
    return l.startsWith('en') ? 'en' : 'zh';
  } catch (_) { return 'zh'; }
}

// 内置分类 id→中英名（与 public/initialSettings.json categoryNameMap 一致）。
// 作为运行时 ConfigService 读取失败时的兜底；NA（待分类）不参与模型选择。
const BUILTIN_FALLBACK = {
  social_activities: { zh: '社交活动', en: 'Social Activities' },
  pets: { zh: '宠物萌照', en: 'Pet Photos' },
  single_person: { zh: '单人照片', en: 'Single Person' },
  foods: { zh: '美食记录', en: 'Food Records' },
  travel_scenery: { zh: '旅行风景', en: 'Travel Scenery' },
  screenshot: { zh: '手机截图', en: 'Mobile Screenshots' },
  idcard: { zh: '证件照', en: 'ID Card' },
  qrcode: { zh: '二维码', en: 'QR Code' },
  electronics: { zh: '电子产品', en: 'Electronics' },
  kids: { zh: '儿童', en: 'Kids' },
  night_scene: { zh: '夜景', en: 'Night Scenes' },
  architecture: { zh: '建筑', en: 'Architecture' },
  plants: { zh: '植物花卉', en: 'Plants & Flowers' },
  vehicles: { zh: '车辆', en: 'Vehicles' },
  sports: { zh: '运动健身', en: 'Sports & Fitness' },
  fashion: { zh: '服饰穿搭', en: 'Fashion' },
  products: { zh: '商品', en: 'Products' },
  documents: { zh: '文档票据', en: 'Documents' },
  art: { zh: '艺术绘画', en: 'Art' },
  cartoon: { zh: '卡通表情', en: 'Cartoon & Memes' },
  other: { zh: '其它', en: 'Other Images' },
};

/** 取分类清单（id + 双语名）。优先 ConfigService 的"可见分类"（含自定义类、排除隐藏与 NA），兜底内置常量。 */
export function getCategoryList() {
  try {
    // eslint-disable-next-line global-require
    const ConfigService = require('../ConfigService').default || require('../ConfigService');
    if (ConfigService && typeof ConfigService.getAllCategoriesWithUI === 'function') {
      const arr = ConfigService.getAllCategoriesWithUI();
      if (Array.isArray(arr) && arr.length) {
        const list = arr
          .filter((x) => x && x.id && x.id !== 'NA')
          .map((x) => ({ id: x.id, zh: x.chinese || x.name || x.id, en: x.english || x.id }));
        if (list.length) return list;
      }
    }
  } catch (_) {}
  return Object.keys(BUILTIN_FALLBACK).map((id) => ({ id, zh: BUILTIN_FALLBACK[id].zh, en: BUILTIN_FALLBACK[id].en }));
}

/**
 * prompt：参考在线大模型 —— 同时要"分类 id"和"一句简短理解描述"。
 * 分类用于正常落库（一个类 + 百分比），描述写进 message → 显示为「🤖 AI 描述」。跟随 App 语言。
 */
export function buildPrompt(cats, lang) {
  if (lang === 'en') {
    const lines = cats.map((c) => `${c.id}=${c.en}`).join('  ');
    return (
      'Look at the image, then output EXACTLY two lines (description first, then category).\n' +
      'desc: one short English sentence (max 15 words) summarizing the image content.\n' +
      'cat: choose the single best category id from the list; if none fits, use other.\n\n' +
      `Categories (id=meaning):\n${lines}\n\n` +
      'desc: '
    );
  }
  const lines = cats.map((c) => `${c.id}=${c.zh}`).join('  ');
  return (
    'Look at the image, then output EXACTLY two lines (description first, then category).\n' +
    '描述: 用简体中文写一句不超过15字的图片内容概括（必须中文）。\n' +
    '分类: choose the single best category id from the list below; if none fits, use other.\n\n' +
    `Categories (id=中文含义)：\n${lines}\n\n` +
    '描述: '
  );
}

/** 标签按中文/英文名匹配到已有分类 id（精确或互为子串）；不中返回 null。 */
export function matchByName(label, cats) {
  const L = String(label || '').trim().toLowerCase();
  if (!L) return null;
  for (const c of cats) {
    const zh = String(c.zh || '').toLowerCase();
    const en = String(c.en || '').toLowerCase();
    if (!zh && !en) continue;
    if (L === zh || L === en) return c.id;
  }
  for (const c of cats) {
    if (c.id === 'other') continue;
    const zh = String(c.zh || '').toLowerCase();
    if (zh && (zh.includes(L) || L.includes(zh))) return c.id;
    const en = String(c.en || '').toLowerCase();
    if (en && L.length >= 3 && (en.includes(L) || L.split(/\s+/).some((w) => w.length >= 3 && en.includes(w)))) return c.id;
  }
  return null;
}

/** 解析模型输出 → { appCategory, description }。容错：抓「描述:/desc:」「分类:/cat:」两行；抓不到则首行当描述、derive 分类。 */
export function parseResult(raw, cats, lang) {
  const idSet = new Set(cats.map((c) => c.id));
  const lines = String(raw || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const catRe = /^(?:分类|类别|category|cat)\s*[:：]\s*(.+)$/i;
  const descRe = /^(?:描述|说明|内容|description|desc)\s*[:：]\s*(.+)$/i;
  let catRaw = null;
  let desc = '';
  for (const line of lines) {
    const mc = line.match(catRe);
    const md = line.match(descRe);
    if (mc && catRaw == null) catRaw = mc[1].trim();
    else if (md && !desc) desc = md[1].trim();
  }
  if (catRaw == null && lines.length) catRaw = lines[0];
  if (!desc) {
    desc = lines
      .filter((l) => !/^(?:分类|类别|category|cat)\s*[:：]/i.test(l))
      .join(' ')
      .replace(/^(?:描述|说明|内容|description|desc)\s*[:：]\s*/i, '')
      .trim();
  }
  let appCategory = 'other';
  if (catRaw) {
    const c = catRaw.replace(/^["'`]+|["'`。.，,\s]+$/g, '').split(/[\s,，]/)[0].trim().toLowerCase();
    if (idSet.has(c)) appCategory = c;
    else { const hit = matchByName(c, cats); if (hit) appCategory = hit; }
  }
  desc = String(desc || '').replace(/^["'`]+|["'`]+$/g, '').replace(/^(?:分类|category|cat)\s*[:：].*/i, '').trim();
  if (!desc) {
    const cat = cats.find((x) => x.id === appCategory);
    desc = (cat && (lang === 'en' ? cat.en : cat.zh)) || '';
  }
  if (desc.length > (lang === 'en' ? 60 : 30)) desc = desc.slice(0, lang === 'en' ? 60 : 30);
  return { appCategory, description: desc || null };
}

/** ph:// / file:// → 缩放后的本地 jpg 路径（file://）。最长边 768、contain 保留整图。 */
export async function prepareImageFile(imageUri) {
  if (!ImageResizer) throw new Error('react-native-image-resizer 不可用');
  const r = await ImageResizer.createResizedImage(
    imageUri, 768, 768, 'JPEG', 90, 0, undefined, false, { mode: 'contain' },
  );
  const uri = r.uri || '';
  return uri.startsWith('file://') ? uri : `file://${uri}`;
}

/** 删除临时缩略图（best-effort）。 */
export async function cleanupTmp(tmpFile) {
  try { if (tmpFile) await RNFS.unlink(String(tmpFile).replace(/^file:\/\//, '')); } catch (_) {}
}

/** 把某变体标记为本机不可用（OOM/不支持）→ 设置页据此禁用。 */
export async function markVlmUnsupported(modelId, reason) {
  try {
    // eslint-disable-next-line global-require
    const UnifiedDataService = require('../UnifiedDataService').default || require('../UnifiedDataService');
    const s = (await UnifiedDataService.readSettings()) || {};
    const cur = s.vlmUnsupported || {};
    if (cur[modelId]) return;
    await UnifiedDataService.writeSettings({ ...s, vlmUnsupported: { ...cur, [modelId]: reason || true } });
  } catch (_) {}
}

/** 构造统一返回契约（与 Places365/MobileCLIP 对齐）。 */
export function buildResult(appCategory, description, t0) {
  const vlmLabel = description || null;
  const name = description || appCategory;
  return {
    success: true,
    predictions: [{ index: 0, name, probability: 1.0, appCategory, vlmLabel }],
    topPrediction: { index: 0, name, appCategory, probability: 1.0, vlmLabel },
    confidence: 0.9,
    vlmLabel,
    model: 'vlm',
    processingTime: Date.now() - t0,
  };
}

export function buildFailure(e, t0) {
  return {
    success: false,
    error: e?.message || String(e),
    predictions: [],
    topPrediction: null,
    confidence: 0,
    model: 'vlm',
    processingTime: Date.now() - t0,
  };
}

export default {
  currentLang, getCategoryList, buildPrompt, matchByName, parseResult,
  prepareImageFile, cleanupTmp, markVlmUnsupported, buildResult, buildFailure,
};
