import {CLASSIFIER_TIERS} from './classifierModelTiers';
import {isClassifierModelDownloaded,isLargeModelComplete} from './classifierModelSource';
import {readActiveVlmModel,readActiveClipModel} from './classifyByTier';
export async function isReclassificationModelReady(tier) {
  if(tier==='vlm') {
    const model=await readActiveVlmModel();
    for(const file of [model.model,model.mmproj].filter(Boolean)) {
      if(!await isLargeModelComplete(file.filename,file.bytes)) return false;
    }
    return true;
  }
  if(tier==='clip') return isClassifierModelDownloaded((await readActiveClipModel()).filename);
  const config=CLASSIFIER_TIERS[tier];
  if(!config?.readyForUse) return false;
  return config.bytes ? isLargeModelComplete(config.filename,config.bytes) : isClassifierModelDownloaded(config.filename);
}
export async function downloadReclassificationModel(tier,onProgress,signal) {
  const {ensureClassifierModel,ensureLargeModel}=require('./classifierModelSource');
  if(tier==='vlm') {
    const model=await readActiveVlmModel();
    for(const file of [model.model,model.mmproj].filter(Boolean)) await ensureLargeModel(file.filename,file.url,onProgress,{expectedBytes:file.bytes,signal});
    return;
  }
  const config=tier==='clip'?await readActiveClipModel():CLASSIFIER_TIERS[tier];
  if(!config) throw new Error('Unknown model');
  if(config.bytes) await ensureLargeModel(config.filename,config.url,onProgress,{expectedBytes:config.bytes,signal});
  else await ensureClassifierModel(config.filename,config.url,onProgress,{signal});
}
