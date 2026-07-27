/** Compressible media (HTML excluded — text-only). */
export type CompressibleMediaType = 'image' | 'audio' | 'video';

export type CompressionPreset = 'low' | 'medium' | 'high';

/** Per-type compression presets. Image-only — audio/video pass through unchanged. */
export type MediaCompressionPresets = { image: CompressionPreset };

export interface ImageCompressionOptions {
    /** Maximum dimension (width or height) in pixels. */
    maxDimension: number;
    quality: number;
    mimeType: string;
    /** Skip lossy re-encode; preserves ICC/bit depth/wide gamut (canvas clips to 8-bit sRGB). */
    lossless?: boolean;
}

export interface CompressionOptions {
    image: ImageCompressionOptions;
}

export interface CompressedMedia {
    data: Uint8Array;
    /** Output filename (may differ from input — e.g. `.png` → `.jpg`). */
    fileName: string;
    originalSize: number;
    compressedSize: number;
    wasCompressed: boolean;
}
