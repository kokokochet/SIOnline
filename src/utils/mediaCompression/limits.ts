/**
 * Hard cap on the ENCODED size of any single media file passed into upload or
 * bulk compression. Checked BEFORE decode. Bounds only the input-byte
 * footprint — it does NOT bound decoded size. (A 200 MB MP3 decodes to ~3.6 GB
 * of PCM; see MAX_DECODED_AUDIO_BYTES for the post-decode bound enforced in
 * the audio worker.) The 60-second worker timeout guards hangs, not memory.
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
