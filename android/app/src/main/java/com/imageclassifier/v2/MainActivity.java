package com.imageclassifier.v2;

import com.facebook.react.ReactActivity;
import com.facebook.react.ReactActivityDelegate;
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint;
import com.facebook.react.defaults.DefaultReactActivityDelegate;
import android.os.Bundle;
import android.os.PowerManager;
import android.content.Context;



public class MainActivity extends ReactActivity {
  private PowerManager.WakeLock wakeLock;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    // 🔥 修复 react-native-screens Fragment 恢复问题
    // 防止 ScreenFragment 被恢复，这会导致应用崩溃
    // 参考: https://github.com/software-mansion/react-native-screens/issues/17#issuecomment-424704067
    super.onCreate(null);
    
    // 获取 WakeLock，保持应用进程活跃（即使进入后台）
    PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
    wakeLock = powerManager.newWakeLock(
      PowerManager.PARTIAL_WAKE_LOCK,
      "MainActivity::WakeLock"
    );
  }
  
  @Override
  protected void onResume() {
    super.onResume();
    // 前台时释放 WakeLock（由前台服务持有）
    if (wakeLock != null && wakeLock.isHeld()) {
      wakeLock.release();
    }
  }
  
  @Override
  protected void onPause() {
    super.onPause();
    // 进入后台时，保持 WakeLock 以维持应用进程活跃
    // 这样可以让 React Native JS 线程继续运行
    if (wakeLock != null && !wakeLock.isHeld()) {
      wakeLock.acquire(10 * 60 * 1000L /*10 minutes*/);
    }
  }
  
  @Override
  protected void onDestroy() {
    super.onDestroy();
    // 释放 WakeLock
    if (wakeLock != null && wakeLock.isHeld()) {
      wakeLock.release();
    }
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  @Override
  protected String getMainComponentName() {
    return "imagepilot";
  }

  /**
   * Returns the instance of the {@link ReactActivityDelegate}. Here we use a util class {@link
   * DefaultReactActivityDelegate} which allows you to easily enable Fabric and Concurrent React
   * (aka React 18) with two boolean flags.
   */
  @Override
  protected ReactActivityDelegate createReactActivityDelegate() {
    return new DefaultReactActivityDelegate(
        this,
        getMainComponentName(),
        // If you opted-in for the New Architecture, we enable the Fabric Renderer.
        DefaultNewArchitectureEntryPoint.getFabricEnabled());

      

        
  }

 
}

