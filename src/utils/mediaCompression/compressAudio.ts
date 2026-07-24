import { Input, Output, BufferTarget, BlobSource, OggOutputFormat, Conversion, MP3, WAVE, OGG, MP4, WEBM, FLAC } from 'mediabunny';
import type { AudioCodec } from 'mediabunny';
import { CompressedMedia, AudioCompressionOptions } from './compressionTypes';
import { isAudioCompressionSupported } from './featureDetection';
import { passthroughFromFile } from './passthrough';
import { runConversion, throwIfAborted, buildCompressedMedia } from './conversionRun';

/**
 * Transcodes audio to OGG/Opus via Mediabunny at 48 kHz / options.channels.
 * Progressive enhancement: returns the original when WebCodecs is unavailable,
 * the conversion is invalid, or the output isn't smaller than the input.
 */
export async function compressAudio(
    file: File,
    options: AudioCompressionOptions,
    signal?: AbortSignal,
): Promise<CompressedMedia> {
    throwIfAborted(signal);

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

    const baseName = file.name.replace(/\.[^.]+$/, '');
    return buildCompressedMedia(target, `${baseName}.opus`, file.size) ?? passthroughFromFile(file);
}
