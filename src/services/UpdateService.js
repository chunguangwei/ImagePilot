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
    // atom 拿不到资产列表，按约定拼出 APK 直链（资产名固定 app-release.apk，走 github.com 下载域）
    apkUrl: `https://github.com/${UPDATE_REPO}/releases/download/${latestVersion}/app-release.apk`,
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

/**
 * 方案2：App 内下载 APK 并拉起系统安装器（不开浏览器）。
 * 下载到缓存目录 → 调原生 ApkInstaller 安装。
 * @param {string} apkUrl
 * @param {(progress:number)=>void} [onProgress] 0~1
 * @throws E_NEED_PERMISSION（未授予安装未知应用权限，原生已引导去设置）/ 其它下载或安装错误
 * @returns {Promise<string>} 下载到的本地路径
 */
export async function downloadAndInstall(apkUrl, onProgress) {
  // 原生依赖懒加载（仅 Android 走这条路；web/异常由调用方兜底到浏览器）
  // eslint-disable-next-line global-require
  const RNFS = require('react-native-fs');
  // eslint-disable-next-line global-require
  const { NativeModules } = require('react-native');
  const ApkInstaller = NativeModules && NativeModules.ApkInstaller;
  if (!ApkInstaller || typeof ApkInstaller.install !== 'function') {
    throw new Error('ApkInstaller 原生模块不可用');
  }
  const dest = `${RNFS.CachesDirectoryPath}/imagepilot-update.apk`;
  try {
    if (await RNFS.exists(dest)) await RNFS.unlink(dest);
  } catch (_) { /* 忽略旧文件清理失败 */ }

  // 记录服务端声明的总大小，下载完成后用于校验是否被中途截断
  let expectedTotal = 0;
  const { promise } = RNFS.downloadFile({
    fromUrl: apkUrl,
    toFile: dest,
    progressInterval: 300,
    begin: (res) => {
      if (res && res.contentLength > 0) expectedTotal = res.contentLength;
    },
    progress: (res) => {
      if (res && res.contentLength > 0) expectedTotal = res.contentLength;
      if (onProgress && res.contentLength > 0) {
        onProgress(Math.min(1, res.bytesWritten / res.contentLength));
      }
    },
  });
  const result = await promise;
  if (result && result.statusCode && result.statusCode >= 400) {
    throw new Error('下载失败 HTTP ' + result.statusCode);
  }

  // 完整性校验：RNFS 在连接中断时仍可能以 200 resolve，得到截断文件
  // （安装时即报「解析软件包失败」）。这里主动验大小 + APK(ZIP) 魔数。
  let actualSize = 0;
  try {
    const stat = await RNFS.stat(dest);
    actualSize = Number(stat.size) || 0;
  } catch (_) { /* stat 失败按 0 处理，下方会判定为损坏 */ }

  const tooSmall = actualSize < 1024 * 1024; // APK 不可能 < 1MB
  const truncated = expectedTotal > 0 && actualSize < expectedTotal;
  let badMagic = false;
  try {
    const head = await RNFS.read(dest, 4, 0, 'ascii'); // ZIP/APK 魔数 'PK\x03\x04'
    badMagic = !(head && head.charCodeAt(0) === 0x50 && head.charCodeAt(1) === 0x4b);
  } catch (_) { badMagic = true; }

  if (tooSmall || truncated || badMagic) {
    try { await RNFS.unlink(dest); } catch (_) {}
    const got = (actualSize / 1048576).toFixed(1);
    const exp = expectedTotal > 0 ? (expectedTotal / 1048576).toFixed(1) : '?';
    throw new Error(`E_CORRUPT 安装包下载不完整（${got}MB/${exp}MB），请重试或用浏览器下载`);
  }

  await ApkInstaller.install(dest); // 未授权会 reject E_NEED_PERMISSION（已引导去设置）
  return dest;
}

export default { checkForUpdate, openDownload, openReleasesPage, downloadAndInstall, isNewer, CURRENT_VERSION, UPDATE_REPO, RELEASES_PAGE };
