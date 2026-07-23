/**
 * Feature detection for WebCodecs APIs.
 *
 * Safari 16.4+ supports VideoEncoder/VideoDecoder (video only); Safari 26.0+
 * adds AudioEncoder/AudioDecoder (full WebCodecs). When WebCodecs is
 * unavailable, files pass through uncompressed. Image compression uses canvas
 * (available everywhere).
 */

/** Returns true if VideoEncoder (WebCodecs) is available. */
export function isVideoCompressionSupported(): boolean {
    return typeof VideoEncoder !== 'undefined';
}

/** Returns true if AudioEncoder (WebCodecs) is available. */
export function isAudioCompressionSupported(): boolean {
    return typeof AudioEncoder !== 'undefined';
}
