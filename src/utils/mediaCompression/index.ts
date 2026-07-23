import { CompressibleMediaType, CompressedMedia, CompressionOptions } from './compressionTypes';
import { compressImage } from './compressImage';
import { compressVideo } from './compressVideo';
import { compressAudio } from './compressAudio';

export { defaultCompressionOptions } from './defaultOptions';
export { probeMedia } from './probeMedia';
export type { MediaProbeResult } from './probeMedia';
export {
    lowPreset,
    mediumPreset,
    highPreset,
    compressionPresets,
    resolveCompressionOptions,
} from './compressionPresets';
export {
    isVideoCompressionSupported,
    isAudioCompressionSupported,
} from './featureDetection';
export { MAX_MEDIA_BYTES } from './limits';
export type {
    CompressibleMediaType,
    CompressedMedia,
    CompressionOptions,
    CompressionPreset,
    MediaCompressionPresets,
    ImageCompressionOptions,
    AudioCompressionOptions,
    VideoCompressionOptions,
} from './compressionTypes';
export { getCompressionDoneSummaryKey, formatSavedBytes } from './compressionI18n';

async function passthrough(file: File): Promise<CompressedMedia> {
    const data = new Uint8Array(await file.arrayBuffer());
    return {
        data,
        fileName: file.name,
        originalSize: data.length,
        compressedSize: data.length,
        wasCompressed: false,
    };
}

/**
 * Compresses image/audio/video; HTML and unknown types pass through.
 * Returns the original when the encoder is unavailable or output isn't smaller.
 */
export async function compressMedia(
    file: File,
    type: CompressibleMediaType | 'html',
    options: CompressionOptions,
    signal?: AbortSignal,
): Promise<CompressedMedia> {
    if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }

    // HTML must stay byte-exact: re-encoding via text() would strip a BOM and mangle windows-1251/UTF-16 bytes.
    if (type === 'html') {
        return passthrough(file);
    }

    switch (type) {
        case 'image':
            return compressImage(file, options.image, signal);

        case 'audio':
            return compressAudio(file, options.audio, signal);

        case 'video':
            return compressVideo(file, options.video, signal);

        default:
            return passthrough(file);
    }
}
