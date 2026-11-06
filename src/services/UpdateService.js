/**
 * UpdateService — 应用内检查 GitHub Releases 更新
 *
 * 独立于上游 fork：更新源指向本产品自己的仓库 chunguangwei/ImagePilot。
 * 流程：拉取 releases/latest → 比对版本 → 有新版则引导下载最新 APK
 *       应用内下载到私有缓存 → 原生 ApkInstaller 调起系统安装器。
 *       API 失败时从 GitHub 同域附件列表解析地址，浏览器仅作为用户主动选择的备用入口。
 */

import { Linking } from 'react-native';
import SHA256 from 'crypto-js/sha256';
import { downloadCandidates } from './classify/modelRegion';
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

async function fetchWithTimeout(url, options = {}) {
  if (typeof AbortController === 'undefined') return fetch(url, options);
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener?.('abort', abort);
  if (options.signal?.aborted) abort();
  const timer = setTimeout(abort, 15000);
  try { return await fetch(url, {...options, signal:controller.signal}); }
  finally { clearTimeout(timer); options.signal?.removeEventListener?.('abort', abort); }
}

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
  // eslint-disable-next-line global-require
  const { Platform } = require('react-native');
  const isIOS = Platform.OS === 'ios';
  // iOS 拿不到也用不了 .apk（系统禁 sideload）。Release 现阶段也没出 .ipa，
  // 直接返回"无更新"，避免给 iOS 用户推一个跑去 Android 包的链接。
  // 后续 iOS 有 TestFlight / Ad Hoc 分发后，这里可以放开 + apkUrl 改成对应分发链接。
  if (isIOS) {
    return { hasUpdate: false, latestVersion: null, currentVersion: BUILD_VERSION, notes: '', apkUrl: null, pageUrl: RELEASES_PAGE };
  }
  // 主路径：api.github.com（能拿到 APK 直链与更新说明）
  try {
    let res;
    for (const endpoint of [RELEASES_API, `https://gh-proxy.com/${RELEASES_API}`]) {
      try {
        res = await fetchWithTimeout(endpoint, { headers: GH_HEADERS });
        if (res.ok || res.status === 404) break;
      } catch (_) { /* Try alternate route. */ }
    }
    if (!res) throw new Error('Update metadata unavailable');
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
        apkSize: apkAsset?.size || 0,
        apkSha256: /^sha256:[a-f0-9]{64}$/i.test(apkAsset?.digest || '') ? apkAsset.digest.slice(7) : null,
        pageUrl: data.html_url || RELEASES_PAGE,
      };
    }
    // 非 404 的失败（如 403 限流/网络拦截）→ 落到 atom 兜底
  } catch (_) {
    // 网络异常 → 落到 atom 兜底
  }
  // 兜底：github.com 的 releases.atom（与 api.github.com 不同域，常在 API 被拦时仍可达）。
  // Atom 提供版本，再从同域附件列表解析实际 APK 地址。
  return await checkViaAtom();
}

/** 解析 github.com/<repo>/releases.atom 取最新版本（API 不可达时的兜底）。 */
async function checkViaAtom() {
  const res = await fetchWithTimeout(`https://github.com/${UPDATE_REPO}/releases.atom`, {
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
  let apkUrl = null;
  try { apkUrl = await resolveApkUrl({ latestVersion }); } catch (_) { /* Retry from the download UI. */ }
  return {
    hasUpdate: isNewer(latestVersion, BUILD_VERSION),
    latestVersion,
    currentVersion: BUILD_VERSION,
    notes: '',
    apkUrl,
    pageUrl: `https://github.com/${UPDATE_REPO}/releases/tag/${latestVersion}`,
  };
}

/** Resolve an actual asset even when api.github.com is unreachable. Never guess APK names. */
export async function resolveApkUrl(info) {
  if (info?.apkUrl) return info.apkUrl;
  const version = String(info?.latestVersion || '');
  if (!version) throw new Error('未获取更新版本，请重新检查更新');
  const tag = encodeURIComponent(version);
  const response = await fetchWithTimeout(`https://github.com/${UPDATE_REPO}/releases/expanded_assets/${tag}`, {
    headers: { 'User-Agent': 'ImagePilot-App', Accept: 'text/html' },
  });
  if (!response.ok) throw new Error(`获取安装包链接失败 HTTP ${response.status}`);
  const html = await response.text();
  const prefix = `/${UPDATE_REPO}/releases/download/${tag}/`;
  const links = [...html.matchAll(/href=["']([^"']+)["']/gi)].map(m => m[1].replace(/&amp;/g, '&'));
  for (let link of links) {
    if (link.startsWith('https://github.com/')) link = link.slice('https://github.com'.length);
    if (link.startsWith(prefix) && /\.apk$/i.test(link) && !link.slice(prefix.length).includes('/')) {
      return `https://github.com${link}`;
    }
  }
  throw new Error('该版本没有可下载的 Android 安装包，请稍后重试');
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
 * 预解析重定向：用 fetch 把 url 的 302/301 跑完，返回最终直链。
 * Why: 实测部分 Android（vivo 折叠屏、含 ROM 定制 OkHttp）下，RNFS.downloadFile
 *      对 GitHub 的 releases/download → objects.githubusercontent.com 重定向会"伪成功"
 *      —— 状态码 < 400 但落地 0 字节文件。先用 RN 的 fetch 把重定向跑完，把最终直链
 *      交给 RNFS，可彻底绕开。
 *
 * 实现：发起 `Range: bytes=0-0` 的 GET（只拿 1 字节，省流量），fetch 默认 follow 重定向，
 *      读 `res.url` 即最终落地 URL。AbortController 在拿到 url 后立刻 abort，
 *      避免后台继续读那 1 字节。
 */
async function resolveRedirects(url) {
  try {
    // eslint-disable-next-line no-undef
    const Ctor = typeof AbortController !== 'undefined' ? AbortController : null;
    const ctrl = Ctor ? new Ctor() : null;
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0', 'User-Agent': 'ImagePilot-App', Accept: '*/*' },
      signal: ctrl ? ctrl.signal : undefined,
    });
    const finalUrl = (res && res.url) || url;
    try { ctrl && ctrl.abort(); } catch (_) { /* 忽略 abort 抛错 */ }
    return finalUrl;
  } catch (_) {
    // 预解析失败就回退原 url —— RNFS 自己也可能跑通
    return url;
  }
}

/**
 * 方案2：App 内下载 APK 并拉起系统安装器（不开浏览器）。
 * 下载到缓存目录 → 调原生 ApkInstaller 安装。
 * @param {string} apkUrl
 * @param {(progress:number)=>void} [onProgress] 0~1
 * @throws E_NEED_PERMISSION（未授予安装未知应用权限，原生已引导去设置）/ 其它下载或安装错误
 * @returns {Promise<string>} 下载到的本地路径
 */
export async function installDownloadedApk(path) {
  const { NativeModules } = require('react-native');
  try {
    if (!NativeModules?.ApkInstaller?.install) throw new Error('ApkInstaller 原生模块不可用');
    await NativeModules.ApkInstaller.install(path);
    return path;
  } catch (error) {
    error.updateStage = 'install';
    error.apkPath = path;
    throw error;
  }
}

export async function downloadAndInstall(apkUrl, onProgress, options = {}) {
  let failure;
  for (const source of downloadCandidates(apkUrl)) {
    try { return await downloadAndInstallFromUrl(source, onProgress, options); }
    catch (error) {
      // Permission/installation failure must not re-download or re-open installer.
      if (error?.updateStage === 'install' || error?.code === 'E_IOS_UNSUPPORTED') throw error;
      failure = error;
    }
  }
  throw failure || new Error('No update download sources available');
}

async function verifyApkHash(RNFS, path, sha256) {
  if (!sha256) return;
  if ((await RNFS.hash(path, 'sha256')).toLowerCase() !== sha256.toLowerCase()) {
    await RNFS.unlink(path);
    throw new Error('E_CORRUPT APK SHA-256 mismatch');
  }
}

async function downloadAndInstallFromUrl(apkUrl, onProgress, options = {}) {
  // 原生依赖懒加载（仅 Android 走这条路；错误交由界面展示并重试）
  // eslint-disable-next-line global-require
  const RNFS = require('react-native-fs');
  // eslint-disable-next-line global-require
  const { NativeModules, Platform } = require('react-native');
  // iOS 不能 sideload APK；用户应走 TestFlight / Ad Hoc 安装链接，让调用方兜底到 openReleasesPage
  if (Platform.OS === 'ios') {
    const err = new Error('iOS 暂不支持 App 内升级，请前往发布页下载安装');
    err.code = 'E_IOS_UNSUPPORTED';
    throw err;
  }
  const ApkInstaller = NativeModules && NativeModules.ApkInstaller;
  if (!ApkInstaller || typeof ApkInstaller.install !== 'function') {
    throw new Error('ApkInstaller 原生模块不可用');
  }
  // App-private cache avoids scoped-storage restrictions on public Download folders.
  // Key by the original release URL so partial/completed files cannot cross versions.
  const dest = `${RNFS.CachesDirectoryPath}/imagepilot-update-${SHA256(apkUrl).toString().slice(0, 24)}.apk`;
  const part = `${dest}.part`;

  // 跑掉重定向，给 RNFS 一个最终直链
  const directUrl = await resolveRedirects(apkUrl);

  // === 断点续传 ===
  // 实测 168MB APK 在不稳定网络下经常中断，每次重头下太痛。
  //
  // 策略：
  // 1) HEAD/Range 1B 拿到 Content-Length 作 expectedTotal
  // 2) 若 .part 存在且 size > 0 且 < expectedTotal → 用 Range: bytes=<size>- 续传
  //    把剩余字节先下到 .part.chunk，再 native 追加（ApkInstaller.appendBytes）到 .part
  //    appendBytes 是新加的 Java 原生模块，避免 base64 round-trip 168MB
  // 3) 若 .part size == expectedTotal → 直接走完整性校验 + 安装
  // 4) 服务器不返 206（Partial Content）→ 回退全量重下，删 .part
  //
  // 失败时**不删 .part**，让用户下次还能续。

  let expectedTotal = options.size || await headContentLength(directUrl);
  // Permission settings may interrupt installation after download. Reuse the verified file.
  let reusable = false;
  try {
    if (expectedTotal > 0 && await RNFS.exists(dest) && Number((await RNFS.stat(dest)).size) === expectedTotal && expectedTotal >= 1024 * 1024) {
      const magic = await RNFS.read(dest, 4, 0, 'ascii');
      reusable = magic === 'PK\x03\x04';
    }
  } catch (_) { /* Continue with normal download. */ }
  if (reusable) {
    if (onProgress) onProgress(1);
    await verifyApkHash(RNFS, dest, options.sha256);
    await installDownloadedApk(dest);
    return dest;
  }

  let partSize = 0;
  try { if (await RNFS.exists(part)) partSize = Number((await RNFS.stat(part)).size) || 0; } catch (_) {}

  // 已下完直接进校验
  if (expectedTotal > 0 && partSize === expectedTotal) {
    if (onProgress) onProgress(1);
    try { if (await RNFS.exists(dest)) await RNFS.unlink(dest); } catch (_) {}
    await RNFS.moveFile(part, dest);
  } else {
    // 决定起点：能续传 → 走 Range，不能 → 重头
    const canResume = expectedTotal > 0 && partSize > 0 && partSize < expectedTotal;
    if (!canResume) {
      try { if (await RNFS.exists(part)) await RNFS.unlink(part); } catch (_) {}
      partSize = 0;
    }
    const tmp = canResume ? `${dest}.part.chunk` : part;
    try { if (await RNFS.exists(tmp)) await RNFS.unlink(tmp); } catch (_) {}

    const headers = { 'User-Agent': 'ImagePilot-App', Accept: '*/*' };
    if (canResume) headers.Range = `bytes=${partSize}-`;

    let serverDeclined206 = false; // 服务器不支持 Range → 回退全量
    const { promise } = RNFS.downloadFile({
      fromUrl: directUrl,
      toFile: tmp,
      headers,
      connectionTimeout: 15000,
      readTimeout: 60000,
      progressInterval: 300,
      begin: (res) => {
        if (canResume && res && res.statusCode === 200) {
          // 服务器忽略了 Range，返了全量 200 → 后面回退处理
          serverDeclined206 = true;
        }
        if (res && res.contentLength > 0) {
          // canResume 时 contentLength 是剩余字节，否则是全量
          if (!expectedTotal) expectedTotal = (canResume ? partSize : 0) + res.contentLength;
        }
      },
      progress: (res) => {
        if (!onProgress) return;
        const total = expectedTotal || (res.contentLength > 0 ? (canResume ? partSize : 0) + res.contentLength : 0);
        const done = (canResume && !serverDeclined206 ? partSize : 0) + (res.bytesWritten || 0);
        if (total > 0) onProgress(Math.min(1, done / total));
        else if (done > 0) onProgress(0.01);
      },
    });
    const result = await promise;
    if (result && result.statusCode && result.statusCode >= 400) {
      // 失败不删 .part，让下次还能续
      throw new Error('下载失败 HTTP ' + result.statusCode);
    }

    // 续传分支：服务器返了 206 → 追加 chunk 到 .part；返了 200 → 整个 tmp 替换 .part
    if (canResume) {
      if (serverDeclined206) {
        // 服务器忽略 Range，tmp 是全量 → 替换 .part
        try { if (await RNFS.exists(part)) await RNFS.unlink(part); } catch (_) {}
        await RNFS.moveFile(tmp, part);
      } else {
        // 真续传：把 chunk 追加到 .part
        try {
          await appendFileToFile(RNFS, ApkInstaller, tmp, part);
        } finally {
          try { if (await RNFS.exists(tmp)) await RNFS.unlink(tmp); } catch (_) {}
        }
      }
    }
    // !canResume 分支：tmp === part，已经直接下到 .part 里了

    // 落定 dest
    try { if (await RNFS.exists(dest)) await RNFS.unlink(dest); } catch (_) {}
    await RNFS.moveFile(part, dest);
  }

  // === 完整性校验 ===
  let actualSize = 0;
  try { actualSize = Number((await RNFS.stat(dest)).size) || 0; } catch (_) {}
  const tooSmall = actualSize < 1024 * 1024;
  const truncated = expectedTotal > 0 && actualSize !== expectedTotal;
  let badMagic = false;
  try {
    const head = await RNFS.read(dest, 4, 0, 'ascii'); // ZIP/APK 魔数 'PK\x03\x04'
    badMagic = !(head && head.charCodeAt(0) === 0x50 && head.charCodeAt(1) === 0x4b && head.charCodeAt(2) === 3 && head.charCodeAt(3) === 4);
  } catch (_) { badMagic = true; }

  if (tooSmall || truncated || badMagic) {
    // 校验失败 → dest 删，但 .part 已 move 走了；放回 dest 给下次（半成品保留意义不大，就删）
    try { await RNFS.unlink(dest); } catch (_) {}
    const got = (actualSize / 1048576).toFixed(1);
    const exp = expectedTotal > 0 ? (expectedTotal / 1048576).toFixed(1) : '?';
    throw new Error(`E_CORRUPT 安装包下载不完整（${got}MB/${exp}MB），请重试或用浏览器下载`);
  }

  await verifyApkHash(RNFS, dest, options.sha256);
  await installDownloadedApk(dest); // 未授权会 reject E_NEED_PERMISSION
  return dest;
}

/** HEAD 拿 Content-Length（GitHub Releases 支持 HEAD；用 GET Range:0-0 兜底） */
async function headContentLength(url) {
  try {
    const r = await fetchWithTimeout(url, { method: 'HEAD', headers: { 'User-Agent': 'ImagePilot-App' } });
    const cl = r && r.headers && r.headers.get && r.headers.get('content-length');
    if (cl) return Number(cl) || 0;
  } catch (_) {}
  // HEAD 失败试 Range
  try {
    const r = await fetchWithTimeout(url, { method: 'GET', headers: { 'User-Agent': 'ImagePilot-App', Range: 'bytes=0-0' } });
    const cr = r && r.headers && r.headers.get && r.headers.get('content-range');
    if (cr) { const m = /\/(\d+)$/.exec(cr); if (m) return Number(m[1]) || 0; }
  } catch (_) {}
  return 0;
}

/**
 * 大文件追加（src → 末尾 dst），不能走 RNFS base64 read+write（168MB round-trip 太慢）。
 * 优先调原生 ApkInstaller.appendBytes（Java FileInputStream + FileOutputStream(append=true)），
 * 没该方法就回退 base64 分块（5MB chunk，仍然慢但能完成）。
 */
async function appendFileToFile(RNFS, ApkInstaller, srcPath, dstPath) {
  if (ApkInstaller && typeof ApkInstaller.appendFile === 'function') {
    return ApkInstaller.appendFile(srcPath, dstPath);
  }
  // 回退：base64 分块（5MB），慢但纯 JS
  const CHUNK = 5 * 1024 * 1024;
  const total = Number((await RNFS.stat(srcPath)).size) || 0;
  for (let pos = 0; pos < total; pos += CHUNK) {
    const len = Math.min(CHUNK, total - pos);
    const b64 = await RNFS.read(srcPath, len, pos, 'base64');
    await RNFS.appendFile(dstPath, b64, 'base64');
  }
}

export default { installDownloadedApk, resolveApkUrl, checkForUpdate, openDownload, openReleasesPage, downloadAndInstall, isNewer, CURRENT_VERSION, UPDATE_REPO, RELEASES_PAGE };
