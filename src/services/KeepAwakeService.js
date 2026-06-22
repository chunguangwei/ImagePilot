/**
 * KeepAwakeService —— 防自动锁屏（保持屏幕常亮）。
 *
 * 长任务（模型下载 / 图片分类）运行时启用：屏幕到了系统自动锁屏时间也不熄屏、不锁定，
 * app 一直前台，任务持续跑。尤其解决 iOS 锁屏即挂起导致分类/下载中断的问题。
 * 任务结束/取消后恢复（允许正常自动锁屏），避免无谓耗电。
 *
 * 实现（零第三方依赖，复用项目现有原生模块）：
 *   - iOS：HapticsModule.setKeepAwake → UIApplication.isIdleTimerDisabled
 *   - Android：WakeLockModule.keepScreenOn → 窗口 FLAG_KEEP_SCREEN_ON
 *
 * 与 WakeLockService 区别：WakeLock(PARTIAL) 只保 CPU 不休眠、屏幕仍会关（仅 Android）；
 * 本服务专管"屏幕常亮/不锁屏"，两端都有，两者互补。
 *
 * 引用计数：下载与分类可能并发，activate/deactivate 配对计数，最后一个结束才真正恢复。
 */
import { NativeModules, Platform } from 'react-native';
import { logger } from '../adapters/WebAdapters';

const { HapticsModule, WakeLockModule } = NativeModules;

let _count = 0;

async function setNative(on) {
  try {
    if (Platform.OS === 'ios') {
      if (HapticsModule && typeof HapticsModule.setKeepAwake === 'function') {
        await HapticsModule.setKeepAwake(on);
      }
    } else if (Platform.OS === 'android') {
      if (WakeLockModule && typeof WakeLockModule.keepScreenOn === 'function') {
        await WakeLockModule.keepScreenOn(on);
      }
    }
  } catch (e) {
    logger.debug('[KeepAwake] 设置失败（忽略）:', e?.message || e);
  }
}

class KeepAwakeService {
  /** 启用防自动锁屏（任务开始时调）。可重入，引用计数。 */
  async activate() {
    _count += 1;
    if (_count === 1) await setNative(true);
  }

  /** 关闭防自动锁屏（任务结束/取消时调，与 activate 配对）。 */
  async deactivate() {
    if (_count > 0) _count -= 1;
    if (_count === 0) await setNative(false);
  }

  /** 强制复位（异常兜底，如页面卸载）。 */
  async reset() {
    _count = 0;
    await setNative(false);
  }
}

export default new KeepAwakeService();
