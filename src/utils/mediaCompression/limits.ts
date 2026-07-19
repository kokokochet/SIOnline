/**
 * Hard safety cap applied to ALL media processing (upload and bulk compression),
 * regardless of compression state. Prevents browser OOM when decoding
 * multi-hundred-MB files into memory (the 60s worker timeout guards against
 * hangs but not OOM).
 */
export const MAX_MEDIA_BYTES = 200 * 1024 * 1024; // 200 MB
