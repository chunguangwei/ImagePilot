// Development-only isolated simulator experiment.
import React from 'react';import {AppRegistry,Text} from 'react-native';import RNFS from 'react-native-fs';
import {initLlama} from 'llama.rn';import {captionModelPaths} from '../src/services/classify/lfmCaptionModel';
import {getCategoryList,prepareImageFile,cleanupTmp} from '../src/services/classify/vlmShared';import {categoryDescription} from '../src/services/classify/categorySemantics';
import data from '../src/services/UnifiedDataService';
const root=RNFS.DocumentDirectoryPath;const report={records:[]};const save=()=>RNFS.writeFile(`${root}/smolvlm-choice.json`,JSON.stringify(report,null,2));
async function run(){let ctx;try{await data.initialize();const cats=getCategoryList();const paths=captionModelPaths();ctx=await initLlama({model:paths.model,n_ctx:4096,n_batch:256,n_threads:2,n_gpu_layers:0,use_mmap:true,ctx_shift:false});await ctx.initMultimodal({path:paths.projector,use_gpu:false});
 for(const name of ['rack','trophy','portrait','cat','food','group']){await ctx.clearCache(true);const tmp=await prepareImageFile(`file://${root}/${name}.jpg`,512);const t=Date.now();
 const cap=await ctx.completion({messages:[{role:'user',content:[{type:'image_url',image_url:{url:tmp}},{type:'text',text:'Describe the main visible subject in one short sentence. Do not read text.'}]}],n_predict:48,temperature:0,stop:['<end_of_utterance>','<|im_end|>','<|endoftext|>']});
 await ctx.clearCache(true);
 const cat=await ctx.completion({messages:[{role:'user',content:[{type:'image_url',image_url:{url:tmp}},{type:'text',text:`Which option best describes the main subject of this image? Choose one letter.\n${cats.map((c,i)=>`${String.fromCharCode(65+i)}. ${c.en || c.zh}: ${categoryDescription(c,'en')}`).join('\n')}\nAnswer:`}]}],grammar:`root ::= ${cats.map((c,i)=>JSON.stringify(String.fromCharCode(65+i))).join(' | ')}`,n_predict:4,temperature:0});
 report.records.push({name,caption:cap.text,category:cats[cat.text.trim().charCodeAt(0)-65]?.id,raw:cat.text,ms:Date.now()-t});await cleanupTmp(tmp);await save();}
 }catch(e){report.error=e.message;}finally{if(ctx)await ctx.release();report.done=true;await save();}}
AppRegistry.registerComponent('imagepilot',()=>()=> <Text>SmolVLM two step experiment</Text>);run();
