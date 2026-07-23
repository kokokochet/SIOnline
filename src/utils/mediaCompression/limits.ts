/** Shared safety caps and timeouts for the media-compression pipeline. */

/** Hard cap applied to all media processing (upload and bulk compression), bounding peak decode memory. */
export const MAX_MEDIA_BYTES = 200 * 1024 * 1024;

/**
 * Hard cap on decoded PCM byte size for one audio file, enforced in the worker
 * after decodeAudioData. Reactive, not preventive — worker isolation contains
 * a decode OOM (the main thread surfaces it as passthrough).
 */
export const MAX_DECODED_AUDIO_BYTES = 1024 * 1024 * 1024;

/** Bounds how long compressAudio/compressVideo wait for their worker before rejecting. */
export const WORKER_TIMEOUT_MS = 60_000;
