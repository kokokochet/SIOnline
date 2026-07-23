import { Input, Output, BufferTarget, BlobSource, Mp4OutputFormat, Conversion, MP4, WEBM, QTFF } from 'mediabunny';
import type { VideoCodec } from 'mediabunny';
import { CompressedMedia, VideoCompressionOptions } from './compressionTypes';
import { isVideoCompressionSupported } from './featureDetection';
import { passthroughFromFile } from './passthrough';
import { runConversion } from './conversionRun';

/**
 * Transcodes video to AVC MP4 via Mediabunny, resizing to fit options.maxHeight.
 * Never silently mutes: if source audio can't be carried over, returns original.
 * Progressive enhancement: returns original when WebCodecs is unavailable,
 * the conversion is invalid, or the output isn't smaller than the input.
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

    // Never silently mute: keep original if source audio couldn't be carried over.
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
