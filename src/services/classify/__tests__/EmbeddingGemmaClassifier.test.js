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
