/**
 * filterMap —— 模板字段到现有能力的映射 + intro/outro 槽位文案替换（纯函数）。
 */

// globalFilter → 现有 jimp 滤镜 id + 强度
const FILTER_MAP = Object.freeze({
  warm_cream: { jimpId: 'warm', intensity: 1 },
  high_saturation: { jimpId: 'vivid', intensity: 1 },
  film_vintage: { jimpId: 'film', intensity: 1 },
  japanese_soft: { jimpId: 'fade', intensity: 0.8 },
  fresh_clean: { jimpId: 'fresh', intensity: 1 },
  candy_bright: { jimpId: 'candy', intensity: 1 },
  cold_grey: { jimpId: 'coldgrey', intensity: 1 },
});
export function mapFilter(globalFilter) {
  return FILTER_MAP[globalFilter] || null;
}

// 模板 transition → 现有 8 种播放 mode（淡入/平移/缩放/推入/翻转/弹入/上浮/直切）
const TRANSITION_MAP = Object.freeze({
  soft_dissolve: 'fade', fade: 'fade',
  slide: 'slide', wipe: 'slide', pan_left: 'slide', pan_right: 'slide',
  zoom: 'zoom', ken_burns_zoom_in: 'zoom', ken_burns_zoom_out: 'zoom',
  pageflip: 'flip',
  bounce: 'spring',
  rise: 'rise', slide_up: 'rise',
  push: 'push',
  flash: 'none', glitch: 'none', mask_heart: 'none', mask_circle: 'none',
});
export function mapTransition(transition) {
  return TRANSITION_MAP[transition] || 'fade';
}

// intro/outro 文案槽位：主体类变量→名称，时间类→日期，其余小众变量删除
const NAME_VARS = ['name', 'name1', 'name2', 'destination', 'babyName', 'petName', 'shopName',
  'productName', 'brandName', 'eventName', 'className', 'location', 'goal', 'dishName'];
const DATE_VARS = ['date', 'year'];
export function fillSlots(text, slots = {}) {
  if (!text) return '';
  let out = String(text).replace(/\{\{(\w+)\}\}/g, (m, key) => {
    if (NAME_VARS.includes(key)) return slots.name || '';
    if (DATE_VARS.includes(key)) return slots.date || '';
    return ''; // 小众变量删除
  });
  // 清理删除变量后残留的连续空格 / 首尾空格
  out = out.replace(/\s{2,}/g, ' ').trim();
  return out;
}

export default { mapFilter, mapTransition, fillSlots };
