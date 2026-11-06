jest.mock('react-native-fs', () => ({ stat: jest.fn(), exists: jest.fn(), hash: jest.fn(), unlink: jest.fn(async () => {}) }));
jest.mock('../classifierModelSource', () => ({ modelLocalPath: f => '/models/' + f, ensureLargeModel: jest.fn(async () => {}), deleteClassifierModel: jest.fn(async () => {}) }));
import RNFS from 'react-native-fs';
import { CAPTION_FILES, captionModelReady, downloadCaptionModel, deleteCaptionModel } from '../lfmCaptionModel';
import { ensureLargeModel, deleteClassifierModel } from '../classifierModelSource';
let files;
beforeEach(async () => {
  await deleteCaptionModel(); jest.clearAllMocks(); files = new Map();
  RNFS.stat.mockImplementation(async path => { if (!files.has(path)) throw new Error('missing'); return files.get(path); });
  RNFS.exists.mockImplementation(async path => files.has(path));
  RNFS.hash.mockImplementation(async path => CAPTION_FILES.find(f => path.split('/').pop() === f.filename).sha256);
  ensureLargeModel.mockImplementation(async (filename, url, progress) => {
    const f = CAPTION_FILES.find(x => x.filename === filename); files.set('/models/' + filename, { size: f.bytes, mtime: 1 }); progress(1);
  });
});
test('one file is not a complete vision model', async () => {
  files.set('/models/' + CAPTION_FILES[0].filename, { size: CAPTION_FILES[0].bytes, mtime: 1 });
  expect(await captionModelReady()).toBe(false);
});
test('downloads both official files and verifies hashes', async () => {
  const progress = jest.fn(); await downloadCaptionModel(progress);
  expect(ensureLargeModel).toHaveBeenCalledTimes(2); expect(RNFS.hash).toHaveBeenCalledTimes(2);
  expect(await captionModelReady()).toBe(true); expect(progress).toHaveBeenLastCalledWith(1);
});
test('corrupt final file is rejected and removed', async () => {
  RNFS.hash.mockResolvedValue('wrong');
  await expect(downloadCaptionModel()).rejects.toThrow('checksum');
  expect(deleteClassifierModel).toHaveBeenCalledWith(CAPTION_FILES[0].filename);
});
test('abort prevents model downloads', async () => {
  await expect(downloadCaptionModel(null, { aborted: true })).rejects.toThrow('E_ABORTED'); expect(ensureLargeModel).not.toHaveBeenCalled();
});
test('retired cleanup removes LFM and SmolVLM while preserving active models',async()=>{
 const {deleteLegacyCaptionModel}=require('../lfmCaptionModel');
 files.set('/models/LFM2.5-VL-450M-Q4_K_M.gguf',{size:1});
 files.set('/models/'+CAPTION_FILES[0].filename,{size:CAPTION_FILES[0].bytes});
 await deleteLegacyCaptionModel();
 expect(RNFS.unlink).toHaveBeenCalledWith('/models/LFM2.5-VL-450M-Q4_K_M.gguf');
 expect(RNFS.unlink).toHaveBeenCalledWith('/models/'+CAPTION_FILES[0].filename);
 expect(RNFS.unlink).not.toHaveBeenCalledWith('/models/gemma-4-E2B-it.litertlm');
 expect(RNFS.unlink).not.toHaveBeenCalledWith('/models/embeddinggemma-2-text-vision-440m.litertlm');
});
