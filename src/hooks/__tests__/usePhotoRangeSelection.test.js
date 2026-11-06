import React from 'react';
import renderer,{act} from 'react-test-renderer';
import usePhotoRangeSelection from '../usePhotoRangeSelection';
let api,selected,list;
function Harness(){api=usePhotoRangeSelection({ids:['a','b','c'],isSelected:id=>selected.has(id),setSelected:(id,value)=>value?selected.add(id):selected.delete(id),onChange:jest.fn(),listRef:{current:list}});return React.createElement('Selected',null,[...selected].sort().join(','));}
const event=(x,y)=>({nativeEvent:{pageX:x,pageY:y}});
beforeEach(()=>{jest.useFakeTimers();selected=new Set();list={scrollToOffset:jest.fn()};});
afterEach(()=>jest.useRealTimers());
function mount(){let tree;act(()=>{tree=renderer.create(<Harness/>);});api.containerProps.ref.current={measureInWindow:fn=>fn(0,0,300,300)};['a','b','c'].forEach((id,i)=>api.cellRef(id)({measureInWindow:fn=>fn(i*100,0,100,100)}));return tree;}
test('ordinary swipe does not capture; long press drag adds range and suppresses release tap',()=>{
 const tree=mount();expect(api.containerProps.onMoveShouldSetResponderCapture()).toBe(false);
 act(()=>api.start('a',event(50,50)));expect([...selected]).toEqual(['a']);
 expect(api.containerProps.onMoveShouldSetResponderCapture()).toBe(true);
 act(()=>api.containerProps.onResponderMove(event(250,50)));expect([...selected]).toEqual(['a','b','c']);
 act(()=>api.containerProps.onResponderMove(event(150,50)));expect([...selected]).toEqual(['a','b']);
 act(()=>api.stop());expect(api.shouldIgnorePress()).toBe(true);expect(api.active).toBe(false);
 act(()=>tree.unmount());expect(jest.getTimerCount()).toBe(0);
});
test('edge scrolling stops on reset and unmount',()=>{
 const tree=mount();api.listProps.onLayout({nativeEvent:{layout:{height:300}}});api.listProps.onContentSizeChange(300,900);
 act(()=>api.start('a',event(50,270)));act(()=>api.containerProps.onResponderMove(event(50,290)));act(()=>jest.advanceTimersByTime(160));expect(list.scrollToOffset).toHaveBeenCalled();
 act(()=>api.reset());list.scrollToOffset.mockClear();act(()=>jest.advanceTimersByTime(500));expect(list.scrollToOffset).not.toHaveBeenCalled();
 act(()=>tree.unmount());
});
test('selection toolbar layout shift must not expand a stationary long press',()=>{
 const tree=mount();
 api.cellRef('a')({measureInWindow:fn=>fn(0,100,100,100)});
 api.cellRef('b')({measureInWindow:fn=>fn(0,0,100,100)});
 act(()=>api.start('a',event(50,150)));
 // Entering selection adds toolbar height; another cell is now under the finger.
 api.cellRef('a')({measureInWindow:fn=>fn(0,200,100,100)});
 api.cellRef('b')({measureInWindow:fn=>fn(0,100,100,100)});
 act(()=>jest.advanceTimersByTime(160));
 expect([...selected]).toEqual(['a']);
 act(()=>tree.unmount());
});

test('same-size range on opposite side refreshes visible selection',()=>{
 const tree=mount();act(()=>api.start('b',event(150,50)));
 act(()=>api.containerProps.onResponderMove(event(50,50)));
 expect(tree.toJSON().children).toEqual(['a,b']);
 act(()=>api.containerProps.onResponderMove(event(250,50)));
 expect(tree.toJSON().children).toEqual(['b,c']);
 act(()=>tree.unmount());
});
