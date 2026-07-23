import { CompressedMedia, ImageCompressionOptions } from './compressionTypes';
import { passthroughMedia } from './passthrough';
import { detectImageFormat, hasAlphaChannel, isAnimated, getPngBitDepth } from './imageFormatDetect';

/** Maximum pixel count allowed for decoded images (7680×4320 = 33_177_600, just under 8K UHD). Prevents decompression-bomb OOM. */
const MAX_IMAGE_PIXELS = 33_177_600;

export function calculateTargetDimensions(
    width: number,
    height: number,
    maxDimension: number,
): { width: number; height: number } | null {
    if (width <= 0 || height <= 0 || maxDimension <= 0) {
        return null;
    }

    let targetWidth: number;
    let targetHeight: number;

    if (width <= maxDimension && height <= maxDimension) {
        targetWidth = width;
        targetHeight = height;
    } else if (width >= height) {
        targetWidth = maxDimension;
        targetHeight = Math.round((height / width) * maxDimension);
    } else {
        targetWidth = Math.round((width / height) * maxDimension);
        targetHeight = maxDimension;
    }

    // Rounding can collapse a near-zero aspect ratio to 0 → refuse to encode.
    if (targetWidth <= 0 || targetHeight <= 0) {
        return null;
    }

    return { width: targetWidth, height: targetHeight };
}

/**
 * Reads pixel dimensions from a compressed image's raw bytes WITHOUT decoding
 * it. Supports PNG (IHDR chunk) and JPEG (SOF markers). Used as a
 * decompression-bomb pre-check: a crafted 40000x40000 PNG would otherwise be
 * fully decoded (~6.4 GB raster) before the MAX_IMAGE_PIXELS guard runs.
 *
 * Returns null for unrecognized or truncated inputs — callers treat null as
 * "cannot pre-screen" and fall through to the post-decode guard.
 */
export function parseImageDimensions(data: Uint8Array): { width: number; height: number } | null {
    // PNG: 8-byte signature, then first chunk is always IHDR (13 bytes payload).
    // Width and height are big-endian u32 at byte offsets 16 and 20.
    if (
        data.length >= 24 &&
        data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47 &&
        data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a
    ) {
        const width = (data[16] * 0x1000000) + (data[17] << 16) + (data[18] << 8) + data[19];
        const height = (data[20] * 0x1000000) + (data[21] << 16) + (data[22] << 8) + data[23];
        return { width: width >>> 0, height: height >>> 0 };
    }

    // JPEG: scan markers. SOI (FFD8) then a sequence of segments; the SOFn
    // segment carries height (u16 BE) then width (u16 BE) right after precision.
    if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
        let offset = 2;
        while (offset + 8 < data.length) {
            if (data[offset] !== 0xff) {
                return null;
            }
            // Fill byte FF can precede a marker; skip it.
            let marker = data[offset + 1];
            while (marker === 0xff && offset + 2 < data.length) {
                offset += 1;
                marker = data[offset + 1];
            }
            // SOF markers (baseline + progressive + lossless): C0-C3, C5-C7, C9-CB, CD-CF.
            const isSof =
                (marker >= 0xc0 && marker <= 0xc3) ||
                (marker >= 0xc5 && marker <= 0xc7) ||
                (marker >= 0xc9 && marker <= 0xcb) ||
                (marker >= 0xcd && marker <= 0xcf);
            if (isSof) {
                // Layout: FF<marker> <lenHi> <lenLo> <precision> <heightHi> <heightLo> <widthHi> <widthLo>
                const height = (data[offset + 5] << 8) | data[offset + 6];
                const width = (data[offset + 7] << 8) | data[offset + 8];
                return { width: width >>> 0, height: height >>> 0 };
            }
            // Standalone markers (no length payload): SOI, EOI, RSTn.
            if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
                offset += 2;
                continue;
            }
            // All other markers carry a 2-byte length (including the length bytes).
            if (offset + 3 >= data.length) {
                return null;
            }
            const segLength = (data[offset + 2] << 8) | data[offset + 3];
            offset += 2 + segLength;
        }
    }

    return null;
}

export async function compressImage(
    file: File,
    options: ImageCompressionOptions,
    signal?: AbortSignal,
): Promise<CompressedMedia> {
    if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }

    const originalData = new Uint8Array(await file.arrayBuffer());

    try {
        const format = detectImageFormat(originalData);

        // Canvas re-encode clips to 8-bit sRGB and strips ICC. Pass through
        // when explicitly lossless or for 16-bit PNG (canvas would clip it).
        if (options.lossless || (format === 'png' && (getPngBitDepth(originalData) ?? 0) > 8)) {
            return passthroughMedia(originalData, file.name);
        }

        // Animation / format passthrough (content-based, not filename):
        //  - GIF: always pass through (preserves frames).
        //  - SVG/SVGZ: canvas rasterizes vectors to lossy JPEG.
        //  - Animated WebP (ANIM chunk) / APNG (acTL chunk): JPEG keeps only frame 1.
        if (format === 'gif' || format === 'svg' || isAnimated(originalData, format)) {
            return passthroughMedia(originalData, file.name);
        }

        // Decompression-bomb guard (pre-decode): reject oversized images before
        // createImageBitmap allocates the full raster.
        const probed = parseImageDimensions(originalData);
        if (probed !== null && probed.width * probed.height > MAX_IMAGE_PIXELS) {
            return passthroughMedia(originalData, file.name);
        }

        // imageOrientation:'from-image' honors EXIF orientation (portrait phone photos).
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        let bitmapClosed = false;

        try {
            // Post-decode guard: fallback for formats the prober couldn't parse.
            if (bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) {
                return passthroughMedia(originalData, file.name);
            }

            const target = calculateTargetDimensions(
                bitmap.width,
                bitmap.height,
                options.maxDimension,
            );
            if (!target) {
                return passthroughMedia(originalData, file.name);
            }
            const { width: targetWidth, height: targetHeight } = target;

            const canvas = document.createElement('canvas');
            canvas.width = targetWidth;
            canvas.height = targetHeight;

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                return passthroughMedia(originalData, file.name);
            }

            const hasAlpha = hasAlphaChannel(originalData, format);
            const effectiveMime = hasAlpha ? 'image/png' : options.mimeType;

            // White-fill only when flattening to JPEG; preserve transparency for PNG.
            if (!hasAlpha) {
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, targetWidth, targetHeight);
            }

            ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
            bitmap.close();
            bitmapClosed = true;

            const blob = await new Promise<Blob | null>((resolve) => {
                canvas.toBlob(resolve, effectiveMime, options.quality);
            });

            if (!blob) {
                return passthroughMedia(originalData, file.name);
            }

            const compressedData = new Uint8Array(await blob.arrayBuffer());

            // >= also rejects equal-size output (no shrink).
            if (compressedData.length === 0 || compressedData.length >= originalData.length) {
                return passthroughMedia(originalData, file.name);
            }

            const baseName = file.name.replace(/\.[^.]+$/, '');
            const extension = hasAlpha ? '.png' : '.jpg';
            const newFileName = `${baseName}${extension}`;

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
        if ((err as Error)?.name === 'AbortError') {
            throw err;
        }
        console.warn('Image compression failed, using original:', err);
        return passthroughMedia(originalData, file.name);
    }
}
