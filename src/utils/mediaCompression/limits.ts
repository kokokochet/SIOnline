/**
 * Shared safety caps and timeouts for the media-compression pipeline.
 *
 * - `MAX_MEDIA_BYTES` is a hard cap applied to ALL media processing (upload
 *   and bulk compression), regardless of compression state. It bounds the
 *   peak memory when decoding multi-hundred-MB files into in-memory buffers.
 *   It does NOT bound the decoded PCM size (a 200 MB MP3 decodes to ~3.6 GB
 *   of PCM — decode runs in the worker to bound peak memory separately).
 *
 * - `MAX_DECODED_AUDIO_BYTES` is the post-decode cap on PCM byte size,
 *   enforced inside the audio worker after `decodeAudioData` runs.
 *
 * - `WORKER_TIMEOUT_MS` bounds how long `compressAudio`/`compressVideo` will
 *   wait for their worker before rejecting. Used by both hosts to prevent an
 *   unresponsive worker from hanging the bulk loop (which checks cancel only
 *   between files).
 */
export const MAX_MEDIA_BYTES = 200 * 1024 * 1024; // 200 MB

/**
 * Hard cap on the DECODED PCM byte size for a single audio file, enforced in
 * `audioCompression.worker.ts` after `decodeAudioData` runs inside the worker.
 *
 * This is a best-effort POST-DECODE reactive cap, not a pre-decode preventive
 * guard: a catastrophically oversized input can still OOM-crash the worker
 * before this check runs. The primary protection against that is worker
 * isolation (a decode OOM crashes the worker, not the tab — the main thread
 * surfaces it as passthrough). Pre-decode size estimation (parsing MP3 frame
 * headers / WAV fmt / OGG Vorbis identification to estimate
 * duration × sampleRate × channels × 4 before calling decodeAudioData) is a
 * follow-up.
 *
 * 1 GiB of Float32 PCM ≈ 46 minutes of 48 kHz stereo (the SIGame use-case
 * ceiling). Bytes = totalFrames × channels × 4.
 */
export const MAX_DECODED_AUDIO_BYTES = 1024 * 1024 * 1024; // 1 GiB

export const WORKER_TIMEOUT_MS = 60_000; // 60 s — matches the prose above
