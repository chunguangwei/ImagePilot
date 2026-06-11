/**
 * classifyProgressStore —— 多选 AI 分类的全局进度（跨页面存活）
 *
 * 背景：进度若放在 CategoryScreen 本地 state，切页回来就丢了，用户不知道
 * 分类还在不在跑/完没完成。这里用模块级单例 + 订阅，HomeScreen/CategoryScreen
 * 共用一个悬浮胶囊组件（ClassifyProgressPill）渲染，导航不影响。
 *
 * state: null | { done, total, status: 'running' | 'done' }
 * 完成后停留 4 秒自动清空（让切回来的用户看见"已完成"）。
 */
const listeners = new Set();
let state = null;
let doneTimer = null;

function emit() {
  for (const l of listeners) { try { l(state); } catch (_) {} }
}

export function startClassifyProgress(total) {
  if (doneTimer) { clearTimeout(doneTimer); doneTimer = null; }
  state = { done: 0, total, status: 'running' };
  emit();
}

export function updateClassifyProgress(done) {
  if (!state || state.status !== 'running') return;
  state = { ...state, done };
  emit();
}

export function finishClassifyProgress() {
  if (!state) return;
  state = { ...state, done: state.total, status: 'done' };
  emit();
  if (doneTimer) clearTimeout(doneTimer);
  doneTimer = setTimeout(() => { state = null; doneTimer = null; emit(); }, 4000);
}

export function clearClassifyProgress() {
  if (doneTimer) { clearTimeout(doneTimer); doneTimer = null; }
  state = null;
  emit();
}

export function getClassifyProgress() { return state; }

export function subscribeClassifyProgress(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
