package com.imageclassifier.v2;

import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.util.Log;

import java.io.File;
import java.nio.ByteBuffer;

/**
 * 时刻秀导出背景音乐合成（安卓）：把本地音乐转码成 AAC、循环铺满视频时长，与纯视频混成带配乐的 MP4。
 * 对齐 iOS（循环铺满、混音失败退纯视频）。
 *
 * 两步：
 *   A) transcodeToAac：MediaExtractor 解码音乐 → PCM → AAC 编码器（源 EOS 未到时长就 seek(0) 循环），
 *      到视频时长即送 EOS，写到临时 m4a。
 *   B) remux：把纯视频的视频轨 + 临时 m4a 的音频轨拷进最终 MP4（仅样本复制，不二次转码）。
 *
 * 任意环节失败抛异常，调用方退回纯视频。
 */
public class ShowcaseAudioMuxer {
    private static final String TAG = "ShowcaseAudioMuxer";
    private static final String AAC_MIME = "audio/mp4a-latm";
    private static final int AAC_BITRATE = 128000;
    private static final int IO_TIMEOUT_US = 10000;

    /**
     * @param videoPath 纯视频 mp4（ShowcaseVideoEncoder 产物）
     * @param musicPath 本地音乐文件
     * @param outPath   输出带配乐 mp4
     */
    public static void mux(String videoPath, String musicPath, String outPath) throws Exception {
        long durationUs = videoDurationUs(videoPath);
        if (durationUs <= 0) throw new Exception("视频时长无效");
        File tmpAac = new File(outPath + ".audio.m4a");
        try {
            transcodeToAac(musicPath, durationUs, tmpAac.getAbsolutePath());
            remux(videoPath, tmpAac.getAbsolutePath(), outPath);
        } finally {
            try { if (tmpAac.exists()) tmpAac.delete(); } catch (Exception ignored) {}
        }
    }

    /** 取视频轨时长（µs）。 */
    private static long videoDurationUs(String videoPath) throws Exception {
        MediaExtractor ex = new MediaExtractor();
        try {
            ex.setDataSource(videoPath);
            for (int i = 0; i < ex.getTrackCount(); i++) {
                MediaFormat f = ex.getTrackFormat(i);
                String mime = f.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("video/") && f.containsKey(MediaFormat.KEY_DURATION)) {
                    return f.getLong(MediaFormat.KEY_DURATION);
                }
            }
            return 0;
        } finally { ex.release(); }
    }

    /** 解码音乐→AAC，循环铺满 durationUs，写到 outAac（音频单轨 mp4）。 */
    private static void transcodeToAac(String musicPath, long durationUs, String outAac) throws Exception {
        MediaExtractor ex = new MediaExtractor();
        MediaCodec decoder = null, encoder = null;
        MediaMuxer muxer = null;
        try {
            ex.setDataSource(musicPath);
            int audioTrack = -1;
            MediaFormat inFmt = null;
            for (int i = 0; i < ex.getTrackCount(); i++) {
                MediaFormat f = ex.getTrackFormat(i);
                String mime = f.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) { audioTrack = i; inFmt = f; break; }
            }
            if (audioTrack < 0) throw new Exception("音乐无音频轨");
            ex.selectTrack(audioTrack);

            int sampleRate = inFmt.getInteger(MediaFormat.KEY_SAMPLE_RATE);
            int channels = inFmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
            String inMime = inFmt.getString(MediaFormat.KEY_MIME);

            decoder = MediaCodec.createDecoderByType(inMime);
            decoder.configure(inFmt, null, null, 0);
            decoder.start();

            MediaFormat outFmt = MediaFormat.createAudioFormat(AAC_MIME, sampleRate, channels);
            outFmt.setInteger(MediaFormat.KEY_BIT_RATE, AAC_BITRATE);
            outFmt.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC);
            outFmt.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 64 * 1024);
            encoder = MediaCodec.createEncoderByType(AAC_MIME);
            encoder.configure(outFmt, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            encoder.start();

            muxer = new MediaMuxer(outAac, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            int muxAudioTrack = -1;
            boolean muxerStarted = false;

            final int bytesPerFrame = channels * 2; // 16-bit PCM
            long encPtsUs = 0;            // 编码器输入累计 PTS
            long totalPcmBytes = 0;
            boolean decoderDone = false;  // 解码侧已送 EOS
            boolean encoderInDone = false; // 编码器输入已送 EOS
            boolean encoderOutDone = false;
            MediaCodec.BufferInfo encInfo = new MediaCodec.BufferInfo();
            MediaCodec.BufferInfo decInfo = new MediaCodec.BufferInfo();

            // 待送给编码器的 PCM 队列（简单用一个 ByteBuffer 累积）
            while (!encoderOutDone) {
                // 1) 喂解码器输入（从 extractor 读；EOS 时若未到时长就 seek 0 循环，否则送解码 EOS）
                if (!decoderDone) {
                    int inIdx = decoder.dequeueInputBuffer(IO_TIMEOUT_US);
                    if (inIdx >= 0) {
                        ByteBuffer inBuf = decoder.getInputBuffer(inIdx);
                        int sz = ex.readSampleData(inBuf, 0);
                        if (sz < 0) {
                            // 源到尾：还没铺满时长 → 循环；否则解码 EOS
                            if (encPtsUs < durationUs) {
                                ex.seekTo(0, MediaExtractor.SEEK_TO_CLOSEST_SYNC);
                                decoder.queueInputBuffer(inIdx, 0, 0, 0, 0);
                            } else {
                                decoder.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                                decoderDone = true;
                            }
                        } else {
                            long pts = ex.getSampleTime();
                            decoder.queueInputBuffer(inIdx, 0, sz, pts, 0);
                            ex.advance();
                        }
                    }
                }

                // 2) 解码输出 PCM → 喂编码器输入（按累计 PTS；到时长送编码 EOS）
                int outIdx = decoder.dequeueOutputBuffer(decInfo, IO_TIMEOUT_US);
                if (outIdx >= 0) {
                    ByteBuffer pcm = decoder.getOutputBuffer(outIdx);
                    if (pcm != null && decInfo.size > 0 && !encoderInDone) {
                        pcm.position(decInfo.offset);
                        pcm.limit(decInfo.offset + decInfo.size);
                        // 把这块 PCM 分批塞进编码器输入
                        while (pcm.hasRemaining() && !encoderInDone) {
                            int encInIdx = encoder.dequeueInputBuffer(IO_TIMEOUT_US);
                            if (encInIdx < 0) { drainEncoder(encoder, muxer, encInfo, new int[]{muxAudioTrack}, new boolean[]{muxerStarted}); continue; }
                            ByteBuffer encIn = encoder.getInputBuffer(encInIdx);
                            encIn.clear();
                            int n = Math.min(encIn.remaining(), pcm.remaining());
                            int oldLimit = pcm.limit();
                            pcm.limit(pcm.position() + n);
                            encIn.put(pcm);
                            pcm.limit(oldLimit);
                            long ptsUs = totalPcmBytes / bytesPerFrame * 1000000L / sampleRate;
                            totalPcmBytes += n;
                            encPtsUs = ptsUs;
                            if (ptsUs >= durationUs) {
                                encoder.queueInputBuffer(encInIdx, 0, n, ptsUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                                encoderInDone = true;
                            } else {
                                encoder.queueInputBuffer(encInIdx, 0, n, ptsUs, 0);
                            }
                        }
                    }
                    boolean decEos = (decInfo.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
                    decoder.releaseOutputBuffer(outIdx, false);
                    if ((decEos || encPtsUs >= durationUs) && !encoderInDone) {
                        // 解码到尾或已够时长但还没送编码 EOS：补一个空 EOS
                        int encInIdx = encoder.dequeueInputBuffer(IO_TIMEOUT_US);
                        if (encInIdx >= 0) {
                            encoder.queueInputBuffer(encInIdx, 0, 0, encPtsUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            encoderInDone = true;
                        }
                    }
                }

                // 3) 编码输出 → muxer
                while (true) {
                    int encOutIdx = encoder.dequeueOutputBuffer(encInfo, IO_TIMEOUT_US);
                    if (encOutIdx == MediaCodec.INFO_TRY_AGAIN_LATER) break;
                    if (encOutIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        if (!muxerStarted) { muxAudioTrack = muxer.addTrack(encoder.getOutputFormat()); muxer.start(); muxerStarted = true; }
                    } else if (encOutIdx >= 0) {
                        ByteBuffer encOut = encoder.getOutputBuffer(encOutIdx);
                        if ((encInfo.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) encInfo.size = 0;
                        if (encInfo.size > 0 && muxerStarted && encOut != null) {
                            encOut.position(encInfo.offset);
                            encOut.limit(encInfo.offset + encInfo.size);
                            muxer.writeSampleData(muxAudioTrack, encOut, encInfo);
                        }
                        encoder.releaseOutputBuffer(encOutIdx, false);
                        if ((encInfo.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) { encoderOutDone = true; break; }
                    }
                }
            }
        } finally {
            try { if (decoder != null) { decoder.stop(); decoder.release(); } } catch (Exception ignored) {}
            try { if (encoder != null) { encoder.stop(); encoder.release(); } } catch (Exception ignored) {}
            try { if (muxer != null) { muxer.stop(); muxer.release(); } } catch (Exception ignored) {}
            try { ex.release(); } catch (Exception ignored) {}
        }
    }

    private static void drainEncoder(MediaCodec encoder, MediaMuxer muxer, MediaCodec.BufferInfo info, int[] track, boolean[] started) {
        int idx = encoder.dequeueOutputBuffer(info, 0);
        if (idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
            if (!started[0]) { track[0] = muxer.addTrack(encoder.getOutputFormat()); muxer.start(); started[0] = true; }
        } else if (idx >= 0) {
            ByteBuffer out = encoder.getOutputBuffer(idx);
            if ((info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) info.size = 0;
            if (info.size > 0 && started[0] && out != null) {
                out.position(info.offset); out.limit(info.offset + info.size);
                muxer.writeSampleData(track[0], out, info);
            }
            encoder.releaseOutputBuffer(idx, false);
        }
    }

    /** 视频轨 + 音频轨（仅样本复制）→ 最终 MP4。 */
    private static void remux(String videoPath, String audioPath, String outPath) throws Exception {
        MediaExtractor vEx = new MediaExtractor();
        MediaExtractor aEx = new MediaExtractor();
        MediaMuxer muxer = null;
        try {
            vEx.setDataSource(videoPath);
            aEx.setDataSource(audioPath);
            int vTrack = findTrack(vEx, "video/");
            int aTrack = findTrack(aEx, "audio/");
            if (vTrack < 0) throw new Exception("无视频轨");
            if (aTrack < 0) throw new Exception("无音频轨");
            vEx.selectTrack(vTrack);
            aEx.selectTrack(aTrack);

            muxer = new MediaMuxer(outPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            int outV = muxer.addTrack(vEx.getTrackFormat(vTrack));
            int outA = muxer.addTrack(aEx.getTrackFormat(aTrack));
            muxer.start();

            ByteBuffer buf = ByteBuffer.allocate(1 * 1024 * 1024);
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            copyTrack(vEx, muxer, outV, buf, info);
            copyTrack(aEx, muxer, outA, buf, info);
        } finally {
            try { if (muxer != null) { muxer.stop(); muxer.release(); } } catch (Exception ignored) {}
            try { vEx.release(); } catch (Exception ignored) {}
            try { aEx.release(); } catch (Exception ignored) {}
        }
    }

    private static int findTrack(MediaExtractor ex, String prefix) {
        for (int i = 0; i < ex.getTrackCount(); i++) {
            String mime = ex.getTrackFormat(i).getString(MediaFormat.KEY_MIME);
            if (mime != null && mime.startsWith(prefix)) return i;
        }
        return -1;
    }

    private static void copyTrack(MediaExtractor ex, MediaMuxer muxer, int outTrack, ByteBuffer buf, MediaCodec.BufferInfo info) {
        while (true) {
            int sz = ex.readSampleData(buf, 0);
            if (sz < 0) break;
            info.offset = 0;
            info.size = sz;
            info.presentationTimeUs = ex.getSampleTime();
            info.flags = sampleFlagsToBufferFlags(ex.getSampleFlags());
            muxer.writeSampleData(outTrack, buf, info);
            ex.advance();
        }
    }

    private static int sampleFlagsToBufferFlags(int sampleFlags) {
        int f = 0;
        if ((sampleFlags & MediaExtractor.SAMPLE_FLAG_SYNC) != 0) f |= MediaCodec.BUFFER_FLAG_KEY_FRAME;
        return f;
    }
}
