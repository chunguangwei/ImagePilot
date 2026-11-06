import React from 'react';
import renderer, { act } from 'react-test-renderer';
import Screen from '../CustomCategoriesScreen.mobile';
import config from '../../../services/llm/adapters/UnifiedDataConfigService';
import Haptics from '../../../utils/haptics';
jest.mock('react-native', () => ({ View:'View', Text:'Text', TextInput:'Input', TouchableOpacity:'Button', ScrollView:'Scroll', ActivityIndicator:'Spinner', KeyboardAvoidingView:'Keyboard', Platform:{OS:'ios'}, StyleSheet:{create: v=>v}, Alert:{alert:jest.fn()} }));
jest.mock('react-i18next', () => ({useTranslation:()=>({t:k=>k,i18n:{language:'zh'}})}));
jest.mock('../../../adapters/WebAdapters', () => ({SafeAreaView:'Safe',Icon:'Icon'}));
jest.mock('../../../services/llm/adapters/UnifiedDataConfigService', () => ({getAIProviderConfig:jest.fn(),setCustomCategories:jest.fn(),setHiddenBuiltinCategories:jest.fn()}));
jest.mock('../../../services/ConfigService', () => ({isConfigLoaded:()=>true,getCategoryDisplayOrder:()=>[],getCategoryNameMap:()=>({})}));
jest.mock('../../../services/UnifiedDataService', () => ({}));
jest.mock('../../../components/shared/categoryUI', () => ({CUSTOM_ICON_PRESETS:[{key:'photo',icon:'photo'}],getCategoryIconMeta:()=>({})}));
jest.mock('../../../ui/ios/theme', () => ({useIosColors:()=>({})}));
jest.mock('../../../utils/haptics', () => ({notification:jest.fn()}));
const byText=(tree,key)=>tree.root.findAllByType('Button').find(b=>b.findAllByType('Text').some(t=>t.props.children===key));
async function mount(list=[]) {config.getAIProviderConfig.mockResolvedValue({customCategories:list});let tree;await act(async()=>{tree=renderer.create(<Screen navigation={{goBack:jest.fn()}}/>);});return tree;}
beforeEach(()=>jest.clearAllMocks());
test('failed creation retains input and does not announce success; retry commits and clears', async()=>{
 const tree=await mount();
 act(()=>{const inputs=tree.root.findAllByType('Input');inputs[0].props.onChangeText('office');inputs[1].props.onChangeText('Office');inputs[2].props.onChangeText('Office photos');});
 config.setCustomCategories.mockRejectedValueOnce(new Error('disk full'));
 await act(async()=>{await byText(tree,'customCategories.addBtn').props.onPress();});
 expect(tree.root.findAllByType('Input')[0].props.value).toBe('office');
 expect(Haptics.notification).not.toHaveBeenCalledWith('success');
 config.setCustomCategories.mockResolvedValueOnce();
 await act(async()=>{await byText(tree,'customCategories.addBtn').props.onPress();});
 expect(tree.root.findAllByType('Input')[0].props.value).toBe('');
 expect(Haptics.notification).toHaveBeenCalledWith('success');
});
test('failed edit leaves editor and draft open for retry',async()=>{
 const tree=await mount([{id:'office',name:'Office',rule:'Rooms',iconKey:'photo'}]);
 act(()=>byText(tree,'customCategories.edit').props.onPress());
 config.setCustomCategories.mockRejectedValueOnce(new Error('disk full'));
 await act(async()=>{await byText(tree,'common.save').props.onPress();});
 expect(byText(tree,'common.save')).toBeDefined();
 expect(tree.root.findAllByType('Input').some(i=>i.props.value==='Office')).toBe(true);
});
test('pending edit cannot be dismissed by its backdrop; failure retains the draft',async()=>{
 const tree=await mount([{id:'office',name:'Office',rule:'Rooms',iconKey:'photo'}]);
 act(()=>byText(tree,'customCategories.edit').props.onPress());
 let reject; config.setCustomCategories.mockImplementationOnce(()=>new Promise((_,r)=>{reject=r;}));
 let pending;
 act(()=>{pending=byText(tree,'common.save').props.onPress();});
 const backdrop=tree.root.findAllByType('Button').find(b=>b.props.activeOpacity===1);
 expect(backdrop.props.disabled).toBe(true);
 expect(byText(tree,'common.saving')).toBeDefined();
 await act(async()=>{reject(new Error('disk full'));await pending;});
 expect(byText(tree,'common.save')).toBeDefined();
});
test('editing preserves optional scenarios and exclusions when the details remain collapsed',async()=>{
 const category={id:'office',name:'Office',rule:'Original rule',iconKey:'photo',scenarios:['Network cabinet','Printer'],exclusions:'Plants'};
 const tree=await mount([category]);
 act(()=>byText(tree,'customCategories.edit').props.onPress());
 config.setCustomCategories.mockResolvedValueOnce();
 await act(async()=>{await byText(tree,'common.save').props.onPress();});
 expect(config.setCustomCategories).toHaveBeenCalledWith([category]);
});
