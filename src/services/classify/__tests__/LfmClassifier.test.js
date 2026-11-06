jest.mock('react-native-fs',()=>({}));
jest.mock('../../../i18n',()=>({language:'zh'}));
jest.mock('../EmbeddingGemmaClassifier',()=>({disposeEmbeddingGemma:jest.fn(async()=>{})}));
const mockContext = { initMultimodal: jest.fn(async()=>true), clearCache: jest.fn(), completion: jest.fn(), release: jest.fn(async()=>{}), stopCompletion: jest.fn() };
jest.mock('llama.rn',()=>({initLlama:jest.fn(async()=>mockContext)}));
jest.mock('../lfmCaptionModel',()=>({captionModelReady:jest.fn(async()=>true),captionModelPaths:()=>({model:'model',projector:'projector'})}));
jest.mock('../captionLanguage',()=>({captionLanguage:()=> 'zh'}));
jest.mock('../vlmShared',()=>({...jest.requireActual('../vlmShared'), getCategoryList:()=>[{id:'electronics',zh:'电子产品'},{id:'custom_rack',zh:'机柜',rule:'网络交换机机柜'},{id:'other',zh:'其他'}],prepareImageFile:async u=>u,cleanupTmp:jest.fn(async()=>{})}));
jest.mock('../../../adapters/WebAdapters',()=>({logger:{warn:jest.fn()}}));
import { runLfmClassification, parseLfmResult, lfmPrompt } from '../LfmClassifier';
import {initLlama} from 'llama.rn';
const categories=[{id:'electronics',zh:'电子产品'},{id:'custom_rack',zh:'机柜',rule:'网络交换机机柜'}];
beforeEach(()=>{jest.clearAllMocks();mockContext.completion.mockResolvedValue({text:'{"category":"custom_rack","description":"A network equipment rack in a room"}'});});
test('prompt includes all category meanings and custom rules',()=>{const p=lfmPrompt(categories,'zh');expect(p).toContain('网络交换机机柜');expect(p).toContain('电子设备');expect(p).toContain('机柜');});
test('strictly rejects unknown IDs and empty descriptions',()=>{expect(()=>parseLfmResult('{"category":"invented","description":"cat"}',categories)).toThrow();expect(()=>parseLfmResult('{"category":"electronics","description":""}',categories)).toThrow();});
test('one LFM context generates both category and description for every photo',async()=>{
 const save=jest.fn(async()=>({success:true})); const result=await runLfmClassification([{id:'a',uri:'a'},{id:'b',uri:'b'}],{save});
 expect(result.generated).toBe(2);expect(initLlama).toHaveBeenCalledTimes(1);expect(require('../EmbeddingGemmaClassifier').disposeEmbeddingGemma.mock.invocationCallOrder[0]).toBeLessThan(initLlama.mock.invocationCallOrder[0]);expect(mockContext.completion).toHaveBeenCalledTimes(2);expect(save).toHaveBeenCalledWith(expect.objectContaining({id:'a'}),expect.objectContaining({engine:'smolvlm',vlmLabel:'A network equipment rack in a room',topPrediction:{name:'custom_rack',appCategory:'custom_rack'}}));expect(mockContext.release).toHaveBeenCalledTimes(1);
});
test('invalid output is a retryable failure, never a guessed category',async()=>{mockContext.completion.mockResolvedValue({text:'{"category":"invented","description":"cat"}'});const save=jest.fn();const onFailure=jest.fn();const r=await runLfmClassification([{id:'a',uri:'a'}],{save,onFailure});expect(r.failed).toBe(1);expect(save).not.toHaveBeenCalled();expect(onFailure).toHaveBeenCalled();});

test('parses E2B two-line prompt output strictly without guessing invalid categories',()=>{
 expect(parseLfmResult('描述: 室内网络机柜\n分类: custom_rack',categories).topPrediction.appCategory).toBe('custom_rack');
 expect(parseLfmResult('A rack in a room\ncat: electronics',categories,'en').vlmLabel).toBe('A rack in a room');
 expect(()=>parseLfmResult('desc: a cat\ncat: unknown',categories)).toThrow();
});

test('maps exact natural category names to IDs and rejects ambiguous names',()=>{
 expect(parseLfmResult('{"description":"室内机柜","category":"机柜"}',categories).topPrediction.appCategory).toBe('custom_rack');
 const duplicates=[{id:'a',zh:'机柜'},{id:'b',zh:'机柜'}];expect(()=>parseLfmResult('{"description":"机柜","category":"机柜"}',duplicates)).toThrow();
});

test('language mismatch is retryable rather than saving an English caption for Chinese settings',()=>{
 expect(()=>parseLfmResult('{"category":"electronics","description":"A rack"}',categories,'zh')).toThrow(/language/);
});

test('replacement uses an English prompt even on a Chinese device',async()=>{
 await runLfmClassification([{id:'a',uri:'a'}],{save:async()=>({success:true})});
 expect(mockContext.completion.mock.calls[0][0].messages[0].content[0].text).toContain('English');
});
