import {buildReclassificationChoices, resolveReclassificationChoice} from '../reclassificationChoice';
test('only downloaded models are selectable and retired models are absent',async()=>{
 const choices=await buildReclassificationChoices({isReady:async id=>['basic','embeddinggemma2'].includes(id),aiCfg:{active:'openai',providers:{openai:{model:'vision'}}},hasKey:async()=>false});
 expect(choices.filter(c=>c.available).map(c=>c.id)).toEqual(['embeddinggemma2','basic']);
 expect(choices.find(c=>c.id==='vlm').available).toBe(false);
 expect(choices.some(c=>['lfm','smolvlm'].includes(c.id))).toBe(false);
});
test('online choices require config/key and do not require changing default provider',async()=>{
 const cfg={active:'local-onnx',providers:{openai:{baseURL:'https://example.com',model:'vision',apiKeyRef:'key'}}};
 const choices=await buildReclassificationChoices({isReady:async()=>false,aiCfg:cfg,hasKey:async()=>true});
 const chosen=choices.find(c=>c.id==='online:openai');
 expect(chosen.available).toBe(true);
 const opts=resolveReclassificationChoice(chosen);
 expect(opts).toEqual({forceLocal:false,provider:'openai'});
 expect(cfg.active).toBe('local-onnx');
});
test('missing choices cannot silently run another engine',()=>{
 expect(()=>resolveReclassificationChoice({id:'vlm',available:false})).toThrow();
 expect(resolveReclassificationChoice({id:'scene',available:true})).toEqual({forceLocal:true,tier:'scene',strict:true});
});
test('default Ollama placeholder is not a configured online choice',async()=>{
 const aiCfg={active:'local-onnx',providers:{ollama:{model:'default',baseURL:'http://localhost:11434'}}};
 const get=cfg=>buildReclassificationChoices({isReady:async()=>false,aiCfg:cfg,hasKey:async()=>false});
 expect((await get(aiCfg)).find(c=>c.provider==='ollama')).toBeUndefined();
 expect((await get({...aiCfg,active:'ollama'})).find(c=>c.provider==='ollama')).toBeUndefined();
});
