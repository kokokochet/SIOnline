import { CompressionOptions } from './compressionTypes';

/**
 * Default compression parameters from the spec:
 * - Images: max 800px, JPEG quality 0.8
 * - Audio: 128 kbps Opus at 48 kHz (WebCodecs AudioEncoder cannot encode MP3;
 *   Opus is ~1.5-2× more efficient than MP3 — 128 kbps ≈ MP3 192 kbps.
 *   Output format: OGG Opus, .opus extension — already in allowedExtensionsByType)
 * - Video: max 720px height, 1000 kbps H.264
 */
export const defaultCompressionOptions: CompressionOptions = {
    image: {
        maxDimension: 800,
        quality: 0.8,
        mimeType: 'image/jpeg',
    },
    audio: {
        bitrate: 128_000,
        codec: 'opus',
        sampleRate: 48000,
        channels: 2,
    },
    video: {
        maxHeight: 720,
        bitrate: 1_000_000,
        codec: 'avc1.64001F',
        framerate: 30,
    },
};
