/**
 * bundledGeocoder — 离线反向地理编码（开放问题 #4 的默认选型：隐私优先）
 *
 * 用内置城市数据集（cityData.js）做「最近城市」查找：纯本地、零网络、零成本、无 API Key。
 * 满足 SemanticLocationService 的 Geocoder 接口（reverse → {city,country}|null），可直接注入：
 *
 *   import { createBundledGeocoder } from './bundledGeocoder.js';
 *   const loc = new SemanticLocationService({ geocoder: createBundledGeocoder() });
 *
 * 设计：
 *   - 超过 maxDistanceKm（默认 250km）无匹配 → 返回 null（宁可"未知"也不乱标）。
 *   - 数据集可替换为完整 GeoNames cities1000（传 cities 即可），逻辑不变。
 *   - O(n) 线性扫描，城市量大时可换 kd-tree；当前精简集足够快。
 */

import { haversineMeters, isValidCoords } from './SemanticLocationService.js';
import { CITIES, PROVINCES } from './cityData.js';

/**
 * 返回离 (lat,lon) 最近的城市；城市在 maxDistanceKm 内无命中时，
 * 退而返回最近省份（provinceMaxKm 内），标记 isProvince=true；再无则 null。
 * @returns {{name:string, lat:number, lon:number, distanceKm:number, isProvince?:boolean}|null}
 */
export function nearestCity(lat, lon, { cities = CITIES, maxDistanceKm = 250, provinces = PROVINCES, provinceMaxKm = 800 } = {}) {
  if (!isValidCoords({ lat, lon })) return null;
  let best = null;
  let bestMeters = Infinity;
  for (const c of cities) {
    const d = haversineMeters({ lat, lon }, { lat: c.lat, lon: c.lon });
    if (d < bestMeters) {
      bestMeters = d;
      best = c;
    }
  }
  if (best && bestMeters <= maxDistanceKm * 1000) {
    return { ...best, distanceKm: Math.round(bestMeters / 100) / 10 };
  }
  // 城市未命中 → 省份兜底（宁可标到省，也别丢成「未知」）
  if (provinces && provinces.length) {
    let bestProv = null;
    let bestProvMeters = Infinity;
    for (const p of provinces) {
      const d = haversineMeters({ lat, lon }, { lat: p.lat, lon: p.lon });
      if (d < bestProvMeters) {
        bestProvMeters = d;
        bestProv = p;
      }
    }
    if (bestProv && bestProvMeters <= provinceMaxKm * 1000) {
      return { ...bestProv, distanceKm: Math.round(bestProvMeters / 100) / 10, isProvince: true };
    }
  }
  return null;
}

/**
 * 构造可注入 SemanticLocationService 的离线 geocoder。
 * @param {object} [opts]
 * @param {Array<{name:string,lat:number,lon:number}>} [opts.cities]
 * @param {number} [opts.maxDistanceKm=250]
 */
export function createBundledGeocoder(opts = {}) {
  return {
    async reverse({ lat, lon }) {
      const hit = nearestCity(lat, lon, opts);
      return hit ? { city: hit.name } : null;
    },
  };
}

export default createBundledGeocoder;
