/** Coalesce cache events without starving UI during a continuous fast scan. */
export function subscribeCacheRefresh(data, refresh, delay = 250, onError = () => {}) {
  let timer = null;
  let active = true;
  let running = false;
  let dirty = false;
  const schedule = () => {
    dirty = true;
    if (!active || timer !== null || running) return;
    timer = setTimeout(async () => {
      timer = null;
      if (!active) return;
      dirty = false;
      running = true;
      try { await refresh(); } catch (error) { onError(error); }
      finally {
        running = false;
        if (active && dirty) schedule();
      }
    }, delay);
  };
  const unsubscribe = data.addCacheListener(schedule);
  return () => { active = false; unsubscribe(); if (timer !== null) clearTimeout(timer); };
}
