/** Compressible media (HTML excluded — text-only). */
export type CompressibleMediaType = 'image' | 'audio' | 'video';

export type CompressionPreset = 'low' | 'medium' | 'high';

export type MediaCompressionPresets = Record<CompressibleMediaType, CompressionPreset>;

export interface ImageCompressionOptions {
    /** Maximum dimension (width or height) in pixels. */
    maxDimension: number;
    quality: number;
    mimeType: string;
    /** Skip lossy re-encode; preserves ICC/bit depth/wide gamut (canvas clips to 8-bit sRGB). */
    lossless?: boolean;
}

/** OGG/Opus via Mediabunny. */
export interface AudioCompressionOptions {
    /** Target bitrate in bits per second. */
    bitrate: number;
    /** Codec name (e.g. 'opus'); see Mediabunny's `AudioCodec`. */
    codec: string;
    /** OGG Opus mapping family 0. */
    channels: 1 | 2;
}

/** MP4/AVC via Mediabunny. */
export interface VideoCompressionOptions {
    /** Maximum height in pixels. Width scales proportionally (fit: 'contain'). */
    maxHeight: number;
    /** Target bitrate in bits per second. */
    bitrate: number;
    /** Base video codec (e.g. 'avc' for H.264); profile/level auto-selected. */
    codec: string;
}

export interface CompressionOptions {
    image: ImageCompressionOptions;
    audio: AudioCompressionOptions;
    video: VideoCompressionOptions;
}

export interface CompressedMedia {
    data: Uint8Array;
    /** Output filename (may differ from input — e.g. `.png` → `.jpg`). */
    fileName: string;
    originalSize: number;
    compressedSize: number;
    wasCompressed: boolean;
}
