jest.mock('../../UnifiedDataService',()=>({}));
jest.mock('../../../adapters/WebAdapters',()=>({logger:{debug:jest.fn()},Platform:{OS:'ios'}}));
import {UnifiedDataConfigService} from '../../llm/adapters/UnifiedDataConfigService';
import config from '../../ConfigService';
import {normalizeBuiltinCategoryRules} from '../builtinCategoryRules';
import {categoryEmbeddingGroups,categoryMatchingRule} from '../categorySemantics';
import {mergeScannerRecords} from '../mergeScannerRecord';

test('accepts only editable builtin IDs and normalizes rules without changing custom categories',()=>{
 expect(normalizeBuiltinCategoryRules({travel_scenery:{rule:'  景观主体  ',scenarios:'湖泊\n湖泊',exclusions:' 人物特写 '},NA:{rule:'x'},other:{rule:'x'},youth:{rule:'x'},plants:{rule:' '}}))
 .toEqual({travel_scenery:{rule:'景观主体',scenarios:['湖泊'],exclusions:'人物特写'}});
});
test('saving and restoring a builtin rule touches settings only and preserves legacy settings',async()=>{
 const legacy={language:'zh',aiProvider:{customCategories:[{id:'youth',name:'少年',rule:'少年照'}],hiddenBuiltinCategories:['foods'],providers:{custom:{model:'x'}}},oldSetting:42};
 let settings=JSON.parse(JSON.stringify(legacy));const data={readSettings:jest.fn(async()=>settings),writeSettings:jest.fn(async s=>{settings=s;})};
 const service=new UnifiedDataConfigService(data);
 await service.setBuiltinCategoryRule('travel_scenery',{rule:'景观为主体',exclusions:'人物特写'});
 expect(settings.aiProvider.builtinCategoryRules.travel_scenery.rule).toBe('景观为主体');
 expect(settings.aiProvider.customCategories).toEqual(legacy.aiProvider.customCategories);
 expect(settings.aiProvider.providers).toEqual(legacy.aiProvider.providers);
 await service.setBuiltinCategoryRule('plants',{rule:'植物特写'});
 await service.setBuiltinCategoryRule('travel_scenery',null);
 expect(settings.aiProvider.builtinCategoryRules).toEqual({plants:{rule:'植物特写',scenarios:[],exclusions:''}});
 expect(settings.oldSetting).toBe(42);
});
test('builtin overrides feed local matching and reset restores builtin subtypes',()=>{
 config.setCustomCategories([{id:'youth',name:'少年',rule:'少年照'}]);
 config.setBuiltinCategoryRules({travel_scenery:{rule:'景观主体',scenarios:['公园'],exclusions:'人物特写'}});
 expect(config.getCustomCategoryRules()).toEqual({youth:'少年照',travel_scenery:'景观主体'});
 const cat={id:'travel_scenery',en:'Travel Scenery',rule:config.getCustomCategoryRules().travel_scenery,...config.getCustomCategoryMatching().travel_scenery};
 expect(categoryEmbeddingGroups(cat)[0].texts[0]).toContain('景观主体');
 expect(categoryMatchingRule(cat)).toContain('人物特写');
 config.setBuiltinCategoryRules({});
 expect(config.getCustomCategoryRules()).toEqual({youth:'少年照'});
 expect(categoryEmbeddingGroups({id:'travel_scenery',en:'Travel Scenery'}).length).toBeGreaterThan(1);
});
test('legacy classified photos keep categories and descriptions across a rescan with new rules',()=>{
 const existing=['travel_scenery','single_person','other','youth'].map((category,id)=>({id:String(id),category,message:'旧描述',confidence:.8,mobileNetV3Detections:{old:true}}));
 const fresh=existing.map(x=>({id:x.id,category:'NA',message:'',confidence:0}));
 const merged=mergeScannerRecords(fresh,existing);
 merged.forEach((x,i)=>expect(x).toMatchObject(existing[i]));
});
test('restoring optional builtin rules preserves local overrides and accepts old backups without rules',async()=>{
 let settings={aiProvider:{builtinCategoryRules:{plants:{rule:'已有规则',scenarios:[],exclusions:''}},customCategories:[]}};
 const service=new UnifiedDataConfigService({readSettings:async()=>settings,writeSettings:async s=>{settings=s;}});
 await service.mergeBuiltinCategoryRules(undefined);
 expect(settings.aiProvider.builtinCategoryRules.plants.rule).toBe('已有规则');
 await service.mergeBuiltinCategoryRules({plants:{rule:'备份旧规则'},travel_scenery:{rule:'风景主体'}});
 expect(settings.aiProvider.builtinCategoryRules.plants.rule).toBe('已有规则');
 expect(settings.aiProvider.builtinCategoryRules.travel_scenery.rule).toBe('风景主体');
});
