/**
 * Safari 16.4+ supports VideoEncoder (video only); Safari 26.0+ adds AudioEncoder.
 * When WebCodecs is absent, files pass through uncompressed. Images use canvas.
 */

export function isVideoCompressionSupported(): boolean {
    return typeof VideoEncoder !== 'undefined';
}

export function isAudioCompressionSupported(): boolean {
    return typeof AudioEncoder !== 'undefined';
}
