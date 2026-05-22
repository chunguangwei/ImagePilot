/**
 * cityData — 精简内置城市数据集（离线反向地理编码默认数据）
 *
 * 用途：为 createBundledGeocoder 提供「最近城市」查找的候选点。
 * 这是**精简默认集**（~55 座主要城市），覆盖中国主要城市 + 全球大城市，
 * 足以让离线地理编码开箱即用；生产环境可替换为完整 GeoNames cities1000
 * （只需提供同结构数组：{ name, lat, lon }）。
 *
 * 名称约定：中国城市用中文名，海外城市用英文名（与默认 promptLang 无强绑定，可自行本地化）。
 */

export const CITIES = [
  // —— 中国 ——
  { name: '北京', lat: 39.9042, lon: 116.4074 },
  { name: '上海', lat: 31.2304, lon: 121.4737 },
  { name: '广州', lat: 23.1291, lon: 113.2644 },
  { name: '深圳', lat: 22.5431, lon: 114.0579 },
  { name: '成都', lat: 30.5728, lon: 104.0668 },
  { name: '杭州', lat: 30.2741, lon: 120.1551 },
  { name: '武汉', lat: 30.5928, lon: 114.3055 },
  { name: '西安', lat: 34.3416, lon: 108.9398 },
  { name: '重庆', lat: 29.563, lon: 106.5516 },
  { name: '南京', lat: 32.0603, lon: 118.7969 },
  { name: '天津', lat: 39.3434, lon: 117.3616 },
  { name: '苏州', lat: 31.2989, lon: 120.5853 },
  { name: '长沙', lat: 28.2282, lon: 112.9388 },
  { name: '郑州', lat: 34.7466, lon: 113.6254 },
  { name: '青岛', lat: 36.0671, lon: 120.3826 },
  { name: '沈阳', lat: 41.8057, lon: 123.4315 },
  { name: '大连', lat: 38.914, lon: 121.6147 },
  { name: '厦门', lat: 24.4798, lon: 118.0894 },
  { name: '昆明', lat: 25.0389, lon: 102.7183 },
  { name: '哈尔滨', lat: 45.8038, lon: 126.535 },
  { name: '香港', lat: 22.3193, lon: 114.1694 },
  { name: '台北', lat: 25.033, lon: 121.5654 },
  { name: '澳门', lat: 22.1987, lon: 113.5439 },
  // —— 亚太 ——
  { name: 'Tokyo', lat: 35.6762, lon: 139.6503 },
  { name: 'Osaka', lat: 34.6937, lon: 135.5023 },
  { name: 'Seoul', lat: 37.5665, lon: 126.978 },
  { name: 'Singapore', lat: 1.3521, lon: 103.8198 },
  { name: 'Bangkok', lat: 13.7563, lon: 100.5018 },
  { name: 'Kuala Lumpur', lat: 3.139, lon: 101.6869 },
  { name: 'Jakarta', lat: -6.2088, lon: 106.8456 },
  { name: 'Manila', lat: 14.5995, lon: 120.9842 },
  { name: 'New Delhi', lat: 28.6139, lon: 77.209 },
  { name: 'Mumbai', lat: 19.076, lon: 72.8777 },
  { name: 'Dubai', lat: 25.2048, lon: 55.2708 },
  { name: 'Sydney', lat: -33.8688, lon: 151.2093 },
  { name: 'Melbourne', lat: -37.8136, lon: 144.9631 },
  // —— 欧洲 ——
  { name: 'London', lat: 51.5074, lon: -0.1278 },
  { name: 'Paris', lat: 48.8566, lon: 2.3522 },
  { name: 'Berlin', lat: 52.52, lon: 13.405 },
  { name: 'Madrid', lat: 40.4168, lon: -3.7038 },
  { name: 'Rome', lat: 41.9028, lon: 12.4964 },
  { name: 'Amsterdam', lat: 52.3676, lon: 4.9041 },
  { name: 'Moscow', lat: 55.7558, lon: 37.6173 },
  { name: 'Istanbul', lat: 41.0082, lon: 28.9784 },
  // —— 美洲 ——
  { name: 'New York', lat: 40.7128, lon: -74.006 },
  { name: 'Los Angeles', lat: 34.0522, lon: -118.2437 },
  { name: 'San Francisco', lat: 37.7749, lon: -122.4194 },
  { name: 'Chicago', lat: 41.8781, lon: -87.6298 },
  { name: 'Toronto', lat: 43.6532, lon: -79.3832 },
  { name: 'Vancouver', lat: 49.2827, lon: -123.1207 },
  { name: 'Mexico City', lat: 19.4326, lon: -99.1332 },
  { name: 'São Paulo', lat: -23.5505, lon: -46.6333 },
  // —— 非洲 ——
  { name: 'Cairo', lat: 30.0444, lon: 31.2357 },
  { name: 'Johannesburg', lat: -26.2041, lon: 28.0473 },
];

export default CITIES;
