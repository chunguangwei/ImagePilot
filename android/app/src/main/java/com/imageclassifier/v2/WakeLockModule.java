package com.imageclassifier.v2;

import android.content.Context;
import android.os.PowerManager;
import android.util.Log;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Promise;

/**
 * WakeLock管理模块
 * 用于在图片扫描和AI处理期间保持CPU运行，防止休眠影响性能
 */
public class WakeLockModule extends ReactContextBaseJavaModule {
    private static final String TAG = "WakeLockModule";
    private static final String WAKE_LOCK_TAG = "ImageClassifier:ProcessingWakeLock";
    
    private PowerManager.WakeLock wakeLock;
    private final ReactApplicationContext reactContext;
    
    public WakeLockModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
    }
    
    @Override
    public String getName() {
        return "WakeLockModule";
    }
    
    /**
     * 获取唤醒锁，保持CPU运行
     * @param timeout 超时时间（毫秒），0表示不自动释放
     * @param promise Promise
     */
    @ReactMethod
    public void acquire(int timeout, Promise promise) {
        try {
            // 如果已有锁，先释放
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
                Log.d(TAG, "释放旧的唤醒锁");
            }
            
            // 获取PowerManager
            PowerManager powerManager = (PowerManager) reactContext.getSystemService(Context.POWER_SERVICE);
            
            if (powerManager == null) {
                promise.reject("ERROR", "无法获取PowerManager");
                return;
            }
            
            // 创建PARTIAL_WAKE_LOCK（保持CPU运行，但允许屏幕关闭）
            wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                WAKE_LOCK_TAG
            );
            
            // 设置引用计数（避免多次acquire/release问题）
            wakeLock.setReferenceCounted(false);
            
            // 获取锁
            if (timeout > 0) {
                wakeLock.acquire(timeout);
                Log.d(TAG, "已获取唤醒锁，超时: " + timeout + "ms");
            } else {
                wakeLock.acquire();
                Log.d(TAG, "已获取唤醒锁，无超时限制");
            }
            
            promise.resolve(true);
            
        } catch (Exception e) {
            Log.e(TAG, "获取唤醒锁失败: " + e.getMessage(), e);
            promise.reject("ERROR", "获取唤醒锁失败: " + e.getMessage());
        }
    }
    
    /**
     * 释放唤醒锁
     */
    @ReactMethod
    public void release(Promise promise) {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
                Log.d(TAG, "已释放唤醒锁");
                promise.resolve(true);
            } else {
                Log.d(TAG, "没有持有的唤醒锁");
                promise.resolve(false);
            }
        } catch (Exception e) {
            Log.e(TAG, "释放唤醒锁失败: " + e.getMessage(), e);
            promise.reject("ERROR", "释放唤醒锁失败: " + e.getMessage());
        }
    }
    
    /**
     * 检查是否持有唤醒锁
     */
    @ReactMethod
    public void isHeld(Promise promise) {
        try {
            boolean held = wakeLock != null && wakeLock.isHeld();
            promise.resolve(held);
        } catch (Exception e) {
            Log.e(TAG, "检查唤醒锁状态失败: " + e.getMessage(), e);
            promise.reject("ERROR", "检查唤醒锁状态失败: " + e.getMessage());
        }
    }
    
    /**
     * 防自动锁屏：任务（模型下载 / 图片分类）运行时给当前 Activity 窗口加
     * FLAG_KEEP_SCREEN_ON，屏幕到点不自动锁屏、任务持续跑。结束传 false 清除，省电。
     * 注意 WakeLock(PARTIAL) 只保 CPU、屏幕仍会关；本方法专管"屏幕常亮"，两者互补。
     */
    @ReactMethod
    public void keepScreenOn(final boolean enable, final Promise promise) {
        final android.app.Activity activity = getCurrentActivity();
        if (activity == null) {
            promise.reject("ERROR", "无当前 Activity");
            return;
        }
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (enable) {
                        activity.getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    } else {
                        activity.getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    }
                    promise.resolve(true);
                } catch (Exception e) {
                    Log.e(TAG, "设置屏幕常亮失败: " + e.getMessage(), e);
                    promise.reject("ERROR", e.getMessage());
                }
            }
        });
    }

    /**
     * 模块销毁时自动释放锁
     */
    @Override
    public void onCatalystInstanceDestroy() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
                Log.d(TAG, "模块销毁，自动释放唤醒锁");
            }
        } catch (Exception e) {
            Log.e(TAG, "销毁时释放唤醒锁失败: " + e.getMessage(), e);
        }
        super.onCatalystInstanceDestroy();
    }
}

