// Isolated native evaluation. Requires model and fixture JPEGs in the simulator Documents folder.
import React from 'react';
import {AppRegistry,Text,NativeModules} from 'react-native';
import RNFS from 'react-native-fs';
import config from '../src/services/ConfigService';
import {getCategoryList,prepareImageFile,cleanupTmp} from '../src/services/classify/vlmShared';
import {categoryEmbeddingGroups} from '../src/services/classify/categorySemantics';
import {rankGroupedEvidence,groupedDecision} from '../src/services/classify/embeddingGroups';
import {classifyWithEmbeddingGemma,disposeEmbeddingGemma} from '../src/services/classify/EmbeddingGemmaClassifier';
const root=RNFS.DocumentDirectoryPath, report={started:Date.now(),images:[]};
const save=()=>RNFS.writeFile(`${root}/embedding-grouped-result.json`,JSON.stringify(report,null,2));
const norm=v=>{const n=Math.hypot(...v);return v.map(x=>x/n);};
async function run(){
 try{
  await config.initialize();const cats=getCategoryList();const mod=NativeModules.LiteRTLMModule;
  const model=`${root}/classify_models/embeddinggemma-2-text-vision-440m.litertlm`;
  const groups=[];let count=0;
  for(const cat of cats){
   const encoded=[];
   for(const group of categoryEmbeddingGroups(cat)){
    const vectors=[];
    for(const text of group.texts){vectors.push(norm(await mod.embed(model,`task: classification | query: ${text}`,'')));count++;}
    encoded.push({...group,vectors});
   }
   groups.push(encoded);report.encodedCategories=groups.length;report.textCalls=count;await save();
  }
  report.referenceMs=Date.now()-report.started;
  for(const [name,expected] of [['user-rack','electronics'],['rack','electronics'],['trophy','art'],['portrait','single_person'],['cat','pets'],['food','foods'],['group','social_activities']]){
   const path=await prepareImageFile(`file://${root}/${name}.jpg`);
   try{
    const v=norm(await mod.embed(model,'',path));const rankings=rankGroupedEvidence(v,cats,groups);
    report.images.push({name,expected,top:rankings[0].appCategory,...groupedDecision(rankings,.005),rankings});await save();
   }finally{await cleanupTmp(path);}
  }
  await mod.release();
  for(const row of report.images){const result=await classifyWithEmbeddingGemma(`file://${root}/${row.name}.jpg`,model);row.current={category:result.topPrediction?.appCategory||null,top:result.predictions[0]?.appCategory,accepted:result.classificationAccepted,margin:result.margin,reason:result.rejectionReason,method:result.diagnostics.decisionMethod,processingTime:result.processingTime};await save();}
  await disposeEmbeddingGemma();
 }catch(e){report.error=e.message;report.stack=e.stack;}
 report.done=true;report.elapsedMs=Date.now()-report.started;await save();
}
AppRegistry.registerComponent('imagepilot',()=>()=> <Text>Grouped category evaluation</Text>);run();
