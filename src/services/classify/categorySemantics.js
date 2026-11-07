// Shared category meanings, not captions generated for an individual image.
const descriptions = {
  social_activities: ['多人聚会、同事或朋友合影、会议、庆典及集体活动的照片', 'A photograph of people together at a gathering, colleagues posing for a group photo, a meeting or a celebration.'],
  single_person: ['以一个人的面容或身体为主要拍摄对象的肖像、自拍或个人写真，包含以山水、公园、建筑为背景的人像；以运动动作本身为重点时归运动', 'A portrait photograph with one person as the main subject, showing their face and body.'],
  kids: ['以真实婴儿、幼儿或儿童为主要拍摄对象的照片，记录孩子的面容、玩耍或日常生活', 'A photograph whose main subject is a real baby, toddler or child, showing children playing or in everyday life.'],
  pets: ['以猫、狗或其他宠物动物为主要拍摄对象的照片', 'A photograph of a cat, dog or another pet animal as the main subject.'],
  foods: ['展示食物、菜肴、甜点、饮料或餐桌美食的照片', 'A photograph showing food, prepared dishes, desserts, drinks or a meal on a table.'],
  travel_scenery: ['以整体环境为主体的山川、海滨、湖泊、河流、公园或乡村风景。允许远处人物作为点缀；人物肖像、自拍或写真为主体时应归人物类，不因背景有风景而归入此类', 'A landscape photograph focused on the overall natural environment: mountains, rivers, lakes, coasts, parks or countryside. People may be small incidental figures; a portrait with scenery in the background belongs to a people category.'],
  screenshot: ['手机或电脑屏幕截取的应用界面、聊天记录、网页或游戏画面', 'A screenshot of a phone or computer app, chat conversation, web page or game interface.'],
  idcard: ['身份证件、护照等证件的照片，或正式证件用途的正面人像照', 'A photograph of an identity document or passport, or a formal front-facing identification portrait.'],
  qrcode: ['以可扫描的二维码为主要内容的图片', 'An image primarily showing a scannable QR code.'],
  electronics: ['以手机、电脑、相机、电路板等电子设备为主体的照片', 'A photograph focused on electronic devices such as phones, computers, cameras or circuit boards.'],
  night_scene: ['夜晚拍摄的城市灯光、街道、夜空或夜间风景照片', 'A photograph of city lights, streets, the night sky or scenery at night.'],
  architecture: ['以建筑外观、室内空间、桥梁或建筑结构为主体的照片', 'A photograph focused on buildings, interior spaces, bridges or architectural structures.'],
  plants: ['以花朵、单株树木、叶片或盆栽等植物细节为主体的照片，整体湖泊、公园等环境景观属于风景', 'A photograph focused on individual flowers, trees, leaves or potted plants and their botanical details.'],
  vehicles: ['以汽车、摩托车、自行车、火车、船或飞机为主体的照片', 'A photograph focused on a car, motorcycle, bicycle, train, boat or airplane.'],
  sports: ['以正在跑步、打球、骑行或健身的人及其运动动作为主体的照片', 'A photograph focused on people actively performing sports or fitness movements, such as running, playing ball, cycling or exercising.'],
  fashion: ['重点展示服装搭配、鞋帽、配饰或穿搭造型的照片', 'A photograph focused on clothing outfits, shoes, hats, accessories or fashion styling.'],
  products: ['展示商品、包装或待售物品外观的产品照片', 'A product photograph showing merchandise, packaging or an item for sale.'],
  documents: ['以纸质或电子文档、表格、发票、收据、票据上的文字为主体的图片', 'An image primarily showing text in a document, form, invoice, receipt or ticket.'],
  art: ['以绘画、雕塑、书法、手工艺术、装饰艺术、奖杯或奖牌为主体的图片', 'A photograph of a painting, sculpture, calligraphy, craft, decorative artwork, trophy or award.'],
  cartoon: ['以卡通角色、漫画、表情包或插画为主要内容的图片', 'An image primarily showing cartoon characters, comics, memes or illustrations.'],
  other: ['不属于现有具体类别的其他图片内容', 'Other image content outside the available specific categories.'],
};

export function categoryDescription(category, lang = 'zh') {
  if (typeof category.rule === 'string' && category.rule.trim()) return category.rule.trim();
  const supplied = category.description;
  if (typeof supplied === 'string' && supplied.trim()) return supplied.trim();
  if (supplied && typeof supplied === 'object') {
    const value = supplied[lang] || supplied.zh || supplied.en;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return descriptions[category.id]?.[lang === 'en' ? 1 : 0] || '';
}

export function categoryText(category, lang = 'zh') {
  const name = lang === 'en' ? (category.en || category.zh || category.id) : (category.zh || category.en || category.id);
  const description = categoryDescription(category, lang);
  return description ? `${name}: ${description}` : name;
}

// Two complementary visual appearances per builtin; never applied to user-authored rules.
const visualExamples = {
  social_activities: ['Adults posing together for a group photograph at a workplace event.', 'Friends or family gathered together at a party, meal or celebration.'],
  single_person: ['A selfie or close-up portrait focused on one person and their face.', 'A full-body or half-body portrait of one person posing as the main subject.'],
  kids: ['A real young child playing, with the child as the main subject.', 'A close-up portrait of a real baby or toddler.'],
  pets: ['A photograph focused on a pet cat resting or playing.', 'A photograph focused on a pet dog or another domestic animal.'],
  foods: ['A close-up food photograph of a prepared meal or dishes on a table.', 'A food photograph of a dessert, snack, fruit or drink.'],
  travel_scenery: ['A landscape photograph of mountains, a lake, a forest or countryside.', 'A scenic photograph of a beach, river, lake or public park.'],
  screenshot: ['A digital screenshot showing a chat conversation, app or phone interface.', 'A computer screenshot showing a web page, game or software window.'],
  idcard: ['A close-up photograph of an identity card or passport document.', 'A formal front-facing ID portrait against a plain background.'],
  qrcode: ['A square black-and-white QR code filling most of an image.', 'A close-up image primarily displaying a scannable QR code.'],
  electronics: ['A photograph focused on a network equipment cabinet containing servers, switches, routers and cables.', 'A close-up photograph of a computer, mobile phone, camera or electronic circuit board.'],
  night_scene: ['A city street or buildings illuminated by lights at night.', 'A nighttime landscape showing the dark sky and distant lights.'],
  architecture: ['A photograph focused on a building facade, bridge or architectural structure.', 'An interior photograph focused on a room and its architectural space.'],
  plants: ['A close-up photograph focused on flowers, leaves or a potted plant.', 'A detailed photograph focused on an individual tree or shrub.'],
  vehicles: ['A photograph focused on a car, motorcycle or bicycle.', 'A photograph focused on a train, boat or airplane.'],
  sports: ['A person actively running, cycling or exercising.', 'People playing a ball game or participating in a sporting event.'],
  fashion: ['A fashion photograph focused on an outfit and the clothing being modeled.', 'A close-up photograph of shoes, hats, jewelry or fashion accessories.'],
  products: ['A studio product photograph of merchandise against a simple background.', 'A photograph displaying product packaging or an item for sale.'],
  documents: ['A close-up photograph of a printed document, form or page of text.', 'A photograph of an invoice, receipt, ticket or paper record.'],
  art: ['A close-up photograph of a trophy, medal or award displayed on a base.', 'A photograph focused on a painting, sculpture, calligraphy or handmade artwork.'],
  cartoon: ['An illustration of a drawn cartoon character or comic panel.', 'A digital meme, cartoon sticker or illustrated emoji image.'],
  other: ['A photograph of miscellaneous objects outside the listed specific subjects.', 'An image with content that does not match a specific available category.'],
};

// Every reference includes a visual meaning; bare labels can override the actual category definition.
// User-authored rules/descriptions remain the sole reference, so a broad label cannot bypass them.
export function categoryEmbeddingTexts(category, lang = 'zh') {
  const supplied = category.description;
  const hasDescription = typeof supplied === 'string' ? !!supplied.trim()
    : supplied && Object.values(supplied).some(value => typeof value === 'string' && value.trim());
  if (!descriptions[category.id] || !category.en || (typeof category.rule === 'string' && category.rule.trim()) || hasDescription) {
    return [categoryText(category, lang)];
  }
  return [categoryText(category, 'en'), ...(visualExamples[category.id] || []).map(text => `${category.en}: ${text}`)];
}

// Group paraphrases describe one visual subtype; user-authored rules remain the sole group.
export function categoryEmbeddingGroups(category, lang = 'zh') {
  const {scenarios} = normalizeCustomMatching(category);
  if (scenarios.length) return scenarios.map((scenario, index) => ({
    id: `scenario-${index}`, texts: [`${categoryText(category, lang)} / ${lang === 'en' ? 'Visual scenario within this rule' : '规则内的具体场景'}: ${scenario}`],
  }));
  const refs = categoryEmbeddingTexts(category, lang);
  const subtypes = require('./embeddingSubtypes').EMBEDDING_SUBTYPES[category.id];
  if (refs.length === 1 || !subtypes) return [{ id: 'rule', texts: [categoryText(category, lang)] }];
  return subtypes.map(([id, first, second]) => ({ id, texts: [
    `${category.en}: ${first}`,
    `${category.en}: ${second}`,
  ] }));
}

// Only explicit scenario lines are split; never rewrite a user's original rule.
export function normalizeCustomMatching(category = {}) {
  const raw = Array.isArray(category.scenarios) ? category.scenarios
    : typeof category.scenarios === 'string' ? category.scenarios.split(/\r?\n/) : [];
  return {scenarios: [...new Set(raw.filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean))],
    exclusions: typeof category.exclusions === 'string' ? category.exclusions.trim() : ''};
}

export function categoryMatchingRule(category, lang = 'zh') {
  const {scenarios, exclusions} = normalizeCustomMatching(category);
  const parts = [categoryDescription(category, lang)];
  if (scenarios.length) parts.push(lang === 'en'
    ? `Within the original rule, possible visual scenarios: ${scenarios.join('; ')}`
    : `在原有规则范围内，可出现的场景：${scenarios.join('；')}`);
  if (exclusions) parts.push(lang === 'en' ? `Exclude: ${exclusions}` : `排除：${exclusions}`);
  return parts.filter(Boolean).join(' / ');
}
