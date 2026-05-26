/**
 * UpdateService — 应用内检查 GitHub Releases 更新
 *
 * 独立于上游 fork：更新源指向本产品自己的仓库 chunguangwei/ImagePilot。
 * 流程：拉取 releases/latest → 比对版本 → 有新版则引导下载最新 APK
 *       （用系统浏览器打开 APK 直链，下载完成后由 Android 安装器接管安装；
 *        无需 REQUEST_INSTALL_PACKAGES / 原生模块，稳妥且零原生依赖）。
 */

import { Linking } from 'react-native';
import { BUILD_VERSION } from '../config/BuildInfo';

export const UPDATE_REPO = 'chunguangwei/ImagePilot';
const RELEASES_API = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;
export const RELEASES_PAGE = `https://github.com/${UPDATE_REPO}/releases/latest`;

// GitHub API 要求带 User-Agent，否则部分边缘节点会 403。
const GH_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'ImagePilot-App',
  'X-GitHub-Api-Version': '2022-11-28',
};

export const CURRENT_VERSION = BUILD_VERSION;

/** "v1.2.3" / "1.2.3" → [1,2,3] */
function parseVersion(v) {
  const m = String(v || '').trim().replace(/^v/i, '').match(/\d+(?:\.\d+)*/);
  return m ? m[0].split('.').map((n) => parseInt(n, 10) || 0) : [0];
}

/** a 是否比 b 新（语义化版本逐段比较） */
export function isNewer(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

/**
 * 查询最新 Release。
 * @returns {Promise<{hasUpdate:boolean, latestVersion:string|null, currentVersion:string,
 *                    notes:string, apkUrl:string|null, pageUrl:string}>}
 * 网络/解析失败时抛错，由调用方决定是否静默处理。
 */
export async function checkForUpdate() {
  // 主路径：api.github.com（能拿到 APK 直链与更新说明）
  try {
    const res = await fetch(RELEASES_API, { headers: GH_HEADERS });
    if (res.status === 404) {
      // 仓库尚无任何 Release（明确无更新，不必再走兜底）
      return { hasUpdate: false, latestVersion: null, currentVersion: BUILD_VERSION, notes: '', apkUrl: null, pageUrl: RELEASES_PAGE };
    }
    if (res.ok) {
      const data = await res.json();
      const latestVersion = data.tag_name || data.name || '';
      const apkAsset = (data.assets || []).find((a) => /\.apk$/i.test(a.name || ''));
      return {
        hasUpdate: isNewer(latestVersion, BUILD_VERSION),
        latestVersion,
        currentVersion: BUILD_VERSION,
        notes: data.body || '',
        apkUrl: apkAsset ? apkAsset.browser_download_url : null,
        pageUrl: data.html_url || RELEASES_PAGE,
      };
    }
    // 非 404 的失败（如 403 限流/网络拦截）→ 落到 atom 兜底
  } catch (_) {
    // 网络异常 → 落到 atom 兜底
  }
  // 兜底：github.com 的 releases.atom（与 api.github.com 不同域，常在 API 被拦时仍可达）。
  // 注：atom 无 APK 直链，故 apkUrl=null，下载时回退到发布页。
  return await checkViaAtom();
}

/** 解析 github.com/<repo>/releases.atom 取最新版本（API 不可达时的兜底）。 */
async function checkViaAtom() {
  const res = await fetch(`https://github.com/${UPDATE_REPO}/releases.atom`, {
    headers: { 'User-Agent': 'ImagePilot-App', Accept: 'application/atom+xml' },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const xml = await res.text();
  // 第一个 entry 即最新；从 releases/tag/<tag> 链接里取版本号
  const m = xml.match(/releases\/tag\/([^"'<>\s]+)/);
  const latestVersion = m ? decodeURIComponent(m[1]) : '';
  if (!latestVersion) {
    // 没有任何 release entry
    return { hasUpdate: false, latestVersion: null, currentVersion: BUILD_VERSION, notes: '', apkUrl: null, pageUrl: RELEASES_PAGE };
  }
  return {
    hasUpdate: isNewer(latestVersion, BUILD_VERSION),
    latestVersion,
    currentVersion: BUILD_VERSION,
    notes: '',
    apkUrl: null,
    pageUrl: RELEASES_PAGE,
  };
}

/** 打开下载：优先 APK 直链（浏览器下载→系统安装器），无直链则打开 Release 页。 */
export async function openDownload(info) {
  const url = (info && (info.apkUrl || info.pageUrl)) || RELEASES_PAGE;
  await Linking.openURL(url);
}

/** 直接打开 GitHub Releases 页（API 不可达时的兜底，用户可手动下载安装）。 */
export async function openReleasesPage() {
  await Linking.openURL(RELEASES_PAGE);
}

export default { checkForUpdate, openDownload, openReleasesPage, isNewer, CURRENT_VERSION, UPDATE_REPO, RELEASES_PAGE };
