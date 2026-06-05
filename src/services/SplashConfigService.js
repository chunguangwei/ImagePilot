// 启动屏远程配置服务（可热更新 / 投放广告）
// ------------------------------------------------------------------
// 设计原则（业界标准 "show-cached, refresh-in-background"）：
//   1. App 启动时只读「本地缓存」的配置决定本次显示什么 —— 不阻塞启动、不卡白屏。
//   2. 同时后台静默拉取远程配置 + 预下载图片 → 写入缓存 → 「下次」冷启动生效。
//   3. 任何异常（无网络、拉取失败、图片下不全、配置非法、不在投放期）一律回退到
//      内置动效启动屏（SplashLoading）。绝不因为远程配置而崩溃或卡死。
//
// 换图/上广告：只需修改远程 splash-config.json 并 commit（或换成 CDN 上的同名文件），
// 无需发版。图片链接可放 GitHub，也可后续换 CDN —— 见 CONFIG_URL / 图片走 imageUrl 字段。
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ⚙️ 远程配置地址（接口）：默认 GitHub raw；以后接 CDN/自建后端只改这一处即可。
//    raw.githubusercontent.com 有 ~5 分钟 CDN 缓存，对启动屏完全够用。
export const CONFIG_URL =
  'https://raw.githubusercontent.com/chunguangwei/ImagePilot/main/splash-config.json';

const CACHE_KEY = 'splash_remote_config_v1';            // AsyncStorage：缓存的配置+本地图路径
const IMG_DIR = `${RNFS.CachesDirectoryPath}/splash`;   // 广告图缓存目录
const FETCH_TIMEOUT_MS = 6000;

// 带超时的 fetch（无网络/慢网络快速失败，不拖累后台刷新）
async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}

// 校验并归一化远程配置；非法返回 null
function normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = raw.type === 'image' ? 'image' : 'builtin';
  const cfg = {
    version: Number(raw.version) || 1,
    enabled: raw.enabled !== false,        // 默认启用，显式 false 才关
    type,
    id: typeof raw.id === 'string' ? raw.id : '',
    imageUrl: typeof raw.imageUrl === 'string' ? raw.imageUrl : '',
    link: typeof raw.link === 'string' ? raw.link : '',
    linkEnabled: raw.linkEnabled !== false,
    durationMs: clampNum(raw.durationMs, 1500, 8000, 4000),
    skippable: raw.skippable !== false,    // 广告默认允许跳过
    skipAfterMs: clampNum(raw.skipAfterMs, 0, 8000, 1000),
    startAt: parseTime(raw.startAt),       // ms 时间戳或 null
    endAt: parseTime(raw.endAt),
  };
  // type=image 但没有图片地址 → 视为内置
  if (cfg.type === 'image' && !cfg.imageUrl) cfg.type = 'builtin';
  return cfg;
}

function clampNum(v, min, max, dflt) {
  const n = Number(v);
  if (!isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}

function parseTime(v) {
  if (v == null || v === '') return null;
  const t = typeof v === 'number' ? v : Date.parse(v);
  return isFinite(t) ? t : null;
}

// 远程图片 URL → 本地缓存文件路径（按 URL 简单 hash，避免重复下载/命名冲突）
function localPathForImage(url) {
  let h = 0;
  for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) | 0;
  const ext = (url.split('?')[0].match(/\.(png|jpe?g|webp|gif)$/i) || [, 'jpg'])[1];
  return `${IMG_DIR}/ad_${(h >>> 0).toString(36)}.${ext}`;
}

/**
 * 后台静默刷新：拉远程配置 + 预下载图片 → 写缓存（供「下次」启动使用）。
 * fire-and-forget；内部全程 try/catch，绝不抛出。
 */
export async function refreshSplashConfig() {
  try {
    const res = await fetchWithTimeout(CONFIG_URL, FETCH_TIMEOUT_MS);
    if (!res || !res.ok) return;
    const raw = await res.json();
    const cfg = normalizeConfig(raw);
    if (!cfg) return;

    let localImagePath = '';
    if (cfg.type === 'image' && cfg.imageUrl) {
      try {
        await RNFS.mkdir(IMG_DIR).catch(() => {});
        const dest = localPathForImage(cfg.imageUrl);
        const exists = await RNFS.exists(dest);
        if (!exists) {
          const dl = await RNFS.downloadFile({
            fromUrl: cfg.imageUrl,
            toFile: dest,
            connectionTimeout: FETCH_TIMEOUT_MS,
            readTimeout: 15000,
          }).promise;
          // 仅当 2xx 且文件非空才算成功
          if (dl.statusCode >= 200 && dl.statusCode < 300) {
            const st = await RNFS.stat(dest).catch(() => null);
            if (st && Number(st.size) > 0) localImagePath = dest;
            else await RNFS.unlink(dest).catch(() => {});
          } else {
            await RNFS.unlink(dest).catch(() => {});
          }
        } else {
          localImagePath = dest;
        }
      } catch (_) {
        localImagePath = ''; // 图片没下成 → 下次按内置兜底
      }
    }

    await AsyncStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ config: cfg, localImagePath, fetchedAt: Date.now() })
    );
  } catch (_) {
    // 静默失败：保留旧缓存，本次/下次继续用缓存或内置
  }
}

/**
 * 读取本次启动应展示的启动屏描述（只读本地缓存，快速、不联网）。
 * 返回：
 *   { mode: 'builtin' }                              // 内置动效（默认/兜底）
 *   { mode: 'image', localUri, link, linkEnabled,    // 远程图/广告
 *     durationMs, skippable, skipAfterMs, id }
 */
export async function getActiveSplash() {
  try {
    const rawStr = await AsyncStorage.getItem(CACHE_KEY);
    if (!rawStr) return { mode: 'builtin' };
    const { config, localImagePath } = JSON.parse(rawStr) || {};
    if (!config || !config.enabled || config.type !== 'image') return { mode: 'builtin' };
    if (!localImagePath) return { mode: 'builtin' };

    // 投放时间窗校验
    const now = Date.now();
    if (config.startAt && now < config.startAt) return { mode: 'builtin' };
    if (config.endAt && now > config.endAt) return { mode: 'builtin' };

    // 本地图片确实存在才用（防缓存被系统清理）
    const exists = await RNFS.exists(localImagePath);
    if (!exists) return { mode: 'builtin' };

    return {
      mode: 'image',
      localUri: localImagePath.startsWith('file://') ? localImagePath : `file://${localImagePath}`,
      link: config.link || '',
      linkEnabled: !!config.linkEnabled && !!config.link,
      durationMs: config.durationMs,
      skippable: !!config.skippable,
      skipAfterMs: config.skipAfterMs,
      id: config.id || '',
    };
  } catch (_) {
    return { mode: 'builtin' };
  }
}

export default { CONFIG_URL, refreshSplashConfig, getActiveSplash };
