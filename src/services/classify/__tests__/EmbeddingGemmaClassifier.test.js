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

test('builtin classification combines full visual meanings rather than bare labels', async () => {
  getCategoryList.mockReturnValue([{ id: 'single_person', zh: '单人照片', en: 'Single Person' }, { id: 'fashion', zh: '服饰穿搭', en: 'Fashion' }]);
  embed.mockImplementation(async (_path, text) => {
    if (!text || text.includes('A portrait photograph with one person as the main subject')) return [0, 1];
    if (text.includes('单人照片')) return [1, 0];
    return [0.6, 0.8];
  });
  const r = await classifyWithEmbeddingGemma('portrait', 'model');
  expect(r.topPrediction.appCategory).toBe('single_person');
  expect(r.categoryDescription).toContain('一个人');
  expect(r.similarity).toBeGreaterThan(0.8);
});
test('explicit rules cannot be bypassed by a broad builtin visual label', async () => {
  getCategoryList.mockReturnValue([{ id: 'single_person', zh: '单人照片', en: 'Single Person', rule: '仅限室内自拍' }]);
  embed.mockResolvedValue([1, 0]);
  await classifyWithEmbeddingGemma('portrait', 'model');
  expect(embed.mock.calls.filter(([, text]) => text)).toHaveLength(1);
  expect(embed.mock.calls[0][1]).toContain('仅限室内自拍');
});

test('optional caption is embedded together with the image, retaining image-only evidence', async () => {
  const r = await classifyWithEmbeddingGemma('photo', 'model', { caption: '一只猫坐在室内。' });
  expect(embed).toHaveBeenCalledWith('model', '一只猫坐在室内。', 'file:///tmp/photo.jpg');
  expect(r.classificationMode).toBe('image-caption');
  expect(r.imageOnlyCategory).toBe('pets');
});
test('joint embedding failure falls back to the image without discarding its classification', async () => {
  embed.mockImplementation(async (_path, text, image) => {
    if (text && image) throw new Error('joint unsupported');
    if (text.includes('食物')) return [1, 0];
    return [0, 1];
  });
  const r = await classifyWithEmbeddingGemma('photo', 'model', { caption: '猫' });
  expect(r.topPrediction.appCategory).toBe('pets');
  expect(r.classificationMode).toBe('image');
  expect(r.fusionError).toContain('joint unsupported');
});
test('near-tied positive similarities are uncertain rather than a forced winner',async()=>{
 embed.mockImplementation(async(_p,text)=>!text?[1,0]:text.includes('食物')?[0.676,Math.sqrt(1-0.676**2)]:[0.673,Math.sqrt(1-0.673**2)]);
 const r=await classifyWithEmbeddingGemma('near-tie','model');
 expect(r.classificationAccepted).toBe(false);expect(r.topPrediction).toBeNull();expect(r.rejectionReason).toBe('ambiguous');
});
test('a single overly broad reference cannot override consistent subtype evidence',async()=>{
 getCategoryList.mockReturnValue([{id:'foods',zh:'美食',en:'Food Records'},{id:'pets',zh:'宠物',en:'Pets'}]);
 let foods=0;
 embed.mockImplementation(async(_p,text)=>!text?[1,0]:text.includes('Food Records')?(foods++===0?[1,0]:[0,1]):[0.8,0.6]);
 const r=await classifyWithEmbeddingGemma('photo','model');
 expect(r.topPrediction.appCategory).toBe('pets');
 expect(r.rejectionReason).toBeNull();
 expect(r.diagnostics.legacyRejectionReason).toBe('strongest-prototype-disagreement');
 expect(r.diagnostics.strongestCategory).toBe('foods');
});

test('diagnostics retain all actually encoded references without photo or model paths',async()=>{
 const r=await classifyWithEmbeddingGemma('private/photo.jpg','private/model');
 expect(r.diagnostics.categories).toHaveLength(cats.length);
 expect(r.diagnostics.categories.every(c=>c.references.length===1)).toBe(true);
 expect(r.diagnostics.categories.flatMap(c=>c.references.map(x=>x.text)).sort()).toEqual(embed.mock.calls.filter(c=>c[1]).map(c=>c[1]).sort());
 expect(JSON.stringify(r.diagnostics)).not.toContain('private/');
 expect(embed).toHaveBeenCalledTimes(3);
 const {embeddingRecordFields}=require('../embeddingRecordFields');
 expect(embeddingRecordFields(r).mobileNetV3Detections.embedding.diagnostics).toEqual(r.diagnostics);
});

test('subtype references are cached and no extra image inference is added',async()=>{
 getCategoryList.mockReturnValue([{id:'electronics',en:'Electronics',zh:'电子产品'}]);
 embed.mockResolvedValue([1,0]);
 const first=await classifyWithEmbeddingGemma('photo','model');
 const count=embed.mock.calls.length;
 await classifyWithEmbeddingGemma('photo2','model');
 expect(embed).toHaveBeenCalledTimes(count+1);
 expect(embed.mock.calls.filter(([,text,image])=>image&&!text)).toHaveLength(2);
 expect(first.diagnostics.categories[0].groups.length).toBeGreaterThan(1);
});
test('optional details invalidate the cache and exclusion conflict cannot write a category',async()=>{
 const custom={id:'work',zh:'工作',rule:'设备',scenarios:['机柜']};
 getCategoryList.mockReturnValue([custom,{id:'other',zh:'其他'}]);
 embed.mockImplementation(async(_path,text)=>text.includes('其他')?[0,1]:text.includes('盆栽')?[1,0]:text?[0.99,0.1]:[1,0]);
 const first=await classifyWithEmbeddingGemma('photo','model');
 expect(first.classificationAccepted).toBe(true);
 const count=embed.mock.calls.length;
 getCategoryList.mockReturnValue([{...custom,exclusions:'盆栽'},{id:'other',zh:'其他'}]);
 const second=await classifyWithEmbeddingGemma('photo','model');
 expect(embed.mock.calls.length).toBeGreaterThan(count+1);
 expect(second.classificationAccepted).toBe(false);
 expect(second.rejectionReason).toBe('exclusion-conflict');
 expect(second.topPrediction).toBeNull();
 expect(second.diagnostics.categories.find(c=>c.id==='work').groups.find(g=>g.exclude).references[0].text).toContain('盆栽');
});
