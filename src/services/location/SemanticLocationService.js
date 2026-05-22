/**
 * SemanticLocationService — GPS 语义分组（借鉴 PhotoClassifierWithAI 思路）
 *
 * 两层语义：
 *   1. 用户标记地点（Home / Office / Travel…）：坐标 + 半径，命中即归到该名字。
 *      —— 这是 B 仓库的核心思路，纯本地、零依赖、隐私友好。
 *   2. 反向地理编码取城市：通过**可注入的 geocoder adapter**（在线 Mapbox/高德 或离线 GeoNames），
 *      可缺省（返回 null），不阻塞主流程。开放问题 #4 由用户后续决定接哪种 adapter。
 *
 * 设计：
 *   - 标记地点持久化交给上层（addPlace/removePlace 返回新列表，由调用方存 ConfigService）。
 *   - resolveLabel(coords) 优先返回用户地点名，其次城市，再次 null。
 *   - geocoder 结果按网格量化缓存，避免重复请求。
 */

const EARTH_RADIUS_M = 6371000;

/** 两点球面距离（米），Haversine */
export function haversineMeters(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 坐标是否合法 */
export function isValidCoords(c) {
  return (
    c &&
    typeof c.lat === 'number' &&
    typeof c.lon === 'number' &&
    c.lat >= -90 &&
    c.lat <= 90 &&
    c.lon >= -180 &&
    c.lon <= 180 &&
    !(c.lat === 0 && c.lon === 0) // (0,0) 几乎总是无效/缺失
  );
}

/**
 * @typedef {Object} Place
 * @property {string} id
 * @property {string} name      - 展示名（Home / 公司 / 老家…）
 * @property {number} lat
 * @property {number} lon
 * @property {number} radiusM   - 命中半径（米）
 */

/**
 * @typedef {Object} Geocoder
 * @property {(coords:{lat:number,lon:number}) => Promise<{city?:string, country?:string}|null>} reverse
 */

export class SemanticLocationService {
  /**
   * @param {Object} [deps]
   * @param {Place[]} [deps.places]     - 已标记地点
   * @param {Geocoder} [deps.geocoder]  - 反向地理编码 adapter（可空）
   * @param {number} [deps.cacheGrid]   - 城市缓存量化网格（度），默认 0.05 ≈ 5km
   */
  constructor({ places = [], geocoder = null, cacheGrid = 0.05 } = {}) {
    this.places = places.slice();
    this.geocoder = geocoder;
    this.cacheGrid = cacheGrid;
    this._cityCache = new Map();
  }

  listPlaces() {
    return this.places.slice();
  }

  /** 新增/更新地点（按 id 覆盖），返回新列表（由上层持久化） */
  addPlace(place) {
    if (!place || !place.name || !isValidCoords(place)) {
      throw new Error('addPlace: name + valid lat/lon required');
    }
    const id = place.id || `place_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const radiusM = place.radiusM > 0 ? place.radiusM : 200;
    const next = { id, name: place.name, lat: place.lat, lon: place.lon, radiusM };
    const idx = this.places.findIndex((p) => p.id === id);
    if (idx >= 0) this.places[idx] = next;
    else this.places.push(next);
    return this.listPlaces();
  }

  removePlace(id) {
    this.places = this.places.filter((p) => p.id !== id);
    return this.listPlaces();
  }

  /**
   * 命中最近的用户标记地点（半径内）。
   * @returns {Place|null}
   */
  matchPlace(coords) {
    if (!isValidCoords(coords)) return null;
    let best = null;
    let bestDist = Infinity;
    for (const p of this.places) {
      const d = haversineMeters(coords, p);
      if (d <= p.radiusM && d < bestDist) {
        best = p;
        bestDist = d;
      }
    }
    return best;
  }

  /** 反向地理编码取城市（带缓存），无 geocoder 时返回 null */
  async reverseCity(coords) {
    if (!isValidCoords(coords) || !this.geocoder) return null;
    const key = this._gridKey(coords);
    if (this._cityCache.has(key)) return this._cityCache.get(key);
    let city = null;
    try {
      const r = await this.geocoder.reverse(coords);
      city = r?.city || null;
    } catch (_) {
      city = null;
    }
    this._cityCache.set(key, city);
    return city;
  }

  /**
   * 解析展示标签：用户地点名 > 城市 > null。
   * @returns {Promise<{label: string|null, source: 'place'|'city'|'none', place?: Place}>}
   */
  async resolveLabel(coords) {
    const place = this.matchPlace(coords);
    if (place) return { label: place.name, source: 'place', place };
    const city = await this.reverseCity(coords);
    if (city) return { label: city, source: 'city' };
    return { label: null, source: 'none' };
  }

  /**
   * 批量分组：把带坐标的项按 resolveLabel 聚成 { label: items[] }。
   * @param {Array<{id?:string, coords:{lat:number,lon:number}}>} items
   * @returns {Promise<Record<string, Array>>}  无法解析的归到 '__ungrouped__'
   */
  async groupByLocation(items) {
    const groups = {};
    for (const item of items) {
      const { label } = await this.resolveLabel(item.coords || {});
      const key = label || '__ungrouped__';
      (groups[key] ||= []).push(item);
    }
    return groups;
  }

  _gridKey(coords) {
    const q = (v) => Math.round(v / this.cacheGrid) * this.cacheGrid;
    return `${q(coords.lat).toFixed(3)},${q(coords.lon).toFixed(3)}`;
  }
}

// ============ Geocoder Adapter 示例（开放问题 #4：选其一接入） ============

/**
 * 在线反向地理编码 adapter 骨架（Mapbox / 高德 / Nominatim 等）。
 * 仅作接线参考；按所选服务实现 parse 逻辑。
 *
 *   const geocoder = createOnlineGeocoder({
 *     fetchImpl: fetch,
 *     endpoint: (lat, lon) => `https://.../reverse?lat=${lat}&lon=${lon}&key=...`,
 *     parse: (json) => ({ city: json.address?.city, country: json.address?.country }),
 *   });
 */
export function createOnlineGeocoder({ fetchImpl, endpoint, parse }) {
  return {
    async reverse({ lat, lon }) {
      const resp = await fetchImpl(endpoint(lat, lon));
      if (!resp.ok) return null;
      const json = await resp.json();
      return parse(json);
    },
  };
}

/**
 * 离线 adapter 骨架（GeoNames cities1000 等本地数据集）。
 * 注入一个能按坐标找最近城市的查询函数（如 kd-tree）。
 *
 *   const geocoder = createOfflineGeocoder({ nearestCity: (lat, lon) => ({ city, country }) });
 */
export function createOfflineGeocoder({ nearestCity }) {
  return {
    async reverse({ lat, lon }) {
      return nearestCity(lat, lon) || null;
    },
  };
}

export default SemanticLocationService;
