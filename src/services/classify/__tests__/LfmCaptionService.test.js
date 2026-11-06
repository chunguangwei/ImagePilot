jest.mock('../captionLanguage', () => ({ captionLanguage: jest.fn(() => 'zh') }));
import { captionLanguage } from '../captionLanguage';
const mockContext = { initMultimodal: jest.fn(), clearCache: jest.fn(), completion: jest.fn(), release: jest.fn(async () => {}), stopCompletion: jest.fn() };
jest.mock('llama.rn', () => ({ initLlama: jest.fn(async () => mockContext) }));
jest.mock('../lfmCaptionModel', () => ({ captionModelReady: jest.fn(async () => true), captionModelPaths: () => ({ model: '/model.gguf', projector: '/projector.gguf' }) }));
jest.mock('../vlmShared', () => ({ currentLang: () => 'zh', prepareImageFile: jest.fn(async u => u), cleanupTmp: jest.fn(async () => {}) }));
jest.mock('../../../adapters/WebAdapters', () => ({ logger: { warn: jest.fn() } }));
import { runCaptionPass } from '../LfmCaptionService';
import { initLlama } from 'llama.rn';
import { captionModelReady } from '../lfmCaptionModel';

beforeEach(() => { jest.clearAllMocks(); captionLanguage.mockReturnValue('zh'); captionModelReady.mockResolvedValue(true); mockContext.initMultimodal.mockResolvedValue(true); mockContext.completion.mockResolvedValue({ text: '图片中有一只猫。' }); });
const images = [{ id: '1', uri: 'file:///a.jpg' }, { id: '2', uri: 'file:///b.jpg' }];
const opts = () => ({ config: { enabled: true, language: 'zh' }, save: jest.fn(async () => ({ success: true })), shouldStop: () => false });
test('disabled makes no runtime or model calls', async () => {
  await runCaptionPass(images, { ...opts(), config: {} });
  expect(initLlama).not.toHaveBeenCalled(); expect(captionModelReady).not.toHaveBeenCalled();
});
test('missing pair does not initialize or write', async () => {
  captionModelReady.mockResolvedValue(false); const o = opts();
  const r = await runCaptionPass(images, o); expect(r.skipped).toBe('model-missing'); expect(o.save).not.toHaveBeenCalled(); expect(initLlama).not.toHaveBeenCalled();
});
test.each(['zh', 'en'])('writes real %s captions using CPU and resets recurrent state for each image', async language => {
  const o = opts(); o.config.language = language === 'zh' ? 'en' : 'zh'; captionLanguage.mockReturnValue(language);
  const r = await runCaptionPass(images, o);
  expect(r.generated).toBe(2); expect(initLlama).toHaveBeenCalledWith(expect.objectContaining({ n_gpu_layers: 0, n_threads: 2, ctx_shift: false }));
  expect(mockContext.initMultimodal).toHaveBeenCalledWith({ path: '/projector.gguf', use_gpu: false });
  expect(mockContext.clearCache).toHaveBeenCalledTimes(2);
  const prompt = mockContext.completion.mock.calls[0][0].messages[0].content[0].text;
  expect(prompt).toContain(language === 'zh' ? '中文' : 'English');
  expect(o.save).toHaveBeenCalledWith(images[0], '图片中有一只猫'); expect(mockContext.release).toHaveBeenCalledTimes(1);
});
test('empty or failed captions do not overwrite existing descriptions', async () => {
  mockContext.completion.mockRejectedValueOnce(new Error('bad image')).mockResolvedValueOnce({ text: '  ' });
  const o = opts(); const r = await runCaptionPass(images, o);
  expect(r.failed).toBe(2); expect(o.save).not.toHaveBeenCalled(); expect(mockContext.release).toHaveBeenCalledTimes(1);
});
test('stop during inference discards output and releases context', async () => {
  let stopped = false; mockContext.completion.mockImplementationOnce(async () => { stopped = true; return { text: 'partial' }; });
  const o = { ...opts(), shouldStop: () => stopped }; const r = await runCaptionPass(images, o);
  expect(r.stopped).toBe(true); expect(o.save).not.toHaveBeenCalled(); expect(mockContext.release).toHaveBeenCalledTimes(1);
});
test('projector initialization failure releases partially loaded context', async () => {
  mockContext.initMultimodal.mockResolvedValue(false); const o = opts();
  const r = await runCaptionPass(images, o); expect(r.failed).toBe(2); expect(o.save).not.toHaveBeenCalled(); expect(mockContext.release).toHaveBeenCalledTimes(1);
});
test('stop during image preparation does not begin inference', async () => {
  let stopped = false; const o = { ...opts(), shouldStop: () => stopped, resolveImage: async image => { stopped = true; return { uri: image.uri }; } };
  const r = await runCaptionPass(images, o);
  expect(r.stopped).toBe(true); expect(mockContext.completion).not.toHaveBeenCalled(); expect(o.save).not.toHaveBeenCalled();
});
test('per-row persistence failures do not count as generated', async () => {
  const o = opts(); o.save.mockResolvedValue({ success: true, updatedCount: 0, failedCount: 1 });
  const r = await runCaptionPass(images, o); expect(r.generated).toBe(0); expect(r.failed).toBe(2);
});

test('reports the failing stage for each image when native initialization fails', async () => {
  initLlama.mockRejectedValueOnce(new Error('native library unavailable'));
  const onFailure = jest.fn(async () => {});
  const r = await runCaptionPass(images, { ...opts(), onFailure });
  expect(r.failed).toBe(2);
  expect(onFailure).toHaveBeenCalledWith(images[0], { stage: 'model', error: 'native library unavailable' });
  expect(onFailure).toHaveBeenCalledWith(images[1], { stage: 'model', error: 'native library unavailable' });
});
test('reports persistence failures separately from inference failures', async () => {
  const o = opts(); o.save.mockResolvedValue({ updatedCount: 0 });
  const onFailure = jest.fn(async () => {});
  await runCaptionPass(images, { ...o, onFailure });
  expect(onFailure).toHaveBeenCalledWith(images[0], { stage: 'save', error: 'Caption save failed' });
});
test('missing model reports actionable failure for every requested image', async () => {
  captionModelReady.mockResolvedValue(false);
  const onFailure = jest.fn(async () => {});
  await runCaptionPass(images, { ...opts(), onFailure });
  expect(onFailure).toHaveBeenCalledTimes(2);
  expect(onFailure.mock.calls[0][1].stage).toBe('verify');
});

test('short subject caption skips OCR details and bounds generation', async () => {
  await runCaptionPass(images.slice(0,1), opts());
  const request = mockContext.completion.mock.calls[0][0];
  expect(request.n_predict).toBe(40);
  expect(request.messages[0].content[0].text).toContain('15');
  expect(request.messages[0].content[0].text).toContain('不转录');
});
