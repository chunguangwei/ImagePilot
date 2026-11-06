// Development-only native A/B probe; fixture images and model must already exist in the isolated simulator.
import React from 'react';
import {AppRegistry,Text,NativeModules} from 'react-native';
import RNFS from 'react-native-fs';
import {getCategoryList,prepareImageFile,cleanupTmp} from '../src/services/classify/vlmShared';
import {categoryText,categoryEmbeddingTexts} from '../src/services/classify/categorySemantics';
import {classifyWithEmbeddingGemma,disposeEmbeddingGemma} from '../src/services/classify/EmbeddingGemmaClassifier';
import config from '../src/services/ConfigService';
const root=RNFS.DocumentDirectoryPath;
const report={started:Date.now(),images:[]};
const norm=v=>{const n=Math.hypot(...v);return v.map(x=>x/n);};
const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
async function run(){
 try{
  await config.initialize();
  const cats=getCategoryList();report.categories=cats.map(c=>c.id);
  const model=`${root}/classify_models/embeddinggemma-2-text-vision-440m.litertlm`;
  const mod=NativeModules.LiteRTLMModule;
  const references=[];
  for(const c of cats){
   const texts=categoryEmbeddingTexts(c);const vectors=[];
   for(const text of texts) vectors.push(norm(await mod.embed(model,`task: classification | query: ${text}`,'')));
   references.push({id:c.id,texts,vectors});
  }
  report.referenceMs=Date.now()-report.started;
  for(const name of ['rack','trophy','portrait','cat','food','group']){
   const path=await prepareImageFile(`file://${root}/${name}.jpg`);
   const started=Date.now();const v=norm(await mod.embed(model,'',path));
   const baseline=references.map(r=>({id:r.id,score:r.id==='electronics'?Math.max(dot(v,r.vectors[0]),dot(v,r.vectors[1])):dot(v,r.vectors[0])})).sort((a,b)=>b.score-a.score);
   const maximum=references.map(r=>({id:r.id,score:Math.max(...r.vectors.map(x=>dot(v,x)))})).sort((a,b)=>b.score-a.score);
   const centroid=references.map(r=>({id:r.id,score:dot(v,norm(r.vectors[0].map((_,i)=>r.vectors.reduce((sum,x)=>sum+x[i],0))))})).sort((a,b)=>b.score-a.score);
   const topTwo=references.map(r=>{const scores=r.vectors.map(x=>dot(v,x)).sort((a,b)=>b-a);return{id:r.id,score:scores.slice(0,2).reduce((a,b)=>a+b,0)/Math.min(2,scores.length)};}).sort((a,b)=>b.score-a.score);
   report.images.push({name,baseline:baseline.slice(0,5),maximum:maximum.slice(0,5),centroid:centroid.slice(0,5),topTwo:topTwo.slice(0,5),imageMs:Date.now()-started});
   await cleanupTmp(path);await RNFS.writeFile(`${root}/embedding-prototypes-result.json`,JSON.stringify(report,null,2));
  }
  await mod.release();
  report.production=[];
  for(const name of ['rack','trophy','portrait','cat','food','group']){
    const result=await classifyWithEmbeddingGemma(`file://${root}/${name}.jpg`,model);
    report.production.push({name,category:result.topPrediction?.appCategory,accepted:result.classificationAccepted,margin:result.margin,scoringVersion:result.scoringVersion});
  }
  await disposeEmbeddingGemma();
 }catch(e){report.error=e.message;report.stack=e.stack;}
 report.done=true;report.elapsedMs=Date.now()-report.started;
 await RNFS.writeFile(`${root}/embedding-prototypes-result.json`,JSON.stringify(report,null,2));
}
AppRegistry.registerComponent('imagepilot',()=>()=> <Text>Embedding prototypes A/B test</Text>);run();
