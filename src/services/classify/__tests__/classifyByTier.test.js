const mockLfm = jest.fn();
jest.mock('../LfmClassifier', () => ({ classifyWithLfm: (...a) => mockLfm(...a) }));
/**
 * classifyByTier — 档位路由 + 模型缺失/引擎报错 fallback 语义测试。
 *
 * 不测真实 ONNX 推理（要 RN runtime）；只测：
 *   1. readActiveTier 读 settings 的兜底
 *   2. 各档"模型未下载"是否正确 fallback
 *   3. 各档"引擎报错"是否正确 fallback
 *   4. 成功路径返回形状
 */

jest.mock('../../../adapters/WebAdapters', () => ({
  logger: { warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

const mockReadSettings = jest.fn();
jest.mock('../../UnifiedDataService', () => ({
  __esModule: true,
  default: { readSettings: (...a) => mockReadSettings(...a) },
}));

const mockIsDownloaded = jest.fn();
const mockEnsureModel = jest.fn();
const mockLargeComplete = jest.fn();
const mockEnsureLarge = jest.fn();
jest.mock('../classifierModelSource', () => ({
  isClassifierModelDownloaded: (...a) => mockIsDownloaded(...a),
  ensureClassifierModel: (...a) => mockEnsureModel(...a),
  isLargeModelComplete: (...a) => mockLargeComplete(...a),
  ensureLargeModel: (...a) => mockEnsureLarge(...a),
}));

const mockEmbeddingClassify = jest.fn();
jest.mock('../EmbeddingGemmaClassifier', () => ({
  classifyWithEmbeddingGemma: (...a) => mockEmbeddingClassify(...a),
}));

const mockMobileNet = jest.fn();
const mockMapMobileNet = jest.fn(() => 'people');
jest.mock('../../ImageClassifierService', () => {
  return jest.fn().mockImplementation(() => ({
    classifyImageWithMobileNetV3: (...a) => mockMobileNet(...a),
    mapMobileNetV3ToAppCategory: (...a) => mockMapMobileNet(...a),
  }));
});

const mockPlaces365 = jest.fn();
jest.mock('../Places365Classifier', () => ({
  classifyImageWithPlaces365: (...a) => mockPlaces365(...a),
}));

const mockClip = jest.fn();
jest.mock('../MobileCLIPClassifier', () => ({
  classifyImageWithMobileCLIP: (...a) => mockClip(...a),
}));

const { classifyImageByTier, readActiveTier } = require('../classifyByTier');

beforeEach(() => {
  mockLargeComplete.mockReset();
  mockEnsureLarge.mockReset();
  mockEmbeddingClassify.mockReset();
  mockReadSettings.mockReset();
  mockIsDownloaded.mockReset();
  mockEnsureModel.mockReset();
  mockMobileNet.mockReset();
  mockMapMobileNet.mockReset().mockReturnValue('people');
  mockPlaces365.mockReset();
  mockClip.mockReset();
});

describe('EmbeddingGemma 2 is an independent opt-in classifier', () => {
  test('missing download rejects instead of silently running the basic model', async () => {
    mockLargeComplete.mockResolvedValue(false);
    await expect(classifyImageByTier('photo', 'embeddinggemma2')).rejects.toThrow(/not downloaded/);
    expect(mockMobileNet).not.toHaveBeenCalled();
  });
  test('native failure rejects instead of substituting another classifier', async () => {
    mockLargeComplete.mockResolvedValue(true);
    mockEnsureLarge.mockResolvedValue('file:///model');
    mockEmbeddingClassify.mockRejectedValue(new Error('native embedding failed'));
    await expect(classifyImageByTier('photo', 'embeddinggemma2')).rejects.toThrow('native embedding failed');
    expect(mockMobileNet).not.toHaveBeenCalled();
  });
  test('selected model returns its category and similarity without basic inference', async () => {
    mockLargeComplete.mockResolvedValue(true);
    mockEnsureLarge.mockResolvedValue('file:///model');
    mockEmbeddingClassify.mockResolvedValue({ engine: 'embeddinggemma2', topPrediction: { appCategory: 'pets' }, similarity: 0.31, classificationAccepted: true });
    const result = await classifyImageByTier('photo', 'embeddinggemma2');
    expect(result.topPrediction.appCategory).toBe('pets');
    expect(result.similarity).toBe(0.31);
    expect(mockMobileNet).not.toHaveBeenCalled();
  });
});

describe('readActiveTier', () => {
  test.each([undefined, 'lfm', 'smolvlm', 'basic', 'scene', 'clip', 'foobar'])('retired or absent selection %s migrates to EmbeddingGemma', async tier => {
    mockReadSettings.mockResolvedValue({ classifierModelTier: tier });
    expect(await readActiveTier()).toBe('embeddinggemma2');
  });
  test.each(['embeddinggemma2', 'vlm'])('keeps supported selection %s', async tier => {
    mockReadSettings.mockResolvedValue({ classifierModelTier: tier });
    expect(await readActiveTier()).toBe(tier);
  });
  test('settings read failure defaults to EmbeddingGemma', async () => {
    mockReadSettings.mockRejectedValue(new Error('db down'));
    expect(await readActiveTier()).toBe('embeddinggemma2');
  });
});

describe('classifyImageByTier — basic 档', () => {
  test('模型未下载 → 返回 no-model fallback，不抛错', async () => {
    mockIsDownloaded.mockResolvedValue(false);
    const r = await classifyImageByTier('ph://1', 'basic');
    expect(r).toEqual({
      engine: 'imagenet',
      topPrediction: null,
      confidence: 0,
      predictions: [],
      fallback: 'no-model',
    });
    expect(mockMobileNet).not.toHaveBeenCalled();
  });

  test('模型在 + MobileNet 成功 → 返回 imagenet 形状 + appCategory', async () => {
    mockIsDownloaded.mockResolvedValue(true);
    mockMobileNet.mockResolvedValue({
      success: true,
      topPrediction: { class: 'tabby_cat' },
      confidence: 0.8,
      predictions: [{ class: 'tabby_cat', prob: 0.8 }],
    });
    mockMapMobileNet.mockReturnValue('pets');
    const r = await classifyImageByTier('ph://1', 'basic');
    expect(r.engine).toBe('imagenet');
    expect(r.topPrediction).toEqual({ name: 'tabby_cat', appCategory: 'pets' });
    expect(r.confidence).toBe(0.8);
    expect(r.fallback).toBeUndefined();
  });
});

describe('classifyImageByTier — scene 档', () => {
  test('模型未下载 → 回退 basic 推理 + fallback="no-model"', async () => {
    // scene 模型 isDownloaded → false；basic 推理由 runImageNet 直接调，不再 gate
    mockIsDownloaded.mockResolvedValue(false);
    mockMobileNet.mockResolvedValue({
      success: true,
      topPrediction: { class: 'street' },
      confidence: 0.6,
      predictions: [],
    });
    const r = await classifyImageByTier('ph://1', 'scene');
    expect(r.engine).toBe('imagenet');
    expect(r.fallback).toBe('no-model');
    expect(mockMobileNet).toHaveBeenCalled();
  });

  test('引擎成功 → 返回 places365 形状，无 fallback 标', async () => {
    mockIsDownloaded.mockResolvedValue(true);
    mockEnsureModel.mockResolvedValue('file:///models/places365.onnx');
    mockPlaces365.mockResolvedValue({
      success: true,
      topPrediction: { name: 'kitchen', appCategory: 'documents' },
      confidence: 0.72,
      predictions: [{ name: 'kitchen', prob: 0.72 }],
    });
    const r = await classifyImageByTier('ph://1', 'scene');
    expect(r.engine).toBe('places365');
    expect(r.topPrediction).toEqual({ name: 'kitchen', appCategory: 'documents' });
    expect(r.confidence).toBe(0.72);
    expect(r.fallback).toBeUndefined();
    expect(mockMobileNet).not.toHaveBeenCalled();
  });

  test('引擎 throw → 回退 basic + fallback="engine-error"', async () => {
    mockIsDownloaded.mockResolvedValue(true);
    mockEnsureModel.mockResolvedValue('file:///x.onnx');
    mockPlaces365.mockRejectedValue(new Error('ORT crash'));
    mockMobileNet.mockResolvedValue({
      success: true,
      topPrediction: { class: 'fallback_class' },
      confidence: 0.3,
      predictions: [],
    });
    const r = await classifyImageByTier('ph://1', 'scene');
    expect(r.engine).toBe('imagenet');
    expect(r.fallback).toBe('engine-error');
    expect(mockMobileNet).toHaveBeenCalled();
  });

  test('引擎返回 success=false → 回退 basic + fallback="engine-error"', async () => {
    mockIsDownloaded.mockResolvedValue(true);
    mockEnsureModel.mockResolvedValue('file:///x.onnx');
    mockPlaces365.mockResolvedValue({ success: false });
    mockMobileNet.mockResolvedValue({
      success: true,
      topPrediction: { class: 'fallback_class' },
      confidence: 0.3,
      predictions: [],
    });
    const r = await classifyImageByTier('ph://1', 'scene');
    expect(r.fallback).toBe('engine-error');
  });
});

describe('classifyImageByTier — clip 档', () => {
  test('模型未下载 → 回退 basic + fallback="no-model"', async () => {
    mockIsDownloaded.mockResolvedValue(false);
    mockMobileNet.mockResolvedValue({
      success: true,
      topPrediction: { class: 'x' },
      confidence: 0.5,
      predictions: [],
    });
    const r = await classifyImageByTier('ph://1', 'clip');
    expect(r.engine).toBe('imagenet');
    expect(r.fallback).toBe('no-model');
  });

  test('引擎成功 → clip 形状', async () => {
    mockIsDownloaded.mockResolvedValue(true);
    mockEnsureModel.mockResolvedValue('file:///clip.onnx');
    mockClip.mockResolvedValue({
      success: true,
      topPrediction: { name: 'beach', appCategory: 'travel_scenery' },
      confidence: 0.55,
      predictions: [{ name: 'beach', prob: 0.55 }],
    });
    const r = await classifyImageByTier('ph://1', 'clip');
    expect(r.engine).toBe('clip');
    expect(r.topPrediction).toEqual({ name: 'beach', appCategory: 'travel_scenery' });
    expect(r.fallback).toBeUndefined();
  });

  test('引擎 throw → 回退 basic + fallback="engine-error"', async () => {
    mockIsDownloaded.mockResolvedValue(true);
    mockEnsureModel.mockResolvedValue('file:///clip.onnx');
    mockClip.mockRejectedValue(new Error('ORT crash'));
    mockMobileNet.mockResolvedValue({
      success: true,
      topPrediction: { class: 'x' },
      confidence: 0.3,
      predictions: [],
    });
    const r = await classifyImageByTier('ph://1', 'clip');
    expect(r.fallback).toBe('engine-error');
  });
});

describe('retired model routing', () => {
  test.each(['lfm', 'smolvlm', 'nonexistent', null])('never invokes a retired caption model for %s', async tier => {
    mockReadSettings.mockResolvedValue({ classifierModelTier: 'lfm' });
    mockLargeComplete.mockResolvedValue(true);
    mockEnsureLarge.mockResolvedValue('file:///embedding');
    mockEmbeddingClassify.mockResolvedValue({ engine: 'embeddinggemma2', topPrediction: { appCategory: 'pets' } });
    expect((await classifyImageByTier('photo', tier)).engine).toBe('embeddinggemma2');
    expect(mockLfm).not.toHaveBeenCalled();
    expect(mockMobileNet).not.toHaveBeenCalled();
  });
  test('retired selection with no EmbeddingGemma file requires download instead of running LFM', async () => {
    mockLargeComplete.mockResolvedValue(false);
    await expect(classifyImageByTier('photo', 'lfm')).rejects.toThrow('not downloaded');
    expect(mockLfm).not.toHaveBeenCalled();
  });
});
test.each(['scene','clip'])('explicit %s choice never silently falls back after inference failure',async tier=>{
 mockReadSettings.mockResolvedValue({});mockIsDownloaded.mockResolvedValue(true);mockEnsureModel.mockResolvedValue('file://model');
 mockPlaces365.mockRejectedValue(new Error('engine failed'));mockClip.mockRejectedValue(new Error('engine failed'));
 await expect(classifyImageByTier('photo',tier,{strict:true})).rejects.toThrow('engine failed');
 expect(mockMobileNet).not.toHaveBeenCalled();
});
test('explicit missing E2B fails before trying any other model',async()=>{
 mockReadSettings.mockResolvedValue({});mockLargeComplete.mockResolvedValue(false);
 await expect(classifyImageByTier('photo','vlm',{strict:true})).rejects.toThrow('not downloaded');
 expect(mockMobileNet).not.toHaveBeenCalled();
});
test('explicit basic inference errors stay retryable rather than becoming Other',async()=>{
 mockIsDownloaded.mockResolvedValue(true);mockMobileNet.mockRejectedValue(new Error('native failed'));
 await expect(classifyImageByTier('photo','basic',{strict:true})).rejects.toThrow('native failed');
 mockMobileNet.mockResolvedValue({success:false,error:'bad input'});
 await expect(classifyImageByTier('photo','basic',{strict:true})).rejects.toThrow('bad input');
});
