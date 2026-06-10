package com.imageclassifier.v2.database;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;

/**
 * 图片数据服务
 * 提供与JS层ImageStorageService对应的数据库操作方法
 * 对应JS层的ImageStorageService SQLite部分
 */
public class ImageDataService {
    private static final String TAG = "ImageDataService";
    private ImageDatabaseHelper dbHelper;
    private SimpleDateFormat dateFormat;
    
    public ImageDataService(Context context) {
        this.dbHelper = ImageDatabaseHelper.getInstance(context);
        // ISO 8601日期格式
        this.dateFormat = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        this.dateFormat.setTimeZone(TimeZone.getTimeZone("UTC"));
    }
    
    // ==================== 写入操作 ====================
    
    /**
     * 批量写入/更新图片详细信息
     * 对应JS层的 writeImageDetailedInfo
     * 
     * @param imageDataList 图片数据列表
     * @return 写入结果 { success: boolean, insertedCount: int, updatedCount: int }
     */
    public Map<String, Object> writeImageDetailedInfo(List<Map<String, Object>> imageDataList) {
        if (imageDataList == null || imageDataList.isEmpty()) {
            Map<String, Object> result = new HashMap<>();
            result.put("success", true);
            result.put("insertedCount", 0);
            result.put("updatedCount", 0);
            return result;
        }
        
        // 添加重试机制，处理数据库锁定问题
        int maxRetries = 5; // 增加重试次数
        int baseRetryDelay = 500; // 基础延迟500ms（增加延迟，给其他连接更多时间释放）
        
        SQLiteDatabase db = null;
        for (int attempt = 0; attempt < maxRetries; attempt++) {
            // 每次重试都获取新的数据库连接，确保连接状态正确
            db = dbHelper.getDatabase();
            int insertedCount = 0;
            int updatedCount = 0;
            
            try {
                db.beginTransaction();
                
                for (Map<String, Object> imageData : imageDataList) {
                    try {
                        ContentValues values = new ContentValues();
                        
                        // 生成ID
                        String id = (String) imageData.get("id");
                        if (id == null || id.isEmpty()) {
                            String uri = (String) imageData.get("uri");
                            if (uri == null || uri.isEmpty()) {
                                Log.w(TAG, "跳过无效数据：缺少uri");
                                continue;
                            }
                            id = generateStableId(uri);
                        }
                        values.put("id", id);
                        
                        // 必需字段
                        String uri = (String) imageData.get("uri");
                        if (uri == null || uri.isEmpty()) {
                            Log.w(TAG, "跳过无效数据：uri为空, id=" + id);
                            continue;
                        }
                        values.put("uri", uri);
                        values.put("fileName", getStringValue(imageData, "fileName", ""));
                        
                        // 🔧 基础字段：确保 category 不为 null
                        String category = getStringValue(imageData, "category", null);
                        if (category == null || category.isEmpty()) {
                            category = "NA";
                            Log.w(TAG, "⚠️ writeImageDetailedInfo: category 为空，使用默认值 NA, id=" + id);
                        }
                        values.put("category", category);
                        putDoubleIfNotNull(values, "confidence", imageData.get("confidence"));
                        putLongIfNotNull(values, "timestamp", imageData.get("timestamp"));
                        putLongIfNotNull(values, "takenAt", imageData.get("takenAt"));
                        putLongIfNotNull(values, "size", imageData.get("size"));
                        putStringIfNotNull(values, "mimeType", imageData.get("mimeType"));
                        putDoubleIfNotNull(values, "duration", imageData.get("duration"));   // 视频时长（秒）
                        
                        // 🔧 确保 width 和 height 始终被设置（即使为0或null，也要设置默认值0）
                        Object widthObj = imageData.get("width");
                        Object heightObj = imageData.get("height");
                        int width = 0;
                        int height = 0;
                        if (widthObj instanceof Number) {
                            width = ((Number) widthObj).intValue();
                        }
                        if (heightObj instanceof Number) {
                            height = ((Number) heightObj).intValue();
                        }
                        values.put("width", width);
                        values.put("height", height);
                        
                        // GPS信息
                        putDoubleIfNotNull(values, "latitude", imageData.get("latitude"));
                        putDoubleIfNotNull(values, "longitude", imageData.get("longitude"));
                        putDoubleIfNotNull(values, "altitude", imageData.get("altitude"));
                        putDoubleIfNotNull(values, "accuracy", imageData.get("accuracy"));
                        
                        // 地址信息
                        putStringIfNotNull(values, "address", imageData.get("address"));
                        putStringIfNotNull(values, "city", imageData.get("city"));
                        putStringIfNotNull(values, "country", imageData.get("country"));
                        putStringIfNotNull(values, "province", imageData.get("province"));
                        putStringIfNotNull(values, "district", imageData.get("district"));
                        putStringIfNotNull(values, "street", imageData.get("street"));
                        putStringIfNotNull(values, "locationSource", imageData.get("locationSource"));
                        putDoubleIfNotNull(values, "cityDistance", imageData.get("cityDistance"));
                        
                        // JSON字段（序列化）
                        if (imageData.get("idCardDetections") != null) {
                            values.put("idCardDetections", jsonToString(imageData.get("idCardDetections")));
                        }
                        if (imageData.get("generalDetections") != null) {
                            values.put("generalDetections", jsonToString(imageData.get("generalDetections")));
                        }
                        if (imageData.get("mobileNetV3Detections") != null) {
                            values.put("mobileNetV3Detections", jsonToString(imageData.get("mobileNetV3Detections")));
                        }
                        if (imageData.get("imageDimensions") != null) {
                            values.put("imageDimensions", jsonToString(imageData.get("imageDimensions")));
                        }
                        putStringIfNotNull(values, "message", imageData.get("message"));
                        
                        // 🔥 拍摄参数处理（cameraSettings 和分类字段）
                        Object cameraSettingsObj = imageData.get("cameraSettings");
                        if (cameraSettingsObj != null) {
                            // 保存 cameraSettings（可能是字符串或对象）
                            String cameraSettingsStr;
                            if (cameraSettingsObj instanceof String) {
                                cameraSettingsStr = (String) cameraSettingsObj;
                            } else {
                                cameraSettingsStr = jsonToString(cameraSettingsObj);
                            }
                            values.put("cameraSettings", cameraSettingsStr);
                            
                            // 计算分类字段
                            Map<String, String> categories = calculateCameraSettingsCategories(cameraSettingsStr);
                            putStringIfNotNull(values, "isoCategory", categories.get("isoCategory"));
                            putStringIfNotNull(values, "apertureCategory", categories.get("apertureCategory"));
                            putStringIfNotNull(values, "shutterCategory", categories.get("shutterCategory"));
                            putStringIfNotNull(values, "focalLengthCategory", categories.get("focalLengthCategory"));
                        } else {
                            // 如果没有 cameraSettings，检查是否直接提供了分类字段
                            putStringIfNotNull(values, "isoCategory", imageData.get("isoCategory"));
                            putStringIfNotNull(values, "apertureCategory", imageData.get("apertureCategory"));
                            putStringIfNotNull(values, "shutterCategory", imageData.get("shutterCategory"));
                            putStringIfNotNull(values, "focalLengthCategory", imageData.get("focalLengthCategory"));
                        }
                        
                        // ❌ 严格数据验证：检查是否只传递了部分字段（部分更新）
                        // 如果只传递了部分字段，需要先读取现有数据，然后合并更新
                        boolean isPartialUpdate = false;
                        Cursor existingCursor = db.query("images", new String[]{
                            "width", "height", "imageDimensions", "fileName", "category", 
                            "size", "mimeType", "timestamp", "takenAt", "createdAt"
                        }, "id = ?", new String[]{id}, null, null, null);
                        
                        if (existingCursor.moveToFirst()) {
                            // 记录已存在
                            isPartialUpdate = true;
                            
                            // ❌ 严格验证：如果只传递了部分字段，必须从现有数据中读取缺失的关键字段
                            // 关键字段：width, height, imageDimensions, fileName, category
                            if (!imageData.containsKey("width") || imageData.get("width") == null) {
                                int existingWidth = existingCursor.getInt(existingCursor.getColumnIndex("width"));
                                if (existingWidth > 0) {
                                    values.put("width", existingWidth);
                                } else {
                                    throw new IllegalStateException("部分更新时，现有数据的 width 也为0，无法合并更新: id=" + id + ", uri=" + uri);
                                }
                            }
                            if (!imageData.containsKey("height") || imageData.get("height") == null) {
                                int existingHeight = existingCursor.getInt(existingCursor.getColumnIndex("height"));
                                if (existingHeight > 0) {
                                    values.put("height", existingHeight);
                                } else {
                                    throw new IllegalStateException("部分更新时，现有数据的 height 也为0，无法合并更新: id=" + id + ", uri=" + uri);
                                }
                            }
                            if (!imageData.containsKey("imageDimensions") || imageData.get("imageDimensions") == null) {
                                String existingImageDimensions = existingCursor.getString(existingCursor.getColumnIndex("imageDimensions"));
                                if (existingImageDimensions != null && !existingImageDimensions.isEmpty()) {
                                    values.put("imageDimensions", existingImageDimensions);
                                } else {
                                    throw new IllegalStateException("部分更新时，现有数据的 imageDimensions 也为空，无法合并更新: id=" + id + ", uri=" + uri);
                                }
                            }
                            if (!imageData.containsKey("fileName") || imageData.get("fileName") == null || imageData.get("fileName").toString().isEmpty()) {
                                String existingFileName = existingCursor.getString(existingCursor.getColumnIndex("fileName"));
                                if (existingFileName != null && !existingFileName.isEmpty()) {
                                    values.put("fileName", existingFileName);
                                } else {
                                    throw new IllegalStateException("部分更新时，现有数据的 fileName 也为空，无法合并更新: id=" + id + ", uri=" + uri);
                                }
                            }
                            if (!imageData.containsKey("category") || imageData.get("category") == null || imageData.get("category").toString().isEmpty()) {
                                String existingCategory = existingCursor.getString(existingCursor.getColumnIndex("category"));
                                if (existingCategory != null && !existingCategory.isEmpty()) {
                                    values.put("category", existingCategory);
                                } else {
                                    throw new IllegalStateException("部分更新时，现有数据的 category 也为空，无法合并更新: id=" + id + ", uri=" + uri);
                                }
                            }
                            
                            // 可选字段：如果不存在，从现有数据读取
                            if (!imageData.containsKey("size") || imageData.get("size") == null) {
                                long existingSize = existingCursor.getLong(existingCursor.getColumnIndex("size"));
                                if (existingSize > 0) {
                                    values.put("size", existingSize);
                                }
                            }
                            if (!imageData.containsKey("mimeType") || imageData.get("mimeType") == null) {
                                String existingMimeType = existingCursor.getString(existingCursor.getColumnIndex("mimeType"));
                                if (existingMimeType != null && !existingMimeType.isEmpty()) {
                                    values.put("mimeType", existingMimeType);
                                }
                            }
                            if (!imageData.containsKey("timestamp") || imageData.get("timestamp") == null) {
                                long existingTimestamp = existingCursor.getLong(existingCursor.getColumnIndex("timestamp"));
                                if (existingTimestamp > 0) {
                                    values.put("timestamp", existingTimestamp);
                                }
                            }
                            if (!imageData.containsKey("takenAt") || imageData.get("takenAt") == null) {
                                long existingTakenAt = existingCursor.getLong(existingCursor.getColumnIndex("takenAt"));
                                if (existingTakenAt > 0) {
                                    values.put("takenAt", existingTakenAt);
                                }
                            }
                            
                            // 保留 createdAt
                            String existingCreatedAt = existingCursor.getString(existingCursor.getColumnIndex("createdAt"));
                            if (existingCreatedAt != null && !existingCreatedAt.isEmpty()) {
                                values.put("createdAt", existingCreatedAt);
                            } else {
                                values.put("createdAt", dateFormat.format(new Date()));
                            }
                        } else {
                            // 新记录：必须包含所有必填字段
                            if (!imageData.containsKey("width") || !imageData.containsKey("height") || 
                                imageData.get("width") == null || imageData.get("height") == null) {
                                throw new IllegalArgumentException("新记录必须包含 width 和 height: id=" + id + ", uri=" + uri);
                            }
                            if (!imageData.containsKey("imageDimensions") || imageData.get("imageDimensions") == null) {
                                throw new IllegalArgumentException("新记录必须包含 imageDimensions: id=" + id + ", uri=" + uri);
                            }
                            
                            values.put("createdAt", dateFormat.format(new Date()));
                        }
                        existingCursor.close();
                        
                        values.put("updatedAt", dateFormat.format(new Date()));
                        
                        // INSERT OR REPLACE
                        long result = db.insertWithOnConflict("images", null, values, 
                            SQLiteDatabase.CONFLICT_REPLACE);
                        
                        if (result == -1) {
                            Log.w(TAG, "插入失败: " + id);
                        } else {
                            if (isPartialUpdate) {
                                updatedCount++;
                            } else {
                                insertedCount++;
                            }
                        }
                        
                    } catch (Exception e) {
                        Log.e(TAG, "处理单条数据失败: " + imageData.get("uri"), e);
                    }
                }
                
                db.setTransactionSuccessful();
                db.endTransaction();
                
                // 成功，返回结果
                Map<String, Object> result = new HashMap<>();
                result.put("success", true);
                result.put("insertedCount", insertedCount);
                result.put("updatedCount", updatedCount);
                return result;
                
            } catch (android.database.sqlite.SQLiteDatabaseLockedException e) {
                // 数据库锁定，需要重试
                try {
                    if (db != null && db.inTransaction()) {
                        db.endTransaction();
                    }
                } catch (Exception ex) {
                    Log.e(TAG, "结束事务失败", ex);
                }
                
                // 释放数据库连接，让其他操作有机会获取
                db = null;
                
                if (attempt < maxRetries - 1) {
                    try {
                        // 指数递增延迟：500ms, 1000ms, 2000ms, 4000ms, 8000ms
                        int delay = baseRetryDelay * (1 << attempt); // 2的幂次方
                        Log.w(TAG, "批量写入失败（数据库锁定），等待 " + delay + "ms 后重试 " + (attempt + 2) + "/" + maxRetries);
                        Thread.sleep(delay);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        Log.e(TAG, "批量写入重试被中断", ie);
                        Map<String, Object> result = new HashMap<>();
                        result.put("success", false);
                        result.put("insertedCount", 0);
                        result.put("updatedCount", 0);
                        result.put("error", "重试被中断");
                        return result;
                    }
                } else {
                    Log.e(TAG, "批量写入失败（数据库锁定，已重试" + maxRetries + "次）", e);
                    Map<String, Object> result = new HashMap<>();
                    result.put("success", false);
                    result.put("insertedCount", 0);
                    result.put("updatedCount", 0);
                    result.put("error", "数据库锁定，重试失败: " + e.getMessage());
                    return result;
                }
            } catch (Exception e) {
                // 其他异常，不重试
                try {
                    if (db.inTransaction()) {
                        db.endTransaction();
                    }
                } catch (Exception ex) {
                    Log.e(TAG, "结束事务失败", ex);
                }
                Log.e(TAG, "批量写入失败", e);
                Map<String, Object> result = new HashMap<>();
                result.put("success", false);
                result.put("insertedCount", 0);
                result.put("updatedCount", 0);
                result.put("error", e.getMessage());
                return result;
            }
        }
        
        // 理论上不会到达这里
        Map<String, Object> result = new HashMap<>();
        result.put("success", false);
        result.put("insertedCount", 0);
        result.put("updatedCount", 0);
        result.put("error", "未知错误");
        return result;
    }
    
    /**
     * 批量更新分类信息（只更新分类相关字段）
     * 对应JS层的 batchUpdateClassification
     * 
     * @param classificationDataList 分类数据列表
     * @return 更新结果 { success: boolean, updatedCount: int, failedCount: int }
     */
    // 🔥 数据库访问同步锁：确保批量更新操作的串行化，避免并发冲突
    private static final Object batchUpdateLock = new Object();
    
    public Map<String, Object> batchUpdateClassification(
            List<Map<String, Object>> classificationDataList) {
        if (classificationDataList == null || classificationDataList.isEmpty()) {
            Map<String, Object> result = new HashMap<>();
            result.put("success", true);
            result.put("updatedCount", 0);
            result.put("failedCount", 0);
            return result;
        }
        
        // 🔥 使用同步锁确保数据库访问的串行化
        synchronized (batchUpdateLock) {
            SQLiteDatabase db = dbHelper.getDatabase();
            int updatedCount = 0;
            int failedCount = 0;
            
            // 重试机制：最多重试5次，处理数据库锁定
            int maxRetries = 5;
            int baseRetryDelayMs = 200; // 基础延迟200ms，递增延迟
            
            for (int retry = 0; retry < maxRetries; retry++) {
                boolean transactionStarted = false;
                
                try {
                    // 尝试开始事务
                    db.beginTransaction();
                    transactionStarted = true;
                    
                    for (Map<String, Object> classificationData : classificationDataList) {
                    try {
                        String uri = (String) classificationData.get("uri");
                        if (uri == null || uri.isEmpty()) {
                            failedCount++;
                            continue;
                        }
                        
                        String id = (String) classificationData.get("id");
                        // 如果ID为空，或者是MediaStore ID（纯数字），则使用URI生成正确的ID
                        if (id == null || id.isEmpty() || id.matches("^\\d+$")) {
                            // MediaStore ID是纯数字，但数据库使用基于URI的哈希ID
                            // 所以忽略MediaStore ID，使用URI生成正确的ID
                            id = generateStableId(uri);
                        }
                        
                        ContentValues values = new ContentValues();
                        
                        // 分类字段（必需）
                        String category = (String) classificationData.get("category");
                        if (category == null || category.isEmpty()) {
                            failedCount++;
                            continue;
                        }
                        values.put("category", category);
                        
                        // 可选字段
                        if (classificationData.get("confidence") != null) {
                            values.put("confidence", getDoubleValue(classificationData.get("confidence")));
                        }
                        if (classificationData.get("idCardDetections") != null) {
                            values.put("idCardDetections", jsonToString(classificationData.get("idCardDetections")));
                        }
                        if (classificationData.get("generalDetections") != null) {
                            values.put("generalDetections", jsonToString(classificationData.get("generalDetections")));
                        }
                        if (classificationData.get("mobileNetV3Detections") != null) {
                            values.put("mobileNetV3Detections", jsonToString(classificationData.get("mobileNetV3Detections")));
                        }
                        if (classificationData.get("message") != null) {
                            values.put("message", classificationData.get("message").toString());
                        }
                        // 保存背景颜色字段（跳过 null 和 "null" 字符串）
                        Object backgroundColorObj = classificationData.get("background_color");
                        if (backgroundColorObj != null) {
                            String backgroundColor = backgroundColorObj.toString();
                            // 只有当背景颜色不为空且不是 "null" 字符串时才保存
                            if (backgroundColor != null && !backgroundColor.isEmpty() && !backgroundColor.equals("null")) {
                                values.put("background_color", backgroundColor);
                            }
                            // 如果为 null 或 "null"，不更新数据库，保持原有值
                        }
                        
                        values.put("updatedAt", dateFormat.format(new Date()));
                        
                        int rowsAffected = db.update("images", values, "id = ?", new String[]{id});
                        
                        if (rowsAffected > 0) {
                            updatedCount++;
                        } else {
                            failedCount++;
                            Log.e(TAG, "更新失败，未找到图片: id=" + id + ", uri=" + uri);
                            // 不降级，直接报错，避免在其他地方出错
                        }
                        
                    } catch (Exception e) {
                        Log.e(TAG, "更新单条分类数据失败", e);
                        failedCount++;
                        }
                    }
                    
                    // 标记事务成功
                    db.setTransactionSuccessful();
                    
                    // 成功执行，退出重试循环
                    break;
                    
                } catch (android.database.sqlite.SQLiteDatabaseLockedException e) {
                    // 数据库锁定异常，需要重试
                    Log.w(TAG, "数据库锁定，重试 " + (retry + 1) + "/" + maxRetries + ": " + e.getMessage());
                    
                    // 确保在重试前结束事务（如果已开始）
                    if (transactionStarted) {
                        try {
                            if (db.inTransaction()) {
                                db.endTransaction();
                            }
                        } catch (Exception ex) {
                            // 忽略结束事务时的异常
                            Log.w(TAG, "结束事务时出错（可忽略）: " + ex.getMessage());
                        }
                        transactionStarted = false;
                    }
                    
                    // 如果不是最后一次重试，等待后继续
                    if (retry < maxRetries - 1) {
                        try {
                            // 递增延迟：200ms, 400ms, 600ms, 800ms
                            int delay = baseRetryDelayMs * (retry + 1);
                            Log.d(TAG, "数据库锁定，等待 " + delay + "ms 后重试 " + (retry + 2) + "/" + maxRetries);
                            Thread.sleep(delay);
                        } catch (InterruptedException ie) {
                            Thread.currentThread().interrupt();
                            break;
                        }
                    } else {
                        // 最后一次重试失败
                        Log.e(TAG, "批量更新分类失败：数据库锁定，已重试 " + maxRetries + " 次", e);
                        Map<String, Object> result = new HashMap<>();
                        result.put("success", false);
                        result.put("updatedCount", 0);
                        result.put("failedCount", classificationDataList.size());
                        result.put("error", "数据库锁定，重试失败: " + e.getMessage());
                        return result;
                    }
                    
                } catch (Exception e) {
                    // 其他异常，不重试
                    Log.e(TAG, "批量更新分类失败", e);
                    
                    // 确保结束事务（如果已开始）
                    if (transactionStarted) {
                        try {
                            if (db.inTransaction()) {
                                db.endTransaction();
                            }
                        } catch (Exception ex) {
                            // 忽略结束事务时的异常
                            Log.w(TAG, "结束事务时出错（可忽略）: " + ex.getMessage());
                        }
                    }
                    
                    Map<String, Object> result = new HashMap<>();
                    result.put("success", false);
                    result.put("updatedCount", 0);
                    result.put("failedCount", classificationDataList.size());
                    result.put("error", e.getMessage());
                    return result;
                } finally {
                    // 确保结束事务（如果已开始且未在catch中处理）
                    if (transactionStarted) {
                        try {
                            if (db.inTransaction()) {
                                db.endTransaction();
                            }
                        } catch (Exception e) {
                            // 忽略结束事务时的异常（可能已经在catch中处理过）
                            Log.w(TAG, "结束事务时出错（可忽略）: " + e.getMessage());
                        }
                    }
                }
            }
            
            Map<String, Object> result = new HashMap<>();
            result.put("success", true);
            result.put("updatedCount", updatedCount);
            result.put("failedCount", failedCount);
            return result;
        }
    }
    
    /**
     * 根据URI删除图片
     * 对应JS层的 removeImagesByUris
     * 
     * @param uris URI列表
     * @return 删除结果 { success: boolean, deletedCount: int }
     */
    public Map<String, Object> removeImagesByUris(List<String> uris) {
        if (uris == null || uris.isEmpty()) {
            Map<String, Object> result = new HashMap<>();
            result.put("success", true);
            result.put("deletedCount", 0);
            return result;
        }
        
        SQLiteDatabase db = dbHelper.getDatabase();
        int deletedCount = 0;
        
        try {
            db.beginTransaction();
            
            for (String uri : uris) {
                if (uri == null || uri.isEmpty()) {
                    continue;
                }
                
                String id = generateStableId(uri);
                int rowsAffected = db.delete("images", "id = ?", new String[]{id});
                if (rowsAffected > 0) {
                    deletedCount++;
                }
            }
            
            db.setTransactionSuccessful();
            
        } catch (Exception e) {
            Log.e(TAG, "批量删除失败", e);
            Map<String, Object> result = new HashMap<>();
            result.put("success", false);
            result.put("deletedCount", 0);
            result.put("error", e.getMessage());
            return result;
        } finally {
            db.endTransaction();
        }
        
        Map<String, Object> result = new HashMap<>();
        result.put("success", true);
        result.put("deletedCount", deletedCount);
        return result;
    }
    
    // ==================== 读取操作 ====================
    
    /**
     * 获取所有图片
     * 对应JS层的 getImages
     * 
     * @return 图片列表
     */
    public List<Map<String, Object>> getImages() {
        SQLiteDatabase db = dbHelper.getDatabase();
        List<Map<String, Object>> images = new ArrayList<>();
        
        Cursor cursor = db.query("images", null, null, null, null, null, 
            "timestamp DESC");
        
        try {
            while (cursor.moveToNext()) {
                Map<String, Object> image = cursorToImageMap(cursor);
                images.add(image);
            }
        } finally {
            cursor.close();
        }
        
        return images;
    }
    
    /**
     * 根据ID列表获取图片
     * 对应JS层的 getImagesByIds
     * 
     * @param imageIds ID列表
     * @return Map<id, imageData>
     */
    public Map<String, Map<String, Object>> getImagesByIds(List<String> imageIds) {
        SQLiteDatabase db = dbHelper.getDatabase();
        Map<String, Map<String, Object>> resultMap = new HashMap<>();
        
        if (imageIds == null || imageIds.isEmpty()) {
            return resultMap;
        }
        
        // 构建IN查询
        StringBuilder placeholders = new StringBuilder();
        for (int i = 0; i < imageIds.size(); i++) {
            if (i > 0) placeholders.append(",");
            placeholders.append("?");
        }
        
        String sql = "SELECT * FROM images WHERE id IN (" + placeholders.toString() + ")";
        Cursor cursor = db.rawQuery(sql, imageIds.toArray(new String[0]));
        
        try {
            while (cursor.moveToNext()) {
                Map<String, Object> image = cursorToImageMap(cursor);
                resultMap.put((String) image.get("id"), image);
            }
        } finally {
            cursor.close();
        }
        
        return resultMap;
    }
    
    /**
     * 根据分类获取图片（优化版：只查询精简字段，避免Cursor窗口溢出）
     * 对应JS层的 getImagesByCategory
     * 
     * 🔥 优化说明：
     * - 只查询AI分类需要的字段，不查询大字段（JSON字段）
     * - 避免当NA分类图片数量多时，Cursor窗口超出2MB限制
     * - 参考PC端的精简信息机制，只包含必要字段
     * 
     * @param category 分类ID
     * @return 图片列表（精简结构，只包含必要字段）
     */
    public List<Map<String, Object>> getImagesByCategory(String category) {
        SQLiteDatabase db = dbHelper.getDatabase();
        List<Map<String, Object>> images = new ArrayList<>();
        
        if (category == null || category.isEmpty()) {
            return images;
        }
        
        // 🔥 只查询AI分类需要的字段，避免查询大字段（JSON字段）导致Cursor窗口溢出
        // 注意：数据库表中没有 path 列，路径信息存储在 uri 字段中（content:// URI）
        String[] columns = {
            "id", "uri", "fileName", "width", "height", 
            "size", "mimeType", "timestamp", "takenAt"
        };
        
        Cursor cursor = db.query("images", columns, "category = ?", 
            new String[]{category}, null, null, "timestamp DESC");
        
        try {
            while (cursor.moveToNext()) {
                Map<String, Object> image = new HashMap<>();
                
                // 基础字段
                putStringIfNotNull(image, "id", cursor, "id");
                putStringIfNotNull(image, "uri", cursor, "uri");
                putStringIfNotNull(image, "fileName", cursor, "fileName");
                // 注意：数据库表中没有 path 列，路径信息存储在 uri 字段中
                
                // 尺寸字段
                int widthIndex = cursor.getColumnIndex("width");
                int heightIndex = cursor.getColumnIndex("height");
                int width = 0;
                int height = 0;
                if (widthIndex >= 0 && !cursor.isNull(widthIndex)) {
                    width = cursor.getInt(widthIndex);
                }
                if (heightIndex >= 0 && !cursor.isNull(heightIndex)) {
                    height = cursor.getInt(heightIndex);
                }
                image.put("width", width);
                image.put("height", height);
                
                // 其他字段
                putLongIfNotNull(image, "size", cursor, "size");
                putStringIfNotNull(image, "mimeType", cursor, "mimeType");
                putLongIfNotNull(image, "timestamp", cursor, "timestamp");
                putLongIfNotNull(image, "takenAt", cursor, "takenAt");
                
                images.add(image);
            }
        } finally {
            cursor.close();
        }
        
        return images;
    }
    
    /**
     * 获取所有图片URI
     * 对应JS层的 getImageUris
     * 
     * @return URI列表
     */
    public List<String> getImageUris() {
        int maxRetries = 5;
        int baseRetryDelayMs = 200;
        
        for (int retry = 0; retry < maxRetries; retry++) {
            SQLiteDatabase db = null;
            Cursor cursor = null;
            
            try {
                db = dbHelper.getDatabase();
                List<String> uris = new ArrayList<>();
                
                cursor = db.query("images", new String[]{"uri"}, null, null, null, null, null);
                
                while (cursor.moveToNext()) {
                    uris.add(cursor.getString(0));
                }
                
                cursor.close();
                return uris;
                
            } catch (android.database.sqlite.SQLiteDatabaseLockedException e) {
                // 数据库锁定异常，需要重试
                if (cursor != null) {
                    try {
                        cursor.close();
                    } catch (Exception ex) {
                        // 忽略关闭 cursor 时的异常
                    }
                }
                
                if (retry < maxRetries - 1) {
                    try {
                        // 递增延迟：200ms, 400ms, 600ms, 800ms
                        int delay = baseRetryDelayMs * (retry + 1);
                        Log.w(TAG, "获取图片URI失败（数据库锁定），等待 " + delay + "ms 后重试 " + (retry + 2) + "/" + maxRetries);
                        Thread.sleep(delay);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        Log.e(TAG, "获取图片URI重试被中断", ie);
                        break;
                    }
                } else {
                    Log.e(TAG, "获取图片URI失败（数据库锁定，已重试" + maxRetries + "次）", e);
                    throw e; // 重试失败，抛出异常
                }
            } catch (Exception e) {
                if (cursor != null) {
                    try {
                        cursor.close();
                    } catch (Exception ex) {
                        // 忽略关闭 cursor 时的异常
                    }
                }
                Log.e(TAG, "获取图片URI失败", e);
                throw e; // 其他异常直接抛出
            }
        }
        
        // 如果所有重试都失败，返回空列表
        return new ArrayList<>();
    }
    
    /**
     * 获取设置值
     * 对应JS层的 getSetting
     * 
     * @param key 设置键
     * @return 设置值（如果不存在返回null）
     */
    public String getSetting(String key) {
        if (key == null || key.isEmpty()) {
            return null;
        }
        
        SQLiteDatabase db = dbHelper.getDatabase();
        Cursor cursor = db.query("settings", new String[]{"value"}, "key = ?", 
            new String[]{key}, null, null, null);
        
        try {
            if (cursor.moveToFirst()) {
                return cursor.getString(0);
            }
        } finally {
            cursor.close();
        }
        
        return null;
    }
    
    /**
     * 更新设置值
     * 对应JS层的 updateSetting
     * 
     * @param key 设置键
     * @param value 设置值
     */
    public void updateSetting(String key, String value) {
        if (key == null || key.isEmpty()) {
            return;
        }
        
        SQLiteDatabase db = dbHelper.getDatabase();
        ContentValues values = new ContentValues();
        values.put("key", key);
        values.put("value", value != null ? value : "");
        
        // 添加重试机制，处理数据库锁定问题
        int maxRetries = 3;
        int retryDelay = 100; // 毫秒
        
        for (int attempt = 0; attempt < maxRetries; attempt++) {
            try {
                db.beginTransaction();
                
                int rowsAffected = db.update("settings", values, "key = ?", new String[]{key});
                
                if (rowsAffected == 0) {
                    // 如果不存在，则插入
                    db.insert("settings", null, values);
                }
                
                db.setTransactionSuccessful();
                db.endTransaction();
                return; // 成功，退出重试循环
                
            } catch (android.database.sqlite.SQLiteDatabaseLockedException e) {
                // 数据库锁定，需要重试
                try {
                    if (db.inTransaction()) {
                        db.endTransaction();
                    }
                } catch (Exception ex) {
                    // 忽略结束事务的异常
                }
                
                if (attempt < maxRetries - 1) {
                    try {
                        Thread.sleep(retryDelay * (attempt + 1)); // 递增延迟
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        Log.e(TAG, "更新设置重试被中断: " + key, ie);
                        return;
                    }
                    Log.w(TAG, "更新设置失败（数据库锁定），重试 " + (attempt + 1) + "/" + maxRetries + ": " + key);
                } else {
                    Log.e(TAG, "更新设置失败（数据库锁定，已重试" + maxRetries + "次）: " + key, e);
                }
            } catch (Exception e) {
                try {
                    if (db.inTransaction()) {
                        db.endTransaction();
                    }
                } catch (Exception ex) {
                    // 忽略结束事务的异常
                }
                Log.e(TAG, "更新设置失败: " + key, e);
                return; // 其他异常不重试
            }
        }
    }
    
    // ==================== 辅助方法 ====================
    
    /**
     * 将Cursor转换为Image Map
     */
    private Map<String, Object> cursorToImageMap(Cursor cursor) {
        Map<String, Object> image = new HashMap<>();
        
        // 基础字段
        int idIndex = cursor.getColumnIndex("id");
        int uriIndex = cursor.getColumnIndex("uri");
        int fileNameIndex = cursor.getColumnIndex("fileName");
        
        if (idIndex >= 0) {
            image.put("id", cursor.getString(idIndex));
        }
        if (uriIndex >= 0) {
            image.put("uri", cursor.getString(uriIndex));
        }
        if (fileNameIndex >= 0) {
            image.put("fileName", cursor.getString(fileNameIndex));
        }
        
        // 🔧 确保 category 不为 null：如果数据库中的 category 为 null，使用默认值 "NA"
        int categoryIndex = cursor.getColumnIndex("category");
        String category = null;
        if (categoryIndex >= 0 && !cursor.isNull(categoryIndex)) {
            category = cursor.getString(categoryIndex);
        }
        // 如果 category 为 null 或空，使用默认值 "NA"
        if (category == null || category.isEmpty()) {
            category = "NA";
        }
        image.put("category", category);
        
        // 数值字段
        putDoubleIfNotNull(image, "confidence", cursor, "confidence");
        putLongIfNotNull(image, "timestamp", cursor, "timestamp");
        putLongIfNotNull(image, "takenAt", cursor, "takenAt");
        putLongIfNotNull(image, "size", cursor, "size");
        putStringIfNotNull(image, "mimeType", cursor, "mimeType");
        
        // 🔧 确保 width 和 height 始终被设置（即使数据库中的值是NULL，也设置默认值0）
        int widthIndex = cursor.getColumnIndex("width");
        int heightIndex = cursor.getColumnIndex("height");
        int width = 0;
        int height = 0;
        if (widthIndex >= 0 && !cursor.isNull(widthIndex)) {
            width = cursor.getInt(widthIndex);
        }
        if (heightIndex >= 0 && !cursor.isNull(heightIndex)) {
            height = cursor.getInt(heightIndex);
        }
        image.put("width", width);
        image.put("height", height);
        putStringIfNotNull(image, "createdAt", cursor, "createdAt");
        putStringIfNotNull(image, "updatedAt", cursor, "updatedAt");
        
        // GPS信息
        putDoubleIfNotNull(image, "latitude", cursor, "latitude");
        putDoubleIfNotNull(image, "longitude", cursor, "longitude");
        putDoubleIfNotNull(image, "altitude", cursor, "altitude");
        putDoubleIfNotNull(image, "accuracy", cursor, "accuracy");
        
        // 地址信息
        putStringIfNotNull(image, "address", cursor, "address");
        putStringIfNotNull(image, "city", cursor, "city");
        putStringIfNotNull(image, "country", cursor, "country");
        putStringIfNotNull(image, "province", cursor, "province");
        putStringIfNotNull(image, "district", cursor, "district");
        putStringIfNotNull(image, "street", cursor, "street");
        putStringIfNotNull(image, "locationSource", cursor, "locationSource");
        putDoubleIfNotNull(image, "cityDistance", cursor, "cityDistance");
        
        // JSON字段（反序列化）
        int idCardIndex = cursor.getColumnIndex("idCardDetections");
        if (!cursor.isNull(idCardIndex)) {
            String idCardStr = cursor.getString(idCardIndex);
            if (idCardStr != null && !idCardStr.isEmpty()) {
                image.put("idCardDetections", stringToJson(idCardStr));
            }
        }
        
        int generalIndex = cursor.getColumnIndex("generalDetections");
        if (!cursor.isNull(generalIndex)) {
            String generalStr = cursor.getString(generalIndex);
            if (generalStr != null && !generalStr.isEmpty()) {
                image.put("generalDetections", stringToJson(generalStr));
            }
        }
        
        int mobileNetIndex = cursor.getColumnIndex("mobileNetV3Detections");
        if (!cursor.isNull(mobileNetIndex)) {
            String mobileNetStr = cursor.getString(mobileNetIndex);
            if (mobileNetStr != null && !mobileNetStr.isEmpty()) {
                image.put("mobileNetV3Detections", stringToJson(mobileNetStr));
            }
        }
        
        int dimensionsIndex = cursor.getColumnIndex("imageDimensions");
        if (!cursor.isNull(dimensionsIndex)) {
            String dimensionsStr = cursor.getString(dimensionsIndex);
            if (dimensionsStr != null && !dimensionsStr.isEmpty()) {
                image.put("imageDimensions", stringToJson(dimensionsStr));
            }
        }
        
        putStringIfNotNull(image, "message", cursor, "message");
        
        // 🔥 拍摄参数字段
        putStringIfNotNull(image, "cameraSettings", cursor, "cameraSettings");
        putStringIfNotNull(image, "isoCategory", cursor, "isoCategory");
        putStringIfNotNull(image, "apertureCategory", cursor, "apertureCategory");
        putStringIfNotNull(image, "shutterCategory", cursor, "shutterCategory");
        putStringIfNotNull(image, "focalLengthCategory", cursor, "focalLengthCategory");
        
        return image;
    }
    
    /**
     * 生成稳定的ID（基于URI的SHA-256哈希）
     * 与JS层保持一致
     * 公共方法，供外部调用
     */
    public String generateStableIdFromUri(String uri) {
        return generateStableId(uri);
    }
    
    /**
     * 生成稳定的ID（基于URI的SHA-256哈希）
     * 与JS层保持一致
     */
    private String generateStableId(String uri) {
        if (uri == null || uri.isEmpty()) {
            return "";
        }
        
        try {
            java.security.MessageDigest digest = java.security.MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(uri.getBytes("UTF-8"));
            StringBuilder hexString = new StringBuilder();
            for (byte b : hash) {
                String hex = Integer.toHexString(0xff & b);
                if (hex.length() == 1) {
                    hexString.append('0');
                }
                hexString.append(hex);
            }
            return hexString.toString();
        } catch (Exception e) {
            Log.e(TAG, "生成ID失败", e);
            return String.valueOf(uri.hashCode());
        }
    }
    
    /**
     * JSON序列化
     */
    private String jsonToString(Object obj) {
        if (obj == null) return null;
        try {
            if (obj instanceof JSONArray || obj instanceof JSONObject) {
                return obj.toString();
            } else if (obj instanceof List) {
                return new JSONArray((List) obj).toString();
            } else if (obj instanceof Map) {
                return new JSONObject((Map) obj).toString();
            } else {
                return obj.toString();
            }
        } catch (Exception e) {
            Log.e(TAG, "JSON序列化失败", e);
            return null;
        }
    }
    
    /**
     * JSON反序列化
     */
    private Object stringToJson(String str) {
        if (str == null || str.isEmpty()) return null;
        try {
            String trimmed = str.trim();
            if (trimmed.startsWith("[")) {
                return new JSONArray(trimmed);
            } else if (trimmed.startsWith("{")) {
                return new JSONObject(trimmed);
            } else {
                return str;
            }
        } catch (Exception e) {
            Log.e(TAG, "JSON反序列化失败: " + str, e);
            return null;
        }
    }
    
    // ==================== 类型转换辅助方法 ====================
    
    private void putStringIfNotNull(ContentValues values, String key, Object value) {
        if (value != null) {
            values.put(key, value.toString());
        }
    }
    
    private void putStringIfNotNull(Map<String, Object> map, String key, Cursor cursor, String columnName) {
        int index = cursor.getColumnIndex(columnName);
        if (index >= 0 && !cursor.isNull(index)) {
            map.put(key, cursor.getString(index));
        }
    }
    
    private void putIntIfNotNull(ContentValues values, String key, Object value) {
        if (value != null) {
            if (value instanceof Number) {
                values.put(key, ((Number) value).intValue());
            }
        }
    }
    
    private void putIntIfNotNull(Map<String, Object> map, String key, Cursor cursor, String columnName) {
        int index = cursor.getColumnIndex(columnName);
        if (index >= 0 && !cursor.isNull(index)) {
            map.put(key, cursor.getInt(index));
        }
    }
    
    private void putLongIfNotNull(ContentValues values, String key, Object value) {
        if (value != null) {
            if (value instanceof Number) {
                values.put(key, ((Number) value).longValue());
            }
        }
    }
    
    private void putLongIfNotNull(Map<String, Object> map, String key, Cursor cursor, String columnName) {
        int index = cursor.getColumnIndex(columnName);
        if (index >= 0 && !cursor.isNull(index)) {
            map.put(key, cursor.getLong(index));
        }
    }
    
    private void putDoubleIfNotNull(ContentValues values, String key, Object value) {
        if (value != null) {
            if (value instanceof Number) {
                values.put(key, ((Number) value).doubleValue());
            }
        }
    }
    
    private void putDoubleIfNotNull(Map<String, Object> map, String key, Cursor cursor, String columnName) {
        int index = cursor.getColumnIndex(columnName);
        if (index >= 0 && !cursor.isNull(index)) {
            map.put(key, cursor.getDouble(index));
        }
    }
    
    private String getStringValue(Map<String, Object> map, String key, String defaultValue) {
        Object value = map.get(key);
        if (value == null) {
            return defaultValue;
        }
        return value.toString();
    }
    
    private double getDoubleValue(Object value) {
        if (value instanceof Number) {
            return ((Number) value).doubleValue();
        }
        return 0.0;
    }
    
    // ==================== 拍摄参数档位化分类（折中方案：标准档位，非高中低） ====================
    
    private static final double[] ISO_BUCKETS = {50, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600};
    private static final double[] APERTURE_BUCKETS = {1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22};
    private static final double[] SHUTTER_BUCKETS_SEC = {1.0/8000, 1.0/4000, 1.0/2000, 1.0/1000, 1.0/500, 1.0/250, 1.0/125, 1.0/60, 1.0/30, 1.0/15, 1.0/8, 1.0/4, 1.0/2, 1, 2, 4, 8};
    private static final double[] FOCAL_BUCKETS = {14, 24, 35, 50, 85, 135, 200, 300, 400};
    
    private double bucketToNearest(double value, double[] buckets) {
        if (value <= buckets[0]) return buckets[0];
        for (int i = 0; i < buckets.length - 1; i++) {
            double mid = (buckets[i] + buckets[i + 1]) / 2;
            if (value <= mid) return buckets[i];
        }
        return buckets[buckets.length - 1];
    }
    
    /** ISO档位：50, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600 */
    private String categorizeISO(Integer iso) {
        if (iso == null || iso <= 0) return null;
        double bucketed = bucketToNearest(iso.doubleValue(), ISO_BUCKETS);
        return String.valueOf((int) bucketed);
    }
    
    /** 光圈档位：1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22 */
    private String categorizeAperture(Double fNumber) {
        if (fNumber == null || fNumber <= 0) return null;
        double bucketed = bucketToNearest(fNumber, APERTURE_BUCKETS);
        return (bucketed == Math.floor(bucketed)) ? String.valueOf((int) bucketed) : String.valueOf(bucketed);
    }
    
    /** 快门档位：1/8000, 1/4000, ..., 1/8, 1/4, 1/2, 1", 2", 4", 8" */
    private String categorizeShutterSpeed(Double exposureTime) {
        if (exposureTime == null || exposureTime <= 0) return null;
        double bucketed = bucketToNearest(exposureTime, SHUTTER_BUCKETS_SEC);
        if (bucketed >= 1) return (int) bucketed + "\"";
        int denom = (int) Math.round(1.0 / bucketed);
        return "1/" + denom;
    }
    
    /** 焦距档位：14, 24, 35, 50, 85, 135, 200, 300, 400 mm */
    private String categorizeFocalLength(Double focalLength) {
        if (focalLength == null || focalLength <= 0) return null;
        double bucketed = bucketToNearest(focalLength, FOCAL_BUCKETS);
        return String.valueOf((int) bucketed);
    }
    
    /**
     * 根据 cameraSettings JSON字符串计算分类
     * @param cameraSettingsStr cameraSettings的JSON字符串
     * @return 包含 isoCategory, apertureCategory, shutterCategory, focalLengthCategory 的Map
     */
    private Map<String, String> calculateCameraSettingsCategories(String cameraSettingsStr) {
        Map<String, String> result = new HashMap<>();
        result.put("isoCategory", null);
        result.put("apertureCategory", null);
        result.put("shutterCategory", null);
        result.put("focalLengthCategory", null);
        
        if (cameraSettingsStr == null || cameraSettingsStr.isEmpty()) {
            return result;
        }
        
        try {
            JSONObject settings = new JSONObject(cameraSettingsStr);
            
            // ISO分类
            if (settings.has("iso") && !settings.isNull("iso")) {
                Integer iso = settings.getInt("iso");
                result.put("isoCategory", categorizeISO(iso));
            }
            
            // 光圈分类
            if (settings.has("aperture") && !settings.isNull("aperture")) {
                Double aperture = settings.getDouble("aperture");
                result.put("apertureCategory", categorizeAperture(aperture));
            }
            
            // 快门分类
            if (settings.has("shutterSpeed") && !settings.isNull("shutterSpeed")) {
                Double shutterSpeed = settings.getDouble("shutterSpeed");
                result.put("shutterCategory", categorizeShutterSpeed(shutterSpeed));
            }
            
            // 焦距分类
            if (settings.has("focalLength") && !settings.isNull("focalLength")) {
                Double focalLength = settings.getDouble("focalLength");
                result.put("focalLengthCategory", categorizeFocalLength(focalLength));
            }
            
        } catch (Exception e) {
            Log.w(TAG, "解析 cameraSettings JSON 失败: " + cameraSettingsStr, e);
        }
        
        return result;
    }
}

