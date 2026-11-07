// Isolated simulator fixture: exercises the production range-selection hook.
// Not imported by the app entry point; does not read or write the user's library.
import React,{useRef,useState,useCallback} from 'react';
import {AppRegistry,View,Text,FlatList,TouchableOpacity,RefreshControl} from 'react-native';
import usePhotoRangeSelection from '../src/hooks/usePhotoRangeSelection';
const ids=Array.from({length:120},(_,i)=>String(i));
const Tile=React.memo(function Tile({item,selected,cellRef,cellLayout,onPress,onLongPress}){
 return <TouchableOpacity ref={cellRef} onLayout={cellLayout}
  accessibilityRole="button" accessibilityLabel={'photo-'+item}
  onLongPress={e=>onLongPress(item,e)} onPress={onPress}
  style={{height:100,flex:1,margin:1,backgroundColor:selected?'#007AFF':'#C2D9CA'}}>
   <Text>{item}</Text>
 </TouchableOpacity>;
});
function Smoke(){
 const selected=useRef(new Set()),listRef=useRef(null);
 const [count,setCount]=useState(0),[offset,setOffset]=useState(0),[refreshes,setRefreshes]=useState(0);
 const range=usePhotoRangeSelection({ids,isSelected:id=>selected.current.has(id),
  setSelected:(id,value)=>value?selected.current.add(id):selected.current.delete(id),
  onChange:setCount,listRef,onRefresh:()=>setRefreshes(n=>n+1)});
 const latest=useRef(range);latest.current=range;
 const onPress=useCallback(()=>{if(!latest.current.shouldIgnorePress())setCount(-100);},[]);
 const onLongPress=useCallback((id,e)=>latest.current.start(id,e),[]);
 return <View style={{flex:1,paddingTop:70}}>
  <View style={{height:70}}>
   <Text testID="selection-count">{String(count)}</Text>
   <Text testID="scroll-offset">{String(Math.round(offset))}</Text>
   <Text testID="refresh-count">{String(refreshes)}</Text>
   <TouchableOpacity accessibilityLabel="Jump" onPress={()=>listRef.current.scrollToOffset({offset:800,animated:false})}><Text>Jump</Text></TouchableOpacity>
  </View>
  <View style={{flex:1}} {...range.containerProps}>
   <FlatList {...range.listProps} refreshing={false} ref={listRef} data={ids} numColumns={3}
    extraData={range.revision} keyExtractor={id=>id}
    onScroll={e=>{range.listProps.onScroll(e);setOffset(e.nativeEvent.contentOffset.y);}}
    refreshControl={<RefreshControl refreshing={false} enabled={!range.active} onRefresh={range.listProps.onRefresh}/>}
    renderItem={({item})=><Tile item={item} selected={selected.current.has(item)}
     cellRef={range.cellRef(item)} cellLayout={range.cellLayout(item)}
     onPress={onPress} onLongPress={onLongPress}/>}/>
  </View>
 </View>;
}
AppRegistry.registerComponent('imagepilot',()=>Smoke);
