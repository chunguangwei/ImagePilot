/**
 * categoryUI — 分类列表的统一展示工具
 *
 * 1) sortCategoryList(list) —— 终态排序：「待分类(NA)」永远放末尾、「其他(other)」永远倒数第二，
 *    用户自定义分类排在两者之前、跟内置分类同序。HomeScreen / CategoryScreen / ImagePreviewScreen 共用。
 *
 * 2) getCategoryIconMeta(id, customList) —— 给定分类 id 返回 { iconName, color }，
 *    iconName 是 react-native-vector-icons/MaterialIcons 的名字（统一字体，外观一致），
 *    color 是分类主题色。自定义分类支持自带 icon/color（CustomCategoriesScreen 里可选），
 *    缺省回退到 'label' + 紫色 → 保证「自定义分类被删→其图标也跟着消失」。
 *
 * 3) CUSTOM_ICON_PRESETS —— 自定义分类的可选图标集合（id+name+materialIcon），
 *    便于在 CustomCategoriesScreen 用网格让用户挑选。
 */

// 终态末位 = 'NA'（待分类），倒数第二 = 'other'（其他）
const TAIL_IDS = ['other', 'NA'];

/**
 * 对分类列表做"末位锚定"排序：
 *   - 非 other/NA 项保持传入顺序（内置在前、自定义在后）
 *   - other 放倒数第二
 *   - NA 放最末
 * 传入空/单项时安全返回原数组。
 */
export function sortCategoryList(list) {
  if (!Array.isArray(list) || list.length <= 1) return list || [];
  const rest = [];
  let otherItem = null;
  let naItem = null;
  for (const item of list) {
    if (!item || !item.id) { rest.push(item); continue; }
    if (item.id === 'other') { otherItem = item; continue; }
    if (item.id === 'NA') { naItem = item; continue; }
    rest.push(item);
  }
  const result = rest;
  if (otherItem) result.push(otherItem);
  if (naItem) result.push(naItem);
  return result;
}

// 用户自定义分类可选的图标预设（MaterialIcons name + 主题色 + 中英文标签）
export const CUSTOM_ICON_PRESETS = [
  { key: 'label', icon: 'label', color: '#5856D6', zh: '标签', en: 'Label' },
  { key: 'work', icon: 'work', color: '#34495E', zh: '工作', en: 'Work' },
  { key: 'school', icon: 'school', color: '#2980B9', zh: '学习', en: 'Study' },
  { key: 'family', icon: 'family-restroom', color: '#E67E22', zh: '家庭', en: 'Family' },
  { key: 'star', icon: 'star', color: '#F1C40F', zh: '收藏', en: 'Favorite' },
  { key: 'favorite', icon: 'favorite', color: '#E91E63', zh: '喜爱', en: 'Love' },
  { key: 'shopping', icon: 'shopping-bag', color: '#16A085', zh: '购物', en: 'Shopping' },
  { key: 'event', icon: 'event', color: '#9B59B6', zh: '活动', en: 'Event' },
  { key: 'sports', icon: 'sports-soccer', color: '#27AE60', zh: '运动', en: 'Sports' },
  { key: 'music', icon: 'music-note', color: '#8E44AD', zh: '音乐', en: 'Music' },
  { key: 'movie', icon: 'movie', color: '#C0392B', zh: '影视', en: 'Movie' },
  { key: 'book', icon: 'menu-book', color: '#795548', zh: '阅读', en: 'Reading' },
  { key: 'flight', icon: 'flight', color: '#3498DB', zh: '出行', en: 'Travel' },
  { key: 'home', icon: 'home', color: '#FF7043', zh: '家居', en: 'Home' },
  { key: 'palette', icon: 'palette', color: '#FF5722', zh: '艺术', en: 'Art' },
  { key: 'photo-camera', icon: 'photo-camera', color: '#607D8B', zh: '摄影', en: 'Photo' },
  { key: 'attach-money', icon: 'attach-money', color: '#2ECC71', zh: '财务', en: 'Finance' },
  { key: 'medical', icon: 'medical-services', color: '#E74C3C', zh: '健康', en: 'Health' },
];

// 内置分类的图标主题（MaterialIcons 名 + 主题色），保持视觉一致：同一字体、同号尺寸由调用方控制
const BUILTIN_ICON_META = {
  single_person: { iconName: 'person', color: '#3498DB' },
  social_activities: { iconName: 'groups', color: '#E67E22' },
  travel_scenery: { iconName: 'landscape', color: '#16A085' },
  pets: { iconName: 'pets', color: '#8D6E63' },
  foods: { iconName: 'restaurant', color: '#E74C3C' },
  idcard: { iconName: 'badge', color: '#00897B' },
  screenshot: { iconName: 'phone-iphone', color: '#9B59B6' },
  qrcode: { iconName: 'qr-code', color: '#212121' },
  other: { iconName: 'apps', color: '#7F8C8D' },
  NA: { iconName: 'help-outline', color: '#F39C12' },
};

const CUSTOM_ICON_INDEX = Object.fromEntries(CUSTOM_ICON_PRESETS.map((p) => [p.key, p]));

/**
 * 返回某分类的统一图标 + 主题色。
 * @param {string} categoryId 分类 id（含内置和自定义）
 * @param {Array} customList settings.aiProvider.customCategories（可选）—— 自定义分类项可含 { iconKey } 字段
 * @returns {{ iconName: string, color: string }}
 */
export function getCategoryIconMeta(categoryId, customList) {
  if (categoryId && BUILTIN_ICON_META[categoryId]) return BUILTIN_ICON_META[categoryId];
  // 自定义分类：先看用户挑选的 iconKey，回落到 'label'
  if (Array.isArray(customList)) {
    const c = customList.find((x) => x && x.id === categoryId);
    if (c) {
      const preset = (c.iconKey && CUSTOM_ICON_INDEX[c.iconKey]) || CUSTOM_ICON_INDEX.label;
      return { iconName: preset.icon, color: preset.color };
    }
  }
  // 既不在内置也不在 customList（如某次 LLM 反吐了一个未配置的 id）
  return { iconName: 'label', color: '#5856D6' };
}

export default { sortCategoryList, getCategoryIconMeta, CUSTOM_ICON_PRESETS };
