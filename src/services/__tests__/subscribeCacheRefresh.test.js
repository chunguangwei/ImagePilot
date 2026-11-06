import {subscribeCacheRefresh} from '../subscribeCacheRefresh';
beforeEach(()=>jest.useFakeTimers());
afterEach(()=>jest.useRealTimers());
function setup(refresh=jest.fn(async()=>{})) {let emit;const remove=jest.fn();const off=subscribeCacheRefresh({addCacheListener:cb=>{emit=cb;return remove;}},refresh);return {emit,off,refresh,remove};}
async function tick(ms){jest.advanceTimersByTime(ms);await Promise.resolve();await Promise.resolve();}
test('continuous classification events cannot postpone refresh indefinitely',async()=>{
 const s=setup();s.emit();await tick(100);s.emit();await tick(100);s.emit();await tick(50);
 expect(s.refresh).toHaveBeenCalledTimes(1);s.off();
});
test('events during an async reload trigger one follow-up, not overlapping loads',async()=>{
 let done;const refresh=jest.fn().mockImplementationOnce(()=>new Promise(resolve=>{done=resolve;})).mockResolvedValue();
 const s=setup(refresh);s.emit();await tick(250);s.emit();s.emit();await tick(1000);
 expect(refresh).toHaveBeenCalledTimes(1);done();await tick(0);await tick(250);
 expect(refresh).toHaveBeenCalledTimes(2);s.off();
});
test('leaving a screen unsubscribes and cancels pending rendering',async()=>{
 const s=setup();s.emit();s.off();await tick(1000);expect(s.refresh).not.toHaveBeenCalled();expect(s.remove).toHaveBeenCalledTimes(1);
});
