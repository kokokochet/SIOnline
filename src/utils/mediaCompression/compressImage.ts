import { CompressedMedia, ImageCompressionOptions } from './compressionTypes';
import { passthroughMedia } from './passthrough';

/** Maximum pixel count allowed for decoded images (≈8192×4096). Prevents decompression-bomb OOM. */
const MAX_IMAGE_PIXELS = 33_177_600;

export function calculateTargetDimensions(
    width: number,
    height: number,
    maxDimension: number,
): { width: number; height: number } {
    if (width <= maxDimension && height <= maxDimension) {
        return { width, height };
    }

    if (width >= height) {
        return {
            width: maxDimension,
            height: Math.round((height / width) * maxDimension),
        };
    }

    return {
        width: Math.round((width / height) * maxDimension),
        height: maxDimension,
    };
}

export async function compressImage(
    file: File,
    options: ImageCompressionOptions,
): Promise<CompressedMedia> {
    const originalData = new Uint8Array(await file.arrayBuffer());

    try {
        // GIF passthrough: JPEG conversion destroys animation.
        if (file.name.toLowerCase().endsWith('.gif')) {
            return passthroughMedia(originalData, file.name);
        }

        const bitmap = await createImageBitmap(file);
        let bitmapClosed = false;

        try {
            // Decompression-bomb guard: reject crafted images with excessive pixel counts.
            if (bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) {
                return passthroughMedia(originalData, file.name);
            }

            const { width: targetWidth, height: targetHeight } = calculateTargetDimensions(
                bitmap.width,
                bitmap.height,
                options.maxDimension,
            );

            const canvas = document.createElement('canvas');
            canvas.width = targetWidth;
            canvas.height = targetHeight;

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                return passthroughMedia(originalData, file.name);
            }

            // Fill white to preserve PNG alpha on JPEG output (avoids black background).
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, targetWidth, targetHeight);

            ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
            bitmap.close();
            bitmapClosed = true;

            const blob = await new Promise<Blob | null>((resolve) => {
                canvas.toBlob(resolve, options.mimeType, options.quality);
            });

            if (!blob) {
                return passthroughMedia(originalData, file.name);
            }

            const compressedData = new Uint8Array(await blob.arrayBuffer());

            // Reject empty or larger-than-original output.
            if (compressedData.length === 0 || compressedData.length >= originalData.length) {
                return passthroughMedia(originalData, file.name);
            }

            const baseName = file.name.replace(/\.[^.]+$/, '');
            const newFileName = `${baseName}.jpg`;

            return {
                data: compressedData,
                fileName: newFileName,
                originalSize: originalData.length,
                compressedSize: compressedData.length,
                wasCompressed: true,
            };
        } finally {
            if (!bitmapClosed) {
                bitmap.close();
            }
        }
    } catch (err) {
        console.warn('Image compression failed, using original:', err);
        return passthroughMedia(originalData, file.name);
    }
}
