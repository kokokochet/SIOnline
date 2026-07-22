// src/utils/mediaCompression/imageFormatDetect.ts
/**
 * Byte-level image format detection for the compression pipeline.
 *
 * Canvas re-encode (JPEG) destroys PNG/WebP alpha channels and is the wrong
 * choice for transparent imagery. These pure helpers sniff the leading bytes
 * of a file to decide format and alpha presence *without* paying for a full
 * decode. They are siblings of the dimension probe introduced by Plan 01
 * (CRITICAL C4) and intentionally self-contained so this plan lands cleanly.
 *
 * `svg` is part of the format union for forward use (T36 wires detection).
 */

export type DetectedImageFormat = 'gif' | 'png' | 'jpeg' | 'webp' | 'svg' | 'unknown';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF_SIGNATURE_87A = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]; // "GIF87a"
const GIF_SIGNATURE_89A = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]; // "GIF89a"

// PNG IHDR color types that carry an alpha channel.
//   0 = gray, 2 = RGB, 3 = palette, 4 = gray+alpha, 6 = RGBA.
// Palette (3) MAY carry tRNS transparency; treated as opaque here since the
// JPEG white-fill is acceptable for it and tRNS is rare in photos.
const PNG_COLOR_TYPE_GRAY_ALPHA = 4;
const PNG_COLOR_TYPE_RGBA = 6;

function bytesStartWith(data: Uint8Array, signature: readonly number[]): boolean {
    if (data.length < signature.length) {
        return false;
    }
    for (let i = 0; i < signature.length; i += 1) {
        if (data[i] !== signature[i]) {
            return false;
        }
    }
    return true;
}

function readUint32LE(data: Uint8Array, offset: number): number {
    return (
        (data[offset] |
            (data[offset + 1] << 8) |
            (data[offset + 2] << 16) |
            (data[offset + 3] << 24)) >>>
        0
    );
}

/** Detects the image format from leading magic bytes. Pure, allocation-free. */
export function detectImageFormat(data: Uint8Array): DetectedImageFormat {
    if (data.length === 0) {
        return 'unknown';
    }
    if (bytesStartWith(data, PNG_SIGNATURE)) {
        return 'png';
    }
    if (bytesStartWith(data, GIF_SIGNATURE_87A) || bytesStartWith(data, GIF_SIGNATURE_89A)) {
        return 'gif';
    }
    if (data[0] === 0xff && data[1] === 0xd8) {
        return 'jpeg';
    }
    if (
        data.length >= 12 &&
        data[0] === 0x52 && // 'R'
        data[1] === 0x49 && // 'I'
        data[2] === 0x46 && // 'F'
        data[3] === 0x46 && // 'F'
        data[8] === 0x57 && // 'W'
        data[9] === 0x45 && // 'E'
        data[10] === 0x42 && // 'B'
        data[11] === 0x50 // 'P'
    ) {
        return 'webp';
    }
    if (isSvg(data)) {
        return 'svg';
    }
    return 'unknown';
}

/**
 * PNG has an alpha channel when IHDR color type is 4 (gray+alpha) or 6 (RGBA).
 * IHDR color type byte lives at offset 25:
 *   signature(8) + length(4) + "IHDR"(4) + width(4) + height(4) + bitDepth(1).
 */
function pngHasAlpha(data: Uint8Array): boolean {
    const colorTypeOffset = 25;
    if (data.length <= colorTypeOffset) {
        return false;
    }
    const colorType = data[colorTypeOffset];
    return colorType === PNG_COLOR_TYPE_GRAY_ALPHA || colorType === PNG_COLOR_TYPE_RGBA;
}

/**
 * WebP alpha: VP8X extended flags bit 0x10, or VP8L packed alpha bit
 * (5th byte of the VP8L payload, bit 0x10). Walks RIFF chunks.
 */
function webpHasAlpha(data: Uint8Array): boolean {
    let offset = 12; // skip "RIFF"(4) + size(4) + "WEBP"(4)
    while (offset + 8 <= data.length) {
        const type = String.fromCharCode(
            data[offset],
            data[offset + 1],
            data[offset + 2],
            data[offset + 3],
        );
        const size = readUint32LE(data, offset + 4);
        const dataStart = offset + 8;
        if (type === 'VP8X' && dataStart < data.length) {
            return (data[dataStart] & 0x10) !== 0;
        }
        if (type === 'VP8L' && dataStart + 4 < data.length) {
            return (data[dataStart + 4] & 0x10) !== 0;
        }
        // RIFF chunks are padded to even size.
        offset = dataStart + size + (size % 2);
    }
    return false;
}

/**
 * True when the image carries an alpha channel that JPEG re-encode would
 * flatten to white. `compressImage` uses this to switch to PNG output.
 */
export function hasAlphaChannel(
    data: Uint8Array,
    format: DetectedImageFormat = detectImageFormat(data),
): boolean {
    switch (format) {
        case 'png':
            return pngHasAlpha(data);
        case 'webp':
            return webpHasAlpha(data);
        default:
            return false;
    }
}

function readUint32BE(data: Uint8Array, offset: number): number {
    return (
        ((data[offset] << 24) |
            (data[offset + 1] << 16) |
            (data[offset + 2] << 8) |
            data[offset + 3]) >>>
        0
    );
}

/** Walks PNG chunks (skipping the 8-byte signature), invoking onChunk per chunk. */
function forEachPngChunk(
    data: Uint8Array,
    onChunk: (type: string, dataOffset: number, length: number) => boolean | void,
): void {
    let offset = 8; // skip signature
    while (offset + 8 <= data.length) {
        const length = readUint32BE(data, offset);
        const type = String.fromCharCode(
            data[offset + 4],
            data[offset + 5],
            data[offset + 6],
            data[offset + 7],
        );
        const dataOffset = offset + 8;
        if (onChunk(type, dataOffset, length) === false) {
            return;
        }
        offset = dataOffset + length + 4; // +4 trailing CRC
    }
}

/** APNG detection: an `acTL` (animation control) chunk before the first IDAT. */
function apngIsAnimated(data: Uint8Array): boolean {
    let animated = false;
    forEachPngChunk(data, (type) => {
        if (type === 'acTL') {
            animated = true;
            return false; // stop
        }
        if (type === 'IDAT') {
            return false; // acTL always precedes image data; safe to stop
        }
    });
    return animated;
}

/** Animated WebP detection: presence of an `ANIM` chunk. */
function webpIsAnimated(data: Uint8Array): boolean {
    let offset = 12; // skip "RIFF"(4) + size(4) + "WEBP"(4)
    while (offset + 8 <= data.length) {
        const type = String.fromCharCode(
            data[offset],
            data[offset + 1],
            data[offset + 2],
            data[offset + 3],
        );
        const size = readUint32LE(data, offset + 4);
        if (type === 'ANIM') {
            return true;
        }
        offset = offset + 8 + size + (size % 2); // RIFF chunks are even-padded
    }
    return false;
}

/**
 * Heuristic animation detection for formats whose JPEG re-encode would keep
 * only the first frame.
 *
 * - `webp`: `ANIM` chunk present (animated WebP).
 * - `png`: `acTL` chunk present (APNG).
 * - `gif`: returns false — GIF is handled by the caller as a format-level
 *   passthrough (all GIFs pass through), so per-frame detection is unnecessary.
 * - others: false (single-frame).
 */
export function isAnimated(
    data: Uint8Array,
    format: DetectedImageFormat = detectImageFormat(data),
): boolean {
    switch (format) {
        case 'webp':
            return webpIsAnimated(data);
        case 'png':
            return apngIsAnimated(data);
        default:
            return false;
    }
}

const SVG_SNIFF_WINDOW = 1024;

/**
 * True for SVG content: detects the `<svg` tag (optionally after an `<?xml`
 * declaration) in the first 1 KiB, case-insensitive. SVG otherwise rasterizes
 * to a lossy JPEG via canvas — the #img-4 corruption.
 *
 * Also recognizes SVGZ (gzip-compressed SVG): files beginning with the gzip
 * magic bytes `0x1f 0x8b`. SVGZ fails every other signature check in
 * `detectImageFormat` and its UTF-8 decode yields replacement chars, so without
 * this guard it would fall through to `createImageBitmap` — which rasterizes
 * it to a lossy JPEG on browsers that transparently gunzip (the exact #img-4
 * corruption this task prevents). `image/gz` is not a real MIME in practice,
 * so treating any gzip payload in an image slot as SVGZ is an acceptable
 * heuristic; worst case a non-image gzip stream passes through uncompressed
 * (preserves bytes, never corrupts).
 *
 * Uses TextDecoder (global in DOM and Node 18+) — no Node-only `Buffer`.
 */
export function isSvg(data: Uint8Array): boolean {
    // SVGZ: gzip magic bytes. Treat as SVG → passthrough (never rasterize).
    if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
        return true;
    }
    const head = data.length > SVG_SNIFF_WINDOW ? data.subarray(0, SVG_SNIFF_WINDOW) : data;
    const text = new TextDecoder('utf-8').decode(head);
    return /<svg[\s>]/i.test(text);
}
