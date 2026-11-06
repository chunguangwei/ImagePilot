import React from 'react';
import renderer,{act} from 'react-test-renderer';
import SearchScreen from '../SearchScreen.mobile';
import data from '../../../services/UnifiedDataService';
jest.mock('react-native',()=>({View:'View',Text:'Text',TextInput:'TextInput',TouchableOpacity:'Button',FlatList:'FlatList',Image:'Image',ActivityIndicator:'Spinner',StyleSheet:{create:x=>x},NativeModules:{},Keyboard:{dismiss:jest.fn()},Platform:{OS:'ios'},Alert:{alert:jest.fn()},useWindowDimensions:()=>({width:390})}));
jest.mock('../../../adapters/WebAdapters',()=>({SafeAreaView:'SafeAreaView',Icon:'Icon',getUri:x=>x.uri,logger:{warn:jest.fn()}}));
jest.mock('react-i18next',()=>({useTranslation:()=>({t:k=>k})}));
jest.mock('../../../ui/ios/theme',()=>({useIosColors:()=>({})}));
jest.mock('../../../components/shared/categoryUI',()=>({formatDuration:()=>''}));
jest.mock('../../../components/shared/CategoryPickerOverlay',()=> 'Picker');
jest.mock('../../../components/shared/VIcon',()=> 'Icon');
jest.mock('../../../services/UnifiedDataService',()=>({__esModule:true,default:{searchImages:jest.fn(),searchBySemanticText:jest.fn()}}));
jest.mock('../../../services/llm/queryRewrite',()=>({isRewriteAvailable:jest.fn(async()=>false)}));
let tree;
beforeEach(()=>{jest.useFakeTimers();jest.clearAllMocks();});
afterEach(()=>{if(tree)act(()=>tree.unmount());jest.useRealTimers();});
const type=text=>act(()=>tree.root.findByType('TextInput').props.onChangeText(text));
const flush=()=>act(async()=>{await Promise.resolve();});
test('a slower old response cannot overwrite newer search results',async()=>{
 let oldResolve,newResolve;
 data.searchImages.mockImplementationOnce(()=>new Promise(r=>{oldResolve=r;})).mockImplementationOnce(()=>new Promise(r=>{newResolve=r;}));
 act(()=>{tree=renderer.create(<SearchScreen navigation={{goBack:jest.fn()}}/>);});await flush();
 type('old');act(()=>jest.advanceTimersByTime(300));
 type('new');act(()=>jest.advanceTimersByTime(300));
 await act(async()=>{newResolve({results:[{id:'new',uri:'new'}]});});
 await act(async()=>{oldResolve({results:[{id:'old',uri:'old'}]});});
 expect(tree.root.findByType('FlatList').props.data.map(x=>x.id)).toEqual(['new']);
});
test('clearing the input invalidates pending results and ends loading',async()=>{
 let resolve;data.searchImages.mockImplementation(()=>new Promise(r=>{resolve=r;}));
 act(()=>{tree=renderer.create(<SearchScreen navigation={{goBack:jest.fn()}}/>);});await flush();
 type('old');act(()=>jest.advanceTimersByTime(300));type('');
 await act(async()=>resolve({results:[{id:'old',uri:'old'}]}));
 expect(tree.root.findAllByType('Spinner')).toHaveLength(0);
 expect(tree.root.findAllByType('FlatList')).toHaveLength(0);
});
test('search failures show retry feedback rather than an empty successful search',async()=>{
 data.searchImages.mockRejectedValue(new Error('DB unavailable'));
 act(()=>{tree=renderer.create(<SearchScreen navigation={{goBack:jest.fn()}}/>);});await flush();
 type('cat');await act(async()=>jest.advanceTimersByTime(300));
 expect(JSON.stringify(tree.toJSON())).toContain('search.failedRetry');
 expect(JSON.stringify(tree.toJSON())).toContain('common.retry');
});

test('changing query clears selections from the previous result set', async()=>{
 data.searchImages.mockResolvedValue({results:[{id:'cat',uri:'cat'}]});
 act(()=>{tree=renderer.create(<SearchScreen navigation={{goBack:jest.fn()}}/>);});await flush();
 type('cat');await act(async()=>jest.advanceTimersByTime(300));
 const list=tree.root.findByType('FlatList');
 const tile=list.props.renderItem({item:{id:'cat',uri:'cat'},index:0});
 act(()=>tile.props.onLongPress());
 expect(tree.root.findAllByType('Text').some(n=>n.props.children === 'search.selectedCount')).toBe(true);
 type('dog');
 expect(tree.root.findAllByType('Text').some(n=>n.props.children === 'search.selectedCount')).toBe(false);
});
