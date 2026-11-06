import {retryOtherVideoClassification,localResultCategory} from '../videoClassificationRetry';
const result=category=>({category});
const categoryOf=r=>r.category;
test('specific initial category never extracts more frames',async()=>{
 const classifyFrame=jest.fn();const first=result('pets');
 expect(await retryOtherVideoClassification(first,{categoryOf,classifyFrame})).toBe(first);
 expect(classifyFrame).not.toHaveBeenCalled();
});
test('Other requires two agreeing samples and stops early',async()=>{
 const classifyFrame=jest.fn().mockResolvedValue(result('electronics'));
 const r=await retryOtherVideoClassification(result('other'),{categoryOf,classifyFrame,random:()=>0.5});
 expect(r.category).toBe('electronics');expect(classifyFrame).toHaveBeenCalledTimes(2);
 expect(classifyFrame.mock.calls[0][0]).toBeCloseTo(0.225);expect(classifyFrame.mock.calls[1][0]).toBeCloseTo(0.725);
});
test('conflicting and failed frames keep original Other; bounded at three',async()=>{
 const first=result('other'),classifyFrame=jest.fn().mockResolvedValueOnce(result('pets')).mockRejectedValueOnce(new Error('decode')).mockResolvedValueOnce(result('plants'));
 expect(await retryOtherVideoClassification(first,{categoryOf,classifyFrame})).toBe(first);
 expect(classifyFrame).toHaveBeenCalledTimes(3);
});
test('stop prevents more inference and does not return a partial classification',async()=>{
 const classifyFrame=jest.fn();
 await expect(retryOtherVideoClassification(result('other'),{categoryOf,classifyFrame,shouldStop:()=>true})).rejects.toMatchObject({code:'CLASSIFICATION_CANCELLED'});
 expect(classifyFrame).not.toHaveBeenCalled();
});
test('rejected embeddings are Other even with a leading category',()=>{
 expect(localResultCategory({engine:'embeddinggemma2',classificationAccepted:false,topPrediction:{appCategory:'plants'},confidence:0.7})).toBe('other');
});
