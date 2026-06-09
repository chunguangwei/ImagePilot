package com.imageclassifier.v2;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.util.Log;
import com.imageclassifier.v2.FileLogger;
import android.graphics.BitmapFactory;
import android.graphics.Bitmap;
import android.graphics.Matrix;
import java.io.ByteArrayOutputStream;

import androidx.exifinterface.media.ExifInterface;

import java.io.InputStream;
import java.io.IOException;
import java.io.BufferedInputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import com.imageclassifier.v2.database.ImageDataService;
import com.imageclassifier.v2.database.ImageDatabaseHelper;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.Collections;

import java.io.OutputStream;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 原生相册扫描服务
 * 实现漏斗式处理：目录扫描 -> 文件比对 -> 截图检测 -> 远端缓存查询 -> 远程推理
 */
public class GalleryScanService {
    private static final String TAG = "GalleryScanService";
    
    // 🔥 API配置（与PC版本保持一致）
    private static final String API_BASE_URL = "https://api.aifuture.net.cn/";
    
    private final ReactApplicationContext reactContext;
    private final Context context;
    private final ImageDataService imageDataService;
    private final MediaStoreModule mediaStoreModule;
    private final ExecutorService executorService;
    private final Handler mainHandler;
    private final FileLogger fileLogger; // 🔥 文件日志记录器
    
    // 🔥 并发控制：限制同时进行的HTTP请求数量（避免过多连接）
    private static final int MAX_CONCURRENT_REQUESTS = 3;
    private final Semaphore httpRequestSemaphore = new Semaphore(MAX_CONCURRENT_REQUESTS);
    
    // 扫描状态
    private String currentScanId = null;
    private int totalFoundThisPhase = 0; // 当前阶段需要处理的图片总数（阶段级变量）
    private int processedThisPhase = 0; // 当前阶段已处理的图片数量（阶段级变量）
    
    // 全局扫描统计变量（在整个扫描任务期间共享，所有阶段都会使用）
    private int totalImagesToBeClassified = 0; // 这次扫描任务一共需要分类的图片总数
                                                      // 在startBasicImageScan或startAiImageClassifyByContent中计算后，在整个扫描任务结束前都不会发生变化
    private int imagesClassified = 0; // 目前已经分类成功的图片数量（整个扫描过程累加）
                                            // 在各个阶段（截图检测、缓存查询、远程推理）中累加
    
    // 🔥 用户ID（用于API请求）
    private String userId = null;
    
    public GalleryScanService(ReactApplicationContext reactContext) {
        this.reactContext = reactContext;
        this.context = reactContext.getApplicationContext();
        this.imageDataService = new ImageDataService(context);
        this.mediaStoreModule = new MediaStoreModule(reactContext);
        this.executorService = Executors.newFixedThreadPool(Runtime.getRuntime().availableProcessors());
        this.mainHandler = new Handler(Looper.getMainLooper());
        this.fileLogger = FileLogger.getInstance(context); // 🔥 初始化文件日志记录器
    }
    
    /**
     * 扫描启动结果
     */
    public static class ScanStartResult {
        public String scanId;
        public int totalImagesToBeClassified;
        public boolean hasNewImages; // 🔥 是否有新增照片
        
        public ScanStartResult(String scanId, int totalImagesToBeClassified) {
            this.scanId = scanId;
            this.totalImagesToBeClassified = totalImagesToBeClassified;
            this.hasNewImages = totalImagesToBeClassified > 0; // 根据总数量判断是否有新增照片
        }
        
        public ScanStartResult(String scanId, int totalImagesToBeClassified, boolean hasNewImages) {
            this.scanId = scanId;
            this.totalImagesToBeClassified = totalImagesToBeClassified;
            this.hasNewImages = hasNewImages;
        }
    }
    
    /**
     * 🆕 启动基础扫描（阶段1、2、3a）
     * 执行目录扫描、文件比对、EXIF提取、截图检测，不执行AI分类
     * 注意：位置信息补全（根据GPS坐标查找城市）由JS层处理，原生层只提取GPS坐标
     * 
     * @param scanPaths 扫描路径列表（相对路径，如 "DCIM/Camera"）
     * @param compareLimit 文件比对限制（0表示不限制）
     * @return 扫描启动结果（包含scanId和totalImagesToBeClassified）
     */
    public ScanStartResult startBasicImageScan(List<String> scanPaths, int compareLimit) {
        currentScanId = "basic_scan_" + System.currentTimeMillis();
        
        // 重置扫描状态计数器
        totalFoundThisPhase = 0;
        processedThisPhase = 0;
        totalImagesToBeClassified = 0;
        imagesClassified = 0;
        
        // 阶段1: 目录扫描（扫描所有图片，不限制）
        fileLogger.d(TAG, "阶段1: 开始目录扫描");
        List<ImageInfo> allImages = scanDirectories(scanPaths);
        totalFoundThisPhase = allImages.size();
        fileLogger.d(TAG, "阶段1完成: 发现 " + totalFoundThisPhase + " 张图片");
        
        // 阶段2: 文件比对
        fileLogger.d(TAG, "阶段2: 开始文件比对");
        ComparisonResult comparisonResult = compareWithDatabase(allImages, compareLimit);
        List<ImageInfo> newImages = comparisonResult.newImages;
        List<String> deletedUris = comparisonResult.deletedUris;
        
        fileLogger.d(TAG, "阶段2完成: 新增 " + newImages.size() + " 张，删除 " + deletedUris.size() + " 张");
        
        // 删除已删除的图片
        if (!deletedUris.isEmpty()) {
            imageDataService.removeImagesByUris(deletedUris);
        }
        
        // 计算总数量：新增照片数量
        totalImagesToBeClassified = newImages.size();
        boolean hasNewImages = !newImages.isEmpty();
        
        fileLogger.d(TAG, "基础扫描总数量: " + totalImagesToBeClassified + " 张，是否有新增照片: " + hasNewImages);
        
        // 🔥 如果没有新增照片，直接返回，不启动后台扫描
        if (!hasNewImages) {
            fileLogger.d(TAG, "✅ 没有新增照片，跳过基础扫描流程");
            return new ScanStartResult(currentScanId, totalImagesToBeClassified, false);
        }
        
        // 在后台线程执行基础扫描阶段（EXIF提取、截图检测）
        executorService.execute(() -> {
            try {
                performBasicScan(currentScanId, newImages);
            } catch (Exception e) {
                fileLogger.e(TAG, "基础扫描过程发生错误", e);
                sendErrorEvent(currentScanId, "基础扫描失败: " + e.getMessage());
            }
        });
        
        return new ScanStartResult(currentScanId, totalImagesToBeClassified, true);
    }
    
    /**
     * 🆕 启动AI分类（阶段3b、3c）
     * 对NA分类图片或指定图片进行缓存查询和远程推理
     * 
     * @param scanId 扫描ID（可选，如果为null则自动生成）
     * @param imagesToClassify 指定需要分类的图片列表（可选，如果为null则读取所有NA分类图片）
     * @param userId 用户ID（可选，用于API请求）
     * @return 扫描启动结果（包含scanId和totalImagesToBeClassified）
     */
    public ScanStartResult startAiImageClassifyByContent(String scanId, List<ImageInfo> imagesToClassify, String userId) {
        // 如果没有提供scanId，生成新的
        if (scanId == null || scanId.isEmpty()) {
            currentScanId = "ai_classify_" + System.currentTimeMillis();
        } else {
            currentScanId = scanId;
        }
        
        // 重置扫描状态计数器
        totalFoundThisPhase = 0;
        processedThisPhase = 0;
        totalImagesToBeClassified = 0;
        imagesClassified = 0;
        
        // 准备需要分类的图片列表
        List<ImageInfo> naImages = new ArrayList<>();
        
        if (imagesToClassify != null && !imagesToClassify.isEmpty()) {
            // 如果指定了图片列表，直接使用
            naImages = imagesToClassify;
            fileLogger.d(TAG, "使用指定的 " + naImages.size() + " 张图片进行AI分类");
        } else {
            // 如果没有指定，读取所有NA分类的图片
            fileLogger.d(TAG, "🔍 开始查询NA分类图片...");
            List<Map<String, Object>> naImagesMap = imageDataService.getImagesByCategory("NA");
            int naCount = naImagesMap != null ? naImagesMap.size() : 0;
            fileLogger.d(TAG, "🔍 查询结果: naImagesMap=" + (naImagesMap != null ? "非空" : "null") + ", naCount=" + naCount);
            
            // 将 NA 分类的图片转换为 ImageInfo 列表
            if (naImagesMap != null && !naImagesMap.isEmpty()) {
                for (Map<String, Object> imageMap : naImagesMap) {
                    ImageInfo imageInfo = new ImageInfo();
                    imageInfo.uri = (String) imageMap.get("uri");
                    imageInfo.fileName = (String) imageMap.get("fileName");
                    // 注意：数据库表中没有 path 列，路径信息存储在 uri 字段中（content:// URI）
                    // path 字段可以为 null，不影响后续处理
                    imageInfo.path = null;
                    // id 字段在数据库中可能是 String 或 Long，需要转换为 String
                    Object idObj = imageMap.get("id");
                    if (idObj != null) {
                        imageInfo.id = idObj instanceof String ? (String) idObj : String.valueOf(idObj);
                    }
                    // 🔥 设置 width 和 height（从数据库读取）
                    Object widthObj = imageMap.get("width");
                    Object heightObj = imageMap.get("height");
                    if (widthObj instanceof Number) {
                        imageInfo.width = ((Number) widthObj).intValue();
                    }
                    if (heightObj instanceof Number) {
                        imageInfo.height = ((Number) heightObj).intValue();
                    }
                    naImages.add(imageInfo);
                }
                fileLogger.d(TAG, "查询到 " + naCount + " 张 NA 分类图片，将进行AI分类");
            } else {
                fileLogger.w(TAG, "⚠️ 未查询到NA分类图片，可能原因：1) 数据库中没有NA分类的图片 2) 所有图片都已分类完成");
            }
        }
        
        // 🔥 保存用户ID（用于API请求）
        this.userId = userId;
        
        // 计算总数量
        totalImagesToBeClassified = naImages.size();
        
        fileLogger.d(TAG, "AI分类总数量: " + totalImagesToBeClassified + " 张");
        if (userId != null && !userId.isEmpty()) {
            fileLogger.d(TAG, "用户ID: " + userId);
        }
        
        // 在后台线程执行AI分类阶段（缓存查询、远程推理）
        final List<ImageInfo> finalNaImages = naImages; // 需要在 lambda 中使用，需要 final
        executorService.execute(() -> {
            try {
                performAiClassification(currentScanId, finalNaImages);
            } catch (Exception e) {
                fileLogger.e(TAG, "AI分类过程发生错误", e);
                sendErrorEvent(currentScanId, "AI分类失败: " + e.getMessage());
            }
        });
        
        if (naImages.isEmpty()) {
            fileLogger.d(TAG, "没有图片需要AI分类（已启动后台线程，将发送完成事件）");
        }
        
        return new ScanStartResult(currentScanId, totalImagesToBeClassified);
    }
    
    /**
     * 🆕 执行基础扫描流程（阶段3a：照片基础信息扫描）
     * @param scanId 扫描ID
     * @param newImages 新增图片（需要基础信息扫描）
     */
    private void performBasicScan(String scanId, List<ImageInfo> newImages) {
        long scanStartTime = System.currentTimeMillis();
        fileLogger.d(TAG, "开始基础扫描阶段: " + scanId + ", 新增图片: " + newImages.size() + " 张");
        
        try {
            // 阶段3a: 照片基础信息扫描（只处理新增图片）
            if (!newImages.isEmpty()) {
                // 注意：进度事件在 scanBasicImageInfo 函数内部发送（开始和完成事件）
                scanBasicImageInfo(newImages);
                fileLogger.d(TAG, "阶段3a完成: 基础信息扫描完成");
                
                // 等待一小段时间，确保阶段3a的完成事件先被处理（避免事件顺序混乱）
                try {
                    Thread.sleep(50); // 50ms延迟，确保事件顺序
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            } else {
                fileLogger.d(TAG, "阶段3a: 没有新增图片，跳过基础信息扫描");
            }
            
            // 基础扫描完成（原生层部分完成，发送事件通知JS层继续处理位置信息补全）
            // JS层收到事件后会执行位置信息补全，然后发送最终完成消息
            completeBasicScan(scanId);
            
        } catch (Exception e) {
            fileLogger.e(TAG, "基础扫描过程发生错误", e);
            sendErrorEvent(scanId, "基础扫描失败: " + e.getMessage());
        }
    }
    
    /**
     * 🆕 执行AI分类流程（阶段3b、3c：缓存查询、远程推理）
     * @param scanId 扫描ID
     * @param naImages NA分类图片（需要缓存查询和远程推理）
     */
    private void performAiClassification(String scanId, List<ImageInfo> naImages) {
        long scanStartTime = System.currentTimeMillis();
        fileLogger.d(TAG, "开始AI分类阶段: " + scanId + ", NA分类图片: " + (naImages != null ? naImages.size() : 0) + " 张");
        
        try {
            if (naImages == null || naImages.isEmpty()) {
                fileLogger.d(TAG, "AI分类完成: 没有图片需要分类");
                completeAiClassification(scanId);
                return;
            }
            
            // 阶段3b: 远端缓存查询
            // 注意：进度事件在 queryRemoteCache 函数内部发送（开始和完成事件）
            CacheResult cacheResult = queryRemoteCache(naImages);
            fileLogger.d(TAG, "阶段3b完成: 缓存命中 " + cacheResult.hitCount + " 张，未命中 " + cacheResult.naImages.size() + " 张，总计 " + naImages.size() + " 张");
            
            // 等待一小段时间，确保阶段3b的完成事件先被处理（避免事件顺序混乱）
            try {
                Thread.sleep(50); // 50ms延迟，确保事件顺序
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            
            // 阶段3c: 远程推理
            // 注意：进度事件在 performRemoteInference 函数内部发送，确保消息能正确显示
            // 🔥 直接传递 cacheResult，包含 naImages 和 uriToHashMap（基于原图的hash，因为上传的是压缩后的图片）
            RemoteInferenceResult inferenceResult = performRemoteInference(cacheResult);
            fileLogger.d(TAG, "阶段3c完成: 推理成功 " + inferenceResult.successCount + " 张");
            
            // AI分类完成
            completeAiClassification(scanId);
            
        } catch (Exception e) {
            fileLogger.e(TAG, "AI分类过程发生错误", e);
            sendErrorEvent(scanId, "AI分类失败: " + e.getMessage());
        }
    }
    
    /**
     * 阶段1: 目录扫描
     * 扫描所有图片，不限制数量
     */
    private List<ImageInfo> scanDirectories(List<String> scanPaths) {
        List<ImageInfo> images = new ArrayList<>();
        
        try {
            fileLogger.d(TAG, "🔍 开始MediaStore查询，scanPaths=" + (scanPaths != null ? scanPaths.toString() : "null"));
            
            // 检查权限
            boolean hasPermission = false;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                // Android 13+ (API 33+)
                hasPermission = reactContext.checkSelfPermission("android.permission.READ_MEDIA_IMAGES") == PackageManager.PERMISSION_GRANTED;
                fileLogger.d(TAG, "📋 Android 13+ 权限检查: READ_MEDIA_IMAGES=" + hasPermission);
            } else {
                // Android 12 及以下
                hasPermission = reactContext.checkSelfPermission("android.permission.READ_EXTERNAL_STORAGE") == PackageManager.PERMISSION_GRANTED;
                fileLogger.d(TAG, "📋 Android 12- 权限检查: READ_EXTERNAL_STORAGE=" + hasPermission);
            }
            
            if (!hasPermission) {
                fileLogger.e(TAG, "❌ 没有相册访问权限，无法扫描图片");
                return images;
            }
            
            ContentResolver contentResolver = context.getContentResolver();
            
            // 🔥 根据 Android 版本动态构建 projection
            // Android 10 以下不支持 RELATIVE_PATH，会导致 SQL 查询失败
            List<String> projectionList = new ArrayList<>();
            projectionList.add(MediaStore.Images.Media._ID);
            projectionList.add(MediaStore.Images.Media.DISPLAY_NAME);
            projectionList.add(MediaStore.Images.Media.SIZE);
            projectionList.add(MediaStore.Images.Media.DATE_TAKEN);
            projectionList.add(MediaStore.Images.Media.DATE_MODIFIED);
            projectionList.add(MediaStore.Images.Media.DATE_ADDED);
            projectionList.add(MediaStore.Images.Media.WIDTH);
            projectionList.add(MediaStore.Images.Media.HEIGHT);
            projectionList.add(MediaStore.Images.Media.MIME_TYPE);
            projectionList.add(MediaStore.Images.Media.DATA); // 所有版本都查询 DATA
            
            // 🔥 Android 10+ (API 29+) 才添加 RELATIVE_PATH
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                projectionList.add(MediaStore.Images.Media.RELATIVE_PATH);
            }
            
            String[] projection = projectionList.toArray(new String[0]);
            
            String sortOrder = MediaStore.Images.Media.DATE_TAKEN + " DESC";
            Cursor cursor = contentResolver.query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                projection,
                null,
                null,
                sortOrder
            );
            
            if (cursor != null) {
                int cursorCount = cursor.getCount();
                fileLogger.d(TAG, "📊 MediaStore查询结果: Cursor总数=" + cursorCount);
                
                int processedCount = 0;
                int filteredCount = 0;
                
                while (cursor.moveToNext()) {
                    processedCount++;
                    
                    long id = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID));
                    String displayName = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME));
                    long size = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Images.Media.SIZE));
                    long dateTaken = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_TAKEN));
                    long dateModified = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_MODIFIED));
                    long dateAdded = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_ADDED));
                    int width = cursor.getInt(cursor.getColumnIndexOrThrow(MediaStore.Images.Media.WIDTH));
                    int height = cursor.getInt(cursor.getColumnIndexOrThrow(MediaStore.Images.Media.HEIGHT));
                    String mimeType = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.Images.Media.MIME_TYPE));
                    String path = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATA));
                    
                    // 🔥 读取 RELATIVE_PATH（只在 Android 10+ 可用）
                    int relativePathColumn = -1;
                    String relativePath = null;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        relativePathColumn = cursor.getColumnIndex(MediaStore.Images.Media.RELATIVE_PATH);
                        if (relativePathColumn >= 0) {
                            relativePath = cursor.getString(relativePathColumn);
                        }
                    }
                    
                    Uri contentUri = ContentUris.withAppendedId(
                        MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                        id
                    );
                    
                    ImageInfo imageInfo = new ImageInfo();
                    imageInfo.id = String.valueOf(id);
                    
                    // 构建拼装URI：优先使用绝对路径（path），如果没有则使用相对路径（relativePath）
                    // 与MediaStoreModule保持一致
                    String filePath = null;
                    if (path != null && !path.isEmpty()) {
                        filePath = path;
                    } else if (relativePath != null && !relativePath.isEmpty()) {
                        filePath = relativePath;
                    }
                    
                    // 使用辅助函数构建拼装URI
                    imageInfo.uri = buildCombinedUri(contentUri.toString(), filePath);
                    
                    // 🔧 确保 fileName 不为 null：如果 MediaStore 的 DISPLAY_NAME 为 null，从路径中提取
                    if (displayName == null || displayName.isEmpty()) {
                        // 尝试从路径中提取文件名
                        if (path != null && !path.isEmpty()) {
                            int lastSlash = path.lastIndexOf('/');
                            if (lastSlash >= 0 && lastSlash < path.length() - 1) {
                                displayName = path.substring(lastSlash + 1);
                            } else {
                                displayName = path;
                            }
                        } else if (relativePath != null && !relativePath.isEmpty()) {
                            // 从相对路径中提取
                            int lastSlash = relativePath.lastIndexOf('/');
                            if (lastSlash >= 0 && lastSlash < relativePath.length() - 1) {
                                displayName = relativePath.substring(lastSlash + 1);
                            } else {
                                displayName = relativePath;
                            }
                        } else {
                            // 最后的后备方案：使用 ID 生成文件名
                            displayName = "image_" + id + ".jpg";
                            fileLogger.w(TAG, "⚠️ MediaStore DISPLAY_NAME 为空，使用后备文件名: " + displayName);
                        }
                    }
                    imageInfo.fileName = displayName;
                    imageInfo.path = path;
                    imageInfo.relativePath = relativePath;
                    imageInfo.size = size;
                    imageInfo.dateTaken = dateTaken;
                    imageInfo.dateModified = dateModified * 1000; // 转换为毫秒
                    imageInfo.dateAdded = dateAdded * 1000; // 转换为毫秒
                    imageInfo.width = width;
                    imageInfo.height = height;
                    imageInfo.mimeType = mimeType;
                    
                    // 🔍 调试日志：记录尺寸为 0 的情况
                    if (width <= 0 || height <= 0) {
                        fileLogger.w(TAG, "⚠️ MediaStore尺寸为0: fileName=" + displayName + ", width=" + width + ", height=" + height + ", uri=" + contentUri);
                    }
                    
                    // 路径过滤（如果指定了扫描路径）
                    if (scanPaths == null || scanPaths.isEmpty() || isPathMatched(imageInfo, scanPaths)) {
                        images.add(imageInfo);
                    } else {
                        filteredCount++;
                    }
                }
                
                fileLogger.d(TAG, "📊 MediaStore扫描完成: 处理=" + processedCount + ", 过滤=" + filteredCount + ", 最终=" + images.size());
                cursor.close();
            } else {
                fileLogger.w(TAG, "⚠️ MediaStore查询返回null Cursor，可能没有权限或MediaStore未初始化");
            }

            // 🎬 视频：并行查询 MediaStore.Video（结构同图片，mimeType 为 video/*）。类别先按 NA 入库，
            // 由 JS 端 migrateUnclassifiedVideos() 迁到「待分类视频」NA_video；缩略图由 Glide 解视频首帧。
            try {
                List<String> vProj = new ArrayList<>();
                vProj.add(MediaStore.Video.Media._ID);
                vProj.add(MediaStore.Video.Media.DISPLAY_NAME);
                vProj.add(MediaStore.Video.Media.SIZE);
                vProj.add(MediaStore.Video.Media.DATE_TAKEN);
                vProj.add(MediaStore.Video.Media.DATE_MODIFIED);
                vProj.add(MediaStore.Video.Media.DATE_ADDED);
                vProj.add(MediaStore.Video.Media.WIDTH);
                vProj.add(MediaStore.Video.Media.HEIGHT);
                vProj.add(MediaStore.Video.Media.MIME_TYPE);
                vProj.add(MediaStore.Video.Media.DATA);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    vProj.add(MediaStore.Video.Media.RELATIVE_PATH);
                }
                Cursor vCursor = contentResolver.query(
                    MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                    vProj.toArray(new String[0]),
                    null, null,
                    MediaStore.Video.Media.DATE_TAKEN + " DESC"
                );
                if (vCursor != null) {
                    while (vCursor.moveToNext()) {
                        long id = vCursor.getLong(vCursor.getColumnIndexOrThrow(MediaStore.Video.Media._ID));
                        String displayName = vCursor.getString(vCursor.getColumnIndexOrThrow(MediaStore.Video.Media.DISPLAY_NAME));
                        long size = vCursor.getLong(vCursor.getColumnIndexOrThrow(MediaStore.Video.Media.SIZE));
                        long dateTaken = vCursor.getLong(vCursor.getColumnIndexOrThrow(MediaStore.Video.Media.DATE_TAKEN));
                        long dateModified = vCursor.getLong(vCursor.getColumnIndexOrThrow(MediaStore.Video.Media.DATE_MODIFIED));
                        long dateAdded = vCursor.getLong(vCursor.getColumnIndexOrThrow(MediaStore.Video.Media.DATE_ADDED));
                        int width = vCursor.getInt(vCursor.getColumnIndexOrThrow(MediaStore.Video.Media.WIDTH));
                        int height = vCursor.getInt(vCursor.getColumnIndexOrThrow(MediaStore.Video.Media.HEIGHT));
                        String mimeType = vCursor.getString(vCursor.getColumnIndexOrThrow(MediaStore.Video.Media.MIME_TYPE));
                        String path = vCursor.getString(vCursor.getColumnIndexOrThrow(MediaStore.Video.Media.DATA));
                        String relativePath = null;
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                            int rpc = vCursor.getColumnIndex(MediaStore.Video.Media.RELATIVE_PATH);
                            if (rpc >= 0) relativePath = vCursor.getString(rpc);
                        }
                        Uri contentUri = ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, id);
                        ImageInfo vi = new ImageInfo();
                        vi.id = String.valueOf(id);
                        String filePath = (path != null && !path.isEmpty()) ? path : relativePath;
                        vi.uri = buildCombinedUri(contentUri.toString(), filePath);
                        if (displayName == null || displayName.isEmpty()) displayName = "video_" + id + ".mp4";
                        vi.fileName = displayName;
                        vi.path = path;
                        vi.relativePath = relativePath;
                        vi.size = size;
                        // 视频的 DATE_TAKEN 常为 0（MediaStore 对视频不填）→ 回退 DATE_ADDED/DATE_MODIFIED，
                        // 否则 takenAt=0 会被时间分桶判为「更早(past)」，不出现在近期时间视图里。
                        vi.dateTaken = (dateTaken > 0) ? dateTaken
                            : (dateAdded > 0 ? dateAdded * 1000L : dateModified * 1000L);
                        vi.dateModified = dateModified * 1000;
                        vi.dateAdded = dateAdded * 1000;
                        vi.width = width;
                        vi.height = height;
                        vi.mimeType = (mimeType != null && !mimeType.isEmpty()) ? mimeType : "video/mp4";
                        if (scanPaths == null || scanPaths.isEmpty() || isPathMatched(vi, scanPaths)) {
                            images.add(vi);
                        }
                    }
                    fileLogger.d(TAG, "🎬 视频扫描: " + vCursor.getCount() + " 个");
                    vCursor.close();
                }
            } catch (Exception e) {
                fileLogger.e(TAG, "❌ 视频扫描失败（不影响图片）: " + e.getMessage(), e);
            }
        } catch (SecurityException e) {
            fileLogger.e(TAG, "❌ 目录扫描权限错误: " + e.getMessage(), e);
        } catch (Exception e) {
            fileLogger.e(TAG, "❌ 目录扫描失败: " + e.getMessage(), e);
        }

        fileLogger.d(TAG, "✅ scanDirectories返回 " + images.size() + " 项（图片+视频）");
        return images;
    }
    
    /**
     * 检查路径是否匹配扫描路径
     */
    /**
     * 从绝对路径中提取相对路径部分（去掉外部存储标准前缀）
     * @param absolutePath 绝对路径，如 "/storage/emulated/0/DCIM/Camera"
     * @return 相对路径部分，如 "DCIM/Camera"
     */
    private String extractRelativePath(String absolutePath) {
        if (absolutePath == null || absolutePath.isEmpty()) {
            return absolutePath;
        }
        
        // Android 外部存储的标准路径前缀
        String[] prefixes = {
            "/storage/emulated/0/",
            "/sdcard/",
            "/mnt/sdcard/",
            android.os.Environment.getExternalStorageDirectory().getAbsolutePath() + "/"
        };
        
        // 尝试去掉各种前缀
        for (String prefix : prefixes) {
            if (absolutePath.startsWith(prefix)) {
                String relative = absolutePath.substring(prefix.length());
                // 去掉尾部斜杠（如果有）
                if (relative.endsWith("/")) {
                    relative = relative.substring(0, relative.length() - 1);
                }
                return relative;
            }
        }
        
        // 如果没有匹配的前缀，返回原路径（可能是相对路径）
        return absolutePath;
    }
    
    /**
     * 规范化路径：去掉尾部斜杠，统一格式
     * @param path 路径字符串
     * @return 规范化后的路径
     */
    private String normalizePath(String path) {
        if (path == null || path.isEmpty()) {
            return path;
        }
        // 去掉尾部斜杠
        if (path.endsWith("/")) {
            path = path.substring(0, path.length() - 1);
        }
        return path;
    }
    
    /**
     * 检查图片路径是否匹配扫描路径
     * 支持绝对路径和相对路径两种格式的匹配
     * @param imageInfo 图片信息
     * @param scanPaths 扫描路径列表（绝对路径，如 "/storage/emulated/0/DCIM/Camera"）
     * @return 是否匹配
     */
    private boolean isPathMatched(ImageInfo imageInfo, List<String> scanPaths) {
        if (scanPaths == null || scanPaths.isEmpty()) {
            return true;
        }
        
        // 如果图片路径都为空，不匹配
        if (imageInfo.path == null && imageInfo.relativePath == null) {
            return false;
        }
        
        for (String scanPath : scanPaths) {
            if (scanPath == null || scanPath.isEmpty()) {
                continue;
            }
            
            // 规范化扫描路径
            String normalizedScanPath = normalizePath(scanPath);
            
            // 情况1：检查绝对路径匹配（如果 imageInfo.path 存在）
            if (imageInfo.path != null && !imageInfo.path.isEmpty()) {
                String normalizedImagePath = normalizePath(imageInfo.path);
                if (normalizedImagePath.startsWith(normalizedScanPath) || 
                    normalizedImagePath.contains(normalizedScanPath)) {
                    return true;
                }
            }
            
            // 情况2：检查相对路径匹配（如果 imageInfo.relativePath 存在）
            if (imageInfo.relativePath != null && !imageInfo.relativePath.isEmpty()) {
                // 从绝对路径中提取相对路径部分
                String scanRelativePath = extractRelativePath(normalizedScanPath);
                String normalizedImageRelativePath = normalizePath(imageInfo.relativePath);
                
                // 匹配相对路径
                if (normalizedImageRelativePath.startsWith(scanRelativePath) || 
                    normalizedImageRelativePath.contains(scanRelativePath)) {
                    return true;
                }
            }
        }
        
        return false;
    }
    
    /**
     * 阶段2: 文件比对
     * 
     * compareLimit的作用：
     * - 当扫描到大量图片（如几万张）时，比对所有图片会很慢
     * - compareLimit限制只比对最新的N张图片（按时间排序）
     * - 这样可以快速识别新增的图片，而忽略旧图片的比对
     * - 用户通常只关心新增的图片，所以这个优化是合理的
     */
    private ComparisonResult compareWithDatabase(List<ImageInfo> scannedImages, int compareLimit) {
        ComparisonResult result = new ComparisonResult();
        result.newImages = new ArrayList<>();
        result.deletedUris = new ArrayList<>();
        
        try {
            // 获取数据库中的现有URI
            Set<String> existingUris = getExistingImageUris();
            
            // 限制比对数量（如果设置了限制）
            // 注意：scannedImages已经按DATE_TAKEN DESC排序，所以最新的在前面
            List<ImageInfo> imagesToCompare = scannedImages;
            if (compareLimit > 0 && scannedImages.size() > compareLimit) {
                // 只比对最新的compareLimit张图片（已经按时间倒序排列）
                imagesToCompare = new ArrayList<>(scannedImages.subList(0, compareLimit));
                fileLogger.d(TAG, "比对限制生效: 扫描到 " + scannedImages.size() + " 张，只比对最新的 " + compareLimit + " 张");
            }
            
            // 找出新增的图片
            Set<String> currentUris = new HashSet<>();
            for (ImageInfo image : imagesToCompare) {
                currentUris.add(image.uri);
                if (!existingUris.contains(image.uri)) {
                    result.newImages.add(image);
                }
            }
            
            // 找出删除的图片
            for (String existingUri : existingUris) {
                if (!currentUris.contains(existingUri)) {
                    result.deletedUris.add(existingUri);
                }
            }
            
            result.newCount = result.newImages.size();
            result.deletedCount = result.deletedUris.size();
            
        } catch (Exception e) {
            fileLogger.e(TAG, "文件比对失败", e);
        }
        
        return result;
    }
    
    /**
     * 从数据库获取所有现有图片URI
     */
    private Set<String> getExistingImageUris() {
        Set<String> uris = new HashSet<>();
        
        try {
            // 使用ImageDataService查询
            List<String> uriList = imageDataService.getImageUris();
            uris.addAll(uriList);
        } catch (Exception e) {
            fileLogger.e(TAG, "获取现有URI失败", e);
        }
        
        return uris;
    }
    
    /**
     * 阶段3a: 照片基础信息扫描
     * 包含EXIF数据提取、截图检测、保存基础信息
     * 注意：位置信息补全（根据GPS坐标查找城市）由JS层处理，原生层只提取GPS坐标
     * 使用批量保存优化性能
     * @param images 待扫描的图片列表
     */
    private void scanBasicImageInfo(List<ImageInfo> images) {
        // 初始化阶段级统计变量
        processedThisPhase = 0;
        totalFoundThisPhase = images.size();
        fileLogger.d(TAG, "阶段3a开始: 照片基础信息扫描，待处理图片: " + totalFoundThisPhase + " 张");
        
        // 发送阶段开始进度事件
        if (totalFoundThisPhase > 0) {
            sendProgressEvent("screenshot_detection", 0, totalFoundThisPhase, currentScanId);
        }
        
        List<ImageInfo> naImages = new ArrayList<>();
        
        // 批量处理（每批100张，与JS层保持一致）
        int batchSize = 100;
        List<ImageDataWithExif> batchSaveData = new ArrayList<>();
        
        // 🔥 统计信息：跟踪尺寸获取情况
        int bitmapFactoryFallbackCount = 0; // 使用BitmapFactory降级方案的图片数量
        int noDimensionsCount = 0; // 最终仍然没有尺寸的图片数量
        
        for (int i = 0; i < images.size(); i++) {
            ImageInfo image = images.get(i);
            
            try {
                // 1. 提取EXIF数据（包括GPS坐标）
                ExifData exifData = extractExifData(image.uri);
                
                // 🔥 新增：如果EXIF没有尺寸，使用BitmapFactory作为降级方案
                if (exifData.dimensions == null || exifData.dimensions.width <= 0 || exifData.dimensions.height <= 0) {
                    ImageDimensions bitmapDimensions = getImageDimensionsWithBitmapFactory(image);
                    if (bitmapDimensions != null && bitmapDimensions.width > 0 && bitmapDimensions.height > 0) {
                        exifData.dimensions = bitmapDimensions;
                        bitmapFactoryFallbackCount++;
                    } else {
                        // ❌ BitmapFactory也失败了，这是异常情况
                        // 记录详细错误信息，帮助诊断问题
                        noDimensionsCount++;
                        fileLogger.w(TAG, "⚠️ 图片尺寸获取失败（EXIF和BitmapFactory都失败）: fileName=" + image.fileName + 
                              ", uri=" + image.uri +
                              ", MediaStoreWidth=" + image.width + 
                              ", MediaStoreHeight=" + image.height +
                              " - 将在保存时再次尝试从MediaStore获取");
                        // 不设置exifData.dimensions，让后续代码尝试使用MediaStore的尺寸
                    }
                }
                
                // 注意：GPS位置查找（根据GPS坐标查找城市信息）保留在JS层实现
                // JS层在后续处理时会调用 enrichLocationInfoWithCity 来补充城市信息
                // 原生层只负责提取GPS坐标，不进行城市查找
                
                // 2. 使用EXIF数据优化截图检测
                boolean isScreenshot = isScreenshot(image, exifData);
                
                // 3. 如果不是截图，设置为 NA（二维码检测由后端服务完成）
                String category;
                double confidence;
                if (isScreenshot) {
                    category = "screenshot";
                    confidence = 1.0;
                } else {
                    category = "NA";
                    confidence = 0.0;
                }
                
                // 统计（只有分类有差异）
                if ("screenshot".equals(category)) {
                    // 分类成功，累加计数器
                    imagesClassified++;
                } else {
                    naImages.add(image);
                }


                
                // 处理计数累加（每处理一张图片就累加）
                processedThisPhase++;

                
                // 数据存储逻辑统一（只有category和confidence值不同）
                ImageDataWithExif imageData = new ImageDataWithExif();
                imageData.image = image;
                imageData.category = category;
                imageData.confidence = confidence;
                imageData.exifData = exifData;
                batchSaveData.add(imageData);
                
                // 🔥 优化：定期保持线程活跃（每处理10张图片）
                // 1. 检查线程是否被中断
                if (Thread.currentThread().isInterrupted()) {
                    fileLogger.w(TAG, "扫描线程被中断，停止处理");
                    break;
                }
                
                // 2. 短暂睡眠让线程进入可调度状态（比 Thread.yield() 更可靠）
                if (i % 10 == 0) {
                    SystemClock.sleep(1); // 1ms睡眠，让系统有机会调度
                }
                
                // 3. 更频繁的进度更新（每20张图片更新一次，而不是每100张）
                if (i % 20 == 0 && i > 0) {
                    sendProgressEvent("screenshot_detection", processedThisPhase, totalFoundThisPhase, currentScanId);
                }
                
                // 4. 批量保存（每批100张或最后一张）
                if (batchSaveData.size() >= batchSize || i == images.size() - 1) {
                    if (!batchSaveData.isEmpty()) {
                        try {
                            batchSaveImages(batchSaveData);
                        } catch (Exception e) {
                            // 🔥 改进：批量保存失败时记录错误但继续处理，不停止整个流程
                            // batchSaveImages 内部已经处理了单张图片失败的情况，这里只处理数据库操作异常
                            fileLogger.e(TAG, "❌ 批量保存失败，跳过这批图片，继续处理: " + e.getMessage(), e);
                            // 不重新抛出异常，继续处理后续图片
                        }
                        batchSaveData.clear();
                    }
                    
                    // 发送进度更新（每处理一个批次就更新一次，与JS层保持一致）
                    sendProgressEvent("screenshot_detection", processedThisPhase, totalFoundThisPhase, currentScanId);
                }
                
            } catch (Exception e) {
                // ❌ 严格错误处理：记录详细错误信息，不保存错误数据
                fileLogger.e(TAG, "❌ 处理图片失败，跳过保存: uri=" + image.uri + 
                      ", fileName=" + (image.fileName != null ? image.fileName : "null") + 
                      ", id=" + image.id, e);
                // 不添加到 batchSaveData，让错误在源头就被发现和处理
                // 处理计数不累加，因为这张图片没有被成功处理
                // 如果需要，可以添加到失败列表用于后续重试
            }
        }
        
        // 保存最后剩余的批次（如果还有）
        if (!batchSaveData.isEmpty()) {
            try {
                batchSaveImages(batchSaveData);
            } catch (Exception e) {
                // 🔥 改进：最后批次保存失败时记录错误但继续，不停止整个流程
                fileLogger.e(TAG, "❌ 最后批次保存失败: " + e.getMessage(), e);
            }
        }
        
        // 🔥 输出统计信息
        fileLogger.i(TAG, "📊 照片基础信息扫描阶段统计: 总处理=" + images.size() + 
              ", BitmapFactory降级=" + bitmapFactoryFallbackCount + 
              ", 无尺寸=" + noDimensionsCount + 
              ", 截图分类=" + imagesClassified + 
              ", 剩余待处理=" + naImages.size());
    }
    
    /**
     * 批量保存图片数据到数据库
     * 注意：位置信息补全（根据GPS坐标查找城市）由JS层处理，原生层只保存GPS坐标
     * @param imageDataList 图片数据列表
     */
    private void batchSaveImages(List<ImageDataWithExif> imageDataList) {
        try {
            List<Map<String, Object>> saveDataList = new ArrayList<>();
            
            for (ImageDataWithExif item : imageDataList) {
                try {
                    // 1. 验证必填字段：uri
                    if (item.image.uri == null || item.image.uri.isEmpty()) {
                        fileLogger.e(TAG, "❌ 图片数据验证失败: uri 为空, id=" + item.image.id);
                        continue; // 跳过这张图片，继续处理其他图片
                    }
                    
                    // 2. 验证必填字段：fileName
                    String fileName = item.image.fileName;
                    if (fileName == null || fileName.isEmpty()) {
                        fileLogger.e(TAG, "❌ 图片数据验证失败: fileName 为空, uri=" + item.image.uri + 
                              ", id=" + item.image.id);
                        continue; // 跳过这张图片，继续处理其他图片
                    }
                    
                    // 3. 验证必填字段：category
                    String category = item.category;
                    if (category == null || category.isEmpty()) {
                        fileLogger.e(TAG, "❌ 图片数据验证失败: category 为空, uri=" + item.image.uri + 
                              ", fileName=" + fileName + ", id=" + item.image.id);
                        continue; // 跳过这张图片，继续处理其他图片
                    }
                    
                    // 4. 验证关键字段：尺寸（width 和 height 必须 > 0）
                    int finalWidth = 0;
                    int finalHeight = 0;
                    String dimensionSource = "unknown";
                    boolean hasValidDimensions = false;
                    
                    if (item.exifData != null && item.exifData.dimensions != null && 
                        item.exifData.dimensions.width > 0 && item.exifData.dimensions.height > 0) {
                        finalWidth = item.exifData.dimensions.width;
                        finalHeight = item.exifData.dimensions.height;
                        dimensionSource = "exifData.dimensions";
                        hasValidDimensions = true;
                    } else if (item.image.width > 0 && item.image.height > 0) {
                        finalWidth = item.image.width;
                        finalHeight = item.image.height;
                        dimensionSource = "MediaStore";
                        hasValidDimensions = true;
                    }
                    
                    // 🔥 改进：如果尺寸验证失败，尝试最后一次降级方案（Content URI）
                    if (!hasValidDimensions) {
                        ImageDimensions bitmapDimensions = getImageDimensionsWithBitmapFactory(item.image);
                        if (bitmapDimensions != null && bitmapDimensions.width > 0 && bitmapDimensions.height > 0) {
                            finalWidth = bitmapDimensions.width;
                            finalHeight = bitmapDimensions.height;
                            dimensionSource = "BitmapFactory(ContentURI)";
                            hasValidDimensions = true;
                        }
                    }
                    
                    // 🔥 改进：如果仍然没有尺寸，记录警告但允许保存（尺寸设为0）
                    if (!hasValidDimensions) {
                        fileLogger.w(TAG, "⚠️ 图片尺寸获取失败，所有方法都失败，允许保存但尺寸为0: fileName=" + fileName + 
                              ", uri=" + item.image.uri +
                              ", id=" + item.image.id +
                              ", hasExifData=" + (item.exifData != null) +
                              ", hasExifDimensions=" + (item.exifData != null && item.exifData.dimensions != null) +
                              ", exifWidth=" + (item.exifData != null && item.exifData.dimensions != null ? item.exifData.dimensions.width : 0) +
                              ", exifHeight=" + (item.exifData != null && item.exifData.dimensions != null ? item.exifData.dimensions.height : 0) +
                              ", MediaStoreWidth=" + item.image.width + 
                              ", MediaStoreHeight=" + item.image.height);
                        // 不抛出异常，允许保存，但尺寸为0
                        finalWidth = 0;
                        finalHeight = 0;
                    }
                
                // 数据验证通过，开始构建保存数据
                Map<String, Object> imageData = new HashMap<>();
                imageData.put("uri", item.image.uri);
                imageData.put("fileName", fileName);
                imageData.put("category", category);
                imageData.put("confidence", item.confidence);
                // timestamp 使用图片的创建时间（优先 dateTaken，否则 dateModified 或 dateAdded）
                long timestamp = item.image.dateTaken > 0 ? item.image.dateTaken : 
                                 (item.image.dateModified > 0 ? item.image.dateModified : item.image.dateAdded);
                imageData.put("timestamp", timestamp);
                
                // 优先使用EXIF中的拍摄时间，如果没有则使用MediaStore的时间（如果有效）
                if (item.exifData != null && item.exifData.hasTakenTime && item.exifData.takenTime > 0) {
                    imageData.put("takenAt", item.exifData.takenTime);
                } else if (item.image.dateTaken > 0) {
                    // 只有当 dateTaken 有效时才设置，否则不设置（保持 null）
                    imageData.put("takenAt", item.image.dateTaken);
                }
                // 如果都没有有效时间，不设置 takenAt（保持 null），与 JS 层保持一致
                
                imageData.put("size", item.image.size);
                imageData.put("mimeType", item.image.mimeType);
                
                // 设置已验证的尺寸字段（已验证 > 0）
                imageData.put("width", finalWidth);
                imageData.put("height", finalHeight);
                
                // 设置 imageDimensions 字段（JS层使用此字段）
                Map<String, Object> imageDimensions = new HashMap<>();
                imageDimensions.put("width", finalWidth);
                imageDimensions.put("height", finalHeight);
                imageData.put("imageDimensions", imageDimensions);
                
                // GPS信息
                if (item.exifData != null && item.exifData.hasGPS && item.exifData.gps != null) {
                    imageData.put("latitude", item.exifData.gps.latitude);
                    imageData.put("longitude", item.exifData.gps.longitude);
                    if (item.exifData.gps.altitude != null) {
                        imageData.put("altitude", item.exifData.gps.altitude);
                    }
                }
                
                // 🔥 拍摄参数（ISO、光圈、快门速度、焦距）- 与PC端对齐
                if (item.exifData != null && item.exifData.cameraSettings != null) {
                    CameraSettings settings = item.exifData.cameraSettings;
                    
                    // 🔧 验证并只保存有效的参数值（> 0）
                    boolean hasAnySetting = false;
                    JSONObject jsonObject = new JSONObject();
                    
                    // ISO必须 > 0
                    if (settings.iso != null && settings.iso > 0) {
                        jsonObject.put("iso", settings.iso);
                        hasAnySetting = true;
                    }
                    
                    // 光圈必须 > 0
                    if (settings.aperture != null && settings.aperture > 0) {
                        jsonObject.put("aperture", settings.aperture);
                        hasAnySetting = true;
                    }
                    
                    // 快门速度必须 > 0
                    if (settings.shutterSpeed != null && settings.shutterSpeed > 0) {
                        jsonObject.put("shutterSpeed", settings.shutterSpeed);
                        hasAnySetting = true;
                    }
                    
                    // 焦距必须 > 0
                    if (settings.focalLength != null && settings.focalLength > 0) {
                        jsonObject.put("focalLength", settings.focalLength);
                        hasAnySetting = true;
                    }
            
                    // 如果至少有一个有效参数，保存为JSON字符串（与PC端格式一致）
                    if (hasAnySetting) {
                        try {
                            imageData.put("cameraSettings", jsonObject.toString());
                        } catch (Exception e) {
                            fileLogger.w(TAG, "序列化cameraSettings失败: " + item.image.fileName, e);
                        }
                    }
                }
                
                saveDataList.add(imageData);
                
                } catch (Exception e) {
                    // 🔥 改进：单张图片处理失败时，记录错误但继续处理其他图片
                    fileLogger.e(TAG, "❌ 处理单张图片失败，跳过: uri=" + item.image.uri + 
                          ", fileName=" + (item.image.fileName != null ? item.image.fileName : "null") + 
                          ", id=" + item.image.id, e);
                    // 继续处理下一张图片，不抛出异常
                }
            }
            
            // 批量保存到数据库（只保存成功构建的数据）
            if (!saveDataList.isEmpty()) {
                imageDataService.writeImageDetailedInfo(saveDataList);
                fileLogger.d(TAG, "批量保存完成: " + saveDataList.size() + "/" + imageDataList.size() + " 张图片");
            } else {
                fileLogger.w(TAG, "⚠️ 批量保存：没有有效数据可保存，所有图片处理都失败");
            }
            
        } catch (Exception e) {
            // 数据库操作异常才抛出
            fileLogger.e(TAG, "❌ 批量保存图片失败：数据库操作异常", e);
            throw new RuntimeException("批量保存图片失败", e);
        }
    }
    
    /**
     * 图片数据与EXIF数据组合类（用于批量保存）
     */
    private static class ImageDataWithExif {
        public ImageInfo image;
        public String category;
        public double confidence;
        public ExifData exifData;
    }
    
    /**
     * URI处理辅助函数
     */
    
    /**
     * 构建拼装URI格式：contentUri||filePath
     * 与JS层保持一致，JS层使用这种格式存储到数据库
     * @param contentUri Content URI字符串（如：content://media/external/images/media/123）
     * @param filePath 文件路径（绝对路径或相对路径），可以为null
     * @return 拼装后的URI字符串
     */
    private String buildCombinedUri(String contentUri, String filePath) {
        if (filePath != null && !filePath.isEmpty()) {
            return contentUri + "||" + filePath;
        }
        return contentUri;
    }
    
    /**
     * 解析拼装URI，提取contentUri部分
     * @param combinedUri 拼装URI（contentUri||filePath格式）或普通URI
     * @return contentUri字符串
     */
    private String extractContentUri(String combinedUri) {
        if (combinedUri == null || combinedUri.isEmpty()) {
            return null;
        }
        
        int separatorIndex = combinedUri.indexOf("||");
        if (separatorIndex >= 0) {
            // 提取contentUri部分（分隔符之前的部分）
            return combinedUri.substring(0, separatorIndex);
        }
        
        // 如果没有分隔符，检查是否是content:// URI
        if (combinedUri.startsWith("content://")) {
            return combinedUri;
        }
        
        return null;
    }
    
    /**
     * 解析拼装URI，提取filePath部分
     * @param combinedUri 拼装URI（contentUri||filePath格式）或普通URI
     * @return filePath字符串，如果没有则返回null
     */
    private String extractFilePath(String combinedUri) {
        if (combinedUri == null || combinedUri.isEmpty()) {
            return null;
        }
        
        int separatorIndex = combinedUri.indexOf("||");
        if (separatorIndex >= 0) {
            // 提取filePath部分（分隔符之后的部分）
            return combinedUri.substring(separatorIndex + 2);
        }
        
        return null;
    }
    
    /**
     * 将文件路径转换为file:// URI
     * @param filePath 文件路径（绝对路径或相对路径）
     * @return file:// URI字符串，如果路径无效则返回null
     */
    private String buildFileUri(String filePath) {
        if (filePath == null || filePath.isEmpty()) {
            return null;
        }
        
        // 如果已经是file:// URI，直接返回
        if (filePath.startsWith("file://")) {
            return filePath;
        }
        
        // 构建file:// URI
        return "file://" + filePath;
    }
    
    /**
     * 从拼装URI中提取file:// URI
     * @param combinedUri 拼装URI（contentUri||filePath格式）
     * @return file:// URI字符串，如果无法提取则返回null
     */
    private String extractFileUri(String combinedUri) {
        String filePath = extractFilePath(combinedUri);
        if (filePath != null) {
            return buildFileUri(filePath);
        }
        return null;
    }
    
    private ExifData extractExifData(String uriString) {
        ExifData exifData = new ExifData();
        exifData.uri = uriString;
        exifData.hasGPS = false;
        exifData.hasTakenTime = false;
        
        InputStream inputStream = null;
        try {
            // 使用辅助函数提取contentUri
            String contentUriString = extractContentUri(uriString);
            if (contentUriString == null) {
                fileLogger.w(TAG, "无法提取contentUri: " + uriString);
                return exifData;
            }
            
            Uri uri = Uri.parse(contentUriString);
            ContentResolver contentResolver = context.getContentResolver();
            
            // Android 10+ 需要使用setRequireOriginal获取原始图片（包含完整EXIF）
            Uri originalUri = uri;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                try {
                    originalUri = MediaStore.setRequireOriginal(uri);
                } catch (Exception e) {
                    fileLogger.w(TAG, "无法获取原始图片，使用普通URI: " + e.getMessage());
                }
            }
            
            inputStream = contentResolver.openInputStream(originalUri);
            if (inputStream == null) {
                fileLogger.w(TAG, "无法打开图片流: " + uriString);
                return exifData;
            }
            
            ExifInterface exif = new ExifInterface(inputStream);
            
            // 提取拍摄时间
            String dateTimeOriginal = exif.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL);
            String dateTime = exif.getAttribute(ExifInterface.TAG_DATETIME);
            String dateTimeDigitized = exif.getAttribute(ExifInterface.TAG_DATETIME_DIGITIZED);
            
            if (dateTimeOriginal != null) {
                exifData.takenTime = parseExifDateTime(dateTimeOriginal);
                exifData.hasTakenTime = exifData.takenTime > 0;
            } else if (dateTime != null) {
                exifData.takenTime = parseExifDateTime(dateTime);
                exifData.hasTakenTime = exifData.takenTime > 0;
            } else if (dateTimeDigitized != null) {
                exifData.takenTime = parseExifDateTime(dateTimeDigitized);
                exifData.hasTakenTime = exifData.takenTime > 0;
            }
            
            // 提取GPS信息
            float[] latLong = new float[2];
            boolean hasGPS = exif.getLatLong(latLong);
            
            if (hasGPS) {
                exifData.gps = new GpsInfo();
                exifData.gps.latitude = latLong[0];
                exifData.gps.longitude = latLong[1];
                
                // 提取GPS高度
                double altitude = exif.getAltitude(0);
                if (altitude != 0) {
                    exifData.gps.altitude = altitude;
                }
                
                exifData.hasGPS = true;
            }
            
            // 提取图片尺寸（如果EXIF中有，优先使用EXIF的）
            int imageWidth = exif.getAttributeInt(ExifInterface.TAG_IMAGE_WIDTH, 0);
            int imageHeight = exif.getAttributeInt(ExifInterface.TAG_IMAGE_LENGTH, 0);
            if (imageWidth > 0 && imageHeight > 0) {
                exifData.dimensions = new ImageDimensions();
                exifData.dimensions.width = imageWidth;
                exifData.dimensions.height = imageHeight;
            }
            // 如果EXIF没有尺寸，不记录日志（避免日志过多，会在阶段结束时统计）
            
            // 🔥 提取拍摄参数（ISO、光圈、快门速度、焦距）- 与PC端对齐
            exifData.cameraSettings = new CameraSettings();
            
            // ISO感光度（必须 > 0）
            String isoStr = exif.getAttribute(ExifInterface.TAG_ISO_SPEED_RATINGS);
            if (isoStr != null && !isoStr.isEmpty()) {
                try {
                    // ISO值可能是字符串，如 "100" 或 "ISO 100"，尝试提取数字
                    String isoNumStr = isoStr.replaceAll("[^0-9]", "");
                    if (!isoNumStr.isEmpty()) {
                        int isoValue = Integer.parseInt(isoNumStr);
                        // 🔧 验证：ISO必须 > 0
                        if (isoValue > 0) {
                            exifData.cameraSettings.iso = isoValue;
                        }
                    }
                } catch (NumberFormatException e) {
                    // 忽略解析失败
                }
            }
            
            // 光圈值（FNumber，必须 > 0）
            String fNumberStr = exif.getAttribute(ExifInterface.TAG_F_NUMBER);
            if (fNumberStr != null && !fNumberStr.isEmpty()) {
                try {
                    // FNumber格式通常是 "f/2.8" 或 "2.8"，提取数字部分
                    String fNumStr = fNumberStr.replaceAll("[^0-9.]", "");
                    if (!fNumStr.isEmpty()) {
                        double apertureValue = Double.parseDouble(fNumStr);
                        // 🔧 验证：光圈必须 > 0
                        if (apertureValue > 0) {
                            exifData.cameraSettings.aperture = apertureValue;
                        }
                    }
                } catch (NumberFormatException e) {
                    // 忽略解析失败
                }
            }
            
            // 快门速度（ExposureTime，必须 > 0）
            String exposureTimeStr = exif.getAttribute(ExifInterface.TAG_EXPOSURE_TIME);
            if (exposureTimeStr != null && !exposureTimeStr.isEmpty()) {
                try {
                    // ExposureTime格式通常是分数，如 "1/125" 或小数 "0.008"
                    double shutterSpeedValue = 0.0;
                    if (exposureTimeStr.contains("/")) {
                        String[] parts = exposureTimeStr.split("/");
                        if (parts.length == 2) {
                            double numerator = Double.parseDouble(parts[0]);
                            double denominator = Double.parseDouble(parts[1]);
                            if (denominator > 0) {
                                shutterSpeedValue = numerator / denominator;
                            }
                        }
                    } else {
                        shutterSpeedValue = Double.parseDouble(exposureTimeStr);
                    }
                    
                    // 🔧 验证：快门速度必须 > 0
                    if (shutterSpeedValue > 0) {
                        exifData.cameraSettings.shutterSpeed = shutterSpeedValue;
                    }
                } catch (NumberFormatException e) {
                    // 忽略解析失败
                }
            }
            
            // 焦距（FocalLength，必须 > 0）
            String focalLengthStr = exif.getAttribute(ExifInterface.TAG_FOCAL_LENGTH);
            if (focalLengthStr != null && !focalLengthStr.isEmpty()) {
                try {
                    // FocalLength格式通常是分数，如 "50/1" 或小数 "50.0"
                    double focalLengthValue = 0.0;
                    if (focalLengthStr.contains("/")) {
                        String[] parts = focalLengthStr.split("/");
                        if (parts.length == 2) {
                            double numerator = Double.parseDouble(parts[0]);
                            double denominator = Double.parseDouble(parts[1]);
                            if (denominator > 0) {
                                focalLengthValue = numerator / denominator;
                            }
                        }
                    } else {
                        focalLengthValue = Double.parseDouble(focalLengthStr);
                    }
                    
                    // 🔧 验证：焦距必须 > 0
                    if (focalLengthValue > 0) {
                        exifData.cameraSettings.focalLength = focalLengthValue;
                    }
                } catch (NumberFormatException e) {
                    // 忽略解析失败
                }
            }
            
        } catch (IOException e) {
            fileLogger.w(TAG, "读取EXIF失败: " + uriString, e);
        } catch (Exception e) {
            fileLogger.w(TAG, "提取EXIF信息失败: " + uriString, e);
        } finally {
            if (inputStream != null) {
                try {
                    inputStream.close();
                } catch (IOException e) {
                    // 忽略关闭错误
                }
            }
        }
        
        return exifData;
    }
    
    /**
     * 解析EXIF日期时间格式 (yyyy:MM:dd HH:mm:ss) 为时间戳
     * EXIF日期时间字符串已经是拍摄时的本地时间，直接解析，不做时区转换
     */
    private long parseExifDateTime(String dateTimeStr) {
        try {
            SimpleDateFormat sdf = new SimpleDateFormat("yyyy:MM:dd HH:mm:ss", Locale.US);
            // 不设置时区，使用系统默认时区直接解析（EXIF时间已经是本地时间）
            Date date = sdf.parse(dateTimeStr);
            return date != null ? date.getTime() : 0;
        } catch (Exception e) {
            fileLogger.w(TAG, "解析EXIF日期失败: " + dateTimeStr);
            return 0;
        }
    }
    
    /**
     * 使用 BitmapFactory 获取图片尺寸（降级方案）
     * 当 EXIF 和 MediaStore 都没有尺寸时使用
     * 🔥 移动端统一使用 Content URI，不使用文件路径
     * @param image 图片信息
     * @return 图片尺寸，如果获取失败返回 null
     */
    private ImageDimensions getImageDimensionsWithBitmapFactory(ImageInfo image) {
        ImageDimensions dimensions = null;
        
        try {
            // 🔥 移动端统一使用 Content URI，不使用文件路径
            String contentUriString = extractContentUri(image.uri);
            if (contentUriString == null || contentUriString.isEmpty()) {
                fileLogger.w(TAG, "⚠️ 无法提取Content URI: " + image.uri);
                return null;
            }
            
            Uri uri = Uri.parse(contentUriString);
            ContentResolver contentResolver = context.getContentResolver();
            
            // Android 10+ 需要使用setRequireOriginal获取原始图片（包含完整EXIF）
            Uri originalUri = uri;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                try {
                    originalUri = MediaStore.setRequireOriginal(uri);
                } catch (Exception e) {
                    fileLogger.d(TAG, "无法获取原始图片，使用普通URI: " + e.getMessage());
                }
            }
            
            InputStream inputStream = contentResolver.openInputStream(originalUri);
            if (inputStream == null) {
                fileLogger.w(TAG, "⚠️ 无法打开图片流: " + contentUriString);
                return null;
            }
            
            try {
                BitmapFactory.Options options = new BitmapFactory.Options();
                options.inJustDecodeBounds = true; // 只解码边界，不加载完整图片到内存
                BitmapFactory.decodeStream(inputStream, null, options);
                
                if (options.outWidth > 0 && options.outHeight > 0) {
                    dimensions = new ImageDimensions();
                    dimensions.width = options.outWidth;
                    dimensions.height = options.outHeight;
                    // 不记录成功日志，避免日志过多（统计信息会在阶段结束时输出）
                }
            } finally {
                try {
                    inputStream.close();
                } catch (IOException e) {
                    // 忽略关闭错误
                }
            }
            
        } catch (Exception e) {
            fileLogger.w(TAG, "⚠️ BitmapFactory获取尺寸失败: " + image.fileName, e);
        }
        
        return dimensions;
    }
    
    /**
     * 压缩图片到指定大小（与 JS 层保持一致：1024x1024，质量 90%）
     * @param imageInputStream 原始图片输入流
     * @param maxSize 最大尺寸（宽或高的最大值），默认 1024
     * @param quality JPEG 压缩质量（0-100），默认 90
     * @return 压缩后的图片字节数组
     */
    /**
     * 检查可用内存是否足够（至少需要50MB）
     */
    private boolean hasEnoughMemory() {
        Runtime runtime = Runtime.getRuntime();
        long maxMemory = runtime.maxMemory();
        long totalMemory = runtime.totalMemory();
        long freeMemory = runtime.freeMemory();
        long availableMemory = maxMemory - (totalMemory - freeMemory);
        
        // 至少需要50MB可用内存
        long requiredMemory = 50 * 1024 * 1024;
        boolean hasEnough = availableMemory > requiredMemory;
        
        if (!hasEnough) {
            fileLogger.w(TAG, "⚠️ 内存不足: 可用=" + (availableMemory / 1024 / 1024) + "MB, 需要=" + (requiredMemory / 1024 / 1024) + "MB");
        }
        
        return hasEnough;
    }
    
    /**
     * 计算合适的 inSampleSize（必须是2的幂次方）
     * @param originalWidth 原始宽度
     * @param originalHeight 原始高度
     * @param targetSize 目标尺寸（宽或高的最大值）
     * @return inSampleSize（1, 2, 4, 8, 16...）
     */
    private int calculateInSampleSize(int originalWidth, int originalHeight, int targetSize) {
        int inSampleSize = 1;
        
        // 如果原始尺寸已经小于目标尺寸，不需要采样
        if (originalWidth <= targetSize && originalHeight <= targetSize) {
            return 1;
        }
        
        // 计算合适的 inSampleSize
        // 找到最大的 inSampleSize，使得解码后的尺寸仍然 >= targetSize
        int halfWidth = originalWidth / 2;
        int halfHeight = originalHeight / 2;
        
        while ((halfWidth / inSampleSize) >= targetSize && 
               (halfHeight / inSampleSize) >= targetSize) {
            inSampleSize *= 2;
        }
        
        return inSampleSize;
    }
    
    private byte[] compressImage(InputStream imageInputStream, int maxSize, int quality, int originalWidth, int originalHeight) throws IOException {
        // 🔥 检查可用内存
        if (!hasEnoughMemory()) {
            throw new IOException("内存不足，无法压缩图片");
        }
        
        // 🔥 检查图片尺寸是否有效（从数据库获取，避免使用 BitmapFactory 读取尺寸）
        if (originalWidth <= 0 || originalHeight <= 0) {
            throw new IOException("无效的图片尺寸: " + originalWidth + "x" + originalHeight);
        }
        
        // 🔥 检查图片尺寸，避免超大图片
        long pixelCount = (long) originalWidth * originalHeight;
        if (pixelCount > 50 * 1024 * 1024) { // 超过50MP
            throw new IOException("图片尺寸过大（" + originalWidth + "x" + originalHeight + "），跳过");
        }
        
        // 🔥 计算合适的 inSampleSize
        int inSampleSize = calculateInSampleSize(originalWidth, originalHeight, maxSize);
        
        // 计算使用 inSampleSize 解码后的尺寸
        int decodedWidth = originalWidth / inSampleSize;
        int decodedHeight = originalHeight / inSampleSize;
        
        fileLogger.d(TAG, "📷 图片尺寸（从数据库）: " + originalWidth + "x" + originalHeight + 
              ", inSampleSize=" + inSampleSize + 
              ", 解码后=" + decodedWidth + "x" + decodedHeight + 
              ", 目标=" + maxSize);
        
        // 🔥 使用 inSampleSize 直接解码缩小后的图片（不再需要 mark/reset，因为已经知道尺寸）
        BitmapFactory.Options decodeOptions = new BitmapFactory.Options();
        decodeOptions.inSampleSize = inSampleSize;
        decodeOptions.inJustDecodeBounds = false;
        
        Bitmap bitmap = null;
        Bitmap finalBitmap = null;
        try {
            bitmap = BitmapFactory.decodeStream(imageInputStream, null, decodeOptions);
            
            if (bitmap == null) {
                throw new IOException("无法解码图片");
            }
            
            int bitmapWidth = bitmap.getWidth();
            int bitmapHeight = bitmap.getHeight();
            
            // 🔥 如果需要进一步缩放到目标尺寸，再进行缩放
            float scale = Math.min((float) maxSize / bitmapWidth, (float) maxSize / bitmapHeight);
            
            finalBitmap = bitmap; // 默认使用解码后的 Bitmap
            boolean needsScaling = scale < 1.0f;
            
            if (needsScaling) {
                // 需要进一步缩放
                int finalWidth = Math.round(bitmapWidth * scale);
                int finalHeight = Math.round(bitmapHeight * scale);
                
                fileLogger.d(TAG, "📷 进一步缩放: " + bitmapWidth + "x" + bitmapHeight + " -> " + finalWidth + "x" + finalHeight);
                
                // 🔥 检查内存是否足够创建缩放后的 Bitmap
                if (!hasEnoughMemory()) {
                    throw new IOException("内存不足，无法缩放图片");
                }
                
                try {
                    finalBitmap = Bitmap.createScaledBitmap(bitmap, finalWidth, finalHeight, true);
                    
                    if (finalBitmap == null) {
                        throw new IOException("无法创建缩放后的图片");
                    }
                } catch (OutOfMemoryError e) {
                    fileLogger.w(TAG, "⚠️ 缩放图片时内存不足", e);
                    System.gc(); // 建议GC
                    throw new IOException("内存不足，无法缩放图片", e);
                }
            } else {
                fileLogger.d(TAG, "📷 图片尺寸 " + bitmapWidth + "x" + bitmapHeight + " 已小于等于目标尺寸 " + maxSize + "，无需进一步缩放");
            }
            
            // 🔥 压缩为 JPEG
            ByteArrayOutputStream outputStream = null;
            byte[] compressedData = null;
            try {
                outputStream = new ByteArrayOutputStream();
                finalBitmap.compress(Bitmap.CompressFormat.JPEG, quality, outputStream);
                compressedData = outputStream.toByteArray();
                
                fileLogger.d(TAG, "✅ 压缩完成: 原始=" + originalWidth + "x" + originalHeight + 
                      ", 解码后=" + bitmapWidth + "x" + bitmapHeight + 
                      ", 最终=" + finalBitmap.getWidth() + "x" + finalBitmap.getHeight() + 
                      ", 压缩后=" + (compressedData.length / 1024) + " KB");
                
                return compressedData;
            } finally {
                // 🔥 关闭 ByteArrayOutputStream，释放资源
                if (outputStream != null) {
                    try {
                        outputStream.close();
                    } catch (IOException e) {
                        // 忽略关闭错误
                    }
                }
            }
            } catch (OutOfMemoryError e) {
                // 🔥 捕获 OOM，尝试释放内存
                fileLogger.w(TAG, "⚠️ 解码图片时内存不足（inSampleSize=" + inSampleSize + "），尝试释放内存", e);
                System.gc(); // 建议GC
                try {
                    Thread.sleep(100); // 等待GC
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                }
                throw new IOException("内存不足，无法解码图片", e);
            } finally {
                // 🔥 释放 Bitmap（内层finally，匹配第1486行的try）
                if (bitmap != null) {
                    bitmap.recycle();
                }
                // 如果创建了新的缩放 Bitmap，也需要释放
                if (finalBitmap != null && finalBitmap != bitmap) {
                    finalBitmap.recycle();
                }
            }
    }
    
    /**
     * 检测是否为截图（使用EXIF数据优化）
     */
    private boolean isScreenshot(ImageInfo image, ExifData exifData) {
        // 规则0: 如果有GPS信息，直接判断不是截图（截图通常不会有GPS信息）
        if (exifData != null && exifData.hasGPS) {
            return false;
        }
        
        String fileName = image.fileName != null ? image.fileName.toLowerCase() : "";
        String path = (image.relativePath != null ? image.relativePath : image.path);
        path = path != null ? path.toLowerCase() : "";
        
        // 规则1: 文件名包含截图/截屏关键词（含中文）
        if (fileName.contains("screenshot") || fileName.contains("截图") || fileName.contains("截屏") || fileName.contains("screen")) {
            return true;
        }
        
        // 规则2: 路径包含截图/截屏关键词
        if (path.contains("screenshot") || path.contains("截图") || path.contains("截屏")) {
            return true;
        }
        
        // 规则3: 宽高比 <= 0.5（手机竖屏比例）
        // 优先使用EXIF中的尺寸，如果没有则使用MediaStore的尺寸
        int width = image.width;
        int height = image.height;
        if (exifData != null && exifData.dimensions != null) {
            width = exifData.dimensions.width;
            height = exifData.dimensions.height;
        }
        
        if (width > 0 && height > 0) {
            double aspectRatio = (double) width / height;
            if (aspectRatio <= 0.5) {
                return true;
            }
        }
        
        return false;
    }
    
    /**
     * 阶段3b: 远端缓存查询（流水线版本）
     * 注意：当缓存命中并分类成功时，需要累加 imagesClassified 计数器
     * 🔥 流水线优化：3个节点并行处理
     *   节点1：计算Hash（CPU密集型）
     *   节点2：远程查询（网络IO）
     *   节点3：保存结果（数据库IO）
     */
    private CacheResult queryRemoteCache(List<ImageInfo> naImages) {
        // 初始化阶段级统计变量
        processedThisPhase = 0;
        totalFoundThisPhase = naImages.size();
        fileLogger.d(TAG, "阶段3b开始（流水线版本）: 远端缓存查询，待处理图片: " + totalFoundThisPhase + " 张");
        
        // 发送阶段开始进度事件
        if (totalFoundThisPhase > 0) {
            sendProgressEvent("cache_check", 0, totalFoundThisPhase, currentScanId);
        }
        
        CacheResult result = new CacheResult();
        // 使用线程安全的集合
        result.hitImages = Collections.synchronizedList(new ArrayList<>());
        result.naImages = Collections.synchronizedList(new ArrayList<>());
        result.hitCount = 0;
        result.uriToHashMap = new ConcurrentHashMap<>(); // 线程安全的Map
        
        if (naImages.isEmpty()) {
            result.naImages = naImages;
            return result;
        }
        
        // 按100张图片分批处理
        int batchSize = 100;
        int totalBatches = (naImages.size() + batchSize - 1) / batchSize;
        fileLogger.d(TAG, "🚀 开始流水线缓存查询: " + totalFoundThisPhase + " 张图片，批次大小: " + batchSize + "，共 " + totalBatches + " 批");
        
        // 创建流水线组件（每个节点1个线程，简化并发控制）
        ExecutorService hashExecutor = Executors.newFixedThreadPool(1); // 节点1：Hash计算
        ExecutorService queryExecutor = Executors.newFixedThreadPool(1); // 节点2：远程查询
        ExecutorService saveExecutor = Executors.newFixedThreadPool(1); // 节点3：保存结果
        
        BlockingQueue<HashTask> hashToQueryQueue = new LinkedBlockingQueue<>(); // Hash结果 → 查询
        BlockingQueue<QueryTask> queryToSaveQueue = new LinkedBlockingQueue<>(); // 查询结果 → 保存
        
        // 线程安全的计数器
        AtomicInteger processedCount = new AtomicInteger(0);
        AtomicInteger hitCount = new AtomicInteger(0);
        AtomicInteger completedBatches = new AtomicInteger(0);
        AtomicInteger submittedBatches = new AtomicInteger(0); // 已提交的批次数量
        
        // 启动节点2：远程查询工作线程（单线程）
        queryExecutor.submit(() -> {
            boolean shouldExit = false;
            while (!shouldExit) {
                    try {
                        // 使用take()阻塞等待，避免循环轮询的性能开销
                        HashTask hashTask = hashToQueryQueue.take();
                        
                        // 执行远程查询
                        Map<String, Object> cacheResponse = null;
                        Exception queryError = null;
                        
                        // 如果hashToUriMap为空，跳过查询（但仍需创建QueryTask传递给节点3）
                        if (hashTask.hashToUriMap == null || hashTask.hashToUriMap.isEmpty()) {
                            fileLogger.d(TAG, "⏭️ [节点2] 批次 " + (hashTask.batchIndex + 1) + " 没有有效的Hash，跳过查询");
                        } else {
                            try {
                                fileLogger.d(TAG, "🔗 [节点2] 开始查询远端缓存，批次 " + (hashTask.batchIndex + 1) + "/" + totalBatches + "，Hash数量: " + hashTask.hashToUriMap.size());
                                cacheResponse = batchCheckCache(hashTask.hashToUriMap);
                                fileLogger.d(TAG, "✅ [节点2] 远端缓存查询成功，批次 " + (hashTask.batchIndex + 1));
                            } catch (Exception e) {
                                queryError = e;
                                String errorMessage = e.getMessage();
                                if (errorMessage != null && errorMessage.contains("timeout")) {
                                    fileLogger.e(TAG, "❌ [节点2] 批次 " + (hashTask.batchIndex + 1) + " 远端缓存查询超时: " + errorMessage, e);
                                } else {
                                    fileLogger.e(TAG, "❌ [节点2] 批次 " + (hashTask.batchIndex + 1) + " 远端缓存查询异常: " + errorMessage, e);
                                }
                            }
                        }
                        
                        // 将查询结果传递给节点3（即使hashToUriMap为空也要传递，确保节点3能处理）
                        QueryTask queryTask = new QueryTask(
                            hashTask.batchIndex,
                            hashTask.batchImages,
                            hashTask.isLastBatch, // 传递isLastBatch标记
                            hashTask.hashToUriMap,
                            hashTask.uriToHashMap,
                            hashTask.hashFailedImages
                        );
                        queryTask.cacheResponse = cacheResponse;
                        queryTask.queryError = queryError;
                        queryToSaveQueue.put(queryTask); // 阻塞直到队列有空间
                        
                        // 如果是最后一个批次，处理完后退出
                        if (hashTask.isLastBatch) {
                            fileLogger.d(TAG, "🔍 [节点2] 处理完最后一个批次，退出");
                            shouldExit = true;
                        }
                        
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        fileLogger.d(TAG, "🔍 [节点2] 线程被中断，退出");
                        break;
                    } catch (Exception e) {
                        fileLogger.e(TAG, "[节点2] 处理异常", e);
                        // 异常时继续处理下一个任务，不退出
                    }
                }
            });
        
        // 启动节点3：保存结果工作线程（单线程）
        saveExecutor.submit(() -> {
            boolean shouldExit = false;
            while (!shouldExit) {
                try {
                    // 使用take()阻塞等待，避免循环轮询的性能开销
                    QueryTask queryTask = queryToSaveQueue.take();
                        
                        // 处理查询结果并保存
                        try {
                            processAndSaveQueryResult(queryTask, result, processedCount, hitCount);
                            
                            int currentCompleted = completedBatches.incrementAndGet();
                            fileLogger.d(TAG, "🔍 [节点3] 批次 " + (queryTask.batchIndex + 1) + " 处理完成，已完成批次: " + currentCompleted + "/" + totalBatches);
                            
                            int currentProcessed = processedCount.get();
                            sendProgressEvent("cache_check", currentProcessed, totalFoundThisPhase, currentScanId);
                        } catch (Exception e) {
                            // 处理异常时也要增加completedBatches，避免节点3一直等待
                            fileLogger.e(TAG, "[节点3] 批次 " + (queryTask.batchIndex + 1) + " 处理异常", e);
                            // 将这批图片加入未命中列表（因为处理失败）
                            synchronized (result.naImages) {
                                for (ImageInfo image : queryTask.batchImages) {
                                    if (!result.naImages.contains(image) && !result.hitImages.contains(image)) {
                                        result.naImages.add(image);
                                        processedCount.incrementAndGet();
                                    }
                                }
                            }
                            int currentCompleted = completedBatches.incrementAndGet();
                            fileLogger.d(TAG, "🔍 [节点3] 批次 " + (queryTask.batchIndex + 1) + " 异常处理完成，已完成批次: " + currentCompleted + "/" + totalBatches);
                        }
                        
                        // 如果是最后一个批次，处理完后退出
                        if (queryTask.isLastBatch) {
                            fileLogger.d(TAG, "🔍 [节点3] 处理完最后一个批次，退出");
                            shouldExit = true;
                        }
                        
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    fileLogger.d(TAG, "🔍 [节点3] 线程被中断，退出");
                    break;
                } catch (Exception e) {
                    fileLogger.e(TAG, "[节点3] 外层异常", e);
                    // 异常时继续处理下一个任务，不退出（除非是最后一个批次）
                }
            }
        });
        
        // 节点1：提交所有批次到Hash计算队列
        try {
            for (int batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
                if (Thread.currentThread().isInterrupted()) {
                    fileLogger.w(TAG, "扫描线程被中断，停止处理");
                    break;
                }
                
                int startIndex = batchIndex * batchSize;
                int endIndex = Math.min(startIndex + batchSize, naImages.size());
                List<ImageInfo> batchImages = new ArrayList<>(naImages.subList(startIndex, endIndex));
                
                final int finalBatchIndex = batchIndex;
                hashExecutor.submit(() -> {
                    try {
                        fileLogger.d(TAG, "🔢 [节点1] 开始计算Hash，批次 " + (finalBatchIndex + 1) + "/" + totalBatches + "，图片数量: " + batchImages.size());
                        
                        // 计算Hash
                        Map<String, List<String>> hashToUriMap = new HashMap<>();
                        Map<String, String> uriToHashMap = new HashMap<>();
                        List<ImageInfo> hashFailedImages = new ArrayList<>();
                        
                        // 提取URI列表
                        List<String> uriList = new ArrayList<>();
                        for (ImageInfo image : batchImages) {
                            String contentUri = extractContentUri(image.uri);
                            if (contentUri != null) {
                                uriList.add(contentUri);
                            } else {
                                uriList.add(image.uri);
                            }
                        }
                        
                        // 调用MediaStoreModule的批量计算方法
                        List<MediaStoreModule.HashResult> hashResults = mediaStoreModule.batchCalculateHashesInternal(uriList);
                        
                        // 构建Hash到URI的MAP
                        for (int i = 0; i < hashResults.size() && i < batchImages.size(); i++) {
                            MediaStoreModule.HashResult hashResult = hashResults.get(i);
                            ImageInfo image = batchImages.get(i);
                            String imageUri = image.uri;
                            
                            if (hashResult.success && hashResult.hash != null && !hashResult.hash.isEmpty()) {
                                String hash = hashResult.hash;
                                hashToUriMap.computeIfAbsent(hash, k -> new ArrayList<>()).add(imageUri);
                                uriToHashMap.put(imageUri, hash);
                                result.uriToHashMap.put(imageUri, hash); // 线程安全的Map
                            } else {
                                hashFailedImages.add(image);
                            }
                        }
                        
                        fileLogger.d(TAG, "✅ [节点1] Hash计算完成，批次 " + (finalBatchIndex + 1) + "，有效Hash: " + hashToUriMap.size() + "，失败: " + hashFailedImages.size());
                        
                        // 判断是否是最后一个批次
                        boolean isLastBatch = (finalBatchIndex == totalBatches - 1);
                        
                        // 将Hash结果传递给节点2
                        HashTask hashTask = new HashTask(finalBatchIndex, batchImages, isLastBatch);
                        hashTask.hashToUriMap = hashToUriMap;
                        hashTask.uriToHashMap = uriToHashMap;
                        hashTask.hashFailedImages = hashFailedImages;
                        hashToQueryQueue.put(hashTask);
                        submittedBatches.incrementAndGet();
                        fileLogger.d(TAG, "🔍 [节点1] 批次 " + (finalBatchIndex + 1) + " Hash任务已提交到队列，已提交批次: " + submittedBatches.get() + "/" + totalBatches + (isLastBatch ? " (最后一批)" : ""));
                        
                    } catch (Exception e) {
                        fileLogger.e(TAG, "[节点1] 批次 " + (finalBatchIndex + 1) + " Hash计算异常", e);
                        // Hash计算失败，仍然需要创建HashTask传递给节点2，确保流水线正常结束
                        boolean isLastBatch = (finalBatchIndex == totalBatches - 1);
                        HashTask hashTask = new HashTask(finalBatchIndex, batchImages, isLastBatch);
                        hashTask.hashToUriMap = new HashMap<>(); // 空的Hash映射
                        hashTask.uriToHashMap = new HashMap<>();
                        hashTask.hashFailedImages = new ArrayList<>(batchImages); // 所有图片都标记为Hash失败
                        try {
                            hashToQueryQueue.put(hashTask);
                            submittedBatches.incrementAndGet();
                            fileLogger.d(TAG, "🔍 [节点1] 批次 " + (finalBatchIndex + 1) + " Hash计算异常，但仍提交Hash任务到队列" + (isLastBatch ? " (最后一批)" : ""));
                        } catch (InterruptedException ie) {
                            Thread.currentThread().interrupt();
                            fileLogger.w(TAG, "[节点1] 提交Hash任务被中断");
                        }
                    }
                });
            }
        } catch (Exception e) {
            fileLogger.e(TAG, "提交Hash任务异常", e);
        }
        
        // 等待所有任务完成
        fileLogger.d(TAG, "🔍 [流水线] 开始等待所有任务完成，已完成批次: " + completedBatches.get() + "/" + totalBatches);
        hashExecutor.shutdown();
        queryExecutor.shutdown();
        saveExecutor.shutdown();
        
        try {
            // 等待所有线程池完成（最多等待30分钟）
            int waitCount = 0;
            while (!hashExecutor.isTerminated() || !queryExecutor.isTerminated() || !saveExecutor.isTerminated()) {
                Thread.sleep(100);
                waitCount++;
                if (waitCount % 50 == 0) { // 每5秒打印一次
                    fileLogger.d(TAG, "🔍 [流水线] 等待中... 已完成批次: " + completedBatches.get() + "/" + totalBatches + 
                          ", hashExecutor终止: " + hashExecutor.isTerminated() + 
                          ", queryExecutor终止: " + queryExecutor.isTerminated() + 
                          ", saveExecutor终止: " + saveExecutor.isTerminated());
                }
            }
            fileLogger.d(TAG, "🔍 [流水线] 所有任务完成，已完成批次: " + completedBatches.get() + "/" + totalBatches);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            fileLogger.w(TAG, "等待流水线完成被中断");
        }
        
        result.hitCount = hitCount.get();
        int finalNaImagesCount = result.naImages.size();
        int finalHitImagesCount = result.hitImages.size();
        fileLogger.d(TAG, "✅ 阶段3b完成（流水线版本）: 缓存命中 " + result.hitCount + " 张，命中图片列表: " + finalHitImagesCount + " 张，未命中图片列表: " + finalNaImagesCount + " 张，总计: " + totalFoundThisPhase + " 张");
        if (finalNaImagesCount == 0 && totalFoundThisPhase > result.hitCount) {
            fileLogger.w(TAG, "⚠️ 警告: 有 " + (totalFoundThisPhase - result.hitCount) + " 张图片未命中缓存，但未命中列表为空，可能存在问题");
        }
        if (result.hitCount == 0 && totalFoundThisPhase > 0) {
            fileLogger.w(TAG, "⚠️ 警告: 远端缓存查询没有命中任何图片，所有图片将进入远程推理阶段");
        }
        
        return result;
    }
    
    /**
     * 处理查询结果并保存（节点3的工作）
     */
    private void processAndSaveQueryResult(QueryTask queryTask, CacheResult result, 
                                           AtomicInteger processedCount, AtomicInteger hitCount) {
        List<ImageInfo> batchImages = queryTask.batchImages;
        Map<String, List<String>> hashToUriMap = queryTask.hashToUriMap;
        Map<String, String> uriToHashMap = queryTask.uriToHashMap;
        List<ImageInfo> hashFailedImages = queryTask.hashFailedImages;
        
        // Hash计算失败的图片直接加入未命中列表
        synchronized (result.naImages) {
            for (ImageInfo image : hashFailedImages) {
                if (!result.naImages.contains(image)) {
                    result.naImages.add(image);
                    processedCount.incrementAndGet();
                }
            }
        }
        
        // 处理查询结果
        Map<String, Object> cacheResponse = queryTask.cacheResponse;
        Exception queryError = queryTask.queryError;
        
        if (queryError != null) {
            // 查询失败，将这批图片加入未命中列表
            synchronized (result.naImages) {
                for (ImageInfo image : batchImages) {
                    if (!result.naImages.contains(image) && !result.hitImages.contains(image)) {
                        result.naImages.add(image);
                        processedCount.incrementAndGet();
                    }
                }
            }
            return;
        }
        
        if (cacheResponse == null || !cacheResponse.containsKey("items")) {
            // 没有查询结果，将所有图片加入未命中列表
            synchronized (result.naImages) {
                for (ImageInfo image : batchImages) {
                    if (!result.naImages.contains(image) && !result.hitImages.contains(image)) {
                        result.naImages.add(image);
                        processedCount.incrementAndGet();
                    }
                }
            }
            return;
        }
        
        List<Map<String, Object>> items = (List<Map<String, Object>>) cacheResponse.get("items");
        Set<String> processedHashes = new HashSet<>();
        List<Map<String, Object>> batchUpdateData = new ArrayList<>();
        
        // 处理缓存结果
        fileLogger.d(TAG, "🔍 [节点3] 开始处理缓存结果，items数量: " + items.size());
        for (Map<String, Object> item : items) {
            String imageHash = (String) item.get("image_hash");
            Boolean cached = (Boolean) item.get("cached");
            
            if (imageHash != null && !imageHash.isEmpty()) {
                processedHashes.add(imageHash);
            }
            
            fileLogger.d(TAG, "🔍 [节点3] 处理item: hash=" + imageHash + ", cached=" + cached);
            
            List<String> imageUris = hashToUriMap.get(imageHash);
            if (imageUris == null || imageUris.isEmpty()) {
                continue;
            }
            
            for (String imageUri : imageUris) {
                ImageInfo image = null;
                for (ImageInfo img : batchImages) {
                    if (img.uri.equals(imageUri)) {
                        image = img;
                        break;
                    }
                }
                
                if (image == null) continue;
                
                if (cached != null && cached && item.containsKey("data")) {
                    // 缓存命中
                    Map<String, Object> cacheData = (Map<String, Object>) item.get("data");
                    
                    synchronized (result.hitImages) {
                        if (result.hitImages.contains(image)) {
                            continue;
                        }
                        result.hitImages.add(image);
                    }
                    
                    // 收集分类数据
                    Map<String, Object> classificationData = new HashMap<>();
                    classificationData.put("uri", image.uri);
                    classificationData.put("id", image.id);
                    
                    String category = (String) cacheData.get("category");
                    if (category == null || category.isEmpty()) {
                        category = "NA";
                    }
                    classificationData.put("category", category);
                    
                    Object confidenceObj = cacheData.get("confidence");
                    double confidence = 0.9;
                    if (confidenceObj != null) {
                        if (confidenceObj instanceof Number) {
                            confidence = ((Number) confidenceObj).doubleValue();
                        } else {
                            try {
                                confidence = Double.parseDouble(confidenceObj.toString());
                            } catch (NumberFormatException e) {
                                // 使用默认值
                            }
                        }
                    }
                    classificationData.put("confidence", confidence);
                    
                    Object messageObj = cacheData.get("description");
                    if (messageObj == null) {
                        messageObj = cacheData.get("message");
                    }
                    if (messageObj != null) {
                        classificationData.put("message", messageObj.toString());
                    }
                    
                    Object backgroundColorObj = cacheData.get("background_color");
                    if (backgroundColorObj != null) {
                        String backgroundColor = backgroundColorObj.toString();
                        if (backgroundColor != null && !backgroundColor.isEmpty() && !backgroundColor.equals("null")) {
                            classificationData.put("background_color", backgroundColor);
                        }
                    }
                    
                    classificationData.put("idCardDetections", new ArrayList<>());
                    classificationData.put("generalDetections", new ArrayList<>());
                    classificationData.put("mobileNetV3Detections", null);
                    
                    batchUpdateData.add(classificationData);
                    
                    if (!category.equals("NA")) {
                        imagesClassified++;
                    }
                    processedCount.incrementAndGet();
                } else {
                    // 缓存未命中
                    synchronized (result.naImages) {
                        if (!result.naImages.contains(image) && !result.hitImages.contains(image)) {
                            result.naImages.add(image);
                            processedCount.incrementAndGet();
                            fileLogger.d(TAG, "🔍 [节点3] 缓存未命中，添加到未命中列表: " + image.uri + ", cached=" + cached);
                        }
                    }
                }
            }
        }
        
        // 处理服务器没有返回结果的Hash
        List<String> validHashes = new ArrayList<>(hashToUriMap.keySet());
        for (String hash : validHashes) {
            if (!processedHashes.contains(hash)) {
                List<String> imageUris = hashToUriMap.get(hash);
                if (imageUris != null && !imageUris.isEmpty()) {
                    for (String imageUri : imageUris) {
                        ImageInfo image = null;
                        for (ImageInfo img : batchImages) {
                            if (img.uri.equals(imageUri)) {
                                image = img;
                                break;
                            }
                        }
                        
                        if (image != null) {
                            synchronized (result.naImages) {
                                if (!result.naImages.contains(image) && !result.hitImages.contains(image)) {
                                    result.naImages.add(image);
                                    processedCount.incrementAndGet();
                                    fileLogger.d(TAG, "🔍 [节点3] Hash未返回结果，添加到未命中列表: " + image.uri + ", hash=" + hash);
                                }
                            }
                        }
                    }
                }
            }
        }
        
        // 保存结果（批量更新）
        if (!batchUpdateData.isEmpty()) {
            try {
                Map<String, Object> updateResult = imageDataService.batchUpdateClassification(batchUpdateData);
                Boolean success = (Boolean) updateResult.get("success");
                Integer updatedCount = (Integer) updateResult.get("updatedCount");
                
                if (success != null && success && updatedCount != null) {
                    hitCount.addAndGet(updatedCount);
                    fileLogger.d(TAG, "💾 [节点3] 批次 " + (queryTask.batchIndex + 1) + " 批量更新分类完成: " + updatedCount + " 张图片");
                } else {
                    fileLogger.w(TAG, "⚠️ [节点3] 批次 " + (queryTask.batchIndex + 1) + " 批量更新分类失败: " + batchUpdateData.size() + " 张图片");
                }
            } catch (Exception e) {
                fileLogger.e(TAG, "❌ [节点3] 批次 " + (queryTask.batchIndex + 1) + " 保存结果异常", e);
            }
        }
    }
    
    /**
     * 批量查询缓存API（v2版本）
     * @param hashToUriMap Hash到URI列表的映射（支持一个Hash对应多个URI）
     * @return 缓存查询结果 { items: [...], cached_count: N, total: N }（兼容v1格式）
     */
    private Map<String, Object> batchCheckCache(Map<String, List<String>> hashToUriMap) throws Exception {
        // 🔥 获取Semaphore许可（限制并发数）
        try {
            httpRequestSemaphore.acquire();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new Exception("获取HTTP请求许可被中断", e);
        }
        
        HttpURLConnection connection = null;
        try {
            // 构建完整的API URL（v2版本）
            String apiUrl = API_BASE_URL + "api/v2/classify/batch-check-cache";
            
            // 构建items列表（每个hash对应一个item，使用第一个URI）
            List<Map.Entry<String, List<String>>> hashUriEntries = new ArrayList<>(hashToUriMap.entrySet());
            int totalItems = hashUriEntries.size();
            
            fileLogger.d(TAG, "🌐 准备远端缓存查询请求（v2）: " + apiUrl + ", Hash数量: " + totalItems);
            
            URL url = new URL(apiUrl);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", "application/json");
            // 🔥 添加用户ID Header（如果存在）
            if (userId != null && !userId.isEmpty()) {
                connection.setRequestProperty("X-User-ID", userId);
                fileLogger.d(TAG, "✅ 已设置 X-User-ID Header: " + userId);
            }
            // 🔥 优化：在后台运行时使用更长的超时时间，防止网络请求被中断
            connection.setConnectTimeout(120000); // 120秒连接超时（后台运行时可能需要更长时间）
            connection.setReadTimeout(120000); // 120秒读取超时
            connection.setDoOutput(true);
            
            fileLogger.d(TAG, "🔗 开始建立HTTP连接（远端缓存查询v2）...");
            
            // 构建v2格式的请求体
            JSONObject requestBody = new JSONObject();
            JSONArray itemsArray = new JSONArray();
            
            for (int i = 0; i < hashUriEntries.size(); i++) {
                Map.Entry<String, List<String>> entry = hashUriEntries.get(i);
                String hash = entry.getKey();
                List<String> uris = entry.getValue();
                
                // 使用第一个URI（v2 API要求必须提供image_uri）
                String imageUri = uris != null && !uris.isEmpty() ? uris.get(0) : "";
                
                JSONObject item = new JSONObject();
                item.put("index", i);
                item.put("image_hash", hash);
                item.put("image_uri", imageUri); // v2 API必填字段
                itemsArray.put(item);
            }
            
            requestBody.put("items", itemsArray);
            // 🔥 添加 user_id（如果存在）
            if (userId != null && !userId.isEmpty()) {
                requestBody.put("user_id", userId);
                fileLogger.d(TAG, "✅ 已添加 user_id 到请求体: " + userId);
            }
            
            // 发送请求
            OutputStream outputStream = connection.getOutputStream();
            outputStream.write(requestBody.toString().getBytes("UTF-8"));
            outputStream.flush();
            outputStream.close();
            
            // 读取响应
            fileLogger.d(TAG, "📥 开始读取HTTP响应（远端缓存查询）...");
            int responseCode = connection.getResponseCode();
            fileLogger.d(TAG, "📊 HTTP响应码（远端缓存查询）: " + responseCode);
            if (responseCode != HttpURLConnection.HTTP_OK) {
                fileLogger.e(TAG, "❌ HTTP错误（远端缓存查询）: " + responseCode);
                throw new Exception("HTTP错误: " + responseCode);
            }
            
            BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), "UTF-8"));
            StringBuilder response = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                response.append(line);
            }
            reader.close();
            
            // 解析JSON响应（v2格式）
            fileLogger.d(TAG, "📝 开始解析JSON响应（远端缓存查询v2），响应长度: " + response.length());
            JSONObject jsonResponse = new JSONObject(response.toString());
            
            // v2接口返回格式：{ results: [...], summary: { total, cached_count, miss_count } }
            JSONArray resultsArray = jsonResponse.optJSONArray("results");
            JSONObject summaryObj = jsonResponse.optJSONObject("summary");
            
            // 转换为兼容v1格式的Map
            Map<String, Object> result = new HashMap<>();
            int total = summaryObj != null ? summaryObj.optInt("total", 0) : 0;
            int cachedCount = summaryObj != null ? summaryObj.optInt("cached_count", 0) : 0;
            result.put("total", total);
            result.put("cached_count", cachedCount);
            fileLogger.d(TAG, "✅ 远端缓存查询响应解析完成（v2）: 总计=" + total + ", 缓存命中=" + cachedCount);
            
            // 转换results为兼容v1格式的items
            List<Map<String, Object>> items = new ArrayList<>();
            if (resultsArray != null) {
                for (int i = 0; i < resultsArray.length(); i++) {
                    JSONObject resultObj = resultsArray.getJSONObject(i);
                    Map<String, Object> item = new HashMap<>();
                    
                    String imageHash = resultObj.optString("image_hash", "");
                    boolean cached = resultObj.optBoolean("cached", false);
                    item.put("image_hash", imageHash);
                    item.put("cached", cached);
                    
                    // v2格式：如果cached为true，数据直接在result对象中，不在data字段
                    if (cached) {
                        Map<String, Object> data = new HashMap<>();
                        data.put("category", resultObj.optString("category", "NA"));
                        data.put("confidence", resultObj.optDouble("confidence", 0.9));
                        data.put("description", resultObj.optString("description", null));
                        data.put("message", resultObj.optString("description", null)); // message使用description
                        
                        // 添加 background_color 字段
                        String backgroundColor = resultObj.optString("background_color", null);
                        if (backgroundColor != null && !backgroundColor.isEmpty()) {
                            data.put("background_color", backgroundColor);
                        }
                        
                        // 添加 raw_content 字段（如果存在）
                        String rawContent = resultObj.optString("raw_content", null);
                        if (rawContent != null && !rawContent.isEmpty()) {
                            data.put("raw_content", rawContent);
                        }
                        
                        item.put("data", data);
                    }
                    
                    items.add(item);
                }
            }
            result.put("items", items);
            
            return result;
            
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
            // 🔥 释放Semaphore许可
            httpRequestSemaphore.release();
        }
    }
    
    /**
     * 压缩批次图片（节点1的工作）
     * @param images 图片列表
     * @param uriToHashMap URI到Hash的映射
     * @return CompressTask 包含压缩后的图片数据和metadata
     */
    private CompressTask compressBatchImages(List<ImageInfo> images, Map<String, String> uriToHashMap, int batchIndex, boolean isLastBatch) {
        CompressTask compressTask = new CompressTask(batchIndex, images, isLastBatch, uriToHashMap);
        compressTask.compressedImages = new HashMap<>();
        compressTask.compressFailedImages = new ArrayList<>();
        
        // 🔥 v2格式：构建 image_metadata JSON对象
        JSONObject imageMetadata = new JSONObject();
        JSONArray itemsArray = new JSONArray();
        
        // 添加图片文件并构建metadata（使用实际索引，确保metadata和图片一一对应）
        int actualIndex = 0; // 实际添加的图片索引
        for (int i = 0; i < images.size(); i++) {
            ImageInfo image = images.get(i);
            String contentUri = extractContentUri(image.uri);
            String uriString = contentUri != null ? contentUri : image.uri;
            
            // 查找hash（先尝试原始uri，再尝试contentUri）
            String hash = uriToHashMap.get(image.uri);
            if (hash == null || hash.isEmpty()) {
                if (contentUri != null) {
                    hash = uriToHashMap.get(contentUri);
                }
            }
            
            if (hash == null || hash.isEmpty()) {
                fileLogger.w(TAG, "⚠️ [节点1] 无法找到图片的hash，跳过图片: " + uriString);
                compressTask.compressFailedImages.add(image);
                continue; // 跳过没有hash的图片
            }
            
            // 构建metadata item（使用实际索引）
            try {
                JSONObject metadataItem = new JSONObject();
                metadataItem.put("index", actualIndex);
                metadataItem.put("image_uri", uriString);
                metadataItem.put("image_hash", hash);
                itemsArray.put(metadataItem);
            } catch (org.json.JSONException e) {
                fileLogger.e(TAG, "❌ [节点1] 构建metadata item失败: " + uriString, e);
                compressTask.compressFailedImages.add(image);
                continue; // 跳过这张图片
            }
            
            // 🔥 修复内存泄漏：使用 try-finally 确保 InputStream 始终关闭
            InputStream imageInputStream = null;
            ByteArrayOutputStream originalData = null;
            try {
                // 🔥 移动端统一使用 Content URI，不使用文件路径
                if (uriString == null || !uriString.startsWith("content://")) {
                    fileLogger.w(TAG, "⚠️ [节点1] URI不是Content URI，跳过图片: " + uriString);
                    compressTask.compressFailedImages.add(image);
                    // 从itemsArray中移除对应的metadata item
                    if (itemsArray.length() > 0) {
                        itemsArray.remove(itemsArray.length() - 1);
                    }
                    continue;
                }
                
                Uri uri = Uri.parse(uriString);
                
                // Android 10+ 需要使用setRequireOriginal获取原始图片
                Uri originalUri = uri;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    try {
                        originalUri = MediaStore.setRequireOriginal(uri);
                    } catch (Exception e) {
                        fileLogger.d(TAG, "无法获取原始图片，使用普通URI: " + e.getMessage());
                    }
                }
                
                imageInputStream = reactContext.getContentResolver().openInputStream(originalUri);
                
                if (imageInputStream == null) {
                    fileLogger.w(TAG, "⚠️ [节点1] 无法打开图片流: " + uriString);
                    compressTask.compressFailedImages.add(image);
                    // 从itemsArray中移除对应的metadata item
                    if (itemsArray.length() > 0) {
                        itemsArray.remove(itemsArray.length() - 1);
                    }
                    continue;
                }
                
                // 🔥 包装成 BufferedInputStream 以支持 mark/reset（compressImage 需要）
                // 在调用方创建，资源管理更清晰
                if (!imageInputStream.markSupported()) {
                    imageInputStream = new java.io.BufferedInputStream(imageInputStream);
                }
                
                // 🔥 压缩图片（与 JS 层保持一致：1024x1024，质量 90%）
                // 使用数据库中的尺寸信息，避免使用 BitmapFactory 读取尺寸
                byte[] compressedImageData;
                try {
                    compressedImageData = compressImage(imageInputStream, 1024, 90, image.width, image.height);
                } catch (Exception compressError) {
                    fileLogger.e(TAG, "❌ [节点1] 图片压缩失败: " + uriString + ", 跳过", compressError);
                    compressTask.compressFailedImages.add(image);
                    // 从itemsArray中移除对应的metadata item
                    if (itemsArray.length() > 0) {
                        itemsArray.remove(itemsArray.length() - 1);
                    }
                    continue; // 直接跳过，不进行降级处理
                }
                
                // 存储压缩后的图片数据（使用uri作为key）
                compressTask.compressedImages.put(uriString, compressedImageData);
                
                // 成功添加图片后，增加实际索引
                actualIndex++;
            } catch (Exception e) {
                fileLogger.e(TAG, "❌ [节点1] 读取图片文件失败: " + uriString, e);
                compressTask.compressFailedImages.add(image);
                // 读取失败时，需要从itemsArray中移除对应的metadata item
                if (itemsArray.length() > 0) {
                    itemsArray.remove(itemsArray.length() - 1);
                }
            } finally {
                // 🔥 确保 InputStream 和 ByteArrayOutputStream 始终关闭/释放
                if (imageInputStream != null) {
                    try {
                        imageInputStream.close();
                    } catch (IOException e) {
                        // 忽略关闭错误
                    }
                }
                if (originalData != null) {
                    try {
                        originalData.close();
                    } catch (IOException e) {
                        // 忽略关闭错误
                    }
                }
            }
        }
        
        // 🔥 v2格式：添加 image_metadata 字段
        try {
            imageMetadata.put("items", itemsArray);
            // 🔥 添加 user_id（如果存在）
            if (userId != null && !userId.isEmpty()) {
                imageMetadata.put("user_id", userId);
            }
        } catch (org.json.JSONException e) {
            fileLogger.e(TAG, "❌ [节点1] 构建image_metadata失败", e);
            // 创建一个空的metadata
            try {
                imageMetadata = new JSONObject();
                imageMetadata.put("items", new JSONArray());
                if (userId != null && !userId.isEmpty()) {
                    imageMetadata.put("user_id", userId);
                }
            } catch (org.json.JSONException e2) {
                fileLogger.e(TAG, "❌ [节点1] 创建空metadata也失败", e2);
            }
        }
        
        // 将metadata存储到compressTask中
        compressTask.metadata = imageMetadata;
        
        fileLogger.d(TAG, "✅ [节点1] 批次 " + (batchIndex + 1) + " 压缩完成，成功: " + compressTask.compressedImages.size() + " 张，失败: " + compressTask.compressFailedImages.size() + " 张");
        
        return compressTask;
    }
    
    /**
     * 发送推理请求（节点2的工作）
     * @param compressTask 包含压缩后的图片数据和metadata
     * @return 推理结果 { items: [...], success_count: N, fail_count: N, total: N }（兼容v1格式）
     */
    private Map<String, Object> sendInferenceRequest(CompressTask compressTask) throws Exception {
        // 🔥 获取Semaphore许可（限制并发数）
        try {
            httpRequestSemaphore.acquire();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new Exception("获取HTTP请求许可被中断", e);
        }
        
        HttpURLConnection connection = null;
        try {
            // 构建完整的API URL（v2版本）
            String apiUrl = API_BASE_URL + "api/v2/classify/batch";
            
            fileLogger.d(TAG, "🌐 [节点2] 准备远程推理请求（v2）: " + apiUrl + ", 图片数量: " + compressTask.batchImages.size());
            
            // 检查网络状态
            try {
                android.net.ConnectivityManager cm = (android.net.ConnectivityManager) reactContext.getSystemService(android.content.Context.CONNECTIVITY_SERVICE);
                android.net.NetworkInfo networkInfo = cm.getActiveNetworkInfo();
                if (networkInfo == null || !networkInfo.isConnected()) {
                    fileLogger.w(TAG, "⚠️ [节点2] 警告: 网络未连接，但继续尝试请求");
                } else {
                    fileLogger.d(TAG, "✅ [节点2] 网络状态: " + networkInfo.getTypeName() + ", 已连接");
                }
            } catch (Exception e) {
                fileLogger.w(TAG, "⚠️ [节点2] 无法检查网络状态: " + e.getMessage());
            }
            
            // 生成边界字符串
            String boundary = "----WebKitFormBoundary" + System.currentTimeMillis();
            
            URL url = new URL(apiUrl);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
            // 🔥 添加用户ID Header（如果存在）
            if (userId != null && !userId.isEmpty()) {
                connection.setRequestProperty("X-User-ID", userId);
                fileLogger.d(TAG, "✅ [节点2] 已设置 X-User-ID Header: " + userId);
            }
            // 🔥 优化：在后台运行时使用更长的超时时间，防止网络请求被中断
            connection.setConnectTimeout(300000); // 300秒连接超时
            connection.setReadTimeout(300000); // 300秒读取超时
            connection.setDoOutput(true);
            connection.setDoInput(true);
            
            fileLogger.d(TAG, "🔗 [节点2] 开始建立HTTP连接...");
            
            OutputStream outputStream = connection.getOutputStream();
            
            // 写入压缩后的图片数据
            JSONArray itemsArray = compressTask.metadata.optJSONArray("items");
            int actualIndex = 0;
            for (int i = 0; i < compressTask.batchImages.size(); i++) {
                ImageInfo image = compressTask.batchImages.get(i);
                String contentUri = extractContentUri(image.uri);
                String uriString = contentUri != null ? contentUri : image.uri;
                
                byte[] compressedImageData = compressTask.compressedImages.get(uriString);
                if (compressedImageData == null) {
                    continue; // 跳过压缩失败的图片
                }
                
                // 写入文件字段头
                String fileName = image.fileName != null ? image.fileName : "image.jpg";
                String fileField = "--" + boundary + "\r\n";
                fileField += "Content-Disposition: form-data; name=\"images\"; filename=\"" + fileName + "\"\r\n";
                fileField += "Content-Type: image/jpeg\r\n\r\n";
                outputStream.write(fileField.getBytes("UTF-8"));
                
                // 写入压缩后的图片数据
                outputStream.write(compressedImageData);
                outputStream.write("\r\n".getBytes("UTF-8"));
                
                actualIndex++;
            }
            
            // 写入 image_metadata 字段
            String metadataField = "--" + boundary + "\r\n";
            metadataField += "Content-Disposition: form-data; name=\"image_metadata\"\r\n";
            metadataField += "Content-Type: application/json\r\n\r\n";
            metadataField += compressTask.metadata.toString() + "\r\n";
            outputStream.write(metadataField.getBytes("UTF-8"));
            
            // 写入结束边界
            String endBoundary = "--" + boundary + "--\r\n";
            outputStream.write(endBoundary.getBytes("UTF-8"));
            outputStream.flush();
            outputStream.close();
            
            // 🔥 HTTP数据写入完成后，立即清理压缩数据，释放内存（关键优化）
            // 此时数据已经发送到服务器，不再需要保留在内存中
            if (compressTask.compressedImages != null) {
                for (int i = 0; i < compressTask.batchImages.size(); i++) {
                    ImageInfo image = compressTask.batchImages.get(i);
                    String contentUri = extractContentUri(image.uri);
                    String uriString = contentUri != null ? contentUri : image.uri;
                    // 移除并清理压缩数据
                    byte[] data = compressTask.compressedImages.remove(uriString);
                    if (data != null) {
                        data = null; // 帮助GC回收
                    }
                }
                // 清空HashMap，释放内存
                compressTask.compressedImages.clear();
            }
            
            // 读取响应
            fileLogger.d(TAG, "📥 [节点2] 开始读取HTTP响应...");
            int responseCode = connection.getResponseCode();
            fileLogger.d(TAG, "📊 [节点2] HTTP响应码: " + responseCode);
            if (responseCode != HttpURLConnection.HTTP_OK) {
                String errorText = "";
                try {
                    BufferedReader errorReader = new BufferedReader(new InputStreamReader(connection.getErrorStream(), "UTF-8"));
                    StringBuilder errorResponse = new StringBuilder();
                    String line;
                    while ((line = errorReader.readLine()) != null) {
                        errorResponse.append(line);
                    }
                    errorReader.close();
                    errorText = errorResponse.toString();
                } catch (Exception e) {
                    // 忽略错误流读取失败
                }
                fileLogger.e(TAG, "❌ [节点2] HTTP错误: " + responseCode + ", 错误信息: " + errorText);
                throw new Exception("HTTP错误: " + responseCode + " " + errorText);
            }
            
            BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), "UTF-8"));
            StringBuilder response = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                response.append(line);
            }
            reader.close();
            
            // 解析JSON响应（v2格式）
            fileLogger.d(TAG, "📝 [节点2] 开始解析JSON响应（v2），响应长度: " + response.length());
            JSONObject jsonResponse = new JSONObject(response.toString());
            
            // v2接口返回格式：{ results: [...], summary: { total_count, success_count, failed_count, ... } }
            JSONArray resultsArray = jsonResponse.optJSONArray("results");
            JSONObject summaryObj = jsonResponse.optJSONObject("summary");
            
            // 转换为兼容v1格式的Map
            Map<String, Object> result = new HashMap<>();
            int total = summaryObj != null ? summaryObj.optInt("total_count", 0) : 0;
            int successCount = summaryObj != null ? summaryObj.optInt("success_count", 0) : 0;
            int failCount = summaryObj != null ? summaryObj.optInt("failed_count", 0) : 0;
            result.put("total", total);
            result.put("success_count", successCount);
            result.put("fail_count", failCount);
            fileLogger.d(TAG, "✅ [节点2] 远程推理响应解析完成（v2）: 总计=" + total + ", 成功=" + successCount + ", 失败=" + failCount);
            
            // 转换results为兼容v1格式的items
            // 🔥 根据API V2文档，results数组中的字段直接在顶层，没有嵌套的data对象
            List<Map<String, Object>> items = new ArrayList<>();
            if (resultsArray != null) {
                for (int i = 0; i < resultsArray.length(); i++) {
                    JSONObject resultObj = resultsArray.getJSONObject(i);
                    Map<String, Object> item = new HashMap<>();
                    
                    // 🔥 API V2格式：error字段为null表示成功，非null表示失败
                    String error = null;
                    if (resultObj.has("error")) {
                        if (resultObj.isNull("error")) {
                            error = null;
                        } else {
                            error = resultObj.optString("error", null);
                            if ("null".equals(error)) {
                                error = null;
                            }
                        }
                    }
                    
                    // 根据error字段判断success
                    boolean success = (error == null || error.isEmpty());
                    item.put("success", success);
                    
                    if (success) {
                        // 🔥 API V2格式：成功时，category、confidence等字段直接在resultObj顶层
                        // 检查是否有category字段（有category表示成功）
                        if (resultObj.has("category")) {
                            Map<String, Object> data = new HashMap<>();
                            data.put("category", resultObj.optString("category", "NA"));
                            data.put("confidence", resultObj.optDouble("confidence", 0.9));
                            
                            String description = resultObj.optString("description", null);
                            data.put("description", description);
                            data.put("message", description); // message字段使用description的值
                            
                            String backgroundColor = resultObj.optString("background_color", null);
                            if (backgroundColor != null && !backgroundColor.isEmpty() && !backgroundColor.equals("null")) {
                                data.put("background_color", backgroundColor);
                            }
                            
                            String rawContent = resultObj.optString("raw_content", null);
                            if (rawContent != null && !rawContent.isEmpty()) {
                                data.put("raw_content", rawContent);
                            }
                            
                            item.put("data", data);
                        } else {
                            // 没有category字段，即使error为null也视为失败
                            item.put("error", "缺少category字段");
                            item.put("success", false);
                        }
                    } else {
                        // 失败时，添加error信息
                        item.put("error", error);
                    }
                    
                    items.add(item);
                }
            }
            result.put("items", items);
            
            return result;
            
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
            // 🔥 释放Semaphore许可
            httpRequestSemaphore.release();
        }
    }
    
    /**
     * 阶段3c: 远程推理（批次并行版本）
     * 注意：当推理成功并分类成功时，需要累加 imagesClassified 计数器
     * 🔥 批次并行优化：多个批次并行处理，每个批次内部：压缩图片 -> 上传 -> 保存结果
     * @param cacheResult 缓存查询结果，包含需要远程推理的图片列表和URI到Hash的映射
     */
    private RemoteInferenceResult performRemoteInference(CacheResult cacheResult) {
        List<ImageInfo> naImages = cacheResult.naImages;
        Map<String, String> uriToHashMap = cacheResult.uriToHashMap;
        
        fileLogger.d(TAG, "🔍 [调试] 阶段3c开始（流水线版本）: cacheResult.naImages.size()=" + naImages.size() + ", cacheResult.hitCount=" + cacheResult.hitCount + ", cacheResult.hitImages.size()=" + cacheResult.hitImages.size());
        
        // 初始化阶段级统计变量
        processedThisPhase = 0;
        totalFoundThisPhase = naImages.size();
        fileLogger.d(TAG, "阶段3c开始（流水线版本）: 远程推理，待处理图片: " + totalFoundThisPhase + " 张");
        
        // 发送阶段开始进度事件（确保UI能收到"开始处理X张图片"的消息）
        if (totalFoundThisPhase > 0) {
            fileLogger.d(TAG, "📤 准备发送远程推理开始事件: 0/" + totalFoundThisPhase);
            sendProgressEvent("remote_inference", 0, totalFoundThisPhase, currentScanId);
            fileLogger.d(TAG, "✅ 远程推理开始事件已调用发送");
        }
        
        RemoteInferenceResult result = new RemoteInferenceResult();
        // 使用线程安全的集合
        result.successImages = Collections.synchronizedList(new ArrayList<>());
        result.failedImages = Collections.synchronizedList(new ArrayList<>());
        result.successCount = 0;
        result.failedCount = 0;
        
        if (naImages.isEmpty()) {
            result.failedImages = naImages;
            result.failedCount = naImages.size();
            return result;
        }
        
        // 按批次处理（每批20张，与JS层保持一致）
        int batchSize = 20;
        int totalBatches = (naImages.size() + batchSize - 1) / batchSize;
        fileLogger.d(TAG, "🚀 开始流水线远程推理: " + totalFoundThisPhase + " 张图片，批次大小: " + batchSize + "，共 " + totalBatches + " 批");
        
        // 创建流水线组件（每个节点1个线程，简化并发控制）
        ExecutorService compressExecutor = Executors.newFixedThreadPool(1); // 节点1：压缩图片（CPU密集型）
        ExecutorService inferenceExecutor = Executors.newFixedThreadPool(1); // 节点2：发送HTTP请求（网络IO）
        ExecutorService saveExecutor = Executors.newFixedThreadPool(1); // 节点3：保存结果（数据库IO）
        
        // 🔥 限制压缩队列大小为3，控制内存中同时存在的压缩任务数量（最多3个批次在队列中等待）
        BlockingQueue<CompressTask> compressToInferenceQueue = new LinkedBlockingQueue<>(3); // 压缩结果 → 推理
        BlockingQueue<InferenceTask> inferenceToSaveQueue = new LinkedBlockingQueue<>(); // 推理结果 → 保存
        
        // 启动节点2：发送HTTP请求工作线程（单线程）
        inferenceExecutor.submit(() -> {
            boolean shouldExit = false;
            while (!shouldExit) {
                    try {
                        // 使用take()阻塞等待，避免循环轮询的性能开销
                        CompressTask compressTask = compressToInferenceQueue.take();
                        
                        // 执行远程推理请求
                        Map<String, Object> inferenceResponse = null;
                        Exception inferenceError = null;
                        
                        try {
                            fileLogger.d(TAG, "🔗 [节点2] 开始发送推理请求，批次 " + (compressTask.batchIndex + 1) + "/" + totalBatches);
                            inferenceResponse = sendInferenceRequest(compressTask);
                            fileLogger.d(TAG, "✅ [节点2] 推理请求成功，批次 " + (compressTask.batchIndex + 1));
                        } catch (Exception e) {
                            inferenceError = e;
                            String errorMessage = e.getMessage();
                            if (errorMessage != null && errorMessage.contains("timeout")) {
                                fileLogger.e(TAG, "❌ [节点2] 批次 " + (compressTask.batchIndex + 1) + " 推理请求超时: " + errorMessage, e);
                            } else {
                                fileLogger.e(TAG, "❌ [节点2] 批次 " + (compressTask.batchIndex + 1) + " 推理请求异常: " + errorMessage, e);
                            }
                        } finally {
                            // 🔥 HTTP请求完成后立即清理压缩数据，释放内存
                            // sendInferenceRequest方法内部已经清空了compressedImages HashMap
                        }
                        
                        // 🔥 在创建InferenceTask之前清理压缩数据，避免InferenceTask持有引用导致内存泄漏
                        // processAndSaveInferenceResult不使用compressedImages，所以可以安全清理
                        compressTask.compressedImages = null;
                        compressTask.metadata = null;
                        
                        // 将推理结果传递给节点3
                        InferenceTask inferenceTask = new InferenceTask(compressTask);
                        inferenceTask.inferenceResponse = inferenceResponse;
                        inferenceTask.inferenceError = inferenceError;
                        inferenceToSaveQueue.put(inferenceTask);
                        
                        // 🔥 清理compressTask中的其他非final字段引用
                        // 注意：batchImages和uriToHashMap是final的，不能设置为null，会在对象GC时自动释放
                        compressTask.compressFailedImages = null;
                        
                        // 如果是最后一个批次，处理完后退出
                        if (compressTask.isLastBatch) {
                            fileLogger.d(TAG, "🔍 [节点2] 处理完最后一个批次，退出");
                            shouldExit = true;
                        }
                        
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        fileLogger.d(TAG, "🔍 [节点2] 线程被中断，退出");
                        break;
                    } catch (Exception e) {
                        fileLogger.e(TAG, "[节点2] 处理异常", e);
                        // 异常时继续处理下一个任务，不退出
                    }
                }
            });
        
        // 启动节点3：保存结果工作线程（单线程）
        saveExecutor.submit(() -> {
            boolean shouldExit = false;
            while (!shouldExit) {
                try {
                    // 使用take()阻塞等待，避免循环轮询的性能开销
                    InferenceTask inferenceTask = inferenceToSaveQueue.take();
                    
                    // 处理推理结果并保存
                    processAndSaveInferenceResult(inferenceTask, result);
                    
                    // 🔥 使用集合大小计算已处理数量（按批更新）
                    int currentProcessed = result.successImages.size() + result.failedImages.size();
                    
                    sendProgressEvent("remote_inference", currentProcessed, totalFoundThisPhase, currentScanId);
                    
                    fileLogger.d(TAG, "🔍 [节点3] 批次 " + (inferenceTask.batchIndex + 1) + "/" + totalBatches + " 处理完成，已处理: " + currentProcessed + "/" + totalFoundThisPhase);
                    
                    // 🔥 清理InferenceTask中的非final字段引用，释放内存
                    // 注意：batchImages, uriToHashMap, compressedImages, compressFailedImages是final的，不能设置为null，会在对象GC时自动释放
                    inferenceTask.inferenceResponse = null;
                    
                    // 如果是最后一个批次，处理完后退出
                    if (inferenceTask.isLastBatch) {
                        fileLogger.d(TAG, "🔍 [节点3] 处理完最后一个批次，退出");
                        shouldExit = true;
                    }
                    
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    fileLogger.d(TAG, "🔍 [节点3] 线程被中断，退出");
                    break;
                } catch (Exception e) {
                    fileLogger.e(TAG, "[节点3] 处理异常", e);
                    // 异常时继续处理下一个任务，不退出（除非是最后一个批次）
                }
            }
        });
        
        // 节点1：提交所有批次到压缩队列
        try {
            for (int batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
                if (Thread.currentThread().isInterrupted()) {
                    fileLogger.w(TAG, "扫描线程被中断，停止处理");
                    break;
                }
                
                int startIndex = batchIndex * batchSize;
                int endIndex = Math.min(startIndex + batchSize, naImages.size());
                List<ImageInfo> batchImages = new ArrayList<>(naImages.subList(startIndex, endIndex));
                
                final int finalBatchIndex = batchIndex;
                boolean isLastBatch = (batchIndex == totalBatches - 1);
                
                compressExecutor.submit(() -> {
                    try {
                        fileLogger.d(TAG, "🗜️ [节点1] 开始压缩批次 " + (finalBatchIndex + 1) + "/" + totalBatches + "，图片数量: " + batchImages.size());
                        
                        // 压缩批次图片
                        CompressTask compressTask = compressBatchImages(batchImages, uriToHashMap, finalBatchIndex, isLastBatch);
                        
                        // 将压缩结果传递给节点2
                        compressToInferenceQueue.put(compressTask);
                        fileLogger.d(TAG, "🔍 [节点1] 批次 " + (finalBatchIndex + 1) + " 压缩任务已提交到队列" + (isLastBatch ? " (最后一批)" : ""));
                        
                        
                    } catch (Exception e) {
                        fileLogger.e(TAG, "[节点1] 批次 " + (finalBatchIndex + 1) + " 压缩异常", e);
                        // 压缩失败，仍然需要创建CompressTask传递给节点2，确保流水线正常结束
                        CompressTask compressTask = new CompressTask(finalBatchIndex, batchImages, isLastBatch, uriToHashMap);
                        compressTask.compressedImages = new HashMap<>();
                        compressTask.compressFailedImages = new ArrayList<>(batchImages); // 所有图片都标记为压缩失败
                        compressTask.metadata = new JSONObject();
                        try {
                            compressToInferenceQueue.put(compressTask);
                            fileLogger.d(TAG, "🔍 [节点1] 批次 " + (finalBatchIndex + 1) + " 压缩异常，但仍提交任务到队列" + (isLastBatch ? " (最后一批)" : ""));
                        } catch (InterruptedException ie) {
                            Thread.currentThread().interrupt();
                            fileLogger.w(TAG, "[节点1] 提交压缩任务被中断");
                        }
                    }
                });
            }
        } catch (Exception e) {
            fileLogger.e(TAG, "提交压缩任务异常", e);
        }
        
        // 等待所有任务完成
        compressExecutor.shutdown();
        inferenceExecutor.shutdown();
        saveExecutor.shutdown();
        
        try {
            int waitCount = 0;
            while (!compressExecutor.isTerminated() || !inferenceExecutor.isTerminated() || !saveExecutor.isTerminated()) {
                Thread.sleep(100);
                waitCount++;
                if (waitCount % 50 == 0) { // 每5秒打印一次
                    fileLogger.d(TAG, "🔍 [流水线] 等待中... compressExecutor终止: " + compressExecutor.isTerminated() + 
                          ", inferenceExecutor终止: " + inferenceExecutor.isTerminated() + 
                          ", saveExecutor终止: " + saveExecutor.isTerminated());
                }
            }
            fileLogger.d(TAG, "🔍 [流水线] 所有任务完成");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            fileLogger.w(TAG, "等待流水线完成被中断");
        }
        
        // 🔥 使用集合大小计算统计数据
        result.successCount = result.successImages.size();
        result.failedCount = result.failedImages.size();
        processedThisPhase = result.successImages.size() + result.failedImages.size();
        
        fileLogger.d(TAG, "✅ 阶段3c完成（流水线版本）: 推理成功 " + result.successCount + " 张，失败: " + result.failedCount + " 张，总计: " + totalFoundThisPhase + " 张");
        if (result.failedCount > 0) {
            fileLogger.w(TAG, "⚠️ 警告: 有 " + result.failedCount + " 张图片远程推理失败，将保持NA分类，后续可能需要本地推理");
        }
        
        return result;
    }
    
    /**
     * 处理推理结果并保存（节点3的工作）
     */
    private void processAndSaveInferenceResult(InferenceTask inferenceTask, RemoteInferenceResult result) {
        List<ImageInfo> batchImages = inferenceTask.batchImages;
        List<ImageInfo> compressFailedImages = inferenceTask.compressFailedImages;
        
        // 压缩失败的图片直接加入失败列表
        synchronized (result.failedImages) {
            for (ImageInfo image : compressFailedImages) {
                if (!result.failedImages.contains(image) && !result.successImages.contains(image)) {
                    result.failedImages.add(image);
                }
            }
        }
        
        // 处理推理结果
        Map<String, Object> inferenceResponse = inferenceTask.inferenceResponse;
        Exception inferenceError = inferenceTask.inferenceError;
        
        if (inferenceError != null) {
            // 推理失败，将这批图片加入失败列表
            synchronized (result.failedImages) {
                for (ImageInfo image : batchImages) {
                    if (!result.failedImages.contains(image) && !result.successImages.contains(image)) {
                        result.failedImages.add(image);
                    }
                }
            }
            return;
        }
        
        if (inferenceResponse == null || !inferenceResponse.containsKey("items")) {
            // 没有推理结果，将所有图片加入失败列表
            synchronized (result.failedImages) {
                for (ImageInfo image : batchImages) {
                    if (!result.failedImages.contains(image) && !result.successImages.contains(image)) {
                        result.failedImages.add(image);
                    }
                }
            }
            return;
        }
        
        List<Map<String, Object>> items = (List<Map<String, Object>>) inferenceResponse.get("items");
        List<Map<String, Object>> batchUpdateData = new ArrayList<>();
        
        // 处理推理结果
        fileLogger.d(TAG, "🔍 [节点3] 开始处理推理结果，items数量: " + items.size() + ", batchImages数量: " + batchImages.size());
        for (int i = 0; i < items.size() && i < batchImages.size(); i++) {
            Map<String, Object> item = items.get(i);
            ImageInfo image = batchImages.get(i);
            
            // 处理success字段
            Object successObj = item.get("success");
            boolean success = false;
            if (successObj instanceof Boolean) {
                success = ((Boolean) successObj).booleanValue();
            } else if (successObj != null) {
                try {
                    success = Boolean.parseBoolean(successObj.toString());
                } catch (Exception e) {
                    fileLogger.w(TAG, "无法解析success字段: " + successObj);
                }
            }
            
            fileLogger.d(TAG, "[节点3] 图片 " + (i + 1) + "/" + items.size() + " (" + image.fileName + "): success=" + success + ", hasData=" + item.containsKey("data"));
            
            if (success && item.containsKey("data")) {
                // 推理成功
                Map<String, Object> inferenceData = (Map<String, Object>) item.get("data");
                String category = (String) inferenceData.get("category");
                
                if (category != null && !category.isEmpty()) {
                    Map<String, Object> classificationData = new HashMap<>();
                    classificationData.put("uri", image.uri);
                    // 🔥 确保 ID 正确：如果 image.id 为空或者是纯数字（MediaStore ID），使用 URI 生成正确的 ID
                    // 注意：batchUpdateClassification 内部也会做同样的处理，但这里提前处理可以确保日志更准确
                    String imageId = image.id;
                    if (imageId == null || imageId.isEmpty() || (imageId.matches("^\\d+$"))) {
                        // 使用 URI 生成基于哈希的稳定 ID（与数据库保持一致）
                        imageId = imageDataService.generateStableIdFromUri(image.uri);
                        fileLogger.d(TAG, "[节点3] 图片 " + image.fileName + " ID为空或无效，使用URI生成ID: " + imageId);
                    }
                    classificationData.put("id", imageId);
                    classificationData.put("category", category);
                    fileLogger.d(TAG, "[节点3] 准备保存分类结果: uri=" + image.uri + ", id=" + imageId + ", category=" + category);
                    
                    Object confidenceObj = inferenceData.get("confidence");
                    double confidence = 0.9;
                    if (confidenceObj != null) {
                        if (confidenceObj instanceof Number) {
                            confidence = ((Number) confidenceObj).doubleValue();
                        } else {
                            try {
                                confidence = Double.parseDouble(confidenceObj.toString());
                            } catch (NumberFormatException e) {
                                // 使用默认值
                            }
                        }
                    }
                    classificationData.put("confidence", confidence);
                    
                    Object messageObj = inferenceData.get("description");
                    if (messageObj == null) {
                        messageObj = inferenceData.get("message");
                    }
                    if (messageObj != null) {
                        classificationData.put("message", messageObj.toString());
                    }
                    
                    Object backgroundColorObj = inferenceData.get("background_color");
                    if (backgroundColorObj != null) {
                        String backgroundColor = backgroundColorObj.toString();
                        if (backgroundColor != null && !backgroundColor.isEmpty() && !backgroundColor.equals("null")) {
                            classificationData.put("background_color", backgroundColor);
                        }
                    }
                    
                    classificationData.put("idCardDetections", new ArrayList<>());
                    classificationData.put("generalDetections", new ArrayList<>());
                    classificationData.put("mobileNetV3Detections", null);
                    
                    batchUpdateData.add(classificationData);
                    
                    synchronized (result.successImages) {
                        if (!result.successImages.contains(image)) {
                            result.successImages.add(image);
                            imagesClassified++;
                        }
                    }
                } else {
                    String error = (String) item.get("error");
                    fileLogger.w(TAG, "[节点3] 批次 " + (inferenceTask.batchIndex + 1) + " 图片 " + image.fileName + " 推理失败：category为空, error=" + error);
                    synchronized (result.failedImages) {
                        if (!result.failedImages.contains(image) && !result.successImages.contains(image)) {
                            result.failedImages.add(image);
                        }
                    }
                }
            } else {
                String error = (String) item.get("error");
                fileLogger.w(TAG, "[节点3] 批次 " + (inferenceTask.batchIndex + 1) + " 图片 " + image.fileName + " 推理失败: success=" + success + ", hasData=" + item.containsKey("data") + ", error=" + error);
                synchronized (result.failedImages) {
                    if (!result.failedImages.contains(image) && !result.successImages.contains(image)) {
                        result.failedImages.add(image);
                    }
                }
            }
        }
        
        // 批量更新分类信息
        fileLogger.d(TAG, "🔍 [节点3] 批次 " + (inferenceTask.batchIndex + 1) + " 准备批量更新，batchUpdateData数量: " + batchUpdateData.size());
        if (!batchUpdateData.isEmpty()) {
            try {
                Map<String, Object> updateResult = imageDataService.batchUpdateClassification(batchUpdateData);
                Boolean updateSuccess = (Boolean) updateResult.get("success");
                Integer updatedCount = (Integer) updateResult.get("updatedCount");
                
                if (updateSuccess != null && updateSuccess && updatedCount != null) {
                    fileLogger.d(TAG, "💾 [节点3] 批次 " + (inferenceTask.batchIndex + 1) + " 批量更新分类完成: " + updatedCount + "/" + batchUpdateData.size() + " 张图片");
                } else {
                    fileLogger.w(TAG, "⚠️ [节点3] 批次 " + (inferenceTask.batchIndex + 1) + " 批量更新分类失败: success=" + updateSuccess + ", updatedCount=" + updatedCount + ", 尝试更新: " + batchUpdateData.size() + " 张图片");
                }
            } catch (Exception e) {
                fileLogger.e(TAG, "❌ [节点3] 批次 " + (inferenceTask.batchIndex + 1) + " 保存结果异常", e);
            }
        } else {
            fileLogger.w(TAG, "⚠️ [节点3] 批次 " + (inferenceTask.batchIndex + 1) + " batchUpdateData为空，没有分类结果需要保存");
        }
    }
    
    /**
     * 批量远程推理API（v2版本）- 保留原方法以兼容，内部调用流水线版本
     * @param images 图片列表
     * @param uriToHashMap URI到Hash的映射（必填，因为上传的是压缩后的图片，必须传递基于原图的hash）
     * @return 推理结果 { items: [...], success_count: N, fail_count: N, total: N }（兼容v1格式）
     */
    private Map<String, Object> batchRemoteInference(List<ImageInfo> images, Map<String, String> uriToHashMap) throws Exception {
        // 为了兼容性，保留原方法，但内部调用新的流水线方法
        // 注意：这个方法现在主要用于单个批次的完整处理（压缩+推理）
        CompressTask compressTask = compressBatchImages(images, uriToHashMap, 0, true);
        return sendInferenceRequest(compressTask);
    }
    
    /**
     * 保存图片分类结果到数据库
     */
    private void saveImageClassification(ImageInfo image, String category, double confidence, 
                                        Map<String, Object> detections, String message, ExifData exifData, String backgroundColor) {
        try {
            Map<String, Object> imageData = new HashMap<>();
            imageData.put("uri", image.uri);
            imageData.put("fileName", image.fileName);
            imageData.put("category", category);
            imageData.put("confidence", confidence);
            // timestamp 使用图片的创建时间（优先 dateTaken，否则 dateModified 或 dateAdded）
            long timestamp = image.dateTaken > 0 ? image.dateTaken : 
                             (image.dateModified > 0 ? image.dateModified : image.dateAdded);
            imageData.put("timestamp", timestamp);
            
            // 优先使用EXIF中的拍摄时间，如果没有则使用MediaStore的时间（如果有效）
            if (exifData != null && exifData.hasTakenTime && exifData.takenTime > 0) {
                imageData.put("takenAt", exifData.takenTime);
            } else if (image.dateTaken > 0) {
                // 只有当 dateTaken 有效时才设置，否则不设置（保持 null）
                imageData.put("takenAt", image.dateTaken);
            }
            // 如果都没有有效时间，不设置 takenAt（保持 null），与 JS 层保持一致
            
            imageData.put("size", image.size);
            imageData.put("mimeType", image.mimeType);
            
            // 优先使用EXIF中的尺寸，如果没有则使用MediaStore的尺寸
            int finalWidth = 0;
            int finalHeight = 0;
            String dimensionSource = "unknown";
            if (exifData != null && exifData.dimensions != null) {
                finalWidth = exifData.dimensions.width;
                finalHeight = exifData.dimensions.height;
                dimensionSource = "exifData.dimensions";
            } else {
                finalWidth = image.width;
                finalHeight = image.height;
                dimensionSource = "MediaStore";
            }
            
            imageData.put("width", finalWidth);
            imageData.put("height", finalHeight);
            
            // 🔥 同时保存 imageDimensions 字段（JS层使用此字段）
            if (finalWidth > 0 && finalHeight > 0) {
                Map<String, Object> imageDimensions = new HashMap<>();
                imageDimensions.put("width", finalWidth);
                imageDimensions.put("height", finalHeight);
                imageData.put("imageDimensions", imageDimensions);
            }
            
            // 🔍 只记录有问题的情况（尺寸为0）
            if (finalWidth <= 0 || finalHeight <= 0) {
                fileLogger.w(TAG, "⚠️ 保存时尺寸为0: fileName=" + image.fileName + 
                      ", width=" + finalWidth + ", height=" + finalHeight + 
                      ", hasExifDimensions=" + (exifData != null && exifData.dimensions != null) +
                      ", MediaStoreWidth=" + image.width + ", MediaStoreHeight=" + image.height);
            }
            
            // GPS信息
            if (exifData != null && exifData.hasGPS && exifData.gps != null) {
                imageData.put("latitude", exifData.gps.latitude);
                imageData.put("longitude", exifData.gps.longitude);
                if (exifData.gps.altitude != null) {
                    imageData.put("altitude", exifData.gps.altitude);
                }
            }
            
            if (detections != null) {
                imageData.put("generalDetections", detections);
            }
            if (message != null) {
                imageData.put("message", message);
            }
            // 保存背景颜色字段（跳过 null 和 "null" 字符串）
            if (backgroundColor != null && !backgroundColor.isEmpty() && !backgroundColor.equals("null")) {
                imageData.put("background_color", backgroundColor);
            }
            
            List<Map<String, Object>> imageDataList = new ArrayList<>();
            imageDataList.add(imageData);
            
            imageDataService.writeImageDetailedInfo(imageDataList);
            
        } catch (Exception e) {
            fileLogger.e(TAG, "保存图片分类失败: " + image.uri, e);
        }
    }
    
    /**
     * 🆕 完成基础扫描（原生层部分）
     * 注意：这只是原生层的基础扫描完成（目录扫描、文件比对、EXIF提取、截图检测）
     * JS层收到此事件后，会继续执行位置信息补全，然后才发送最终完成消息
     */
    private void completeBasicScan(String scanId) {
        try {
            // 更新数据库状态
            imageDataService.updateSetting("scan_status", "basic_completed");
            imageDataService.updateSetting("scan_completed_at", String.valueOf(System.currentTimeMillis()));
            
            // 发送基础扫描完成进度事件（原生层部分完成）
            // JS层收到此事件后，会执行位置信息补全，然后发送最终完成消息
            // AI分类需要用户手动触发，不会自动执行
            sendProgressEvent("basic_scan_completed", processedThisPhase, totalFoundThisPhase, scanId);
            
            fileLogger.d(TAG, "基础扫描完成（原生层）: " + scanId + ", 处理 " + processedThisPhase + "/" + totalFoundThisPhase + " 张图片");
            
        } catch (Exception e) {
            fileLogger.e(TAG, "完成基础扫描失败", e);
        }
    }
    
    /**
     * 🆕 完成AI分类
     */
    private void completeAiClassification(String scanId) {
        try {
            // 更新数据库状态
            imageDataService.updateSetting("scan_status", "ai_classification_completed");
            imageDataService.updateSetting("scan_completed_at", String.valueOf(System.currentTimeMillis()));
            imageDataService.updateSetting("scan_needs_post_processing", "true");
            
            // 发送AI分类完成进度事件
            // JS层收到此事件后，AI分类完成
            sendProgressEvent("ai_classification_completed", processedThisPhase, totalFoundThisPhase, scanId);
            
            fileLogger.d(TAG, "AI分类完成: " + scanId + ", 处理 " + processedThisPhase + "/" + totalFoundThisPhase + " 张图片");
            
        } catch (Exception e) {
            fileLogger.e(TAG, "完成AI分类失败", e);
        }
    }
    
    /**
     * 发送进度事件
     * 
     * 进度事件包含4个关键指标：
     * 1. filesFound: 当前阶段需要处理的图片数量
     * 2. filesProcessed: 当前阶段已处理的图片数量
     * 3. totalImagesToBeClassified: 这次扫描任务一共需要分类的图片总数
     * 4. imagesClassified: 目前已经分类成功的图片数量（整个扫描过程累加）
     */
    private void sendProgressEvent(String stage, int filesProcessed, int filesFound, String scanId) {
        sendProgressEvent(stage, filesProcessed, filesFound, scanId, totalImagesToBeClassified, imagesClassified);
    }
    
    /**
     * 发送进度事件（完整参数）
     * 只传递阶段ID和进度数据，消息生成和国际化由JS层统一处理
     */
    private void sendProgressEvent(String stage, int filesProcessed, int filesFound, String scanId, 
                                  int totalImagesToBeClassified, int imagesClassified) {
        // 发送事件到JS层，JS层统一处理消息生成、国际化和通知更新
        mainHandler.post(() -> {
            try {
                WritableMap eventData = Arguments.createMap();
                eventData.putString("type", "progress");
                eventData.putString("stage", stage); // 阶段ID，JS层根据此ID生成国际化消息
                eventData.putInt("filesProcessed", filesProcessed); // 当前阶段已处理的图片数量
                eventData.putInt("filesFound", filesFound); // 当前阶段需要处理的图片数量
                eventData.putInt("totalImagesToBeClassified", totalImagesToBeClassified); // 这次扫描任务一共需要分类的图片总数
                eventData.putInt("imagesClassified", imagesClassified); // 目前已经分类成功的图片数量（整个扫描过程累加）
                eventData.putString("scanId", scanId);
                
                reactContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                    .emit("GalleryScanProgress", eventData);
                
                // 🔥 合并日志：只保留一条，包含完整信息
                fileLogger.d(TAG, "📊 扫描进度: " + stage + ", " + filesProcessed + "/" + filesFound + ", 总分类: " + imagesClassified + "/" + totalImagesToBeClassified);
            } catch (Exception e) {
                fileLogger.e(TAG, "❌ 发送进度事件失败", e);
            }
        });
    }
    
    
    /**
     * 发送扫描完成事件
     */
    private void sendScanCompletedEvent(String scanId) {
        mainHandler.post(() -> {
            try {
                WritableMap eventData = Arguments.createMap();
                eventData.putString("type", "scan_completed");
                eventData.putString("scanId", scanId);
                
                reactContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                    .emit("GalleryScanCompleted", eventData);
                
            } catch (Exception e) {
                fileLogger.e(TAG, "发送扫描完成事件失败", e);
            }
        });
    }
    
    /**
     * 发送错误事件
     */
    private void sendErrorEvent(String scanId, String errorMessage) {
        mainHandler.post(() -> {
            try {
                WritableMap eventData = Arguments.createMap();
                eventData.putString("type", "error");
                eventData.putString("stage", "scan");
                eventData.putString("scanId", scanId);
                eventData.putString("message", errorMessage);
                
                reactContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                    .emit("GalleryScanError", eventData);
                
            } catch (Exception e) {
                fileLogger.e(TAG, "发送错误事件失败", e);
            }
        });
    }
    
    /**
     * 图片信息类
     */
    public static class ImageInfo {
        public String id;
        public String uri;
        public String fileName;
        public String path;
        public String relativePath;
        public long size;
        public long dateTaken;
        public long dateModified;
        public long dateAdded;
        public int width;
        public int height;
        public String mimeType;
    }
    
    /**
     * 比对结果类
     */
    public static class ComparisonResult {
        public List<ImageInfo> newImages;
        public List<String> deletedUris;
        public int newCount;
        public int deletedCount;
    }
    
    
    /**
     * 流水线任务类：Hash计算任务
     */
    private static class HashTask {
        final int batchIndex;
        final List<ImageInfo> batchImages;
        final boolean isLastBatch; // 是否是最后一个批次
        Map<String, List<String>> hashToUriMap; // Hash -> URI列表
        Map<String, String> uriToHashMap; // URI -> Hash
        List<ImageInfo> hashFailedImages; // Hash计算失败的图片
        
        HashTask(int batchIndex, List<ImageInfo> batchImages, boolean isLastBatch) {
            this.batchIndex = batchIndex;
            this.batchImages = batchImages;
            this.isLastBatch = isLastBatch;
        }
    }
    
    /**
     * 流水线任务类：查询任务（包含Hash结果和查询结果）
     */
    private static class QueryTask {
        final int batchIndex;
        final List<ImageInfo> batchImages;
        final boolean isLastBatch; // 是否是最后一个批次
        final Map<String, List<String>> hashToUriMap; // Hash -> URI列表
        final Map<String, String> uriToHashMap; // URI -> Hash
        final List<ImageInfo> hashFailedImages; // Hash计算失败的图片
        Map<String, Object> cacheResponse; // 查询结果
        Exception queryError; // 查询错误（如果有）
        
        QueryTask(int batchIndex, List<ImageInfo> batchImages, 
                  boolean isLastBatch,
                  Map<String, List<String>> hashToUriMap, 
                  Map<String, String> uriToHashMap,
                  List<ImageInfo> hashFailedImages) {
            this.batchIndex = batchIndex;
            this.batchImages = batchImages;
            this.isLastBatch = isLastBatch;
            this.hashToUriMap = hashToUriMap;
            this.uriToHashMap = uriToHashMap;
            this.hashFailedImages = hashFailedImages;
        }
    }
    
    /**
     * 缓存查询结果类
     */
    public static class CacheResult {
        public List<ImageInfo> hitImages;
        public List<ImageInfo> naImages;
        public int hitCount;
        public Map<String, String> uriToHashMap; // URI到Hash的映射（用于后续远程推理）
    }
    
    /**
     * 远程推理结果类
     */
    public static class RemoteInferenceResult {
        public List<ImageInfo> successImages;
        public List<ImageInfo> failedImages;
        public int successCount;
        public int failedCount;
    }
    
    /**
     * 流水线任务类：压缩任务（节点1的输出，节点2的输入）
     */
    private static class CompressTask {
        final int batchIndex;
        final List<ImageInfo> batchImages;
        final boolean isLastBatch;
        final Map<String, String> uriToHashMap; // URI到Hash的映射
        Map<String, byte[]> compressedImages; // URI -> 压缩后的图片数据
        List<ImageInfo> compressFailedImages; // 压缩失败的图片
        JSONObject metadata; // image_metadata JSON对象
        
        CompressTask(int batchIndex, List<ImageInfo> batchImages, boolean isLastBatch, Map<String, String> uriToHashMap) {
            this.batchIndex = batchIndex;
            this.batchImages = batchImages;
            this.isLastBatch = isLastBatch;
            this.uriToHashMap = uriToHashMap;
        }
    }
    
    /**
     * 流水线任务类：推理任务（节点2的输出，节点3的输入）
     */
    private static class InferenceTask {
        final int batchIndex;
        final List<ImageInfo> batchImages;
        final boolean isLastBatch;
        final Map<String, String> uriToHashMap;
        // 🔥 移除 compressedImages 字段，因为 processAndSaveInferenceResult 不使用它
        // 这样可以避免 InferenceTask 持有压缩数据引用，防止内存泄漏
        final List<ImageInfo> compressFailedImages;
        Map<String, Object> inferenceResponse; // 推理结果
        Exception inferenceError; // 推理错误（如果有）
        
        InferenceTask(CompressTask compressTask) {
            this.batchIndex = compressTask.batchIndex;
            this.batchImages = compressTask.batchImages;
            this.isLastBatch = compressTask.isLastBatch;
            this.uriToHashMap = compressTask.uriToHashMap;
            // 🔥 不再引用 compressedImages，避免内存泄漏
            this.compressFailedImages = compressTask.compressFailedImages;
        }
    }
    
    /**
     * EXIF数据类
     */
    public static class ExifData {
        public String uri;
        public Long takenTime;
        public GpsInfo gps;
        public ImageDimensions dimensions;
        public CameraSettings cameraSettings; // 🔥 拍摄参数（ISO、光圈、快门速度、焦距）
        public boolean hasGPS;
        public boolean hasTakenTime;
    }
    
    /**
     * 拍摄参数类（与PC端格式一致）
     */
    public static class CameraSettings {
        public Integer iso;           // ISO感光度
        public Double aperture;       // 光圈值（f-stop，如 2.8）
        public Double shutterSpeed;   // 快门速度（秒，如 0.008 表示 1/125秒）
        public Double focalLength;    // 焦距（毫米，如 50）
    }
    
    /**
     * GPS信息类
     */
    public static class GpsInfo {
        public double latitude;
        public double longitude;
        public Double altitude;
    }
    
    /**
     * 图片尺寸类
     */
    public static class ImageDimensions {
        public int width;
        public int height;
    }
}

