/**
 * showcaseTemplates —— 剪映式模板注册表（一期）。
 *
 * 一期消费字段：id / name / category / globalFilter / interval(单图时长) /
 * transition(映射现有 8 种 mode) / intro / outro（含 {{var}} 槽位，空串=无该卡）。
 * 运镜/字体/文字动画/节拍卡点/多画幅为二期，未在此体现。
 */
export const SHOWCASE_TEMPLATES = Object.freeze([
  { id: 'wedding_eternal_vow', name: '婚礼·永恒誓约', category: '情感纪念', aspectRatio: '9:16', globalFilter: 'warm_cream', interval: 3.5, transition: 'soft_dissolve', intro: '{{name1}} ❤ {{name2}}', outro: '{{date}}' },
  { id: 'travel_distant_memory', name: '旅游·远方记忆', category: '旅行生活', aspectRatio: '16:9', globalFilter: 'high_saturation', interval: 2.2, transition: 'slide', intro: '{{destination}}', outro: '{{date}} · 旅行的意义' },
  { id: 'ontheroad_diary', name: '在路上·公路日记', category: '旅行生活', aspectRatio: '16:9', globalFilter: 'film_vintage', interval: 1.8, transition: 'flash', intro: 'ON THE ROAD', outro: '{{mileage}} km' },
  { id: 'study_growth_track', name: '学习·成长轨迹', category: '学习成长', aspectRatio: '9:16', globalFilter: 'fresh_clean', interval: 2.0, transition: 'fade', intro: '{{goal}}', outro: '坚持，终有回响' },
  { id: 'life_daily_fragments', name: '生活·日常碎片', category: '旅行生活', aspectRatio: '9:16', globalFilter: 'japanese_soft', interval: 2.5, transition: 'soft_dissolve', intro: '{{date}} 的小确幸', outro: '生活，慢慢来' },
  { id: 'birthday_shining_moment', name: '生日·闪光时刻', category: '节日庆典', aspectRatio: '9:16', globalFilter: 'candy_bright', interval: 1.5, transition: 'zoom', intro: 'Happy Birthday {{name}}', outro: '{{age}} 岁快乐' },
  { id: 'baby_growth_album', name: '萌宝·成长相册', category: '情感纪念', aspectRatio: '9:16', globalFilter: 'candy_bright', interval: 2.5, transition: 'mask_heart', intro: '{{babyName}} 的成长', outro: '{{months}} 个月啦' },
  { id: 'sport_burning_moment', name: '运动·燃动瞬间', category: '学习成长', aspectRatio: '9:16', globalFilter: 'cold_grey', interval: 1.2, transition: 'glitch', intro: 'NO PAIN NO GAIN', outro: '{{data}}' },
  { id: 'graduation_youth_memory', name: '毕业·青春纪念', category: '情感纪念', aspectRatio: '16:9', globalFilter: 'warm_cream', interval: 2.3, transition: 'pageflip', intro: '{{className}} 毕业季', outro: '{{year}} · 后会有期' },
  { id: 'goods_recommend_show', name: '好物·种草展示', category: '美食种草', aspectRatio: '9:16', globalFilter: 'cold_grey', interval: 1.6, transition: 'slide', intro: '{{productName}}', outro: '¥{{price}}' },
  { id: 'newyear_renewal', name: '新年·辞旧迎新', category: '节日庆典', aspectRatio: '9:16', globalFilter: 'high_saturation', interval: 1.8, transition: 'flash', intro: '{{year}} 新年快乐', outro: '万事顺遂' },
  { id: 'christmas_warm_time', name: '圣诞·温馨时光', category: '节日庆典', aspectRatio: '9:16', globalFilter: 'cold_grey', interval: 2.5, transition: 'soft_dissolve', intro: 'Merry Christmas', outro: '{{year}} ❄' },
  { id: 'midautumn_reunion', name: '中秋·团圆夜', category: '节日庆典', aspectRatio: '9:16', globalFilter: 'cold_grey', interval: 3.0, transition: 'mask_circle', intro: '海上生明月', outro: '天涯共此时' },
  { id: 'food_explore_diary', name: '美食·探店日记', category: '美食种草', aspectRatio: '9:16', globalFilter: 'high_saturation', interval: 1.7, transition: 'zoom', intro: '{{shopName}}', outro: '评分 {{score}}/10' },
  { id: 'coffee_slow_life', name: '咖啡·慢生活', category: '旅行生活', aspectRatio: '1:1', globalFilter: 'japanese_soft', interval: 3.0, transition: 'fade', intro: 'Slow Morning', outro: '享受当下' },
  { id: 'food_recipe_tutorial', name: '美食·教程菜谱', category: '美食种草', aspectRatio: '9:16', globalFilter: 'fresh_clean', interval: 2.0, transition: 'wipe', intro: '{{dishName}}', outro: '完成！开动～' },
  { id: 'pet_daily_cute', name: '宠物·萌宠日常', category: '萌宠', aspectRatio: '9:16', globalFilter: 'candy_bright', interval: 1.5, transition: 'mask_circle', intro: '{{petName}} 的一天', outro: '永远的快乐源泉' },
  { id: 'couple_sweet_memory', name: '情侣·甜蜜纪念', category: '情感纪念', aspectRatio: '9:16', globalFilter: 'warm_cream', interval: 2.3, transition: 'mask_heart', intro: '{{name1}} & {{name2}}', outro: '在一起 {{days}} 天' },
  { id: 'family_warm_time', name: '家庭·温情时光', category: '情感纪念', aspectRatio: '16:9', globalFilter: 'warm_cream', interval: 3.0, transition: 'pageflip', intro: '我们的家', outro: '{{year}} · 有爱有家' },
  { id: 'childhood_growth_record', name: '童年·成长记录', category: '情感纪念', aspectRatio: '9:16', globalFilter: 'candy_bright', interval: 2.3, transition: 'mask_circle', intro: '{{name}} 的童年', outro: '{{age}} 岁的回忆' },
  { id: 'career_annual_summary', name: '职场·年度总结', category: '商业职场', aspectRatio: '16:9', globalFilter: 'cold_grey', interval: 2.0, transition: 'slide', intro: '{{year}} 年度总结', outro: '致敬每一份努力' },
  { id: 'brand_promotion', name: '企业·品牌宣传', category: '商业职场', aspectRatio: '16:9', globalFilter: 'cold_grey', interval: 1.8, transition: 'glitch', intro: '{{brandName}}', outro: '{{slogan}}' },
  { id: 'event_highlight', name: '活动·现场集锦', category: '商业职场', aspectRatio: '16:9', globalFilter: 'high_saturation', interval: 1.3, transition: 'flash', intro: '{{eventName}}', outro: '{{date}} 精彩回顾' },
  { id: 'outdoor_hiking_adventure', name: '户外·徒步探险', category: '旅行生活', aspectRatio: '16:9', globalFilter: 'high_saturation', interval: 2.5, transition: 'slide', intro: '{{location}}', outro: '海拔 {{altitude}} m' },
  { id: 'fitness_transformation', name: '健身·蜕变记录', category: '学习成长', aspectRatio: '9:16', globalFilter: 'cold_grey', interval: 1.2, transition: 'glitch', intro: '{{days}} DAYS CHALLENGE', outro: '自律即自由' },
]);

export function getTemplate(id) {
  return SHOWCASE_TEMPLATES.find((tpl) => tpl.id === id) || null;
}

export default SHOWCASE_TEMPLATES;
