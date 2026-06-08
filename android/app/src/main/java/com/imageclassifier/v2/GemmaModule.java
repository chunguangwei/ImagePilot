package com.imageclassifier.v2;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Log;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * GemmaModule —— Android 本地多模态分类档（VLM tier）的原生运行时。
 *
 * 用 Google LiteRT-LM 加载 Gemma4-E2B（.litertlm），看图 → 出"描述+分类"文本。
 * 本模块只做"跑一次推理(模型路径, 图片路径, prompt) → 返回原始文本"；prompt 构建与解析在 JS（与 iOS Qwen 共享）。
 *
 * 为什么全程反射调用 litertlm：litertlm-android 0.11.0 是 Java 21 字节码（class major 65），
 * 本项目用 JDK 17 编译，javac 读不了 Java 21 的 class（会报"无法访问 Engine"）。反射在编译期不引用这些类，
 * 运行时再加载（R8 8.3.37 已能把它们 dex），从而无需升 JDK/Gradle/AGP，保护现有安卓构建。
 *
 * 后端 GPU→CPU 自动回退；Engine 单例缓存；推理在独立单线程串行（Conversation 单租户）。
 */
public class GemmaModule extends ReactContextBaseJavaModule {
  private static final String TAG = "GemmaModule";
  private static final String P = "com.google.ai.edge.litertlm.";

  private final ReactApplicationContext ctx;
  private final ExecutorService exec = Executors.newSingleThreadExecutor();

  private Object engine;          // litertlm Engine
  private String engineModelPath;
  private String engineBackend;   // "gpu" | "cpu"

  // 反射缓存
  private Class<?> cBackend, cEngine, cEngineConfig, cConversation, cConversationConfig,
      cSamplerConfig, cContents, cContent, cContentImageBytes, cContentText, cMessage;
  private Constructor<?> ctorEngineConfig, ctorEngine, ctorConvConfig, ctorSampler, ctorImageBytes, ctorText;
  private Object companionContents;
  private Method mOfList, mInitialize, mCreateConversation, mSendMessage, mClose, mConvClose,
      mMsgGetContents, mContentsGetList, mTextGetText;
  private boolean reflectReady = false;

  public GemmaModule(ReactApplicationContext context) {
    super(context);
    this.ctx = context;
  }

  @NonNull
  @Override
  public String getName() {
    return "GemmaModule";
  }

  private synchronized void ensureReflection() throws Exception {
    if (reflectReady) return;
    cBackend = Class.forName(P + "Backend");
    cEngine = Class.forName(P + "Engine");
    cEngineConfig = Class.forName(P + "EngineConfig");
    cConversation = Class.forName(P + "Conversation");
    cConversationConfig = Class.forName(P + "ConversationConfig");
    cSamplerConfig = Class.forName(P + "SamplerConfig");
    cContents = Class.forName(P + "Contents");
    cContent = Class.forName(P + "Content");
    cContentImageBytes = Class.forName(P + "Content$ImageBytes");
    cContentText = Class.forName(P + "Content$Text");
    cMessage = Class.forName(P + "Message");

    // EngineConfig(String modelPath, Backend backend, Backend visionBackend, Backend audioBackend, Integer maxNumTokens, Integer maxNumImages, String cacheDir)
    ctorEngineConfig = cEngineConfig.getConstructor(
        String.class, cBackend, cBackend, cBackend, Integer.class, Integer.class, String.class);
    ctorEngine = cEngine.getConstructor(cEngineConfig);
    // ConversationConfig(Contents, List, List, SamplerConfig, boolean, List, Map)
    ctorConvConfig = cConversationConfig.getConstructor(
        cContents, List.class, List.class, cSamplerConfig, boolean.class, List.class, java.util.Map.class);
    // SamplerConfig(int topK, double topP, double temperature, int seed)
    ctorSampler = cSamplerConfig.getConstructor(int.class, double.class, double.class, int.class);
    ctorImageBytes = cContentImageBytes.getConstructor(byte[].class);
    ctorText = cContentText.getConstructor(String.class);

    Field fCompanion = cContents.getField("Companion");
    companionContents = fCompanion.get(null);
    mOfList = companionContents.getClass().getMethod("of", List.class);

    mInitialize = cEngine.getMethod("initialize");
    mCreateConversation = cEngine.getMethod("createConversation", cConversationConfig);
    mClose = cEngine.getMethod("close");
    mSendMessage = cConversation.getMethod("sendMessage", cContents, java.util.Map.class);
    mConvClose = cConversation.getMethod("close");
    mMsgGetContents = cMessage.getMethod("getContents");
    mContentsGetList = cContents.getMethod("getContents");
    mTextGetText = cContentText.getMethod("getText");
    reflectReady = true;
  }

  private Object newBackend(boolean gpu) throws Exception {
    Class<?> c = Class.forName(P + (gpu ? "Backend$GPU" : "Backend$CPU"));
    return c.getConstructor().newInstance();
  }

  private Object newContentsOf(List<?> parts) throws Exception {
    return mOfList.invoke(companionContents, parts);
  }

  /** 确保 Engine 就绪（GPU 优先，失败回退 CPU）。返回 null 表示两种后端都失败。 */
  private synchronized Object ensureEngine(String modelPath) {
    if (engine != null && modelPath.equals(engineModelPath)) return engine;
    releaseEngineInternal();
    try { ensureReflection(); } catch (Throwable t) { Log.e(TAG, "reflection init failed: " + t.getMessage(), t); return null; }

    String cacheDir = ctx.getCacheDir().getAbsolutePath();
    boolean[] gpuFirst = { true, false };
    for (boolean gpu : gpuFirst) {
      Object e = null;
      try {
        Object backend = newBackend(gpu);
        Object vision = newBackend(gpu);
        Object cfg = ctorEngineConfig.newInstance(
            modelPath, backend, vision, null, Integer.valueOf(512), Integer.valueOf(1), cacheDir);
        e = ctorEngine.newInstance(cfg);
        mInitialize.invoke(e);
        engine = e;
        engineModelPath = modelPath;
        engineBackend = gpu ? "gpu" : "cpu";
        Log.d(TAG, "Engine ready backend=" + engineBackend);
        return engine;
      } catch (Throwable t) {
        Throwable cause = t.getCause() != null ? t.getCause() : t;
        Log.w(TAG, "Engine init failed backend=" + (gpu ? "gpu" : "cpu") + ": " + cause.getMessage());
        if (e != null) { try { mClose.invoke(e); } catch (Throwable ignore) {} }
      }
    }
    return null;
  }

  private synchronized void releaseEngineInternal() {
    if (engine != null) { try { mClose.invoke(engine); } catch (Throwable ignore) {} }
    engine = null;
    engineModelPath = null;
    engineBackend = null;
  }

  /** 图片文件 → PNG 字节（LiteRT-LM 视觉编码器对 PNG 最稳，对齐译人）。 */
  private static byte[] imageFileToPng(String imagePath) throws Exception {
    String path = imagePath.startsWith("file://") ? imagePath.substring(7) : imagePath;
    Bitmap bmp = BitmapFactory.decodeFile(path);
    if (bmp == null) throw new Exception("decode image failed: " + path);
    ByteArrayOutputStream baos = new ByteArrayOutputStream();
    bmp.compress(Bitmap.CompressFormat.PNG, 100, baos);
    bmp.recycle();
    return baos.toByteArray();
  }

  /** 从响应 Message 取文本：取 Content.Text 拼接，兜底 toString()。 */
  private String messageText(Object msg) {
    try {
      Object contents = mMsgGetContents.invoke(msg);
      Object listObj = mContentsGetList.invoke(contents);
      StringBuilder sb = new StringBuilder();
      if (listObj instanceof List) {
        for (Object c : (List<?>) listObj) {
          if (cContentText.isInstance(c)) sb.append((String) mTextGetText.invoke(c));
        }
      }
      String s = sb.toString().trim();
      if (!s.isEmpty()) return s;
    } catch (Throwable ignore) {}
    return String.valueOf(msg);
  }

  @ReactMethod
  public void classify(String modelPath, String imagePath, String prompt, final Promise promise) {
    final String mp = modelPath.startsWith("file://") ? modelPath.substring(7) : modelPath;
    exec.execute(() -> {
      Object conv = null;
      try {
        if (!new File(mp).exists()) { promise.reject("E_LOAD", "model not found: " + mp); return; }
        Object e = ensureEngine(mp);
        if (e == null) { promise.reject("E_LOAD", "engine init failed (GPU & CPU)"); return; }

        byte[] png = imageFileToPng(imagePath);

        // ConversationConfig(systemInstruction=空Contents, initialMessages=[], tools=[], sampler, automaticToolCalling=false, channels=[], extraContext={})
        Object sampler = ctorSampler.newInstance(40, 0.95, 0.2, 0);
        Object emptyContents = newContentsOf(Collections.emptyList());
        Object cc = ctorConvConfig.newInstance(
            emptyContents, Collections.emptyList(), Collections.emptyList(),
            sampler, Boolean.FALSE, Collections.emptyList(), Collections.emptyMap());
        conv = mCreateConversation.invoke(e, cc);

        List<Object> parts = new ArrayList<>(Arrays.asList(
            ctorImageBytes.newInstance((Object) png),
            ctorText.newInstance(prompt)));
        Object contents = newContentsOf(parts);

        Object resp = mSendMessage.invoke(conv, contents, Collections.emptyMap());
        String text = messageText(resp);
        Log.d(TAG, "classify done backend=" + engineBackend + " len=" + (text == null ? 0 : text.length()));
        promise.resolve(text == null ? "" : text);
      } catch (Throwable t) {
        Throwable cause = t.getCause() != null ? t.getCause() : t;
        Log.e(TAG, "classify error: " + cause.getMessage(), cause);
        promise.reject("E_INFER", cause.getMessage() == null ? String.valueOf(cause) : cause.getMessage());
      } finally {
        if (conv != null) { try { mConvClose.invoke(conv); } catch (Throwable ignore) {} }
      }
    });
  }

  @ReactMethod
  public void release(final Promise promise) {
    exec.execute(() -> {
      releaseEngineInternal();
      promise.resolve(true);
    });
  }

  /** 设备物理内存（MB）—— 给"本地大模型下载前判断机型是否跑得动"用。 */
  @ReactMethod
  public void totalMemoryMB(final Promise promise) {
    try {
      android.app.ActivityManager am = (android.app.ActivityManager) ctx.getSystemService(android.content.Context.ACTIVITY_SERVICE);
      android.app.ActivityManager.MemoryInfo mi = new android.app.ActivityManager.MemoryInfo();
      am.getMemoryInfo(mi);
      promise.resolve((double) (mi.totalMem / (1024L * 1024L)));
    } catch (Throwable t) {
      promise.resolve(0.0);
    }
  }
}
