/** Media types that can be compressed. HTML is excluded (text-only). */
export type CompressibleMediaType = 'image' | 'audio' | 'video';

/** Quality preset for media compression. */
export type CompressionPreset = 'low' | 'medium' | 'high';

/** Per-media-type preset selection (image / audio / video). */
export type MediaCompressionPresets = Record<CompressibleMediaType, CompressionPreset>;

/** Options for image compression via canvas + toBlob. */
export interface ImageCompressionOptions {
    /** Maximum dimension (width or height) in pixels. */
    maxDimension: number;
    /** JPEG quality, 0–1. */
    quality: number;
    /** Output MIME type. */
    mimeType: string;
    /**
     * When true, skip the lossy canvas re-encode and return the file unchanged.
     * Preserves ICC profiles, bit depth, and wide gamut that canvas would clip
     * to 8-bit sRGB.
     */
    lossless?: boolean;
}

/** Options for audio compression; output is OGG/Opus via Mediabunny. */
export interface AudioCompressionOptions {
    /** Target bitrate in bits per second. */
    bitrate: number;
    /** Output codec name (e.g. 'opus'). See Mediabunny's `AudioCodec`. */
    codec: string;
    /** Number of audio channels (1 or 2 only — OGG Opus mapping family 0). */
    channels: 1 | 2;
}

/** Options for video compression; output is MP4/AVC via Mediabunny. */
export interface VideoCompressionOptions {
    /** Maximum height in pixels. Width scales proportionally (fit: 'contain'). */
    maxHeight: number;
    /** Target bitrate in bits per second. */
    bitrate: number;
    /** Base video codec name (e.g. 'avc' for H.264). Profile/level is auto-selected. */
    codec: string;
}

/** Combined options for all media types. */
export interface CompressionOptions {
    image: ImageCompressionOptions;
    audio: AudioCompressionOptions;
    video: VideoCompressionOptions;
}

/** Result of a compression operation. */
export interface CompressedMedia {
    /** Compressed file data as binary. */
    data: Uint8Array;
    /** Output filename (may differ from input — e.g. `.png` → `.jpg`). */
    fileName: string;
    /** Original file size in bytes. */
    originalSize: number;
    /** Compressed file size in bytes. */
    compressedSize: number;
    /** Whether compression actually occurred (false = passthrough). */
    wasCompressed: boolean;
}
