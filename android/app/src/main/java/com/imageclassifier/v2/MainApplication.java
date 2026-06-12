package com.imageclassifier.v2;

import android.app.Application;
import com.facebook.react.ReactApplication;
import com.facebook.react.ReactNativeHost;
import com.facebook.react.ReactPackage;
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint;
import com.facebook.react.defaults.DefaultReactNativeHost;
import com.facebook.soloader.SoLoader;
import java.util.List;
import java.util.Arrays;
import com.facebook.react.shell.MainReactPackage;
import com.swmansion.gesturehandler.RNGestureHandlerPackage;
import com.th3rdwave.safeareacontext.SafeAreaContextPackage;
import com.swmansion.rnscreens.RNScreensPackage;
import com.reactnativecommunity.asyncstorage.AsyncStoragePackage;
import com.dylanvann.fastimage.FastImageViewPackage;
import com.rnfs.RNFSPackage;
import com.imagepicker.ImagePickerPackage;
import fr.bamlab.rnimageresizer.ImageResizerPackage;
import com.oblador.vectoricons.VectorIconsPackage;
import fr.greweb.reactnativeviewshot.RNViewShotPackage;
import org.pgsqlite.SQLitePluginPackage;
import ai.onnxruntime.reactnative.OnnxruntimePackage;
import com.imageclassifier.v2.MediaStorePackage;
import com.imageclassifier.v2.SharePackage;
import com.imageclassifier.v2.ScanServicePackage;
import com.imageclassifier.v2.GalleryScanPackage;
import com.imageclassifier.v2.NativeLogExportPackage;
import com.reactnativecommunity.blurview.BlurViewPackage;

public class MainApplication extends Application implements ReactApplication {

  private final ReactNativeHost mReactNativeHost =
      new DefaultReactNativeHost(this) {
        @Override
        public boolean getUseDeveloperSupport() {
          return BuildConfig.DEBUG;
        }

        @Override
        protected List<ReactPackage> getPackages() {
          // 手动添加必要的包
          return Arrays.<ReactPackage>asList(
            new MainReactPackage(),
            new RNGestureHandlerPackage(),
            new SafeAreaContextPackage(),
            new RNScreensPackage(),
            new AsyncStoragePackage(),
            new FastImageViewPackage(),
            new RNFSPackage(),
            new ImagePickerPackage(),
            new ImageResizerPackage(),
            new VectorIconsPackage(),
            new RNViewShotPackage(),
            new SQLitePluginPackage(),
            new OnnxruntimePackage(),
            new MediaStorePackage(),  // 添加MediaStore原生模块
            new SharePackage(),  // 添加Share原生模块
            new ScanServicePackage(),  // 添加扫描服务原生模块
            new GalleryScanPackage(),  // 添加相册扫描原生模块
            new NativeLogExportPackage(),  // 添加原生日志导出模块
            new ApkInstallerPackage(),  // App 内更新安装（方案2）
            new BlurViewPackage(),  // ImagePreview 沉浸式 chrome 磨砂玻璃效果
            new GemmaPackage()  // Android 本地多模态分类档（LiteRT-LM + Gemma4-E2B）
          );
        }

        @Override
        protected String getJSMainModuleName() {
          return "index";
        }

        @Override
        protected boolean isNewArchEnabled() {
          return BuildConfig.IS_NEW_ARCHITECTURE_ENABLED;
        }

        @Override
        protected Boolean isHermesEnabled() {
          return BuildConfig.IS_HERMES_ENABLED;
        }
      };

  @Override
  public ReactNativeHost getReactNativeHost() {
    return mReactNativeHost;
  }

  @Override
  public void onCreate() {
    super.onCreate();
    SoLoader.init(this, /* native exopackage */ false);
    if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
      // If you opted-in for the New Architecture, we load the native entry point for this app.
      DefaultNewArchitectureEntryPoint.load();
    }
    // 注释掉Flipper相关代码
    // ReactNativeFlipper.initializeFlipper(this, getReactNativeHost().getReactInstanceManager());
  }
}

