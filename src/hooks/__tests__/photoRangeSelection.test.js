import {rangeSelection} from '../photoRangeSelection';
test('range crosses sections and shrinks back to original selections',()=>{
 const ids=['a','b','c','d','e'];const initial=new Set(['e']);
 expect([...rangeSelection(ids,initial,'b','d',true)].sort()).toEqual(['b','c','d','e']);
 expect([...rangeSelection(ids,initial,'b','b',true)].sort()).toEqual(['b','e']);
 expect([...rangeSelection(ids,initial,'d','a',true)].sort()).toEqual(ids);
});
test('drag from selected item deselects range without losing other selection',()=>{
 expect([...rangeSelection(['a','b','c','d'],new Set(['a','b','c','d']),'b','c',false)]).toEqual(['a','d']);
});
