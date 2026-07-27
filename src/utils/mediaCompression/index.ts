import { CompressibleMediaType, CompressedMedia, CompressionOptions } from './compressionTypes';
import { compressImage } from './compressImage';
import { passthroughFromFile } from './passthrough';

export { resolveCompressionOptions } from './compressionPresets';
/** Caps media size to bound peak decode memory (media compression). */
export const MAX_MEDIA_BYTES = 200 * 1024 * 1024;

/**
 * Compresses images; all other types (HTML, and defensively audio/video)
 * pass through untouched. Returns the original when output isn't smaller.
 */
export async function compressMedia(
    file: File,
    type: CompressibleMediaType | 'html',
    options: CompressionOptions,
    signal?: AbortSignal,
): Promise<CompressedMedia> {
    if (type === 'image') {
        return compressImage(file, options.image, signal);
    }

    // HTML must stay byte-exact: re-encoding via text() would strip a BOM and mangle windows-1251/UTF-16 bytes.
    return passthroughFromFile(file);
}
