jest.mock('../../llm/LLMProviderService',()=>({LLMProviderService:jest.fn()}));
jest.mock('../../llm/adapters/UnifiedDataConfigService',()=>({}));
jest.mock('../../llm/keyStoreSingleton',()=>({}));
jest.mock('../../LocalClassifierService',()=>({}));
jest.mock('../../llm/adapters/localOnnxRunner',()=>({}));
jest.mock('../../../i18n',()=>({language:'zh'}));
jest.mock('../../../adapters/WebAdapters',()=>({logger:{}}));
jest.mock('../../ConfigService',()=>({getAllCategoriesWithUI:()=>[{id:'travel_scenery',chinese:'旅行风景',english:'Travel Scenery'},{id:'plants',chinese:'植物',english:'Plants'},{id:'NA'},{id:'NA_video'}]}));
import {buildTaxonomy} from '../../llm/llmClassifyOrchestrator';
test('online taxonomy receives builtin overrides, matching details and original custom rules',()=>{
 const rows=buildTaxonomy({builtinCategoryRules:{travel_scenery:{rule:'整体风景主体',scenarios:['公园'],exclusions:'人物写真'}},customCategories:[{id:'youth',name:'少年',rule:'少年单人照'}]},'zh');
 expect(rows.map(x=>x.id)).toEqual(['travel_scenery','plants','youth']);
 expect(rows[0].rule).toContain('整体风景主体');expect(rows[0].rule).toContain('公园');expect(rows[0].rule).toContain('人物写真');
 expect(rows[1].rule).toContain('植物');expect(rows[2].rule).toBe('少年单人照');
});
