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
import java.io.FileInputStream;
import java.io.FileOutputStream;

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

  /**
   * 二进制追加：把 srcPath 的字节流追加到 dstPath 末尾。
   *
   * 用于 UpdateService 的断点续传：Range request 把剩余字节下到 .part.chunk，
   * 这里 native 把 chunk 字节追加到 .part，避免 RNFS base64 round-trip 168MB
   * 的性能问题（实测耗时 30s+ vs native FileChannel 不到 1s）。
   *
   * 用 8KB buffer 流式拷贝；不一次性读到内存（防 OOM）。
   */
  @ReactMethod
  public void appendFile(String srcPath, String dstPath, Promise promise) {
    FileInputStream in = null;
    FileOutputStream out = null;
    try {
      String s = srcPath;
      if (s != null && s.startsWith("file://")) s = s.substring(7);
      String d = dstPath;
      if (d != null && d.startsWith("file://")) d = d.substring(7);
      File src = new File(s);
      File dst = new File(d);
      if (!src.exists()) {
        promise.reject("E_NO_SRC", "src 不存在: " + s);
        return;
      }
      in = new FileInputStream(src);
      out = new FileOutputStream(dst, /* append = */ true);
      byte[] buf = new byte[8192];
      int n;
      long total = 0;
      while ((n = in.read(buf)) > 0) {
        out.write(buf, 0, n);
        total += n;
      }
      out.flush();
      promise.resolve((double) total);
    } catch (Exception e) {
      promise.reject("E_APPEND", e.getMessage());
    } finally {
      try { if (in != null) in.close(); } catch (Exception ignored) {}
      try { if (out != null) out.close(); } catch (Exception ignored) {}
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
