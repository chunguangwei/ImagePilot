jest.mock('react-native', () => ({ NativeModules: {}, Platform: { OS: 'android' } }));
jest.mock('react-native-fs', () => ({}));
jest.mock('react-native-image-resizer', () => ({}));
jest.mock('../../../i18n', () => ({ language: 'zh' }));
jest.mock('../../ConfigService', () => ({
  getAllCategoriesWithUI: jest.fn(() => [{ id: 'kids', chinese: '儿童', english: 'Kids', description: { zh: '真实儿童为主体', en: 'A real child as the subject' } }]),
  getCustomCategoryRules: () => ({ custom: '同事在会议现场合影' }),
  getCustomCategoryNames: () => ({ custom: '工作活动' }),
}));
const { getCategoryList, buildPrompt } = require('../vlmShared');

test('the shared category list preserves supplied descriptions and custom rules', () => {
  const cats = getCategoryList();
  expect(cats[0].description.zh).toBe('真实儿童为主体');
  expect(cats.find(c => c.id === 'custom').rule).toBe('同事在会议现场合影');
  const prompt = buildPrompt(cats, 'zh');
  expect(prompt).toContain('真实儿童为主体');
  expect(prompt).toContain('同事在会议现场合影');
  expect(prompt).toContain('一句不超过15字');
});

test('E2B keeps its description/category output contract with shared meanings', () => {
  const prompt = buildPrompt([{ id: 'social_activities', zh: '社交活动', en: 'Social Activities' }], 'en', { detailed: true });
  expect(prompt).toContain('colleagues posing for a group photo');
  expect(prompt).toContain('desc: 2-3 detailed');
  expect(prompt).toContain('cat: output ONE category');
});


test('every enabled builtin plus custom category is included; pending buckets and deleted builtins are excluded', () => {
  const Config = require('../../ConfigService');
  const settings = require('../../../../public/initialSettings.json');
  const enabled = Object.entries(settings.categoryNameMap).filter(([id]) => id !== 'kids');
  Config.getAllCategoriesWithUI.mockReturnValue(enabled.map(([id, names]) => ({ id, ...names })));
  const cats = getCategoryList();
  const expected = enabled.map(([id]) => id).filter(id => !['NA', 'NA_video'].includes(id));
  expect(cats.map(c => c.id).sort()).toEqual([...expected, 'custom'].sort());
  expect(cats.find(c => c.id === 'custom').rule).toBe('同事在会议现场合影');
});
test.each(['zh','en'])('E2B receives optional details even without a base rule (%s)',lang=>{
 const prompt=buildPrompt([{id:'work',zh:'工作',en:'Work',scenarios:['网络机柜'],exclusions:'盆栽'}],lang);
 expect(prompt).toContain('网络机柜');expect(prompt).toContain('盆栽');
});
