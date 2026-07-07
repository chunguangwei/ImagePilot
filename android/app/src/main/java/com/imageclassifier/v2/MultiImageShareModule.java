package com.imageclassifier.v2;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.content.ContentResolver;
import androidx.core.content.FileProvider;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.Promise;
import java.io.File;
import java.io.InputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

public class MultiImageShareModule extends ReactContextBaseJavaModule {
    
    private ReactApplicationContext reactContext;
    
    public MultiImageShareModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
    }
    
    @Override
    public String getName() {
        return "MultiImageShareModule";
    }
    
    @ReactMethod
    public void shareMultipleImages(ReadableArray imagePaths, Promise promise) {
        try {
            Intent shareIntent = new Intent(Intent.ACTION_SEND_MULTIPLE);
            shareIntent.setType("image/*");
            
            ArrayList<Uri> imageUris = new ArrayList<>();
            ContentResolver contentResolver = reactContext.getContentResolver();
            
            for (int i = 0; i < imagePaths.size(); i++) {
                String imagePath = imagePaths.getString(i);
                if (imagePath != null && !imagePath.isEmpty()) {
                    // 只处理 content:// URI，统一使用 URI 进行文件操作
                    if (!imagePath.startsWith("content://")) {
                        // 不是 content:// URI，跳过
                        continue;
                    }
                    
                    try {
                        Uri contentUri = Uri.parse(imagePath);
                        // 将 content:// URI 复制到缓存目录，确保其他应用可以访问
                        File cachedFile = copyContentUriToCache(contentUri, contentResolver, i);
                        if (cachedFile != null && cachedFile.exists()) {
                            // 使用 FileProvider 生成 URI，确保其他应用可以访问
                            Uri imageUri = FileProvider.getUriForFile(
                                reactContext,
                                reactContext.getPackageName() + ".fileprovider",
                                cachedFile
                            );
                            imageUris.add(imageUri);
                        }
                    } catch (Exception e) {
                        // 复制失败，跳过此文件
                        continue;
                    }
                }
            }
            
            if (imageUris.isEmpty()) {
                promise.reject("NO_IMAGES", "没有找到有效的图片文件");
                return;
            }
            
            shareIntent.putParcelableArrayListExtra(Intent.EXTRA_STREAM, imageUris);
            shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            // 创建分享选择器
            // 使用 createChooser 确保 Android 系统在分享完成后显示"完成"对话框
            // 对话框会显示"返回[应用名称]"选项，让用户选择返回ImagePilot或留在微信
            Intent chooserIntent = Intent.createChooser(shareIntent, "分享图片到");
            // 必须添加 FLAG_ACTIVITY_NEW_TASK，因为是从后台启动
            chooserIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            // 不要添加 FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS，这不会影响返回提示
            // createChooser 会自动处理返回提示的显示

            // 显式授权给所有可能接收的应用（作为额外保障，某些定制ROM可能需要）
            // 注意：虽然 FLAG_GRANT_READ_URI_PERMISSION 已经足够，但显式授权可以避免某些ROM的兼容性问题
            try {
                List<ResolveInfo> resInfoList = reactContext.getPackageManager()
                    .queryIntentActivities(shareIntent, PackageManager.MATCH_DEFAULT_ONLY);
                
                for (ResolveInfo resolveInfo : resInfoList) {
                    String packageName = resolveInfo.activityInfo.packageName;
                    for (Uri uri : imageUris) {
                        reactContext.grantUriPermission(packageName, uri, 
                            Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    }
                }
            } catch (Exception e) {
                // 如果显式授权失败，依赖 FLAG_GRANT_READ_URI_PERMISSION 标志
                // 这不会影响分享功能
            }
            
            reactContext.startActivity(chooserIntent);
            promise.resolve("分享成功");
            
        } catch (Exception e) {
            promise.reject("SHARE_ERROR", e.getMessage());
        }
    }
    
    /**
     * 分享单个文件（使用 FileProvider URI）
     * @param filePath 文件路径（绝对路径）
     * @param mimeType MIME类型（如 "text/plain", "text/txt" 等）
     * @param title 分享标题
     */
    @ReactMethod
    public void shareFile(String filePath, String mimeType, String title, Promise promise) {
        try {
            if (filePath == null || filePath.isEmpty()) {
                promise.reject("INVALID_PATH", "文件路径不能为空");
                return;
            }
            
            File file = new File(filePath);
            if (!file.exists() || !file.canRead()) {
                promise.reject("FILE_NOT_FOUND", "文件不存在或无法读取: " + filePath);
                return;
            }
            
            // 使用 FileProvider 生成 URI
            Uri fileUri = FileProvider.getUriForFile(
                reactContext,
                reactContext.getPackageName() + ".fileprovider",
                file
            );
            
            // 创建分享 Intent
            Intent shareIntent = new Intent(Intent.ACTION_SEND);
            shareIntent.setType(mimeType != null && !mimeType.isEmpty() ? mimeType : "text/plain");
            shareIntent.putExtra(Intent.EXTRA_STREAM, fileUri);
            shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            
            // 创建分享选择器
            Intent chooserIntent = Intent.createChooser(shareIntent, title != null ? title : "分享文件");
            chooserIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            
            // 显式授权给所有可能接收的应用
            try {
                List<ResolveInfo> resInfoList = reactContext.getPackageManager()
                    .queryIntentActivities(shareIntent, PackageManager.MATCH_DEFAULT_ONLY);
                
                for (ResolveInfo resolveInfo : resInfoList) {
                    String packageName = resolveInfo.activityInfo.packageName;
                    reactContext.grantUriPermission(packageName, fileUri, 
                        Intent.FLAG_GRANT_READ_URI_PERMISSION);
                }
            } catch (Exception e) {
                // 如果显式授权失败，依赖 FLAG_GRANT_READ_URI_PERMISSION 标志
            }
            
            reactContext.startActivity(chooserIntent);
            promise.resolve("分享成功");
            
        } catch (Exception e) {
            promise.reject("SHARE_ERROR", "分享文件失败: " + e.getMessage(), e);
        }
    }
    
    /**
     * 将 content:// URI 复制到应用缓存目录
     */
    private File copyContentUriToCache(Uri contentUri, ContentResolver contentResolver, int index) {
        try {
            // 创建缓存目录
            File cacheDir = new File(reactContext.getCacheDir(), "share_images");
            if (!cacheDir.exists()) {
                cacheDir.mkdirs();
            }
            
            // 生成临时文件名
            String fileName = "share_image_" + System.currentTimeMillis() + "_" + index + ".jpg";
            File cachedFile = new File(cacheDir, fileName);
            
            // 复制文件
            InputStream inputStream = contentResolver.openInputStream(contentUri);
            if (inputStream == null) {
                return null;
            }
            
            FileOutputStream outputStream = new FileOutputStream(cachedFile);
            byte[] buffer = new byte[8192];
            int bytesRead;
            while ((bytesRead = inputStream.read(buffer)) != -1) {
                outputStream.write(buffer, 0, bytesRead);
            }
            
            outputStream.close();
            inputStream.close();
            
            return cachedFile;
        } catch (IOException e) {
            return null;
        }
    }
}