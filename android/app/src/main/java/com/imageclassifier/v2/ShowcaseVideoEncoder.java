package com.imageclassifier.v2;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.media.Image;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.util.Log;

import java.io.File;
import java.nio.ByteBuffer;

/**
 * 时刻秀导出（安卓）：图片序列 → H.264 MP4，对齐 iOS（30fps、每图 interval×30 静帧、
 * 张间 12 帧交叉淡入、1080×1920、等比黑底）。
 *
 * 编码走 MediaCodec（video/avc）+ COLOR_FormatYUV420Flexible + getInputImage —— 用 Image 的
 * plane 实际 rowStride/pixelStride 写入，规避各机型（尤其华为）NV12/I420 色彩格式差异。
 * 帧合成用 Canvas（等比适配、交叉淡入的 alpha 混合），离线导出不要求实时。
 * 静帧的 YUV 只转一次缓存复用，仅交叉淡入帧逐帧转换，省大量耗时。
 *
 * 背景音乐合成（混音）暂不在此实现（安卓 AAC 转码后续在真机迭代），导出为纯视频。
 */
public class ShowcaseVideoEncoder {
    private static final String TAG = "ShowcaseEncoder";
    private static final int FPS = 30;
    private static final int BITRATE = 8_000_000;
    private static final int FADE_FRAMES = 12;     // 0.4s 交叉淡入，与 iOS 一致
    private static final int IO_TIMEOUT_US = 10_000;

    /** 缓存某张图（画布尺寸）的 YUV420 平面数据，供静帧复用。 */
    private static final class Yuv {
        final byte[] y, u, v;
        final int w, h, cw, ch;
        Yuv(int w, int h) {
            this.w = w; this.h = h; this.cw = w / 2; this.ch = h / 2;
            y = new byte[w * h];
            u = new byte[cw * ch];
            v = new byte[cw * ch];
        }
    }

    /**
     * 导出。返回生成的 mp4 绝对路径（不带 file://，调用方自行拼）。
     * @param paths    图片本地路径数组（已是 ~1080 长边 JPEG）
     * @param interval 单图停留秒数
     * @param outW/outH 画布尺寸（默认 1080×1920，须为偶数）
     * @param outFile  输出文件
     */
    public static void encode(String[] paths, double interval, int outW, int outH, File outFile) throws Exception {
        final int w = outW % 2 == 0 ? outW : outW - 1;
        final int h = outH % 2 == 0 ? outH : outH - 1;
        final int stillFrames = Math.max(1, (int) Math.round(interval * FPS));
        final int fadeFrames = paths.length > 1 ? FADE_FRAMES : 0;

        MediaFormat format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, w, h);
        format.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible);
        format.setInteger(MediaFormat.KEY_BIT_RATE, BITRATE);
        format.setInteger(MediaFormat.KEY_FRAME_RATE, FPS);
        format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1);

        MediaCodec encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC);
        encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
        encoder.start();

        MediaMuxer muxer = new MediaMuxer(outFile.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
        final int[] trackIndex = { -1 };
        final boolean[] muxerStarted = { false };
        MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();

        long frameIndex = 0;
        Bitmap prev = null;
        try {
            for (String path : paths) {
                Bitmap cur = canvasBitmap(path, w, h);
                if (cur == null) continue;
                Yuv curYuv = toYuv(cur, w, h);

                // 交叉淡入（上一张 → 当前张）：逐帧 Canvas 混合后转 YUV
                if (prev != null && fadeFrames > 0) {
                    for (int f = 1; f <= fadeFrames; f++) {
                        Bitmap comp = blend(prev, cur, (float) f / fadeFrames, w, h);
                        Yuv cy = toYuv(comp, w, h);
                        comp.recycle();
                        frameIndex = feedFrame(encoder, muxer, info, trackIndex, muxerStarted, cy, frameIndex);
                    }
                }
                // 静帧：同一份 YUV 复用
                for (int s = 0; s < stillFrames; s++) {
                    frameIndex = feedFrame(encoder, muxer, info, trackIndex, muxerStarted, curYuv, frameIndex);
                }

                if (prev != null) prev.recycle();
                prev = cur;
            }
            if (prev != null) prev.recycle();

            // 结束：送 EOS 再排空
            signalEnd(encoder, muxer, info, trackIndex, muxerStarted, frameIndex);
            drain(encoder, muxer, info, trackIndex, muxerStarted, true);
        } finally {
            try { encoder.stop(); } catch (Exception ignored) {}
            try { encoder.release(); } catch (Exception ignored) {}
            try { if (muxerStarted[0]) muxer.stop(); } catch (Exception ignored) {}
            try { muxer.release(); } catch (Exception ignored) {}
        }
    }

    /** 写一帧（缓存的 YUV）到编码器输入，并排空已就绪输出。返回递增后的 frameIndex。 */
    private static long feedFrame(MediaCodec encoder, MediaMuxer muxer, MediaCodec.BufferInfo info,
                                  int[] trackIndex, boolean[] muxerStarted, Yuv yuv, long frameIndex) {
        int inIdx;
        while (true) {
            inIdx = encoder.dequeueInputBuffer(IO_TIMEOUT_US);
            if (inIdx >= 0) break;
            drain(encoder, muxer, info, trackIndex, muxerStarted, false);
        }
        Image img = encoder.getInputImage(inIdx);
        int size = yuv.w * yuv.h * 3 / 2;
        if (img != null) writeYuv(img, yuv);
        long pts = frameIndex * 1_000_000L / FPS;
        encoder.queueInputBuffer(inIdx, 0, size, pts, 0);
        drain(encoder, muxer, info, trackIndex, muxerStarted, false);
        return frameIndex + 1;
    }

    private static void signalEnd(MediaCodec encoder, MediaMuxer muxer, MediaCodec.BufferInfo info,
                                  int[] trackIndex, boolean[] muxerStarted, long frameIndex) {
        int inIdx;
        // 边等输入缓冲边排空输出，避免输出未取走导致输入缓冲不释放而死等
        while ((inIdx = encoder.dequeueInputBuffer(IO_TIMEOUT_US)) < 0) {
            drain(encoder, muxer, info, trackIndex, muxerStarted, false);
        }
        long pts = frameIndex * 1_000_000L / FPS;
        encoder.queueInputBuffer(inIdx, 0, 0, pts, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
    }

    private static void drain(MediaCodec encoder, MediaMuxer muxer, MediaCodec.BufferInfo info,
                              int[] trackIndex, boolean[] muxerStarted, boolean endOfStream) {
        while (true) {
            int outIdx = encoder.dequeueOutputBuffer(info, IO_TIMEOUT_US);
            if (outIdx == MediaCodec.INFO_TRY_AGAIN_LATER) {
                if (!endOfStream) return;       // 还没 EOS，先回去喂帧
                // EOS 模式：继续等直到拿到 EOS 标记
            } else if (outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                if (!muxerStarted[0]) {
                    trackIndex[0] = muxer.addTrack(encoder.getOutputFormat());
                    muxer.start();
                    muxerStarted[0] = true;
                }
            } else if (outIdx >= 0) {
                ByteBuffer outBuf = encoder.getOutputBuffer(outIdx);
                if ((info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) info.size = 0;
                if (info.size > 0 && muxerStarted[0] && outBuf != null) {
                    outBuf.position(info.offset);
                    outBuf.limit(info.offset + info.size);
                    muxer.writeSampleData(trackIndex[0], outBuf, info);
                }
                encoder.releaseOutputBuffer(outIdx, false);
                if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) return;
            }
        }
    }

    /** 解码图片并等比适配到 w×h 黑底画布（ARGB_8888）。 */
    private static Bitmap canvasBitmap(String path, int w, int h) {
        try {
            String p = path.startsWith("file://") ? path.substring(7) : path;
            Bitmap src = BitmapFactory.decodeFile(p);
            if (src == null) return null;
            Bitmap canvasBmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(canvasBmp);
            canvas.drawColor(Color.BLACK);
            int iw = src.getWidth(), ih = src.getHeight();
            float scale = Math.min((float) w / iw, (float) h / ih);
            int dw = Math.round(iw * scale), dh = Math.round(ih * scale);
            int left = (w - dw) / 2, top = (h - dh) / 2;
            Paint paint = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.ANTI_ALIAS_FLAG);
            canvas.drawBitmap(src, new Rect(0, 0, iw, ih), new Rect(left, top, left + dw, top + dh), paint);
            src.recycle();
            return canvasBmp;
        } catch (Exception e) {
            Log.w(TAG, "canvasBitmap failed: " + e.getMessage());
            return null;
        }
    }

    /** 两张画布图按 alpha 混合（base 不透明 + over 以 alpha 叠加）。 */
    private static Bitmap blend(Bitmap base, Bitmap over, float alpha, int w, int h) {
        Bitmap out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);
        canvas.drawBitmap(base, 0, 0, null);
        Paint paint = new Paint();
        paint.setAlpha(Math.max(0, Math.min(255, Math.round(alpha * 255))));
        canvas.drawBitmap(over, 0, 0, paint);
        return out;
    }

    /** ARGB 画布图 → YUV420（BT.601 limited range），缓存平面字节。 */
    private static Yuv toYuv(Bitmap bmp, int w, int h) {
        Yuv yuv = new Yuv(w, h);
        int[] argb = new int[w * h];
        bmp.getPixels(argb, 0, w, 0, 0, w, h);
        for (int j = 0; j < h; j++) {
            for (int i = 0; i < w; i++) {
                int c = argb[j * w + i];
                int r = (c >> 16) & 0xff, g = (c >> 8) & 0xff, b = c & 0xff;
                int yy = ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16;
                yuv.y[j * w + i] = (byte) clamp(yy);
                if ((j & 1) == 0 && (i & 1) == 0) {
                    int uu = ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128;
                    int vv = ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128;
                    int ci = (j / 2) * yuv.cw + (i / 2);
                    yuv.u[ci] = (byte) clamp(uu);
                    yuv.v[ci] = (byte) clamp(vv);
                }
            }
        }
        return yuv;
    }

    /** 把缓存 YUV 写进编码器 Image 的三个 plane，按各自 rowStride/pixelStride。 */
    private static void writeYuv(Image img, Yuv yuv) {
        Image.Plane[] planes = img.getPlanes();
        // Y
        writePlane(planes[0], yuv.y, yuv.w, yuv.h);
        // U / V（半分辨率）
        writePlane(planes[1], yuv.u, yuv.cw, yuv.ch);
        writePlane(planes[2], yuv.v, yuv.cw, yuv.ch);
    }

    private static void writePlane(Image.Plane plane, byte[] data, int pw, int ph) {
        ByteBuffer buf = plane.getBuffer();
        int rowStride = plane.getRowStride();
        int pixStride = plane.getPixelStride();
        if (pixStride == 1) {
            // 平面（I420）：整行连续，按 rowStride 定位后批量拷贝
            for (int row = 0; row < ph; row++) {
                buf.position(row * rowStride);
                buf.put(data, row * pw, pw);
            }
        } else {
            // 半平面（NV12/NV21）：U、V 交错，pixelStride=2。只写目标字节、不碰相邻 plane
            // 的交错字节（否则会把另一通道清零）。
            for (int row = 0; row < ph; row++) {
                int base = row * rowStride;
                for (int col = 0; col < pw; col++) {
                    buf.position(base + col * pixStride);
                    buf.put(data[row * pw + col]);
                }
            }
        }
    }

    private static int clamp(int v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }
}
