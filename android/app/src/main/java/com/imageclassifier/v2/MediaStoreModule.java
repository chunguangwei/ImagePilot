package com.imageclassifier.v2;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.IntentSender;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.provider.MediaStore;
import android.util.Log;
import android.os.Build;
import android.Manifest;

import androidx.exifinterface.media.ExifInterface;

import com.facebook.react.bridge.ActivityEventListener;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.BaseActivityEventListener;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import java.util.Collections;

import java.io.File;
import java.io.FileOutputStream;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.PointF;
import android.graphics.Rect;
import android.media.MediaMetadataRetriever;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.face.Face;
import com.google.mlkit.vision.face.FaceDetection;
import com.google.mlkit.vision.face.FaceDetectorOptions;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

public class MediaStoreModule extends ReactContextBaseJavaModule {
    private static final String TAG = "MediaStoreModule";
    private final ReactApplicationContext reactContext;

    // 系统授权删除（Android 11+ createDeleteRequest）的状态
    private static final int REQUEST_DELETE = 0x44EE;
    private Promise pendingDeletePromise;
    private final ActivityEventListener deleteActivityListener = new BaseActivityEventListener() {
        @Override
        public void onActivityResult(Activity activity, int requestCode, int resultCode, Intent data) {
            if (requestCode != REQUEST_DELETE || pendingDeletePromise == null) return;
            Promise p = pendingDeletePromise;
            pendingDeletePromise = null;
            if (resultCode == Activity.RESULT_OK) p.resolve(true);
            else p.reject("E_DENIED", "用户拒绝授权删除");
        }
    };

    public MediaStoreModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
        reactContext.addActivityEventListener(deleteActivityListener);
    }

    @Override
    public String getName() {
        return "MediaStoreModule";
    }

    /**
     * Android 11+ 删除别的应用创建的媒体需要系统授权对话框；用 MediaStore.createDeleteRequest
     * 弹出原生确认 → 用户同意则系统直接删除。在 JS 端"删除失败"时作为兜底调用。
     */
    @ReactMethod
    public void requestDeleteByPath(String filePath, Promise promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            promise.reject("E_UNSUPPORTED", "需要 Android 11+");
            return;
        }
        try {
            ContentResolver cr = reactContext.getContentResolver();
            Cursor cursor = cr.query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                new String[]{ MediaStore.Images.Media._ID },
                MediaStore.Images.Media.DATA + "=?",
                new String[]{ filePath },
                null
            );
            if (cursor == null || !cursor.moveToFirst()) {
                if (cursor != null) cursor.close();
                promise.reject("E_NOT_FOUND", "媒体库未找到该文件");
                return;
            }
            long id = cursor.getLong(cursor.getColumnIndex(MediaStore.Images.Media._ID));
            cursor.close();
            Uri uri = Uri.withAppendedPath(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, String.valueOf(id));

            Activity act = getCurrentActivity();
            if (act == null) { promise.reject("E_NO_ACTIVITY", "当前无 Activity"); return; }

            PendingIntent pi = MediaStore.createDeleteRequest(cr, Collections.singletonList(uri));
            if (pendingDeletePromise != null) {
                try { pendingDeletePromise.reject("E_REPLACED", "请求被新请求替换"); } catch (Exception ignored) {}
            }
            pendingDeletePromise = promise;
            act.startIntentSenderForResult(pi.getIntentSender(), REQUEST_DELETE, null, 0, 0, 0);
        } catch (Exception e) {
            pendingDeletePromise = null;
            promise.reject("E_REQUEST", "请求删除授权失败: " + e.getMessage());
        }
    }

    @ReactMethod
    public void deleteFile(String filePath, Promise promise) {
        try {
            Log.d(TAG, "尝试删除文件: " + filePath);
            
            // 方法1: 使用File.delete()删除（优先）
            boolean deleted = deleteFileDirectly(filePath);
            if (deleted) {
                Log.d(TAG, "直接删除成功: " + filePath);
                promise.resolve(true);
                return;
            }
            
            // 方法2: 使用MediaStore删除（备选）
            deleted = deleteFileViaMediaStore(filePath);
            if (deleted) {
                Log.d(TAG, "MediaStore删除成功: " + filePath);
                promise.resolve(true);
                return;
            }
            
            Log.d(TAG, "所有删除方法都失败了: " + filePath);
            // 返回明确的错误信息
            promise.reject("DELETE_FAILED", "文件删除失败，可能没有权限或文件不存在");
            
        } catch (Exception e) {
            Log.e(TAG, "删除文件时发生错误: " + e.getMessage(), e);
            // 返回具体的错误信息
            promise.reject("DELETE_ERROR", "删除文件时发生错误: " + e.getMessage());
        }
    }

    private boolean deleteFileViaMediaStore(String filePath) {
        try {
            // 检查权限
            // 注意：使用 MediaStore API 删除图片时，对于应用自己创建的图片通常不需要额外权限
            // 但为了兼容性，我们仍然检查基本权限
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                // Android 13+ 只需要 READ_MEDIA_IMAGES 权限即可删除自己创建的图片
                // 删除其他应用的图片可能需要 WRITE_MEDIA_IMAGES，但我们的应用通常只删除自己创建的图片
                if (reactContext.checkSelfPermission("android.permission.READ_MEDIA_IMAGES") 
                    != PackageManager.PERMISSION_GRANTED) {
                    Log.w(TAG, "缺少 READ_MEDIA_IMAGES 权限");
                    return false;
                }
            } else {
                // Android 12 及以下需要 WRITE_EXTERNAL_STORAGE 权限
                if (reactContext.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) 
                    != PackageManager.PERMISSION_GRANTED) {
                    Log.w(TAG, "缺少 WRITE_EXTERNAL_STORAGE 权限");
                    return false;
                }
            }
            
            ContentResolver contentResolver = reactContext.getContentResolver();
            
            // 先检查文件是否存在
            File file = new File(filePath);
            if (!file.exists()) {
                Log.w(TAG, "文件不存在: " + filePath);
                return false;
            }
            
            Log.d(TAG, "开始查询MediaStore，文件路径: " + filePath);
            
            // 查询文件的MediaStore ID
            String selection = MediaStore.Images.Media.DATA + "=?";
            String[] selectionArgs = {filePath};
            
            Cursor cursor = contentResolver.query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                new String[]{MediaStore.Images.Media._ID},
                selection,
                selectionArgs,
                null
            );
            
            Log.d(TAG, "MediaStore查询结果: cursor=" + (cursor != null ? "非空" : "空"));
            
            if (cursor != null && cursor.moveToFirst()) {
                int idColumn = cursor.getColumnIndex(MediaStore.Images.Media._ID);
                long id = cursor.getLong(idColumn);
                Log.d(TAG, "找到MediaStore ID: " + id);
                cursor.close();
                
                // 使用MediaStore删除文件到回收站
                Uri deleteUri = Uri.withAppendedPath(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI, 
                    String.valueOf(id)
                );
                
                Log.d(TAG, "删除URI: " + deleteUri);
                
                // 🔥 优先使用 IS_TRASHED 和 DATE_EXPIRES 实现删除到回收站
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    // Android 11+ (API 30+) 使用 IS_TRASHED 和 DATE_EXPIRES
                    try {
                        ContentValues values = new ContentValues();
                        values.put(MediaStore.Images.Media.IS_TRASHED, 1);
                        // 设置30天后过期（自动永久删除），时间戳为秒级
                        long expireTime = System.currentTimeMillis() / 1000 + (30L * 24 * 60 * 60);
                        values.put(MediaStore.Images.Media.DATE_EXPIRES, expireTime);
                        
                        int updatedRows = contentResolver.update(deleteUri, values, null, null);
                        Log.d(TAG, "MediaStore标记为回收站: " + updatedRows + " 行，过期时间: " + expireTime);
                        
                        if (updatedRows > 0) {
                            Log.d(TAG, "✅ 文件已移动到回收站（30天后自动永久删除）");
                            // 文件已移动到回收站，不需要验证文件是否存在
                            return true;
                        } else {
                            Log.w(TAG, "⚠️ 标记为回收站失败，降级到直接删除");
                        }
                    } catch (Exception e) {
                        Log.w(TAG, "⚠️ 使用IS_TRASHED失败: " + e.getMessage() + "，降级到直接删除");
                    }
                }
                
                // 降级方案：Android 10 尝试使用 IS_PENDING（部分厂商可能不支持）
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
                    try {
                        ContentValues values = new ContentValues();
                        values.put(MediaStore.Images.Media.IS_PENDING, 1);
                        int updatedRows = contentResolver.update(deleteUri, values, null, null);
                        Log.d(TAG, "MediaStore标记为IS_PENDING: " + updatedRows + " 行");
                        
                        if (updatedRows > 0) {
                            Log.d(TAG, "✅ 文件已标记为待删除（IS_PENDING）");
                            return true;
                        }
                    } catch (Exception e) {
                        Log.w(TAG, "⚠️ 使用IS_PENDING失败: " + e.getMessage());
                    }
                }
                
                // 最后的降级方案：直接删除（如果上述方法都不支持或失败）
                Log.d(TAG, "降级到直接删除");
                int deletedRows = contentResolver.delete(deleteUri, null, null);
                Log.d(TAG, "MediaStore删除结果: " + deletedRows + " 行");
                
                // 验证文件是否真的被删除了
                boolean fileStillExists = file.exists();
                Log.d(TAG, "文件删除后状态: " + (fileStillExists ? "仍存在" : "已删除"));
                return !fileStillExists;
            } else {
                Log.w(TAG, "MediaStore中未找到文件记录: " + filePath);
            }
            
            if (cursor != null) {
                cursor.close();
            }
            
            return false;
            
        } catch (Exception e) {
            if (e instanceof SecurityException || (e.getMessage() != null && e.getMessage().toLowerCase().contains("permission"))) {
                Log.i(TAG, "MediaStore删除失败(权限受限): " + e.getMessage());
            } else {
                Log.e(TAG, "MediaStore删除失败: " + e.getMessage(), e);
            }
            return false;
        }
    }

    private boolean deleteFileDirectly(String filePath) {
        try {
            File file = new File(filePath);
            if (file.exists()) {
                boolean deleted = file.delete();
                Log.d(TAG, "直接删除结果: " + deleted);
                return deleted && !file.exists();
            }
            return false;
        } catch (Exception e) {
            Log.e(TAG, "直接删除失败: " + e.getMessage(), e);
            return false;
        }
    }

    private boolean deleteFileViaSystem(String filePath) {
        try {
            // 使用Runtime执行系统命令
            Process process = Runtime.getRuntime().exec("rm -f \"" + filePath + "\"");
            int exitCode = process.waitFor();
            
            Log.d(TAG, "系统命令删除结果: " + exitCode);
            
            // 验证文件是否真的被删除了
            File file = new File(filePath);
            return !file.exists();
            
        } catch (Exception e) {
            Log.e(TAG, "系统命令删除失败: " + e.getMessage(), e);
            return false;
        }
    }

    /**
     * 用系统播放器播放视频（ACTION_VIEW intent）。combinedUri 为 "content://...||/path" 格式，
     * 取 || 前的 content uri；没有则原样用。授予临时读权限给外部播放器。
     */
    @ReactMethod
    public void playVideo(String combinedUri, Promise promise) {
        try {
            String uriStr = combinedUri == null ? "" : combinedUri;
            int sep = uriStr.indexOf("||");
            if (sep >= 0) uriStr = uriStr.substring(0, sep);
            if (uriStr.isEmpty()) { promise.reject("E_PLAY", "空 uri"); return; }
            Uri videoUri = Uri.parse(uriStr);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(videoUri, "video/*");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            Activity activity = getCurrentActivity();
            Context ctx = (activity != null) ? activity : getReactApplicationContext();
            ctx.startActivity(intent);
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("E_PLAY", e.getMessage());
        }
    }

    /**
     * 视频抽帧（自动分类用）：取时长中点一帧，存 ≤1024px JPEG 到 cacheDir，返回 file:// 路径。
     * combinedUri 兼容 "content://...||/path" 组合格式（取 || 前的 content uri）。
     */
    @ReactMethod
    public void extractVideoFrame(String combinedUri, Promise promise) {
        MediaMetadataRetriever mmr = new MediaMetadataRetriever();
        try {
            String s = combinedUri == null ? "" : combinedUri;
            int sep = s.indexOf("||");
            String target = (sep >= 0) ? s.substring(0, sep) : s;
            if (target.isEmpty()) { promise.reject("E_FRAME", "空 uri"); return; }
            if (target.startsWith("content://")) {
                mmr.setDataSource(getReactApplicationContext(), Uri.parse(target));
            } else {
                mmr.setDataSource(target.startsWith("file://") ? target.substring(7) : target);
            }
            String durStr = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            long durMs = 0;
            try { durMs = durStr != null ? Long.parseLong(durStr) : 0; } catch (NumberFormatException ignore) {}
            // 中点帧；OPTION_CLOSEST_SYNC 就近取关键帧，避免逐帧解码慢
            Bitmap bmp = mmr.getFrameAtTime(Math.max(durMs * 1000L / 2, 0), MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
            if (bmp == null) { promise.reject("E_FRAME", "getFrameAtTime 返回空"); return; }
            int w = bmp.getWidth(), h = bmp.getHeight();
            float scale = 1024f / Math.max(w, h);
            if (scale < 1f) {
                bmp = Bitmap.createScaledBitmap(bmp, Math.round(w * scale), Math.round(h * scale), true);
            }
            File out = new File(getReactApplicationContext().getCacheDir(), "vframe_" + Math.abs(s.hashCode()) + ".jpg");
            FileOutputStream fos = new FileOutputStream(out);
            bmp.compress(Bitmap.CompressFormat.JPEG, 85, fos);
            fos.close();
            promise.resolve("file://" + out.getAbsolutePath());
        } catch (Exception e) {
            promise.reject("E_FRAME", e.getMessage());
        } finally {
            try { mmr.release(); } catch (Exception ignore) {}
        }
    }

    /**
     * 人脸检测（人像美颜「仅人脸区域」用）：ML Kit Face Detection（bundled，自带模型不依赖 GMS）。
     * 入参本地文件路径；返回归一化 [{x,y,width,height}]（左上原点）。
     * 相比系统老 android.media.FaceDetector，侧脸/歪头/暗光/小脸检出率显著更高。
     */
    @ReactMethod
    public void detectFaces(String path, Promise promise) {
        try {
            String p = (path != null && path.startsWith("file://")) ? path.substring(7) : path;
            Bitmap bmp = BitmapFactory.decodeFile(p);   // 默认 ARGB_8888，ML Kit 要求
            if (bmp == null) { promise.reject("E_FACE", "无法读取图片"); return; }
            final int w = bmp.getWidth();
            final int h = bmp.getHeight();

            FaceDetectorOptions options = new FaceDetectorOptions.Builder()
                .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)   // 精度优先（美颜非实时，可接受稍慢）
                .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_NONE)
                .setContourMode(FaceDetectorOptions.CONTOUR_MODE_NONE)
                .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_NONE)
                .setMinFaceSize(0.08f)   // 检出占比更小的脸（默认 0.1）
                .build();
            final com.google.mlkit.vision.face.FaceDetector detector = FaceDetection.getClient(options);
            InputImage image = InputImage.fromBitmap(bmp, 0);

            detector.process(image)
                .addOnSuccessListener(new com.google.android.gms.tasks.OnSuccessListener<List<Face>>() {
                    @Override
                    public void onSuccess(List<Face> faces) {
                        try {
                            WritableArray out = Arguments.createArray();
                            for (Face f : faces) {
                                Rect bb = f.getBoundingBox();
                                double x = Math.max(0, bb.left) / (double) w;
                                double y = Math.max(0, bb.top) / (double) h;
                                double fw = Math.min(bb.width(), w) / (double) w;
                                double fh = Math.min(bb.height(), h) / (double) h;
                                if (fw <= 0 || fh <= 0) continue;
                                WritableMap m = Arguments.createMap();
                                m.putDouble("x", x);
                                m.putDouble("y", y);
                                m.putDouble("width", fw);
                                m.putDouble("height", fh);
                                out.pushMap(m);
                            }
                            promise.resolve(out);
                        } catch (Exception ex) {
                            promise.reject("E_FACE", ex.getMessage());
                        } finally {
                            detector.close();
                        }
                    }
                })
                .addOnFailureListener(new com.google.android.gms.tasks.OnFailureListener() {
                    @Override
                    public void onFailure(Exception e) {
                        detector.close();
                        promise.reject("E_FACE", e.getMessage());
                    }
                });
        } catch (Exception e) {
            promise.reject("E_FACE", e.getMessage());
        }
    }

    /**
     * 批量取视频时长（秒）——存量视频 duration 回填用。
     * 入参 combinedUri 数组（兼容 "content://...||/path"），返回 { uri: seconds } 映射；取不到的不返回。
     */
    @ReactMethod
    public void getVideoDurations(ReadableArray uris, Promise promise) {
        WritableMap out = Arguments.createMap();
        try {
            int n = uris != null ? uris.size() : 0;
            for (int i = 0; i < n; i++) {
                String s = uris.getString(i);
                if (s == null || s.isEmpty()) continue;
                MediaMetadataRetriever mmr = new MediaMetadataRetriever();
                try {
                    int sep = s.indexOf("||");
                    String target = (sep >= 0) ? s.substring(0, sep) : s;
                    if (target.startsWith("content://")) {
                        mmr.setDataSource(getReactApplicationContext(), Uri.parse(target));
                    } else {
                        mmr.setDataSource(target.startsWith("file://") ? target.substring(7) : target);
                    }
                    String durStr = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
                    long durMs = durStr != null ? Long.parseLong(durStr) : 0;
                    if (durMs > 0) out.putDouble(s, durMs / 1000.0);
                } catch (Exception ignore) {
                    // 单个失败跳过，不影响其它
                } finally {
                    try { mmr.release(); } catch (Exception ignore) {}
                }
            }
            promise.resolve(out);
        } catch (Exception e) {
            promise.reject("E_DURATIONS", e.getMessage());
        }
    }

    @ReactMethod
    public void getFileInfo(String filePath, Promise promise) {
        try {
            File file = new File(filePath);
            WritableMap fileInfo = Arguments.createMap();
            
            if (file.exists()) {
                fileInfo.putBoolean("exists", true);
                fileInfo.putString("path", file.getAbsolutePath());
                fileInfo.putString("name", file.getName());
                fileInfo.putDouble("size", file.length());
                fileInfo.putDouble("lastModified", file.lastModified());
                fileInfo.putBoolean("canRead", file.canRead());
                fileInfo.putBoolean("canWrite", file.canWrite());
                fileInfo.putBoolean("canExecute", file.canExecute());
            } else {
                fileInfo.putBoolean("exists", false);
            }
            
            promise.resolve(fileInfo);
            
        } catch (Exception e) {
            Log.e(TAG, "获取文件信息失败: " + e.getMessage(), e);
            promise.reject("FILE_INFO_ERROR", e.getMessage());
        }
    }

    /**
     * 获取所有图片清单
     * @param limit 限制返回数量，0表示不限制
     * @param offset 偏移量，用于分页
     * @param promise Promise对象
     */
    @ReactMethod
    public void getAllImages(int limit, int offset, Promise promise) {
        try {
            Log.d(TAG, "开始获取图片清单, limit=" + limit + ", offset=" + offset);
            
            ContentResolver contentResolver = reactContext.getContentResolver();
            
            // 查询字段（Android 10+ 添加 RELATIVE_PATH）
            // 统一投影列：始终查询 DATA 和 RELATIVE_PATH（如果API支持）
            // 不依赖版本号判断，直接查询，如果列不存在会返回 -1
            String[] projection = new String[]{
                MediaStore.Images.Media._ID,
                MediaStore.Images.Media.DISPLAY_NAME,
                MediaStore.Images.Media.SIZE,
                MediaStore.Images.Media.DATE_TAKEN,
                MediaStore.Images.Media.DATE_MODIFIED,
                MediaStore.Images.Media.DATE_ADDED,
                MediaStore.Images.Media.WIDTH,
                MediaStore.Images.Media.HEIGHT,
                MediaStore.Images.Media.MIME_TYPE,
                MediaStore.Images.Media.DATA,  // 绝对路径（优先使用，可能为null）
                MediaStore.Images.Media.RELATIVE_PATH  // 相对路径（如果DATA为空，使用此路径）
            };
            
            // 排序：按拍摄时间降序（不在这里添加 LIMIT，因为不是所有 Android 版本都支持）
            String sortOrder = MediaStore.Images.Media.DATE_TAKEN + " DESC";
            
            Cursor cursor = contentResolver.query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                projection,
                null,  // selection
                null,  // selectionArgs
                sortOrder
            );
            
            WritableArray imageArray = Arguments.createArray();
            int count = 0;
            int skipped = 0;
            
            if (cursor != null) {
                int idColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID);
                int nameColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME);
                int sizeColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.SIZE);
                int dateTakenColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_TAKEN);
                int dateModifiedColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_MODIFIED);
                int dateAddedColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_ADDED);
                int widthColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.WIDTH);
                int heightColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.HEIGHT);
                int mimeTypeColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.MIME_TYPE);
                int dataColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATA);
                
                // 尝试获取 RELATIVE_PATH 列索引（可能不存在，使用 getColumnIndex）
                // 不依赖版本号，直接尝试获取
                int relativePathColumn = cursor.getColumnIndex(MediaStore.Images.Media.RELATIVE_PATH);
                
                // 手动实现分页：跳过 offset 个结果
                if (offset > 0 && cursor.moveToPosition(offset - 1)) {
                    // 移动到起始位置
                } else if (offset > 0) {
                    // offset 超出范围
                    cursor.close();
                    WritableMap result = Arguments.createMap();
                    result.putArray("images", imageArray);
                    result.putInt("count", 0);
                    result.putInt("offset", offset);
                    result.putBoolean("hasMore", false);
                    promise.resolve(result);
                    return;
                }
                
                // 读取指定数量的结果
                while (cursor.moveToNext()) {
                    long id = cursor.getLong(idColumn);
                    String displayName = cursor.getString(nameColumn);
                    long size = cursor.getLong(sizeColumn);
                    long dateTaken = cursor.getLong(dateTakenColumn);
                    long dateModified = cursor.getLong(dateModifiedColumn);
                    long dateAdded = cursor.getLong(dateAddedColumn);
                    int width = cursor.getInt(widthColumn);
                    int height = cursor.getInt(heightColumn);
                    String mimeType = cursor.getString(mimeTypeColumn);
                    String path = cursor.getString(dataColumn);  // 绝对路径（可能为null）
                    
                    // 读取 RELATIVE_PATH（如果列存在）
                    String relativePath = null;
                    if (relativePathColumn >= 0) {
                        relativePath = cursor.getString(relativePathColumn);
                    }
                    
                    // 构建Content URI
                    Uri contentUri = ContentUris.withAppendedId(
                        MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                        id
                    );
                    
                    WritableMap imageInfo = Arguments.createMap();
                    imageInfo.putString("id", String.valueOf(id));
                    imageInfo.putString("uri", contentUri.toString());
                    imageInfo.putString("fileName", displayName);
                    
                    // 优先使用绝对路径（path），如果为空则使用相对路径（relativePath）
                    if (path != null && !path.isEmpty()) {
                        imageInfo.putString("path", path);
                    } else if (relativePath != null && !relativePath.isEmpty()) {
                        // 绝对路径为空，使用相对路径
                        imageInfo.putString("path", relativePath);
                    }
                    // 如果两者都为空，则不设置path字段
                    
                    // 同时保存 relativePath（如果有），用于后续处理
                    if (relativePath != null && !relativePath.isEmpty()) {
                        imageInfo.putString("relativePath", relativePath);
                    }
                    
                    imageInfo.putDouble("size", size);
                    imageInfo.putDouble("dateTaken", dateTaken);
                    imageInfo.putDouble("dateModified", dateModified * 1000); // 转换为毫秒
                    imageInfo.putDouble("dateAdded", dateAdded * 1000); // 转换为毫秒
                    imageInfo.putInt("width", width);
                    imageInfo.putInt("height", height);
                    imageInfo.putString("mimeType", mimeType);
                    
                    imageArray.pushMap(imageInfo);
                    count++;
                    
                    // 如果设置了 limit，达到 limit 后停止
                    if (limit > 0 && count >= limit) {
                        break;
                    }
                }
                
                cursor.close();
            }
            
            WritableMap result = Arguments.createMap();
            result.putArray("images", imageArray);
            result.putInt("count", count);
            result.putInt("offset", offset);
            result.putBoolean("hasMore", count == limit);
            
            Log.d(TAG, "成功获取 " + count + " 张图片");
            promise.resolve(result);
            
        } catch (Exception e) {
            Log.e(TAG, "获取图片清单失败: " + e.getMessage(), e);
            promise.reject("GET_IMAGES_ERROR", e.getMessage());
        }
    }

    /**
     * 获取指定时间之后的图片清单（用于查询新发现的照片）
     * @param sinceTime 起始时间戳（毫秒），查询 DATE_TAKEN >= sinceTime 的图片
     * @param limit 限制返回数量，0表示不限制
     * @param offset 偏移量，用于分页
     * @param promise Promise对象
     */
    @ReactMethod
    public void getImagesSinceTime(double sinceTime, int limit, int offset, Promise promise) {
        try {
            // 将 double 转换为 long（React Native 不支持 long 类型参数）
            long sinceTimeLong = (long) sinceTime;
            Log.d(TAG, "开始获取指定时间之后的图片清单, sinceTime=" + sinceTimeLong + ", limit=" + limit + ", offset=" + offset);
            
            ContentResolver contentResolver = reactContext.getContentResolver();
            
            // 查询字段（与 getAllImages 保持一致）
            String[] projection = new String[]{
                MediaStore.Images.Media._ID,
                MediaStore.Images.Media.DISPLAY_NAME,
                MediaStore.Images.Media.SIZE,
                MediaStore.Images.Media.DATE_TAKEN,
                MediaStore.Images.Media.DATE_MODIFIED,
                MediaStore.Images.Media.DATE_ADDED,
                MediaStore.Images.Media.WIDTH,
                MediaStore.Images.Media.HEIGHT,
                MediaStore.Images.Media.MIME_TYPE,
                MediaStore.Images.Media.DATA,  // 绝对路径（优先使用，可能为null）
                MediaStore.Images.Media.RELATIVE_PATH  // 相对路径（如果DATA为空，使用此路径）
            };
            
            // 查询条件：DATE_TAKEN >= sinceTime
            String selection = MediaStore.Images.Media.DATE_TAKEN + " >= ?";
            String[] selectionArgs = new String[]{String.valueOf(sinceTimeLong)};
            
            // 排序：按拍摄时间降序
            String sortOrder = MediaStore.Images.Media.DATE_TAKEN + " DESC";
            
            Cursor cursor = contentResolver.query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                projection,
                selection,
                selectionArgs,
                sortOrder
            );
            
            WritableArray imageArray = Arguments.createArray();
            int count = 0;
            int skipped = 0;
            
            if (cursor != null) {
                int idColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID);
                int nameColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME);
                int sizeColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.SIZE);
                int dateTakenColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_TAKEN);
                int dateModifiedColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_MODIFIED);
                int dateAddedColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_ADDED);
                int widthColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.WIDTH);
                int heightColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.HEIGHT);
                int mimeTypeColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.MIME_TYPE);
                int dataColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATA);
                
                // 尝试获取 RELATIVE_PATH 列索引（可能不存在，使用 getColumnIndex）
                int relativePathColumn = cursor.getColumnIndex(MediaStore.Images.Media.RELATIVE_PATH);
                
                // 手动实现分页：跳过 offset 个结果
                if (offset > 0 && cursor.moveToPosition(offset - 1)) {
                    // 移动到起始位置
                } else if (offset > 0) {
                    // offset 超出范围
                    cursor.close();
                    WritableMap result = Arguments.createMap();
                    result.putArray("images", imageArray);
                    result.putInt("count", 0);
                    result.putInt("offset", offset);
                    result.putBoolean("hasMore", false);
                    promise.resolve(result);
                    return;
                }
                
                // 读取指定数量的结果
                while (cursor.moveToNext()) {
                    long id = cursor.getLong(idColumn);
                    String displayName = cursor.getString(nameColumn);
                    long size = cursor.getLong(sizeColumn);
                    long dateTaken = cursor.getLong(dateTakenColumn);
                    long dateModified = cursor.getLong(dateModifiedColumn);
                    long dateAdded = cursor.getLong(dateAddedColumn);
                    int width = cursor.getInt(widthColumn);
                    int height = cursor.getInt(heightColumn);
                    String mimeType = cursor.getString(mimeTypeColumn);
                    String path = cursor.getString(dataColumn);  // 绝对路径（可能为null）
                    
                    // 读取 RELATIVE_PATH（如果列存在）
                    String relativePath = null;
                    if (relativePathColumn >= 0) {
                        relativePath = cursor.getString(relativePathColumn);
                    }
                    
                    // 构建Content URI
                    Uri contentUri = ContentUris.withAppendedId(
                        MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                        id
                    );
                    
                    WritableMap imageInfo = Arguments.createMap();
                    imageInfo.putString("id", String.valueOf(id));
                    imageInfo.putString("uri", contentUri.toString());
                    imageInfo.putString("fileName", displayName);
                    
                    // 优先使用绝对路径（path），如果为空则使用相对路径（relativePath）
                    if (path != null && !path.isEmpty()) {
                        imageInfo.putString("path", path);
                    } else if (relativePath != null && !relativePath.isEmpty()) {
                        // 绝对路径为空，使用相对路径
                        imageInfo.putString("path", relativePath);
                    }
                    // 如果两者都为空，则不设置path字段
                    
                    // 同时保存 relativePath（如果有），用于后续处理
                    if (relativePath != null && !relativePath.isEmpty()) {
                        imageInfo.putString("relativePath", relativePath);
                    }
                    
                    imageInfo.putDouble("size", size);
                    imageInfo.putDouble("dateTaken", dateTaken);
                    imageInfo.putDouble("dateModified", dateModified * 1000); // 转换为毫秒
                    imageInfo.putDouble("dateAdded", dateAdded * 1000); // 转换为毫秒
                    imageInfo.putInt("width", width);
                    imageInfo.putInt("height", height);
                    imageInfo.putString("mimeType", mimeType);
                    
                    imageArray.pushMap(imageInfo);
                    count++;
                    
                    // 如果设置了 limit，达到 limit 后停止
                    if (limit > 0 && count >= limit) {
                        break;
                    }
                }
                
                cursor.close();
            }
            
            WritableMap result = Arguments.createMap();
            result.putArray("images", imageArray);
            result.putInt("count", count);
            result.putInt("offset", offset);
            result.putBoolean("hasMore", count == limit);
            
            Log.d(TAG, "成功获取 " + count + " 张指定时间之后的图片");
            promise.resolve(result);
            
        } catch (Exception e) {
            Log.e(TAG, "获取指定时间之后的图片清单失败: " + e.getMessage(), e);
            promise.reject("GET_IMAGES_SINCE_TIME_ERROR", e.getMessage());
        }
    }

    /**
     * 提取图片的EXIF信息
     * @param uriString 图片URI
     * @param promise Promise对象
     */
    @ReactMethod
    public void getImageExif(String uriString, Promise promise) {
        try {
            Uri uri = Uri.parse(uriString);
            ContentResolver contentResolver = reactContext.getContentResolver();
            
            // Android 10+ 需要使用setRequireOriginal获取原始图片（包含完整EXIF）
            Uri originalUri = uri;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                try {
                    originalUri = MediaStore.setRequireOriginal(uri);
                } catch (Exception e) {
                    Log.w(TAG, "无法获取原始图片，使用普通URI: " + e.getMessage());
                }
            }
            
            InputStream inputStream = contentResolver.openInputStream(originalUri);
            if (inputStream == null) {
                promise.reject("EXIF_ERROR", "无法打开图片流");
                return;
            }
            
            ExifInterface exif = new ExifInterface(inputStream);
            WritableMap exifData = Arguments.createMap();
            
            // 提取拍摄时间
            String dateTimeOriginal = exif.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL);
            String dateTime = exif.getAttribute(ExifInterface.TAG_DATETIME);
            String dateTimeDigitized = exif.getAttribute(ExifInterface.TAG_DATETIME_DIGITIZED);
            
            if (dateTimeOriginal != null) {
                exifData.putString("dateTimeOriginal", dateTimeOriginal);
                exifData.putDouble("takenTime", parseExifDateTime(dateTimeOriginal));
            } else if (dateTime != null) {
                exifData.putString("dateTime", dateTime);
                exifData.putDouble("takenTime", parseExifDateTime(dateTime));
            } else if (dateTimeDigitized != null) {
                exifData.putString("dateTimeDigitized", dateTimeDigitized);
                exifData.putDouble("takenTime", parseExifDateTime(dateTimeDigitized));
            }
            
            // 提取GPS信息
            float[] latLong = new float[2];
            boolean hasGPS = exif.getLatLong(latLong);
            
            if (hasGPS) {
                WritableMap gpsInfo = Arguments.createMap();
                gpsInfo.putDouble("latitude", latLong[0]);
                gpsInfo.putDouble("longitude", latLong[1]);
                
                // 提取GPS高度
                double altitude = exif.getAltitude(0);
                if (altitude != 0) {
                    gpsInfo.putDouble("altitude", altitude);
                }
                
                // 提取GPS时间戳
                String gpsDateStamp = exif.getAttribute(ExifInterface.TAG_GPS_DATESTAMP);
                String gpsTimeStamp = exif.getAttribute(ExifInterface.TAG_GPS_TIMESTAMP);
                if (gpsDateStamp != null && gpsTimeStamp != null) {
                    gpsInfo.putString("gpsDateStamp", gpsDateStamp);
                    gpsInfo.putString("gpsTimeStamp", gpsTimeStamp);
                }
                
                exifData.putMap("gps", gpsInfo);
                exifData.putBoolean("hasGPS", true);
            } else {
                exifData.putBoolean("hasGPS", false);
            }
            
            // 提取图片尺寸
            int imageWidth = exif.getAttributeInt(ExifInterface.TAG_IMAGE_WIDTH, 0);
            int imageHeight = exif.getAttributeInt(ExifInterface.TAG_IMAGE_LENGTH, 0);
            if (imageWidth > 0 && imageHeight > 0) {
                exifData.putInt("width", imageWidth);
                exifData.putInt("height", imageHeight);
            }
            
            // 提取其他常用EXIF信息
            String make = exif.getAttribute(ExifInterface.TAG_MAKE);
            String model = exif.getAttribute(ExifInterface.TAG_MODEL);
            String orientation = exif.getAttribute(ExifInterface.TAG_ORIENTATION);
            
            if (make != null) exifData.putString("make", make);
            if (model != null) exifData.putString("model", model);
            if (orientation != null) exifData.putString("orientation", orientation);
            
            inputStream.close();
            
            Log.d(TAG, "成功提取EXIF信息, hasGPS=" + hasGPS);
            promise.resolve(exifData);
            
        } catch (IOException e) {
            Log.e(TAG, "读取EXIF失败: " + e.getMessage(), e);
            promise.reject("EXIF_ERROR", e.getMessage());
        } catch (Exception e) {
            Log.e(TAG, "提取EXIF信息失败: " + e.getMessage(), e);
            promise.reject("EXIF_ERROR", e.getMessage());
        }
    }

    /**
     * 批量提取EXIF信息（性能优化版本）
     * @param uriArrayString JSON数组格式的URI列表
     * @param promise Promise对象
     */
    @ReactMethod
    public void batchGetImageExif(String uriArrayString, Promise promise) {
        try {
            // 解析URI数组（简单实现，生产环境应使用JSON库）
            String[] uris = uriArrayString
                .replace("[", "")
                .replace("]", "")
                .replace("\"", "")
                .split(",");
            
            WritableArray results = Arguments.createArray();
            int successCount = 0;
            int failCount = 0;
            
            for (String uriString : uris) {
                uriString = uriString.trim();
                if (uriString.isEmpty()) continue;
                
                try {
                    Uri uri = Uri.parse(uriString);
                    ContentResolver contentResolver = reactContext.getContentResolver();
                    
                    Uri originalUri = uri;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        try {
                            originalUri = MediaStore.setRequireOriginal(uri);
                        } catch (Exception e) {
                            // 忽略错误，使用普通URI
                        }
                    }
                    
                    InputStream inputStream = contentResolver.openInputStream(originalUri);
                    if (inputStream == null) {
                        WritableMap errorResult = Arguments.createMap();
                        errorResult.putString("uri", uriString);
                        errorResult.putBoolean("success", false);
                        errorResult.putString("error", "无法打开图片流");
                        results.pushMap(errorResult);
                        failCount++;
                        continue;
                    }
                    
                    ExifInterface exif = new ExifInterface(inputStream);
                    WritableMap exifData = Arguments.createMap();
                    exifData.putString("uri", uriString);
                    exifData.putBoolean("success", true);
                    
                    // 提取拍摄时间
                    String dateTimeOriginal = exif.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL);
                    if (dateTimeOriginal != null) {
                        exifData.putDouble("takenTime", parseExifDateTime(dateTimeOriginal));
                    }
                    
                    // 提取GPS信息
                    float[] latLong = new float[2];
                    if (exif.getLatLong(latLong)) {
                        WritableMap gpsInfo = Arguments.createMap();
                        gpsInfo.putDouble("latitude", latLong[0]);
                        gpsInfo.putDouble("longitude", latLong[1]);
                        gpsInfo.putDouble("altitude", exif.getAltitude(0));
                        exifData.putMap("gps", gpsInfo);
                    }
                    
                    // 提取图片尺寸
                    int width = exif.getAttributeInt(ExifInterface.TAG_IMAGE_WIDTH, 0);
                    int height = exif.getAttributeInt(ExifInterface.TAG_IMAGE_LENGTH, 0);
                    if (width > 0) exifData.putInt("width", width);
                    if (height > 0) exifData.putInt("height", height);
                    
                    inputStream.close();
                    results.pushMap(exifData);
                    successCount++;
                    
                } catch (Exception e) {
                    WritableMap errorResult = Arguments.createMap();
                    errorResult.putString("uri", uriString);
                    errorResult.putBoolean("success", false);
                    errorResult.putString("error", e.getMessage());
                    results.pushMap(errorResult);
                    failCount++;
                }
            }
            
            WritableMap result = Arguments.createMap();
            result.putArray("results", results);
            result.putInt("successCount", successCount);
            result.putInt("failCount", failCount);
            result.putInt("total", uris.length);
            
            Log.d(TAG, "批量EXIF提取完成: 成功=" + successCount + ", 失败=" + failCount);
            promise.resolve(result);
            
        } catch (Exception e) {
            Log.e(TAG, "批量提取EXIF失败: " + e.getMessage(), e);
            promise.reject("BATCH_EXIF_ERROR", e.getMessage());
        }
    }

    /**
     * 解析EXIF日期时间格式 (yyyy:MM:dd HH:mm:ss) 为时间戳
     */
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
            Log.w(TAG, "解析EXIF日期失败: " + dateTimeStr);
            return 0;
        }
    }

    /**
     * 根据文件路径查询MediaStore URI
     * @param filePath 文件路径
     * @param promise Promise对象
     */
    @ReactMethod
    public void getUriByPath(String filePath, Promise promise) {
        try {
            ContentResolver contentResolver = reactContext.getContentResolver();
            
            String selection = MediaStore.Images.Media.DATA + "=?";
            String[] selectionArgs = {filePath};
            
            Cursor cursor = contentResolver.query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                new String[]{MediaStore.Images.Media._ID},
                selection,
                selectionArgs,
                null
            );
            
            if (cursor != null && cursor.moveToFirst()) {
                int idColumn = cursor.getColumnIndex(MediaStore.Images.Media._ID);
                long id = cursor.getLong(idColumn);
                cursor.close();
                
                Uri contentUri = ContentUris.withAppendedId(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    id
                );
                
                promise.resolve(contentUri.toString());
            } else {
                if (cursor != null) cursor.close();
                promise.resolve(null);
            }
            
        } catch (Exception e) {
            Log.e(TAG, "根据路径查询URI失败: " + e.getMessage(), e);
            promise.reject("GET_URI_ERROR", e.getMessage());
        }
    }

    /**
     * 获取外部存储根目录路径
     * @param promise Promise对象
     */
    @ReactMethod
    public void getExternalStoragePath(Promise promise) {
        try {
            File externalStorageDir = android.os.Environment.getExternalStorageDirectory();
            String path = externalStorageDir.getAbsolutePath();
            Log.d(TAG, "外部存储根目录: " + path);
            promise.resolve(path);
        } catch (Exception e) {
            Log.e(TAG, "获取外部存储路径失败: " + e.getMessage(), e);
            promise.reject("GET_STORAGE_PATH_ERROR", e.getMessage());
        }
    }

    /**
     * 批量计算文件哈希（多线程并行计算）
     * @param filePaths 文件路径数组
     * @param promise Promise对象
     */
    @ReactMethod
    public void batchCalculateFileHash(ReadableArray filePaths, Promise promise) {
        try {
            int fileCount = filePaths.size();
            Log.d(TAG, "开始批量哈希计算: " + fileCount + " 个文件");
            
            if (fileCount == 0) {
                WritableArray results = Arguments.createArray();
                WritableMap result = Arguments.createMap();
                result.putArray("results", results);
                result.putInt("successCount", 0);
                result.putInt("failCount", 0);
                result.putInt("total", 0);
                promise.resolve(result);
                return;
            }
            
            // 转换为List<String>
            List<String> uriList = new ArrayList<>();
            for (int i = 0; i < fileCount; i++) {
                uriList.add(filePaths.getString(i));
            }
            
            // 调用内部批量计算方法
            List<HashResult> hashResults = batchCalculateHashesInternal(uriList);
            
            // 转换为React Native格式
            WritableArray results = Arguments.createArray();
            int successCount = 0;
            int failCount = 0;
            
            for (HashResult result : hashResults) {
                WritableMap resultMap = Arguments.createMap();
                resultMap.putInt("index", result.index);
                resultMap.putString("filePath", result.filePath);
                resultMap.putBoolean("success", result.success);
                
                if (result.success) {
                    resultMap.putString("hash", result.hash);
                    successCount++;
                } else {
                    resultMap.putString("error", result.error);
                    failCount++;
                }
                
                results.pushMap(resultMap);
            }
            
            // 构建返回结果
            WritableMap finalResult = Arguments.createMap();
            finalResult.putArray("results", results);
            finalResult.putInt("successCount", successCount);
            finalResult.putInt("failCount", failCount);
            finalResult.putInt("total", fileCount);
            
            Log.d(TAG, "批量哈希计算完成: 成功=" + successCount + ", 失败=" + failCount);
            
            promise.resolve(finalResult);
            
        } catch (Exception e) {
            Log.e(TAG, "批量哈希计算失败: " + e.getMessage(), e);
            promise.reject("BATCH_HASH_ERROR", e.getMessage());
        }
    }
    
    /**
     * 批量计算哈希值（内部方法，供Java内部调用）
     * 复用batchCalculateFileHash的核心逻辑，但使用Java标准类型
     * @param uriList 图片URI列表（支持contentUri||filePath格式、content:// URI或文件路径）
     * @return 哈希计算结果列表
     */
    public List<HashResult> batchCalculateHashesInternal(List<String> uriList) {
        if (uriList == null || uriList.isEmpty()) {
            return new ArrayList<>();
        }
        
        long startTime = System.currentTimeMillis();
        Log.d(TAG, "开始批量并行计算 " + uriList.size() + " 个文件的哈希值");
        
        // 创建线程池（使用CPU核心数）
        int threadCount = Runtime.getRuntime().availableProcessors();
        ExecutorService executor = Executors.newFixedThreadPool(threadCount);
        
        Log.d(TAG, "使用 " + threadCount + " 个线程并行计算");
        
        // 创建任务列表
        List<Future<HashResult>> futures = new ArrayList<>();
        
        for (int i = 0; i < uriList.size(); i++) {
            final String uri = uriList.get(i);
            final int index = i;
            
            // 提交任务到线程池
            Future<HashResult> future = executor.submit(new Callable<HashResult>() {
                @Override
                public HashResult call() {
                    return calculateSingleFileHash(uri, index);
                }
            });
            
            futures.add(future);
        }
        
        // 收集结果
        List<HashResult> results = new ArrayList<>();
        for (Future<HashResult> future : futures) {
            try {
                HashResult result = future.get(); // 阻塞等待结果
                results.add(result);
            } catch (Exception e) {
                Log.e(TAG, "获取哈希计算结果失败: " + e.getMessage());
                // 创建失败结果
                HashResult errorResult = new HashResult();
                errorResult.index = results.size();
                errorResult.success = false;
                errorResult.error = e.getMessage();
                results.add(errorResult);
            }
        }
        
        // 关闭线程池
        executor.shutdown();
        
        long duration = System.currentTimeMillis() - startTime;
        int successCount = 0;
        for (HashResult result : results) {
            if (result.success) {
                successCount++;
            }
        }
        
        Log.d(TAG, "批量哈希计算完成: 成功=" + successCount + ", 失败=" + (results.size() - successCount) + ", 耗时=" + duration + "ms");
        
        return results;
    }

    /**
     * 计算单个文件的SHA-256哈希（仅支持Content URI）
     * @param contentUri Content URI
     * @param index 索引
     * @return 哈希结果
     */
    private HashResult calculateSingleFileHash(String contentUri, int index) {
        HashResult result = new HashResult();
        result.index = index;
        result.filePath = contentUri;
        
        String hash = calculateImageHash(contentUri);
        if (hash != null) {
            result.success = true;
            result.hash = hash;
        } else {
            result.success = false;
            result.error = "计算哈希失败";
        }
        
        return result;
    }
    
    /**
     * 计算图片的SHA-256哈希值（公共方法，支持Content URI和文件路径）
     * @param uriString 图片URI（contentUri||filePath格式、content:// URI或文件路径）
     * @return 哈希值（十六进制字符串），失败返回null
     */
    public String calculateImageHash(String uriString) {
        InputStream inputStream = null;
        try {
            // 优先使用contentUri，如果没有则使用filePath
            String contentUriString = extractContentUri(uriString);
            if (contentUriString == null) {
                // 尝试使用filePath
                String filePath = extractFilePath(uriString);
                if (filePath != null) {
                    inputStream = new FileInputStream(new File(filePath));
                } else if (uriString != null && !uriString.contains("||")) {
                    // 如果URI不包含分隔符，可能是纯文件路径或纯Content URI
                    if (uriString.startsWith("content://")) {
                        contentUriString = uriString;
                    } else {
                        // 尝试作为文件路径处理
                        inputStream = new FileInputStream(new File(uriString));
                    }
                } else {
                    Log.w(TAG, "无法提取URI: " + uriString);
                    return null;
                }
            }
            
            // 如果是Content URI，使用ContentResolver打开
            if (contentUriString != null) {
                Uri uri = Uri.parse(contentUriString);
                ContentResolver contentResolver = reactContext.getContentResolver();
                inputStream = contentResolver.openInputStream(uri);
            }
            
            if (inputStream == null) {
                Log.w(TAG, "无法打开图片流: " + uriString);
                return null;
            }
            
            // 创建SHA-256消息摘要
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            
            // 读取数据并计算哈希
            byte[] buffer = new byte[8192]; // 8KB缓冲区
            int bytesRead;
            
            while ((bytesRead = inputStream.read(buffer)) != -1) {
                digest.update(buffer, 0, bytesRead);
            }
            
            // 获取哈希值
            byte[] hashBytes = digest.digest();
            
            // 转换为十六进制字符串
            StringBuilder hexString = new StringBuilder();
            for (byte b : hashBytes) {
                String hex = Integer.toHexString(0xff & b);
                if (hex.length() == 1) {
                    hexString.append('0');
                }
                hexString.append(hex);
            }
            
            return hexString.toString();
            
        } catch (Exception e) {
            Log.e(TAG, "计算图片哈希失败: " + uriString, e);
            return null;
        } finally {
            if (inputStream != null) {
                try {
                    inputStream.close();
                } catch (IOException e) {
                    // 忽略关闭错误
                }
            }
        }
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
     * 保存图片到相册
     * @param imageUrl 图片URL或base64数据
     * @param fileName 文件名（可选，默认自动生成）
     * @param promise Promise对象
     */
    @ReactMethod
    public void saveImageToGallery(String imageUrl, String fileName, Promise promise) {
        try {
            Log.d(TAG, "开始保存图片到相册: " + imageUrl);
            
            // 检查权限
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                // Android 13+ 只需要 READ_MEDIA_IMAGES 权限
                // 使用 MediaStore API 保存图片时，系统会自动处理写入权限，不需要 WRITE_MEDIA_IMAGES
                if (reactContext.checkSelfPermission("android.permission.READ_MEDIA_IMAGES") 
                    != PackageManager.PERMISSION_GRANTED) {
                    Log.w(TAG, "缺少 READ_MEDIA_IMAGES 权限");
                    promise.reject("PERMISSION_DENIED", "需要相册读取权限（READ_MEDIA_IMAGES），请在系统设置中授予后重试");
                    return;
                }
            } else {
                // Android 12 及以下需要 WRITE_EXTERNAL_STORAGE 权限
                if (reactContext.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) 
                    != PackageManager.PERMISSION_GRANTED) {
                    Log.w(TAG, "缺少 WRITE_EXTERNAL_STORAGE 权限");
                    promise.reject("PERMISSION_DENIED", "需要 WRITE_EXTERNAL_STORAGE 权限");
                    return;
                }
            }
            
            ContentResolver contentResolver = reactContext.getContentResolver();
            ContentValues contentValues = new ContentValues();
            
            // 生成文件名
            if (fileName == null || fileName.isEmpty()) {
                SimpleDateFormat sdf = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US);
                fileName = "IMG_" + sdf.format(new Date()) + ".png";
            }
            
            // 设置ContentValues
            contentValues.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
            contentValues.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
            
            // Android 10+ 使用相对路径
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                contentValues.put(MediaStore.Images.Media.RELATIVE_PATH, 
                    android.os.Environment.DIRECTORY_PICTURES + "/芯图相册");
                contentValues.put(MediaStore.Images.Media.IS_PENDING, 1);
            } else {
                // Android 9及以下使用DATA字段
                File picturesDir = android.os.Environment.getExternalStoragePublicDirectory(
                    android.os.Environment.DIRECTORY_PICTURES);
                File appDir = new File(picturesDir, "芯图相册");
                if (!appDir.exists()) {
                    appDir.mkdirs();
                }
                File imageFile = new File(appDir, fileName);
                contentValues.put(MediaStore.Images.Media.DATA, imageFile.getAbsolutePath());
            }
            
            // 插入MediaStore
            Uri imageUri = contentResolver.insert(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                contentValues
            );
            
            if (imageUri == null) {
                promise.reject("SAVE_FAILED", "无法创建MediaStore记录");
                return;
            }
            
            // 下载并写入图片
            InputStream inputStream = null;
            OutputStream outputStream = null;
            
            try {
                // 判断是URL还是base64
                if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
                    // URL：使用java.net.URL下载
                    java.net.URL url = new java.net.URL(imageUrl);
                    inputStream = url.openStream();
                } else if (imageUrl.startsWith("data:image")) {
                    // Base64数据URL：解析base64部分
                    String base64Data = imageUrl.substring(imageUrl.indexOf(",") + 1);
                    byte[] imageBytes = android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT);
                    inputStream = new java.io.ByteArrayInputStream(imageBytes);
                } else {
                    // 假设是base64字符串（没有data:前缀）
                    byte[] imageBytes = android.util.Base64.decode(imageUrl, android.util.Base64.DEFAULT);
                    inputStream = new java.io.ByteArrayInputStream(imageBytes);
                }
                
                // 写入到MediaStore
                outputStream = contentResolver.openOutputStream(imageUri);
                if (outputStream == null) {
                    promise.reject("SAVE_FAILED", "无法打开输出流");
                    return;
                }
                
                byte[] buffer = new byte[8192];
                int bytesRead;
                while ((bytesRead = inputStream.read(buffer)) != -1) {
                    outputStream.write(buffer, 0, bytesRead);
                }
                outputStream.flush();
                
                // Android 10+ 需要设置IS_PENDING为0
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues updateValues = new ContentValues();
                    updateValues.put(MediaStore.Images.Media.IS_PENDING, 0);
                    contentResolver.update(imageUri, updateValues, null, null);
                }
                
                // 获取保存的文件路径
                String filePath = null;
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                    // Android 9及以下，从ContentValues获取
                    filePath = contentValues.getAsString(MediaStore.Images.Media.DATA);
                } else {
                    // Android 10+，查询MediaStore获取路径
                    Cursor cursor = contentResolver.query(
                        imageUri,
                        new String[]{MediaStore.Images.Media.DATA},
                        null, null, null
                    );
                    if (cursor != null && cursor.moveToFirst()) {
                        int dataColumn = cursor.getColumnIndex(MediaStore.Images.Media.DATA);
                        if (dataColumn >= 0) {
                            filePath = cursor.getString(dataColumn);
                        }
                        cursor.close();
                    }
                }
                
                WritableMap result = Arguments.createMap();
                result.putString("uri", imageUri.toString());
                if (filePath != null) {
                    result.putString("path", filePath);
                }
                result.putString("fileName", fileName);
                
                Log.d(TAG, "图片保存成功: " + imageUri.toString());
                promise.resolve(result);
                
            } catch (Exception e) {
                Log.e(TAG, "保存图片失败: " + e.getMessage(), e);
                // 删除已创建的MediaStore记录
                contentResolver.delete(imageUri, null, null);
                promise.reject("SAVE_FAILED", "保存图片失败: " + e.getMessage());
            } finally {
                if (inputStream != null) {
                    try {
                        inputStream.close();
                    } catch (IOException e) {
                        // 忽略关闭错误
                    }
                }
                if (outputStream != null) {
                    try {
                        outputStream.close();
                    } catch (IOException e) {
                        // 忽略关闭错误
                    }
                }
            }
            
        } catch (Exception e) {
            Log.e(TAG, "保存图片到相册失败: " + e.getMessage(), e);
            promise.reject("SAVE_ERROR", e.getMessage());
        }
    }

    /**
     * 哈希计算结果类（公共类，供外部调用）
     */
    public static class HashResult {
        public int index;
        public String filePath;
        public boolean success;
        public String hash;
        public String error;
    }
}
