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

/** Options for audio compression via WebCodecs AudioEncoder. */
export interface AudioCompressionOptions {
    /** Target bitrate in bits per second. */
    bitrate: number;
    /** WebCodecs codec string (e.g. 'opus'). */
    codec: string;
    /** Number of audio channels (1 or 2 only — OGG Opus mapping family 0). */
    channels: 1 | 2;
}

/** Options for video compression via WebCodecs VideoEncoder. */
export interface VideoCompressionOptions {
    /** Maximum height in pixels. Width scales proportionally. */
    maxHeight: number;
    /** Target bitrate in bits per second. */
    bitrate: number;
    /** WebCodecs codec string (e.g. 'avc1.64001F' for H.264 High 3.1). */
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

/** Message from the main thread to a video compression worker. */
export interface WorkerCompressRequest {
    data: ArrayBuffer;
    options: VideoCompressionOptions;
}

/** Message from the main thread to abort an in-flight compression. */
export type WorkerAbortMessage = { type: 'abort' };

/**
 * Message from a video compression worker to main thread.
 * The error variant carries `name` (programmatic, e.g. NotSupportedError) so
 * callers/telemetry can triage without parsing locale-dependent `error` text.
 */
export type WorkerCompressResponse =
    | { type: 'done'; data: ArrayBuffer }
    | { type: 'error'; name: string; error: string }
    | { type: 'cancelled' };

/**
 * Message from main thread to audio worker — raw encoded bytes.
 *
 * Decoding (decodeAudioData) runs INSIDE the worker to keep multi-hundred-MB
 * PCM off the main thread. The worker probes OfflineAudioContext / AudioContext
 * availability and throws if neither exists (caller surfaces as passthrough).
 */
export interface AudioWorkerRequest {
    /** Raw encoded audio bytes (MP3, WAV, OGG, …). Worker decodes via decodeAudioData. */
    data: ArrayBuffer;
    options: AudioCompressionOptions;
}

/** Message from an audio worker to main thread. */
export type AudioWorkerResponse =
    | { type: 'done'; data: ArrayBuffer }
    | { type: 'error'; name: string; error: string }
    | { type: 'cancelled' };
