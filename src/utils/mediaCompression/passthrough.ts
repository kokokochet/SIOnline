import { CompressedMedia } from './compressionTypes';

export function passthroughMedia(data: Uint8Array, fileName: string): CompressedMedia {
    return {
        data,
        fileName,
        originalSize: data.length,
        compressedSize: data.length,
        wasCompressed: false,
    };
}

/** Reads the file lazily — only into memory when we actually fall through to passthrough. */
export async function passthroughFromFile(file: File): Promise<CompressedMedia> {
    const data = new Uint8Array(await file.arrayBuffer());
    return passthroughMedia(data, file.name);
}
