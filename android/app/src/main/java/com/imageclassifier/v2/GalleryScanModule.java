package com.imageclassifier.v2;

import android.util.Log;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.WritableMap;

import java.util.ArrayList;
import java.util.List;

/**
 * 相册扫描模块
 * React Native桥接模块，提供JS层调用原生扫描服务的接口
 */
public class GalleryScanModule extends ReactContextBaseJavaModule {
    private static final String TAG = "GalleryScanModule";
    private final ReactApplicationContext reactContext;
    private GalleryScanService scanService;
    
    public GalleryScanModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
        this.scanService = new GalleryScanService(reactContext);
    }
    
    @Override
    public String getName() {
        return "GalleryScanModule";
    }
    
    /**
     * 🆕 启动基础扫描（阶段1、2、3a）
     * @param options 扫描选项
     *   - scanPaths: string[] (扫描路径数组，相对路径，如 ["DCIM/Camera"])
     *   - compareLimit: number (比对限制，0表示不限制)
     * @param promise Promise对象
     * @return 返回对象包含：
     *   - scanId: string (扫描任务ID)
     *   - totalImagesToBeClassified: number (总需要处理的图片数量 = 新增照片数量)
     */
    @ReactMethod
    public void startBasicImageScan(ReadableMap options, Promise promise) {
        try {
            // 解析扫描路径
            List<String> scanPaths = new ArrayList<>();
            if (options.hasKey("scanPaths")) {
                ReadableArray scanPathsArray = options.getArray("scanPaths");
                if (scanPathsArray != null) {
                    for (int i = 0; i < scanPathsArray.size(); i++) {
                        String path = scanPathsArray.getString(i);
                        if (path != null && !path.isEmpty()) {
                            scanPaths.add(path);
                        }
                    }
                }
            }
            
            // 解析其他选项
            int compareLimit = options.hasKey("compareLimit") ? options.getInt("compareLimit") : 0;
            
            // 启动基础扫描（同步执行阶段1和阶段2，返回总数量）
            GalleryScanService.ScanStartResult result = scanService.startBasicImageScan(scanPaths, compareLimit);
            
            // 构建返回对象
            WritableMap resultMap = Arguments.createMap();
            resultMap.putString("scanId", result.scanId);
            resultMap.putInt("totalImagesToBeClassified", result.totalImagesToBeClassified);
            resultMap.putBoolean("hasNewImages", result.hasNewImages); // 🔥 返回是否有新增照片
            
            Log.d(TAG, "基础扫描已启动: " + result.scanId + ", 总数量: " + result.totalImagesToBeClassified + ", 是否有新增照片: " + result.hasNewImages + ", compareLimit=" + compareLimit);
            promise.resolve(resultMap);
            
        } catch (Exception e) {
            Log.e(TAG, "启动基础扫描失败", e);
            promise.reject("START_BASIC_SCAN_ERROR", e.getMessage());
        }
    }
    
    /**
     * 🆕 启动AI分类（阶段3b、3c）
     * @param options 分类选项
     *   - scanId: string (扫描任务ID，可选，如果未提供则自动生成)
     *   - imagesToClassify: array (指定需要分类的图片数组，可选，如果未提供则读取所有NA分类图片)
     *     - 每个图片对象包含: uri, fileName, path, id
     *   - userId: string (用户ID，可选，用于API请求)
     * @param promise Promise对象
     * @return 返回对象包含：
     *   - scanId: string (扫描任务ID)
     *   - totalImagesToBeClassified: number (总需要处理的图片数量 = NA分类图片数量或指定图片数量)
     */
    @ReactMethod
    public void startAiImageClassifyByContent(ReadableMap options, Promise promise) {
        try {
            // 解析scanId（可选）
            String scanId = options.hasKey("scanId") ? options.getString("scanId") : null;
            
            // 解析imagesToClassify（可选）
            List<GalleryScanService.ImageInfo> imagesToClassify = null;
            if (options.hasKey("imagesToClassify")) {
                ReadableArray imagesArray = options.getArray("imagesToClassify");
                if (imagesArray != null && imagesArray.size() > 0) {
                    imagesToClassify = new ArrayList<>();
                    for (int i = 0; i < imagesArray.size(); i++) {
                        ReadableMap imageMap = imagesArray.getMap(i);
                        if (imageMap != null) {
                            GalleryScanService.ImageInfo imageInfo = new GalleryScanService.ImageInfo();
                            imageInfo.uri = imageMap.hasKey("uri") ? imageMap.getString("uri") : null;
                            imageInfo.fileName = imageMap.hasKey("fileName") ? imageMap.getString("fileName") : null;
                            imageInfo.path = imageMap.hasKey("path") ? imageMap.getString("path") : null;
                            imageInfo.id = imageMap.hasKey("id") ? imageMap.getString("id") : null;
                            imagesToClassify.add(imageInfo);
                        }
                    }
                }
            }
            
            // 🔥 解析用户ID（可选）
            String userId = options.hasKey("userId") ? options.getString("userId") : null;
            
            // 启动AI分类（API URL在代码中配置，无需传递）
            GalleryScanService.ScanStartResult result = scanService.startAiImageClassifyByContent(
                scanId, imagesToClassify, userId
            );
            
            // 构建返回对象
            WritableMap resultMap = Arguments.createMap();
            resultMap.putString("scanId", result.scanId);
            resultMap.putInt("totalImagesToBeClassified", result.totalImagesToBeClassified);
            
            Log.d(TAG, "AI分类已启动: " + result.scanId + ", 总数量: " + result.totalImagesToBeClassified);
            promise.resolve(resultMap);
            
        } catch (Exception e) {
            Log.e(TAG, "启动AI分类失败", e);
            promise.reject("START_AI_CLASSIFY_ERROR", e.getMessage());
        }
    }
    
    /**
     * 🛑 停止当前扫描（架构文档 3.3.2 设计的接口）。
     * 优雅停止：已处理批次照常落库，剩余下次扫描自动续；停止后仍走 completeBasicScan 正常收尾。
     */
    @ReactMethod
    public void stopScan(Promise promise) {
        try {
            GalleryScanService.requestStop();
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("STOP_SCAN_ERROR", e.getMessage());
        }
    }

    /**
     * 添加事件监听器（React Native NativeEventEmitter 要求）
     * @param eventName 事件名称
     */
    @ReactMethod
    public void addListener(String eventName) {
        // React Native NativeEventEmitter 要求实现此方法
        // 实际的事件发送在 GalleryScanService 中通过 DeviceEventManagerModule 完成
    }
    
    /**
     * 移除事件监听器（React Native NativeEventEmitter 要求）
     * @param count 要移除的监听器数量
     */
    @ReactMethod
    public void removeListeners(Integer count) {
        // React Native NativeEventEmitter 要求实现此方法
        // 实际的事件发送在 GalleryScanService 中通过 DeviceEventManagerModule 完成
    }
    
}

