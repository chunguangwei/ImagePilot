jest.mock('react-native', () => ({ NativeModules: {
  GemmaModule: { embed: jest.fn(), release: jest.fn() },
}, Platform: { OS: 'android' } }));
jest.mock('../vlmShared', () => ({
  getCategoryList: jest.fn(), currentLang: () => 'zh',
  prepareImageFile: jest.fn(async () => 'file:///tmp/photo.jpg'),
  cleanupTmp: jest.fn(),
}));
const { NativeModules } = require('react-native');
const { getCategoryList, cleanupTmp } = require('../vlmShared');
const { classifyWithEmbeddingGemma, disposeEmbeddingGemma } = require('../EmbeddingGemmaClassifier');
const embed = NativeModules.GemmaModule.embed;
const cats = [{ id: 'food', zh: '食物' }, { id: 'pets', zh: '宠物' }];

beforeEach(async () => {
  await disposeEmbeddingGemma();
  jest.clearAllMocks();
  getCategoryList.mockReturnValue(cats);
  embed.mockImplementation(async (_path, text) => {
    if (text.includes('食物')) return [3, 0];
    if (text.includes('宠物')) return [0, 4];
    return [0, 2];
  });
});

test('classifies by cosine similarity, returns no invented description, and reuses category vectors', async () => {
  const first = await classifyWithEmbeddingGemma('photo', 'model');
  expect(first.topPrediction.appCategory).toBe('pets');
  expect(first.similarity).toBeCloseTo(1);
  expect(first.vlmLabel).toBeUndefined();
  expect(first.classificationAccepted).toBe(true);
  const second = await classifyWithEmbeddingGemma('photo2', 'model');
  expect(second.topPrediction.appCategory).toBe('pets');
  expect(embed).toHaveBeenCalledTimes(4); // two labels, two images
  expect(cleanupTmp).toHaveBeenCalledTimes(2);
});

test('category rule changes invalidate cached vectors', async () => {
  await classifyWithEmbeddingGemma('photo', 'model');
  getCategoryList.mockReturnValue([{ ...cats[0], rule: '仅甜点' }, cats[1]]);
  await classifyWithEmbeddingGemma('photo', 'model');
  expect(embed).toHaveBeenCalledTimes(6);
  expect(embed.mock.calls.some(([, text]) => text.includes('仅甜点'))).toBe(true);
});

test('invalid native vectors fail explicitly and clean up the temporary image', async () => {
  embed.mockResolvedValue([NaN, 0]);
  await expect(classifyWithEmbeddingGemma('photo', 'model')).rejects.toThrow(/vector/i);
  expect(cleanupTmp).toHaveBeenCalledWith('file:///tmp/photo.jpg');
});

test('dimension mismatch cannot silently produce a category', async () => {
  embed.mockImplementation(async (_path, text) => text ? [1, 0] : [1]);
  await expect(classifyWithEmbeddingGemma('photo', 'model')).rejects.toThrow(/dimension/i);
});

test('descriptive category text is encoded and saved as category explanation, not an image caption', async () => {
  getCategoryList.mockReturnValue([{ id: 'food', zh: '食物', description: { zh: '餐桌上的食物和饮料' } }, cats[1]]);
  await classifyWithEmbeddingGemma('photo', 'model');
  expect(embed.mock.calls.some(([, text]) => text.includes('餐桌上的食物和饮料'))).toBe(true);
});

test('tied candidates do not force a category based on list order', async () => {
  embed.mockResolvedValue([1, 0]);
  const result = await classifyWithEmbeddingGemma('photo', 'model');
  expect(result.classificationAccepted).toBe(false);
  expect(result.topPrediction).toBeNull();
  expect(result.predictions).toHaveLength(2);
});

test('non-positive similarity is not accepted as a match', async () => {
  embed.mockImplementation(async (_path, text) => text ? [1, 0] : [-1, 0]);
  const result = await classifyWithEmbeddingGemma('photo', 'model');
  expect(result.classificationAccepted).toBe(false);
  expect(result.topPrediction).toBeNull();
});

test('editing a category description invalidates its encoded cache', async () => {
  await classifyWithEmbeddingGemma('photo', 'model');
  getCategoryList.mockReturnValue([{ ...cats[0], description: '餐桌上的食物' }, cats[1]]);
  await classifyWithEmbeddingGemma('photo', 'model');
  expect(embed).toHaveBeenCalledTimes(6);
});

test('uses the official classification query prefix for every category', async () => {
  await classifyWithEmbeddingGemma('photo', 'model');
  const texts = embed.mock.calls.map(([, text]) => text).filter(Boolean);
  expect(texts).toHaveLength(cats.length);
  expect(texts.every(text => text.startsWith('task: classification | query: '))).toBe(true);
});
