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
export { UnsupportedAudioCodecError, assertAudioMp4Compatible } from './audioCodecSupport';
export { OGGSegmentTableOverflowError } from './oggOpusMuxer';
export { MAX_MEDIA_BYTES, MAX_DECODED_AUDIO_BYTES } from './limits';
export { formatWorkerError, namedError, buildErrorResponse } from './workerErrors';
export type { WorkerErrorInfo, WorkerErrorResponse } from './workerErrors';
export { WorkerValidationError, validateAudioWorkerMessage, validateVideoWorkerMessage } from './workerInputValidation';
export { configureWithCleanup } from './configureWithCleanup';
export type { ConfigureWithCleanupArgs } from './configureWithCleanup';
export { validateAvcLevel } from './avcLevelValidation';
export type { AvcLevelCheck } from './avcLevelValidation';
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

/**
 * Creates a passthrough result — the original file returned unchanged.
 * Used for unknown media types or as a fallback.
 */
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
 * Compresses a media file with lossy compression.
 *
 * - Images: canvas + toBlob → JPEG — works everywhere
 * - Video: WebCodecs VideoEncoder → H.264 MP4 — Chrome/Edge only
 * - Audio: WebCodecs AudioEncoder → Opus in OGG — Chrome/Edge only
 *
 * Progressive enhancement: when WebCodecs is unavailable (Safari, Tauri-macOS),
 * the file is returned as-is. The editor remains fully functional.
 *
 * Safety check: if the compressed output is larger than the original,
 * the original file is returned unchanged.
 *
 * @param file - The media file to compress
 * @param type - The media type ('image', 'audio', 'video', 'html')
 * @param options - Compression options (typically from `compressionPresets[preset]`)
 * @returns Compressed media data with metadata
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

    // HTML is text-only and must be stored byte-exact: re-encoding via
    // file.text() + TextEncoder would strip a BOM and mangle windows-1251 /
    // UTF-16 bytes (mismatch with the compression-OFF path in ScreensView).
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
