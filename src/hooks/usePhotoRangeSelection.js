import {useCallback, useEffect, useRef, useState} from 'react';

const EDGE = 56;
const MAX_SPEED = 480; // points/second; ramp up as the finger approaches an edge
const touchPoint = event => {
  const e = event?.nativeEvent;
  const touch = e?.touches?.[0] || e;
  return Number.isFinite(touch?.pageX) && Number.isFinite(touch?.pageY)
    ? {x: touch.pageX, y: touch.pageY} : null;
};

// Use root coordinates, matching PressEvent.pageX/pageY on BOTH platforms.
// measureInWindow differs from root coordinates when Android has a status bar.
const measureNode = (node, callback) => {
  if (node?.measure) node.measure((_x, _y, width, height, x, y) => callback(x, y, width, height));
  else node?.measureInWindow?.(callback);
};

export default function usePhotoRangeSelection({
  ids, isSelected, setSelected, onChange, listRef, onRefresh, bottomInset = 0,
}) {
  const latest = useRef();
  latest.current = {ids, isSelected, setSelected, onChange, listRef, onRefresh, bottomInset};
  const nodes = useRef(new Map()), rects = useRef(new Map()), refs = useRef(new Map());
  const layouts = useRef(new Map());
  const viewport = useRef(null), bounds = useRef(null), gesture = useRef(null);
  const scroll = useRef({offset: 0, height: 0, content: 0});
  const pointer = useRef(null), frame = useRef(null), epoch = useRef(0), suppress = useRef(0);
  const hitRef = useRef(() => {}), dirty = useRef(new Set());
  const [active, setActive] = useState(false);
  const [revision, setRevision] = useState(0);

  const measureCell = useCallback(id => {
    const node = nodes.current.get(id), token = epoch.current, offset = scroll.current.offset;
    measureNode(node, (x, y, width, height) => {
      if (token !== epoch.current || nodes.current.get(id) !== node) return;
      if (offset !== scroll.current.offset) { dirty.current.add(id); return; }
      if (width > 0 && height > 0 && Number.isFinite(x) && Number.isFinite(y)) {
        // Cache in content coordinates so scrolling needs no bridge measurement.
        rects.current.set(id, {x, y: y + offset, width, height});
        hitRef.current();
      }
    });
  }, []);

  const measure = useCallback(() => {
    const token = epoch.current;
    measureNode(viewport.current, (x, y, width, height) => {
      if (token === epoch.current && width > 0 && height > 0) {
        bounds.current = {x, y, width, height};
        hitRef.current();
      }
    });
    nodes.current.forEach((_, id) => measureCell(id));
  }, [measureCell]);

  const apply = end => {
    const g = gesture.current, api = latest.current;
    const index = g?.indices.get(end);
    if (!g || index == null || g.end === index) return;
    const lo = Math.min(g.anchor, index), hi = Math.max(g.anchor, index);
    const oldLo = g.lo, oldHi = g.hi;
    const update = (from, to, inRange) => {
      for (let i = from; i <= to; i++) {
        const id = g.ids[i], value = inRange ? g.selecting : g.initial.has(id);
        if (api.isSelected(id) !== value) {
          api.setSelected(id, value);
          g.count += value ? 1 : -1;
        }
      }
    };
    if (oldLo != null) {
      update(oldLo, Math.min(oldHi, lo - 1), false);
      update(Math.max(oldLo, hi + 1), oldHi, false);
    }
    update(lo, oldLo == null ? hi : Math.min(hi, oldLo - 1), true);
    if (oldLo != null) update(Math.max(lo, oldHi + 1), hi, true);
    g.end = index; g.lo = lo; g.hi = hi;
    api.onChange(g.count);
    setRevision(value => value + 1);
  };

  const hit = () => {
    const p = pointer.current, b = bounds.current, g = gesture.current;
    if (!g?.moved || !p || !b) return;
    const bottom = b.y + b.height - latest.current.bottomInset;
    if (p.x < b.x || p.x > b.x + b.width) return;
    const y = Math.max(b.y + 2, Math.min(p.y, bottom - 2)) + scroll.current.offset;
    for (const [id, r] of rects.current) {
      if (p.x >= r.x && p.x <= r.x + r.width && y >= r.y && y <= r.y + r.height) {
        apply(id); break;
      }
    }
  };
  hitRef.current = hit;

  const stop = useCallback(() => {
    if (gesture.current) suppress.current = Date.now() + 400;
    gesture.current = null; pointer.current = null;
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setActive(false);
  }, []);
  const reset = useCallback(() => {
    stop(); epoch.current++; rects.current.clear(); dirty.current.clear();
  }, [stop]);
  useEffect(() => () => {
    if (frame.current != null) cancelAnimationFrame(frame.current);
    epoch.current++; gesture.current = null;
  }, []);
  // A reload/reorder must never continue a range over an obsolete photo order.
  useEffect(() => { reset(); }, [ids, reset]);

  const move = event => {
    const p = touchPoint(event), g = gesture.current;
    if (!g || !p) return;
    pointer.current = p;
    if (!g.origin) g.origin = p;
    else if (Math.hypot(p.x - g.origin.x, p.y - g.origin.y) >= 8) g.moved = true;
    hit();
  };
  const start = (id, event) => {
    stop();
    const api = latest.current, anchor = api.ids.indexOf(id);
    if (anchor < 0) return;
    const initial = new Set(api.ids.filter(api.isSelected));
    pointer.current = touchPoint(event);
    gesture.current = {
      ids: api.ids, indices: new Map(api.ids.map((value, i) => [value, i])),
      initial, anchor, selecting: !initial.has(id), count: initial.size,
      end: null, lo: null, hi: null, moved: false, origin: pointer.current,
    };
    setActive(true); measure(); apply(id);
    let previousTime;
    const tick = time => {
      if (!gesture.current) return;
      const dt = previousTime == null ? 16 : Math.min(32, Math.max(0, time - previousTime));
      previousTime = time;
      const b = bounds.current, p = pointer.current, s = scroll.current;
      if (gesture.current.moved && b && p && p.x >= b.x && p.x <= b.x + b.width) {
        const bottom = b.y + b.height - latest.current.bottomInset;
        const proximity = p.y < b.y + EDGE ? -Math.min(1, (b.y + EDGE - p.y) / EDGE)
          : p.y > bottom - EDGE ? Math.min(1, (p.y - bottom + EDGE) / EDGE) : 0;
        const next = Math.max(0, Math.min(Math.max(0, s.content - s.height), s.offset + proximity * MAX_SPEED * dt / 1000));
        if (next !== s.offset) latest.current.listRef.current?.scrollToOffset({offset: next, animated: false});
      }
      const pending = [...dirty.current]; dirty.current.clear();
      pending.forEach(measureCell);
      hitRef.current();
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };
  const refresh = useCallback(() => {
    if (!gesture.current) latest.current.onRefresh?.();
  }, []);
  const cellRef = useCallback(id => {
    if (!refs.current.has(id)) refs.current.set(id, node => {
      if (node) { nodes.current.set(id, node); measureCell(id); }
      else { nodes.current.delete(id); rects.current.delete(id); dirty.current.delete(id); }
    });
    return refs.current.get(id);
  }, [measureCell]);

  return {
    active, revision, start, reset, stop, cellRef,
    cellLayout: id => {
      if (!layouts.current.has(id)) layouts.current.set(id, () => measureCell(id));
      return layouts.current.get(id);
    },
    shouldIgnorePress: () => !!gesture.current || Date.now() < suppress.current,
    containerProps: {
      ref: viewport, collapsable: false, onLayout: measure,
      onMoveShouldSetResponderCapture: event => {
        if (!gesture.current) return false;
        move(event); // RN does not guarantee onResponderMove for the capture event.
        return true;
      },
      onResponderGrant: move, onResponderMove: move,
      onResponderRelease: stop, onResponderTerminate: stop,
      onResponderTerminationRequest: () => false,
      onTouchEnd: stop, onTouchCancel: stop,
    },
    listProps: {
      scrollEnabled: !active, scrollEventThrottle: 16,
      // Keep installed: removing onRefresh replaces Android's native scroll subtree.
      onRefresh: refresh,
      onScroll: event => { scroll.current.offset = event.nativeEvent.contentOffset.y; hitRef.current(); },
      onLayout: event => { scroll.current.height = event.nativeEvent.layout.height; measure(); },
      onContentSizeChange: (_, height) => { scroll.current.content = height; },
    },
  };
}
