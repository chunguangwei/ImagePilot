jest.mock('../LfmCaptionService',()=>({ runCaptionPass: jest.fn() }));
jest.mock('../EmbeddingGemmaClassifier',()=>({disposeEmbeddingGemma: jest.fn(async()=>{})}));
jest.mock('../classifyByTier',()=>({ classifyImageByTier: jest.fn(async()=>({success:true,engine:'embeddinggemma2',classificationAccepted:true,classificationMode:'image-caption',topPrediction:{appCategory:'electronics'}})) }));
const {runCaptionFirstPass}=require('../captionFirstPass');
const {runCaptionPass}=require('../LfmCaptionService');
const {classifyImageByTier}=require('../classifyByTier');
const {pendingCaptions}=require('../captionQueue');
let db, events;
const image=(id,extra={})=>({id,uri:`file://${id}`,category:'NA',...extra});
function options(extra={}) {return {config:{enabled:true},resolveImage:async i=>({uri:i.uri}),save:async rows=>{for(const r of rows)db[r.id]={...db[r.id],...r};return {success:true,updatedCount:rows.length};},...extra};}
beforeEach(()=>{jest.clearAllMocks();db={};events=[];runCaptionPass.mockImplementation(async(images,o)=>{for(const i of images){events.push('caption');await o.save(i,'室内网络机柜。');}return {generated:images.length,failed:0,stopped:false};});});
test('saves short descriptions before classification and passes them with the original image',async()=>{
 classifyImageByTier.mockImplementationOnce(async(uri,tier,opts)=>{expect(db.a.message).toBe('室内网络机柜。');expect(opts.caption).toBe('室内网络机柜。');events.push('classify');return {success:true,engine:'embeddinggemma2',classificationAccepted:true,topPrediction:{appCategory:'electronics'}};});
 await runCaptionFirstPass([image('a')],options());
 expect(events).toEqual(['caption','classify']);expect(db.a.category).toBe('electronics');
});
test('stop after caption preserves a resumable classification without repeating caption generation',async()=>{
 let stop=false;const original=runCaptionPass.getMockImplementation();runCaptionPass.mockImplementationOnce(async(...args)=>{const r=await original(...args);stop=true;return {...r,stopped:true};});
 await runCaptionFirstPass([image('a',{category:'art'})],options({shouldStop:()=>stop}));
 expect(classifyImageByTier).not.toHaveBeenCalled();expect(pendingCaptions([db.a])).toHaveLength(1);
 stop=false;await runCaptionFirstPass([db.a],options());
 expect(runCaptionPass).toHaveBeenCalledTimes(1);expect(db.a.category).toBe('electronics');
});
test('caption failure falls back to image classification and remains retryable',async()=>{
 runCaptionPass.mockImplementationOnce(async(images,o)=>{await o.onFailure(images[0],{stage:'inference',error:'failed'});return {generated:0,failed:1};});
 await runCaptionFirstPass([image('a')],options());
 expect(classifyImageByTier.mock.calls[0][2].caption).toBe('');expect(db.a.category).toBe('electronics');expect(pendingCaptions([db.a])).toHaveLength(1);
});
test('manual text is preserved and is not used as generated visual evidence',async()=>{
 db.a=image('a',{message:'2020年的回忆'});
 await runCaptionFirstPass([db.a],options());
 expect(db.a.message).toBe('2020年的回忆');expect(classifyImageByTier.mock.calls[0][2].caption).toBe('室内网络机柜。');
});
test('disabled cannot initialize either model through the caption-first path',async()=>{
 await runCaptionFirstPass([image('a')],options({config:{enabled:false}}));
 expect(runCaptionPass).not.toHaveBeenCalled();expect(classifyImageByTier).not.toHaveBeenCalled();
});

test('joint failure keeps image fallback but leaves fusion retryable without repeating description',async()=>{
 classifyImageByTier.mockResolvedValueOnce({success:true,engine:'embeddinggemma2',classificationAccepted:true,classificationMode:'image',fusionError:'temporary native error',topPrediction:{appCategory:'electronics'}});
 const result=await runCaptionFirstPass([image('a')],options());
 expect(db.a.category).toBe('electronics');expect(result.fusionFailed).toBe(1);expect(pendingCaptions([db.a])).toHaveLength(1);
 await runCaptionFirstPass([db.a],options());expect(runCaptionPass).toHaveBeenCalledTimes(1);
});
