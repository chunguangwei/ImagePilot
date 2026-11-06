import {useRef,useState,useEffect} from 'react';
import {rangeSelection} from './photoRangeSelection';

// Long press then drag. Ordinary vertical swipes keep scrolling the gallery.
export default function usePhotoRangeSelection({ids,isSelected,setSelected,onChange,listRef}) {
  const latest=useRef();latest.current={ids,isSelected,setSelected,onChange};
  const nodes=useRef(new Map()),rects=useRef(new Map()),gesture=useRef(null);
  const viewport=useRef(null),bounds=useRef(null),scroll=useRef({offset:0,height:0,content:0});
  const pointer=useRef(null),timer=useRef(null),suppress=useRef(0),epoch=useRef(0);
  const [active,setActive]=useState(false);
  const measure=()=>{
    const token=epoch.current;
    viewport.current?.measureInWindow((x,y,width,height)=>{if(token===epoch.current)bounds.current={x,y,width,height};});
    nodes.current.forEach((node,id)=>node?.measureInWindow?.((x,y,width,height)=>{
      if(token===epoch.current&&nodes.current.get(id)===node)rects.current.set(id,{x,y,width,height});
    }));
  };
  const apply=end=>{
    const g=gesture.current;if(!g||g.end===end)return;g.end=end;
    const {ids:current,isSelected:has,setSelected:set,onChange:change}=latest.current;
    const selected=rangeSelection(g.ids,g.initial,g.anchor,end,g.selecting);
    current.forEach(id=>{if(has(id)!==selected.has(id))set(id,selected.has(id));});
    change(current.filter(id=>selected.has(id)).length);
  };
  const hit=()=>{
    const p=pointer.current,b=bounds.current;if(!p||!b)return;
    const y=Math.max(b.y+2,Math.min(p.y,b.y+b.height-2));
    for(const [id,r] of rects.current){
      if(r.width>0&&r.height>0&&p.x>=r.x&&p.x<=r.x+r.width&&y>=r.y&&y<=r.y+r.height){apply(id);break;}
    }
  };
  const stop=()=>{
    if(gesture.current)suppress.current=Date.now()+400;
    gesture.current=null;pointer.current=null;clearInterval(timer.current);timer.current=null;setActive(false);
  };
  const reset=()=>{stop();epoch.current++;rects.current.clear();};
  useEffect(()=>()=>{clearInterval(timer.current);epoch.current++;gesture.current=null;},[]);
  const start=(id,event)=>{
    stop();const api=latest.current;
    const initial=new Set(api.ids.filter(api.isSelected));
    gesture.current={ids:[...api.ids],initial,anchor:id,selecting:!initial.has(id),end:null};
    const e=event?.nativeEvent;if(e)pointer.current={x:e.pageX,y:e.pageY};
    setActive(true);measure();apply(id);
    timer.current=setInterval(()=>{
      if(!gesture.current)return;
      const b=bounds.current,p=pointer.current,s=scroll.current;
      if(b&&p){
        const direction=p.y<b.y+48?-1:p.y>b.y+b.height-48?1:0;
        const next=Math.max(0,Math.min(Math.max(0,s.content-s.height),s.offset+direction*24));
        if(next!==s.offset){listRef.current?.scrollToOffset({offset:next,animated:false});}
      }
      measure();hit();
    },80);
  };
  return {active,start,reset,stop,shouldIgnorePress:()=>!!gesture.current||Date.now()<suppress.current,
    cellRef:id=>node=>{if(node)nodes.current.set(id,node);else{nodes.current.delete(id);rects.current.delete(id);}},
    containerProps:{ref:viewport,onLayout:measure,
      onMoveShouldSetResponderCapture:()=>!!gesture.current,
      onResponderMove:e=>{pointer.current={x:e.nativeEvent.pageX,y:e.nativeEvent.pageY};hit();},
      onResponderRelease:stop,onResponderTerminate:stop,onResponderTerminationRequest:()=>false,
      onTouchEnd:stop,onTouchCancel:stop},
    listProps:{scrollEnabled:!active,scrollEventThrottle:16,
      onScroll:e=>{scroll.current.offset=e.nativeEvent.contentOffset.y;if(gesture.current)measure();},
      onLayout:e=>{scroll.current.height=e.nativeEvent.layout.height;measure();},
      onContentSizeChange:(_,height)=>{scroll.current.content=height;}},
  };
}
