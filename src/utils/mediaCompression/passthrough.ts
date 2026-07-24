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

export async function passthroughFromFile(file: File): Promise<CompressedMedia> {
    const data = new Uint8Array(await file.arrayBuffer());
    return passthroughMedia(data, file.name);
}
