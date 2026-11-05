// Shared category meanings, not captions generated for an individual image.
const descriptions = {
  social_activities: ['多人聚会、同事或朋友合影、会议、庆典及集体活动的照片', 'A photograph of people together at a gathering, colleagues posing for a group photo, a meeting or a celebration.'],
  single_person: ['以一个人为主要拍摄对象的人像、自拍或个人生活照片', 'A portrait, selfie or everyday photograph with one person as the main subject.'],
  kids: ['以真实婴儿、幼儿或儿童为主要拍摄对象的照片，记录孩子的面容、玩耍或日常生活', 'A photograph whose main subject is a real baby, toddler or child, showing children playing or in everyday life.'],
  pets: ['以猫、狗或其他宠物动物为主要拍摄对象的照片', 'A photograph of a cat, dog or another pet animal as the main subject.'],
  foods: ['展示食物、菜肴、甜点、饮料或餐桌美食的照片', 'A photograph showing food, prepared dishes, desserts, drinks or a meal on a table.'],
  travel_scenery: ['旅行途中拍摄的山川、海滨、湖泊、公园等自然风景', 'A photograph of natural scenery, mountains, beaches, lakes or parks during travel.'],
  screenshot: ['手机或电脑屏幕截取的应用界面、聊天记录、网页或游戏画面', 'A screenshot of a phone or computer app, chat conversation, web page or game interface.'],
  idcard: ['身份证件、护照等证件的照片，或正式证件用途的正面人像照', 'A photograph of an identity document or passport, or a formal front-facing identification portrait.'],
  qrcode: ['以可扫描的二维码为主要内容的图片', 'An image primarily showing a scannable QR code.'],
  electronics: ['以手机、电脑、相机、电路板等电子设备为主体的照片', 'A photograph focused on electronic devices such as phones, computers, cameras or circuit boards.'],
  night_scene: ['夜晚拍摄的城市灯光、街道、夜空或夜间风景照片', 'A photograph of city lights, streets, the night sky or scenery at night.'],
  architecture: ['以建筑外观、室内空间、桥梁或建筑结构为主体的照片', 'A photograph focused on buildings, interior spaces, bridges or architectural structures.'],
  plants: ['以花朵、树木、叶片、盆栽等植物为主体的照片', 'A photograph focused on flowers, trees, leaves, houseplants or other vegetation.'],
  vehicles: ['以汽车、摩托车、自行车、火车、船或飞机为主体的照片', 'A photograph focused on a car, motorcycle, bicycle, train, boat or airplane.'],
  sports: ['记录跑步、球类、游泳、骑行或健身等运动活动的照片', 'A photograph of sports or fitness activities such as running, ball games, swimming, cycling or exercise.'],
  fashion: ['重点展示服装搭配、鞋帽、配饰或穿搭造型的照片', 'A photograph focused on clothing outfits, shoes, hats, accessories or fashion styling.'],
  products: ['展示商品、包装或待售物品外观的产品照片', 'A product photograph showing merchandise, packaging or an item for sale.'],
  documents: ['以纸质或电子文档、表格、发票、收据、票据上的文字为主体的图片', 'An image primarily showing text in a document, form, invoice, receipt or ticket.'],
  art: ['以绘画、雕塑、书法、手工艺术等作品为主体的图片', 'An image focused on a painting, sculpture, calligraphy, craft or other artwork.'],
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
