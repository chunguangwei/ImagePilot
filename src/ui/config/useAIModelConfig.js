/**
 * useAIModelConfig — React 适配 hook（桌面 React DOM 与 React Native 通用）
 *
 * 把框架无关的 AIModelConfigController 接到 React 渲染：
 *   - 用 useSyncExternalStore 订阅 controller 状态
 *   - 首次挂载触发 controller.load()
 *
 * 用法：
 *   const { state, controller } = useAIModelConfig(() => new AIModelConfigController(deps));
 *
 * 注：本文件依赖 react（peer）。在纯 Node 单测里请直接测 AIModelConfigController，
 *     不要 import 本文件。
 */

import { useEffect, useMemo, useSyncExternalStore } from 'react';

export function useAIModelConfig(makeController) {
  const controller = useMemo(makeController, []); // eslint-disable-line react-hooks/exhaustive-deps

  const state = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.getState(),
    () => controller.getState(),
  );

  useEffect(() => {
    controller.load();
  }, [controller]);

  return { state, controller };
}

export default useAIModelConfig;
