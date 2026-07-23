import { Input, Output, BufferTarget, BlobSource, Mp4OutputFormat, Conversion, MP4, WEBM, QTFF } from 'mediabunny';
import type { VideoCodec } from 'mediabunny';
import { CompressedMedia, VideoCompressionOptions } from './compressionTypes';
import { isVideoCompressionSupported } from './featureDetection';
import { passthroughFromFile } from './passthrough';
import { runConversion } from './conversionRun';

/**
 * Compresses a video file by transcoding it with Mediabunny's high-level
 * `Conversion` API: the input (MP4/WebM/MOV) is decoded, the video is resized
 * to fit within `options.maxHeight` and re-encoded as AVC at `options.bitrate`,
 * and the result is re-muxed into an MP4 (Fast Start). Decode/encode, frame
 * timing, B-frames and backpressure are all handled by Mediabunny.
 *
 * Audio is normalized to AAC where possible. To avoid silently producing a
 * muted clip, if the input carried audio that could not be carried over, the
 * original file is returned unchanged.
 *
 * Progressive enhancement: when WebCodecs (`VideoEncoder`) is unavailable, the
 * conversion is invalid, or the output is not smaller than the input, the
 * original file is returned unchanged. `AbortSignal` aborts the conversion.
 */
export async function compressVideo(
    file: File,
    options: VideoCompressionOptions,
    signal?: AbortSignal,
): Promise<CompressedMedia> {
    if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }

    if (!isVideoCompressionSupported()) {
        return passthroughFromFile(file);
    }

    const target = new BufferTarget();
    const output = new Output({
        format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
        target,
    });
    const input = new Input({
        formats: [MP4, WEBM, QTFF],
        source: new BlobSource(file),
    });

    const conversion = await Conversion.init({
        input,
        output,
        video: {
            height: options.maxHeight,
            fit: 'contain',
            codec: options.codec as VideoCodec,
            bitrate: options.bitrate,
        },
        audio: {
            codec: 'aac',
        },
        showWarnings: false,
    });

    // Never silently mute: if the source had audio that couldn't be carried
    // (undecodable codec / no AAC encoder available), keep the original file.
    const audioDropped = conversion.discardedTracks.some((d) => d.track.type === 'audio');
    if (!conversion.isValid || audioDropped) {
        return passthroughFromFile(file);
    }

    await runConversion(conversion, signal);

    const { buffer } = target;
    if (!buffer || buffer.byteLength === 0 || buffer.byteLength >= file.size) {
        return passthroughFromFile(file);
    }

    const data = new Uint8Array(buffer);
    return {
        data,
        fileName: file.name,
        originalSize: file.size,
        compressedSize: data.length,
        wasCompressed: true,
    };
}
