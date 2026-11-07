// Guidance for instruction-following models, not a person detector or hard embedding veto.
export const SUBJECT_GUIDANCE = {
  zh: '按主要拍摄对象和正在发生的活动分类，不按背景中碰巧出现的元素分类。以人物为主体的肖像、自拍、写真应归相应人物类；运动动作或多人互动为重点时归运动或社交。风景以整体环境为主体，远处点缀人物不妨碍归风景；人物写真背后的山水、公园不应把人像归风景。植物、建筑、车辆、设备、商品等也以对应对象是否为主体判断。用户明确填写的分类规则优先。',
  en: 'Classify the main photographic subject or activity, not incidental background elements. Portraits and selfies belong to the appropriate people category; visible sporting action or social interaction belongs to its activity category. Scenery focuses on the overall environment and may include small incidental people. Landscape behind a posed person does not make a portrait a scenery photo. Plants, buildings, vehicles, devices and products must likewise be the main subject. Explicit user category rules take precedence.',
};
