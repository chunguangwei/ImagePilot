// A gesture is a range over the visual order, relative to its initial selection.
export function rangeSelection(ids, initial, anchor, end, selecting) {
  const result=new Set(initial), a=ids.indexOf(anchor), b=ids.indexOf(end);
  if(a<0||b<0)return result;
  for(let i=Math.min(a,b);i<=Math.max(a,b);i++) selecting?result.add(ids[i]):result.delete(ids[i]);
  return result;
}
