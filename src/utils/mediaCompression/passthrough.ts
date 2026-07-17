import { CompressedMedia } from './compressionTypes';

/**
 * Creates a passthrough result — the original file returned unchanged.
 * Used when compression is unsupported, fails, or produces a larger output.
 */
export function passthroughMedia(data: Uint8Array, fileName: string): CompressedMedia {
    return {
        data,
        fileName,
        originalSize: data.length,
        compressedSize: data.length,
        wasCompressed: false,
    };
}
