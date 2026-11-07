import React from 'react';
import renderer,{act} from 'react-test-renderer';
import usePhotoRangeSelection from '../usePhotoRangeSelection';
let api,selected,list;
const ids=['a','b','c'];
function Harness(){api=usePhotoRangeSelection({ids,isSelected:id=>selected.has(id),setSelected:(id,value)=>value?selected.add(id):selected.delete(id),onChange:jest.fn(),listRef:{current:list}});return React.createElement('Selected',null,[...selected].sort().join(','));}
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

test('keeps refresh callback installed during a gesture and blocks refresh until release',()=>{
 const tree=mount();
 const refresh=api.listProps.onRefresh;
 expect(typeof refresh).toBe('function');
 act(()=>api.start('a',event(50,50)));
 expect(api.listProps.onRefresh).toBe(refresh);
 act(()=>api.stop());
 expect(api.listProps.onRefresh).toBe(refresh);
 act(()=>tree.unmount());
});
test('the movement that captures the responder already extends selection',()=>{
 const tree=mount();act(()=>api.start('a',event(50,50)));
 act(()=>api.containerProps.onMoveShouldSetResponderCapture(event(250,50)));
 expect([...selected]).toEqual(['a','b','c']);
 act(()=>tree.unmount());
});
test('missing touch coordinates never select a top row or trigger scrolling',()=>{
 const tree=mount();act(()=>api.start('b',event(150,50)));
 act(()=>api.containerProps.onResponderMove({nativeEvent:{}}));
 expect([...selected]).toEqual(['b']);
 act(()=>api.containerProps.onResponderMove(event(250,50)));
 expect([...selected]).toEqual(['b','c']);
 act(()=>tree.unmount());
});
test('cell refs remain stable across selection renders',()=>{
 const tree=mount();const ref=api.cellRef('a');
 act(()=>api.start('a',event(50,50)));
 expect(api.cellRef('a')).toBe(ref);
 act(()=>tree.unmount());
});
test('stationary selection does not remeasure all photos on every frame',()=>{
 const tree=mount();const measure=jest.fn(fn=>fn(0,0,100,100));
 api.cellRef('a')({measureInWindow:measure});
 act(()=>api.start('a',event(50,50)));measure.mockClear();
 act(()=>jest.advanceTimersByTime(240));
 expect(measure).not.toHaveBeenCalled();
 act(()=>tree.unmount());
});

test('uses root coordinates instead of window coordinates below Android status bars',()=>{
 const tree=mount();
 api.containerProps.ref.current={measure:fn=>fn(0,0,300,300,0,0),measureInWindow:fn=>fn(0,24,300,300)};
 api.cellRef('c')({measure:fn=>fn(0,0,100,100,200,0),measureInWindow:fn=>fn(200,24,100,100)});
 act(()=>api.start('a',event(50,10)));
 act(()=>api.containerProps.onResponderMove(event(250,10)));
 expect([...selected]).toEqual(['a','b','c']);
 act(()=>tree.unmount());
});
test('scroll events move hit testing without remeasuring every mounted thumbnail',()=>{
 const tree=mount();
 api.listProps.onScroll({nativeEvent:{contentOffset:{y:200}}});
 const measured=jest.fn(fn=>fn(0,150,100,100));
 api.cellRef('c')({measureInWindow:measured});
 act(()=>api.start('a',event(50,50)));measured.mockClear();
 act(()=>api.containerProps.onResponderMove(event(50,100)));
 act(()=>api.listProps.onScroll({nativeEvent:{contentOffset:{y:300}}}));
 expect([...selected]).toEqual(['a','b','c']);
 expect(measured).not.toHaveBeenCalled();
 act(()=>tree.unmount());
});
test('shrinking a deselection range restores the original selection',()=>{
 const tree=mount();selected=new Set(['a','b','c']);
 act(()=>api.start('a',event(50,50)));
 act(()=>api.containerProps.onResponderMove(event(250,50)));
 expect([...selected]).toEqual([]);
 act(()=>api.containerProps.onResponderMove(event(150,50)));
 expect([...selected]).toEqual(['c']);
 act(()=>tree.unmount());
});
