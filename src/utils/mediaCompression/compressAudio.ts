import { Input, Output, BufferTarget, BlobSource, OggOutputFormat, Conversion, MP3, WAVE, OGG, MP4, WEBM, FLAC } from 'mediabunny';
import type { AudioCodec } from 'mediabunny';
import { CompressedMedia, AudioCompressionOptions } from './compressionTypes';
import { isAudioCompressionSupported } from './featureDetection';
import { passthroughFromFile } from './passthrough';
import { runConversion } from './conversionRun';

/**
 * Compresses an audio file by transcoding it to OGG/Opus via Mediabunny's
 * high-level `Conversion` API. The input (MP3/WAV/OGG/MP4/WebM/FLAC) is
 * decoded, resampled/remixed to 48 kHz / `options.channels`, re-encoded as
 * Opus at `options.bitrate`, and muxed into an OGG container (`.opus`).
 * Decode/encode, resampling and backpressure are all handled by Mediabunny —
 * this replaces the former hand-rolled `AudioEncoder` loop and the custom
 * 250-line OGG/Opus muxer.
 *
 * Progressive enhancement: when WebCodecs (`AudioEncoder`) is unavailable, the
 * conversion is invalid, or the output is not smaller than the input, the
 * original file is returned unchanged. `AbortSignal` aborts the conversion.
 */
export async function compressAudio(
    file: File,
    options: AudioCompressionOptions,
    signal?: AbortSignal,
): Promise<CompressedMedia> {
    if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }

    if (!isAudioCompressionSupported()) {
        return passthroughFromFile(file);
    }

    const target = new BufferTarget();
    const output = new Output({
        format: new OggOutputFormat(),
        target,
    });
    const input = new Input({
        formats: [MP3, WAVE, OGG, MP4, WEBM, FLAC],
        source: new BlobSource(file),
    });

    const conversion = await Conversion.init({
        input,
        output,
        audio: {
            codec: options.codec as AudioCodec,
            bitrate: options.bitrate,
            numberOfChannels: options.channels,
            sampleRate: 48000,
        },
        showWarnings: false,
    });

    if (!conversion.isValid) {
        return passthroughFromFile(file);
    }

    await runConversion(conversion, signal);

    const buffer = target.buffer;
    if (!buffer || buffer.byteLength === 0 || buffer.byteLength >= file.size) {
        return passthroughFromFile(file);
    }

    const data = new Uint8Array(buffer);
    const baseName = file.name.replace(/\.[^.]+$/, '');
    return {
        data,
        fileName: `${baseName}.opus`,
        originalSize: file.size,
        compressedSize: data.length,
        wasCompressed: true,
    };
}
