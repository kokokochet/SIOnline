/** Compressible media (HTML excluded — text-only). */
export type CompressibleMediaType = 'image' | 'audio' | 'video';

export type CompressionPreset = 'low' | 'medium' | 'high';

export type MediaCompressionPresets = Record<CompressibleMediaType, CompressionPreset>;

/** Image compression options (canvas + toBlob). */
export interface ImageCompressionOptions {
    /** Maximum dimension (width or height) in pixels. */
    maxDimension: number;
    /** JPEG quality, 0–1. */
    quality: number;
    mimeType: string;
    /** Skip lossy re-encode; preserves ICC/bit depth/wide gamut (canvas clips to 8-bit sRGB). */
    lossless?: boolean;
}

/** Audio compression options (OGG/Opus via Mediabunny). */
export interface AudioCompressionOptions {
    /** Target bitrate in bits per second. */
    bitrate: number;
    /** Codec name (e.g. 'opus'); see Mediabunny's `AudioCodec`. */
    codec: string;
    /** Number of audio channels (1 or 2 only — OGG Opus mapping family 0). */
    channels: 1 | 2;
}

/** Video compression options (MP4/AVC via Mediabunny). */
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
    /** Whether compression actually occurred (false = passthrough). */
    wasCompressed: boolean;
}
