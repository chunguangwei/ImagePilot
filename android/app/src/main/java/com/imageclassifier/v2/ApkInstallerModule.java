package com.imageclassifier.v2;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

import java.io.File;

/**
 * ApkInstaller — App 内拉起系统安装器安装已下载的 APK（更新方案2）。
 * 复用已配置的 FileProvider（${applicationId}.fileprovider）生成 content:// URI。
 * Android O+ 需「安装未知应用」权限：未授权时引导用户去系统设置开启。
 */
public class ApkInstallerModule extends ReactContextBaseJavaModule {
  private final ReactApplicationContext reactContext;

  public ApkInstallerModule(ReactApplicationContext context) {
    super(context);
    this.reactContext = context;
  }

  @Override
  public String getName() {
    return "ApkInstaller";
  }

  /** 是否已具备安装未知应用的权限 */
  @ReactMethod
  public void canInstall(Promise promise) {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        promise.resolve(reactContext.getPackageManager().canRequestPackageInstalls());
      } else {
        promise.resolve(true);
      }
    } catch (Exception e) {
      promise.resolve(false);
    }
  }

  /** 打开「安装未知应用」系统设置页 */
  @ReactMethod
  public void openInstallSettings(Promise promise) {
    try {
      Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
      intent.setData(Uri.parse("package:" + reactContext.getPackageName()));
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      reactContext.startActivity(intent);
      promise.resolve(true);
    } catch (Exception e) {
      promise.reject("E_SETTINGS", e.getMessage());
    }
  }

  /** 安装指定路径的 APK（拉起系统安装器） */
  @ReactMethod
  public void install(String filePath, Promise promise) {
    try {
      String path = filePath;
      if (path != null && path.startsWith("file://")) {
        path = path.substring(7);
      }
      File apk = new File(path);
      if (!apk.exists()) {
        promise.reject("E_NO_FILE", "APK 文件不存在: " + path);
        return;
      }

      // Android O+：未授予「安装未知应用」权限时，先引导去设置开启
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
          && !reactContext.getPackageManager().canRequestPackageInstalls()) {
        Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
        settings.setData(Uri.parse("package:" + reactContext.getPackageName()));
        settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        reactContext.startActivity(settings);
        promise.reject("E_NEED_PERMISSION", "need_install_permission");
        return;
      }

      Intent intent = new Intent(Intent.ACTION_VIEW);
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      Uri uri;
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        uri = FileProvider.getUriForFile(
            reactContext, reactContext.getPackageName() + ".fileprovider", apk);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
      } else {
        uri = Uri.fromFile(apk);
      }
      intent.setDataAndType(uri, "application/vnd.android.package-archive");
      reactContext.startActivity(intent);
      promise.resolve(true);
    } catch (Exception e) {
      promise.reject("E_INSTALL", e.getMessage());
    }
  }
}
