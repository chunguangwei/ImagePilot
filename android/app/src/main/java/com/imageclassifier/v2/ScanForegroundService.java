package com.imageclassifier.v2;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

public class ScanForegroundService extends Service {
    private static final String CHANNEL_ID = "ScanServiceChannel";
    private static final int NOTIFICATION_ID = 1;
    
    // 🔥 解耦：扫描进展消息由JS层控制，原生层只提供fallback（硬编码英文）
    // 通知渠道名称、描述和标题需要国际化，继续使用资源文件
    private static final String DEFAULT_SCANNING_MESSAGE = "Scanning...";
    private static final String DEFAULT_STARTING_MESSAGE = "Starting scan...";
    
    private NotificationManager notificationManager;
    private PowerManager.WakeLock wakeLock;
    private android.os.Handler handler;
    private Runnable heartbeatRunnable;
    
    // 🔥 新增：保存最后一次的进度消息和标题，供心跳机制使用
    private String lastProgressMessage;
    private String lastTitle; // 🔥 保存最后一次的标题，确保心跳时使用正确的语言
    private int lastProcessed = 0;
    private int lastTotal = 0;
    
    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        notificationManager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        
        // 创建 WakeLock 防止 CPU 休眠
        PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "ScanForegroundService::WakeLock"
        );
        
        // 创建 Handler 用于定期发送心跳
        handler = new android.os.Handler(android.os.Looper.getMainLooper());
        
        // 心跳任务：定期更新通知，保持服务活跃
        heartbeatRunnable = new Runnable() {
            @Override
            public void run() {
                // 🔥 优化：使用最后一次的进度消息和标题，而不是固定的"扫描中..."
                // 这样心跳时也能显示实际的扫描进度和正确的语言
                updateNotification(lastProgressMessage, lastProcessed, lastTotal, lastTitle);
                // 继续下一次心跳
                if (handler != null) {
                    handler.postDelayed(this, 10000); // 🔥 从30秒改为10秒
                }
            }
        };
    }
    
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            return START_NOT_STICKY;
        }
        
        String action = intent.getAction();
        
        if ("START_SCAN".equals(action)) {
            // 🔥 修复：必须在5秒内调用 startForeground()，使用最简单的通知立即调用
            // 先创建一个最简单的通知，避免任何耗时操作（如 getString()、PendingIntent 等）
            Notification simpleNotification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Starting...")
                .setContentText("Starting scan...")
                .setSmallIcon(R.drawable.ic_notification)
                .setLargeIcon(getLargeIconBitmap())
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .build();
            
            // 🔥 立即调用 startForeground()，必须在5秒内完成
            startForeground(NOTIFICATION_ID, simpleNotification);
            
            // 初始化进度消息
            lastProgressMessage = DEFAULT_STARTING_MESSAGE;
            lastTitle = null; // 启动时还没有标题，使用资源文件的默认值
            lastProcessed = 0;
            lastTotal = 0;
            
            // 获取 WakeLock，防止 CPU 休眠（在 startForeground() 之后执行）
            // 使用超长超时时间，确保扫描过程中不会释放
            if (wakeLock != null && !wakeLock.isHeld()) {
                wakeLock.acquire(60 * 60 * 1000L /*60分钟*/);
            }
            
            // 🔥 立即更新为完整的通知（包含国际化标题和 PendingIntent）
            // 使用 post 确保在主线程执行，不阻塞
            if (handler != null) {
                handler.post(new Runnable() {
                    @Override
                    public void run() {
                        updateNotification(DEFAULT_STARTING_MESSAGE, 0, 0, null);
                    }
                });
            } else {
                // 如果没有 handler，直接更新
                updateNotification(DEFAULT_STARTING_MESSAGE, 0, 0, null);
            }
            
            // 启动心跳任务，定期更新通知保持服务活跃
            // 🔥 优化：缩短心跳间隔从30秒到10秒
            if (handler != null && heartbeatRunnable != null) {
                handler.postDelayed(heartbeatRunnable, 10000); // 🔥 10秒后开始第一次心跳
            }
        } else if ("UPDATE_PROGRESS".equals(action)) {
            String message = intent.getStringExtra("message");
            int processed = intent.getIntExtra("processed", 0);
            int total = intent.getIntExtra("total", 0);
            String title = intent.getStringExtra("title"); // 🔥 解耦：通知标题由JS层传递
            
            // 🔥 修复：如果服务还没有成为前台服务（例如被系统杀死后重新启动），必须先调用 startForeground()
            // 检查服务是否已经是前台服务（通过检查 WakeLock 是否被持有，或者直接调用 startForeground 确保安全）
            // 为了安全，总是先创建一个通知并调用 startForeground()
            Notification progressNotification = createNotification(
                message != null ? message : DEFAULT_SCANNING_MESSAGE, 
                processed, 
                total, 
                title
            );
            startForeground(NOTIFICATION_ID, progressNotification);
            
            // 🔥 保存进度消息和标题，供心跳机制使用
            if (message != null) {
                lastProgressMessage = message;
            } else {
                lastProgressMessage = DEFAULT_SCANNING_MESSAGE;
            }
            // 保存标题，如果JS层传递了标题则使用，否则保持上次的值（或null使用资源文件默认值）
            if (title != null) {
                lastTitle = title;
            }
            lastProcessed = processed;
            lastTotal = total;
            
            // 如果 WakeLock 还没有被持有，获取它（服务可能被系统杀死后重新启动）
            if (wakeLock != null && !wakeLock.isHeld()) {
                wakeLock.acquire(60 * 60 * 1000L /*60分钟*/);
            }
            
            // 启动心跳任务（如果还没有启动）
            if (handler != null && heartbeatRunnable != null) {
                handler.removeCallbacks(heartbeatRunnable); // 先移除，避免重复启动
                handler.postDelayed(heartbeatRunnable, 10000); // 10秒后开始第一次心跳
            }
        } else if ("STOP_SCAN".equals(action)) {
            // 停止心跳任务
            if (handler != null && heartbeatRunnable != null) {
                handler.removeCallbacks(heartbeatRunnable);
            }
            
            // 释放 WakeLock
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
            stopForeground(true);
            stopSelf();
        }
        
        // 🔥 优化：使用 START_STICKY | START_REDELIVER_INTENT 提高服务优先级
        // START_STICKY: 服务被杀死后自动重启
        // START_REDELIVER_INTENT: 服务被杀死后重新传递最后一个 Intent
        return START_STICKY | START_REDELIVER_INTENT;
    }
    
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                getString(R.string.scan_notification_channel_name),
                NotificationManager.IMPORTANCE_DEFAULT // 改为 DEFAULT，确保通知能及时更新（小米手机需要）
            );
            channel.setDescription(getString(R.string.scan_notification_channel_description));
            channel.setShowBadge(false);
            channel.setSound(null, null);
            channel.enableVibration(false);
            // 小米手机优化：允许通知更新
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }
    
    private Notification createNotification(String message, int processed, int total) {
        return createNotification(message, processed, total, null);
    }
    
    private Notification createNotification(String message, int processed, int total, String title) {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        notificationIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M 
            ? PendingIntent.FLAG_IMMUTABLE 
            : PendingIntent.FLAG_UPDATE_CURRENT;
            
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, 0, notificationIntent, flags
        );
        
        String progressText = total > 0 
            ? String.format("%s (%d/%d)", message, processed, total)
            : message;
        
        // 🔥 解耦：通知标题由JS层传递，如果为null则使用资源文件的默认值（已国际化）
        String notificationTitle = title != null ? title : getString(R.string.scan_notification_title);
        
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(notificationTitle)
            .setContentText(progressText)
            .setSmallIcon(R.drawable.ic_notification)
            .setLargeIcon(getLargeIconBitmap())
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT) // 改为 DEFAULT，确保通知能及时更新
            .setOnlyAlertOnce(false) // 改为 false，允许每次更新都显示（小米手机需要）
            .setAutoCancel(false)
            .setShowWhen(true) // 显示时间戳，帮助用户看到更新
            .setWhen(System.currentTimeMillis()); // 设置当前时间，确保每次更新都有新的时间戳
        
        if (total > 0) {
            builder.setProgress(total, processed, false);
        }
        
        return builder.build();
    }
    
    private void updateNotification(String message, int processed, int total) {
        updateNotification(message, processed, total, null);
    }
    
    private void updateNotification(String message, int processed, int total, String title) {
        Notification notification = createNotification(message, processed, total, title);
        notificationManager.notify(NOTIFICATION_ID, notification);
    }
    
    // 通知大图标：显式渲染我们的罗盘 app 图标为 bitmap 并 setLargeIcon。
    // 不设 largeIcon 时，系统会用「应用图标」当大图标——而 vivo/部分 ROM 会缓存旧的
    // 应用图标（换图标后通知里仍显示旧图），重装也不清。显式设置即可绕开该缓存。
    private Bitmap cachedLargeIcon;
    private Bitmap getLargeIconBitmap() {
        if (cachedLargeIcon != null) return cachedLargeIcon;
        try {
            Drawable d = ContextCompat.getDrawable(this, R.mipmap.ic_launcher);
            if (d == null) return null;
            int size = d.getIntrinsicWidth() > 0 ? d.getIntrinsicWidth() : 144;
            Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bmp);
            d.setBounds(0, 0, size, size);
            d.draw(canvas);
            cachedLargeIcon = bmp;
            return bmp;
        } catch (Exception e) {
            return null;
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
    
    @Override
    public void onDestroy() {
        super.onDestroy();
        // 停止心跳任务
        if (handler != null && heartbeatRunnable != null) {
            handler.removeCallbacks(heartbeatRunnable);
        }
        
        // 释放 WakeLock
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        notificationManager.cancel(NOTIFICATION_ID);
        
        // 刷新日志（服务暂停时保存最后1000条日志）
        try {
            FileLogger.getInstance(this).flush();
        } catch (Exception e) {
            android.util.Log.e("ScanForegroundService", "刷新日志失败", e);
        }
    }
    
    // 🔥 新增：当应用从最近任务中移除时，尝试保持服务运行
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        android.util.Log.d("ScanForegroundService", "⚠️ 应用从最近任务中移除，尝试保持服务运行");
        
        // 如果正在扫描（WakeLock 被持有），重新启动服务
        // 🔥 注意：这里重新启动服务时，onStartCommand 会被调用，会立即调用 startForeground()
        if (wakeLock != null && wakeLock.isHeld()) {
            Intent restartIntent = new Intent(this, ScanForegroundService.class);
            restartIntent.setAction("START_SCAN");
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(restartIntent);
            } else {
                startService(restartIntent);
            }
            android.util.Log.d("ScanForegroundService", "✅ 已重新启动服务");
        }
    }
}

