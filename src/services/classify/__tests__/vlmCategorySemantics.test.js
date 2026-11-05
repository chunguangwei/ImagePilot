jest.mock('react-native', () => ({ NativeModules: {}, Platform: { OS: 'android' } }));
jest.mock('react-native-fs', () => ({}));
jest.mock('react-native-image-resizer', () => ({}));
jest.mock('../../../i18n', () => ({ language: 'zh' }));
jest.mock('../../ConfigService', () => ({
  getAllCategoriesWithUI: () => [{ id: 'kids', chinese: '儿童', english: 'Kids', description: { zh: '真实儿童为主体', en: 'A real child as the subject' } }],
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
