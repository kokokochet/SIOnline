/** Media types that can be compressed. HTML is excluded (text-only). */
export type CompressibleMediaType = 'image' | 'audio' | 'video';

/** Options for image compression via canvas + toBlob. */
export interface ImageCompressionOptions {
    /** Maximum dimension (width or height) in pixels. */
    maxDimension: number;
    /** JPEG quality, 0–1. */
    quality: number;
    /** Output MIME type. */
    mimeType: string;
}

/** Options for audio compression via WebCodecs AudioEncoder. */
export interface AudioCompressionOptions {
    /** Target bitrate in bits per second. */
    bitrate: number;
    /** WebCodecs codec string (e.g. 'opus'). */
    codec: string;
    /** Output sample rate (Opus requires 48000). */
    sampleRate: number;
    /** Number of audio channels (1 or 2 only — OGG Opus mapping family 0). */
    channels: number;
}

/** Options for video compression via WebCodecs VideoEncoder. */
export interface VideoCompressionOptions {
    /** Maximum height in pixels. Width scales proportionally. */
    maxHeight: number;
    /** Target bitrate in bits per second. */
    bitrate: number;
    /** WebCodecs codec string (e.g. 'avc1.64001F' for H.264 High 3.1). */
    codec: string;
    /** Target frame rate. */
    framerate: number;
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

/** Message from main thread to a video compression worker. */
export interface WorkerCompressRequest {
    data: ArrayBuffer;
    options: VideoCompressionOptions;
}

/** Message from a compression worker to main thread. */
export interface WorkerCompressResponse {
    type: 'done' | 'error';
    data?: ArrayBuffer;
    error?: string;
}
