/**
 * Feature detection for WebCodecs APIs.
 *
 * Safari 16.4+ supports VideoEncoder/VideoDecoder (video only).
 * Safari 26.0+ supports AudioEncoder/AudioDecoder (full WebCodecs).
 * Tauri-macOS WKWebView follows the installed Safari/WebKit version.
 * When WebCodecs is unavailable, files pass through uncompressed.
 *
 * Note: Image compression always runs — it uses canvas (available everywhere).
 * The try/catch in compressImage handles any canvas failure as passthrough.
 */

/** Returns true if VideoEncoder (WebCodecs) is available. */
export function isVideoCompressionSupported(): boolean {
    return typeof VideoEncoder !== 'undefined';
}

/** Returns true if AudioEncoder (WebCodecs) is available. */
export function isAudioCompressionSupported(): boolean {
    return typeof AudioEncoder !== 'undefined';
}
