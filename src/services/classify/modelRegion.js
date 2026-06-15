/**
 * modelRegion —— 端侧模型下载「按地区选源」。
 *
 * 国内（中国大陆）：ModelScope 直连国内 CDN 最快 → ModelScope 优先，GitHub（代理+直连）兜底。
 * 海外：访问国内 CDN 慢/不通 → GitHub 直连优先，ModelScope 兜底。
 * 解决全球上线时海外用户首次下模型卡 ModelScope 超时的问题。
 */

const MS_BASE = 'https://modelscope.cn/models/chunguangwee/ImagePilot-models/resolve/master';
const GH_BASE = 'https://github.com/chunguangwei/ImagePilot/releases/download/models-v1';
const GH_PROXY = 'https://gh-proxy.com/'; // 国内访问 github 的加速代理

let _cnPref = null;
/** 是否偏好国内源（中国大陆地区 / 中文且未知地区）。结果缓存。 */
export function prefersChinaSource() {
  if (_cnPref !== null) return _cnPref;
  _cnPref = false;
  try {
    // 用 require 而非 import：本函数仅在运行时下载模型时调用，非模块加载期，release 下安全
    const RL = require('react-native-localize');
    const locales = (RL && RL.getLocales) ? RL.getLocales() : [];
    if (locales && locales.length) {
      const cc = String(locales[0].countryCode || '').toUpperCase();
      const lc = String(locales[0].languageCode || '').toLowerCase();
      // 明确中国大陆 → 国内源；地区取不到但语言中文 → 也按国内
      _cnPref = cc === 'CN' || (!cc && lc === 'zh');
    }
  } catch (_) { /* 取不到地区 → 海外源（GitHub 全球可达，作安全默认） */ }
  return _cnPref;
}

/** 某模型文件的下载候选 URL（按地区排序，主源在前、兜底在后）。 */
export function modelCandidates(filename) {
  const ms = `${MS_BASE}/${filename}`;
  const gh = `${GH_BASE}/${filename}`;
  if (prefersChinaSource()) return [ms, GH_PROXY + gh, gh]; // 国内：MS → GitHub代理 → 直连
  return [gh, ms]; // 海外：GitHub 直连 → MS 兜底
}

/** 某模型文件的首选下载 URL（单源场景用）。 */
export function modelPrimaryUrl(filename) {
  return modelCandidates(filename)[0];
}

/** 判断一个 url 是否指向本产品模型库（ModelScope 直链 或 GitHub models-v1），并提取文件名。 */
export function modelFilenameFromUrl(url) {
  const ms = String(url || '').match(/modelscope\.cn\/.*\/resolve\/master\/([^?]+)$/i);
  if (ms) return ms[1];
  const gh = String(url || '').match(/releases\/download\/models-v1\/([^?]+)$/i);
  if (gh) return gh[1];
  return null;
}

export default { prefersChinaSource, modelCandidates, modelPrimaryUrl, modelFilenameFromUrl };
