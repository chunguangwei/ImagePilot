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
jest.mock('../classifierModelSource', () => ({
  isClassifierModelDownloaded: (...a) => mockIsDownloaded(...a),
  ensureClassifierModel: (...a) => mockEnsureModel(...a),
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
  mockReadSettings.mockReset();
  mockIsDownloaded.mockReset();
  mockEnsureModel.mockReset();
  mockMobileNet.mockReset();
  mockMapMobileNet.mockReset().mockReturnValue('people');
  mockPlaces365.mockReset();
  mockClip.mockReset();
});

describe('readActiveTier', () => {
  test('settings 缺 → 兜底 basic', async () => {
    mockReadSettings.mockResolvedValue({});
    expect(await readActiveTier()).toBe('basic');
  });

  test('settings.classifierModelTier=scene → scene', async () => {
    mockReadSettings.mockResolvedValue({ classifierModelTier: 'scene' });
    expect(await readActiveTier()).toBe('scene');
  });

  test('settings.classifierModelTier=foobar（未知 tier） → 兜底 basic', async () => {
    mockReadSettings.mockResolvedValue({ classifierModelTier: 'foobar' });
    expect(await readActiveTier()).toBe('basic');
  });

  test('readSettings throw → 兜底 basic（不向上抛）', async () => {
    mockReadSettings.mockRejectedValue(new Error('db down'));
    expect(await readActiveTier()).toBe('basic');
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

describe('classifyImageByTier — tier 兜底', () => {
  test('tier=null → 读 settings 决定（scene）', async () => {
    mockReadSettings.mockResolvedValue({ classifierModelTier: 'scene' });
    mockIsDownloaded.mockResolvedValue(true);
    mockEnsureModel.mockResolvedValue('file:///places.onnx');
    mockPlaces365.mockResolvedValue({
      success: true,
      topPrediction: { name: 'k', appCategory: 'documents' },
      confidence: 0.7,
      predictions: [],
    });
    const r = await classifyImageByTier('ph://1', null);
    expect(r.engine).toBe('places365');
  });

  test('未知 tier → 走兜底（fallback engine-error 而不抛）', async () => {
    mockIsDownloaded.mockResolvedValue(true);
    mockMobileNet.mockResolvedValue({
      success: true,
      topPrediction: { class: 'x' },
      confidence: 0.3,
      predictions: [],
    });
    // 直接传 unknown engine 应当不抛错（虽然 tierCfg 兜底了 basic，但路径是 basic）
    const r = await classifyImageByTier('ph://1', 'nonexistent');
    expect(r.engine).toBe('imagenet'); // 兜底走 basic
  });
});
