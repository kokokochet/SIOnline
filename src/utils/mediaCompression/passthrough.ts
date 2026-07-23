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

/**
 * Reads a file lazily and returns it unchanged. Used by the audio/video
 * compressors on every non-compressing path (unsupported codec, invalid
 * conversion, output not smaller, aborted). The file is only read into memory
 * when we actually fall through to passthrough.
 */
export async function passthroughFromFile(file: File): Promise<CompressedMedia> {
    const data = new Uint8Array(await file.arrayBuffer());
    return passthroughMedia(data, file.name);
}
