import { CompressibleMediaType, CompressedMedia, CompressionOptions } from './compressionTypes';
import { compressImage } from './compressImage';
import { compressVideo } from './compressVideo';
import { compressAudio } from './compressAudio';
import { passthroughFromFile } from './passthrough';

export { resolveCompressionOptions } from './compressionPresets';
export {
    isVideoCompressionSupported,
    isAudioCompressionSupported,
} from './featureDetection';
/** Caps media size to bound peak decode memory (upload and bulk compression). */
export const MAX_MEDIA_BYTES = 200 * 1024 * 1024;

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
    // HTML must stay byte-exact: re-encoding via text() would strip a BOM and mangle windows-1251/UTF-16 bytes.
    if (type === 'html') {
        return passthroughFromFile(file);
    }

    switch (type) {
        case 'image':
            return compressImage(file, options.image, signal);

        case 'audio':
            return compressAudio(file, options.audio, signal);

        case 'video':
            return compressVideo(file, options.video, signal);
    }
}
