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

/**
 * 取设备系统 locale（零依赖，只用 RN 核心 NativeModules）。
 * iOS：SettingsManager.settings.AppleLocale / AppleLanguages[0]（如 "zh_CN" / "zh-Hans-CN"）。
 * Android：I18nManager.localeIdentifier（如 "zh_CN"）。
 * 历史坑：早期版本曾 require('react-native-localize')，但该库未装进本项目 →
 *        端侧下载模型时触发缺失模块、iOS 直接 fatal crash。改用核心模块，永不缺失。
 */
function deviceLocale() {
  try {
    const { NativeModules, Platform } = require('react-native');
    if (Platform.OS === 'ios') {
      const s = NativeModules.SettingsManager && NativeModules.SettingsManager.settings;
      if (!s) return '';
      return s.AppleLocale || (Array.isArray(s.AppleLanguages) ? s.AppleLanguages[0] : '') || '';
    }
    return (NativeModules.I18nManager && NativeModules.I18nManager.localeIdentifier) || '';
  } catch (_) { return ''; }
}

let _cnPref = null;
/** 是否偏好国内源（中国大陆 zh_CN / 简体）。港台 zh_TW/zh_HK 视为海外（GitHub 更稳）。结果缓存。 */
export function prefersChinaSource() {
  if (_cnPref !== null) return _cnPref;
  _cnPref = false;
  try {
    const lc = String(deviceLocale()).toLowerCase().replace(/-/g, '_');
    // 中国大陆：zh_CN / zh_hans / zh_hans_cn / 纯 zh → 国内源；其它（含繁体、非中文）→ 海外
    _cnPref = lc === 'zh' || lc.startsWith('zh_cn') || lc.startsWith('zh_hans');
  } catch (_) { /* 取不到 → 海外源（GitHub 全球可达，作安全默认） */ }
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
