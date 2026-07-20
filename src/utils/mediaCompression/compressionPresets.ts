import { CompressionOptions, CompressionPreset, MediaCompressionPresets } from './compressionTypes';

/**
 * Low quality preset — aggressive compression for smallest file size.
 * Images: 480px, quality 0.6. Audio: 64 kbps. Video: 480p, 500 kbps.
 */
export const lowPreset: CompressionOptions = {
    image: {
        maxDimension: 480,
        quality: 0.6,
        mimeType: 'image/jpeg',
    },
    audio: {
        bitrate: 64_000,
        codec: 'opus',
        channels: 2,
    },
    video: {
        maxHeight: 480,
        bitrate: 350_000,
        codec: 'avc1.64001F',
    },
};

/**
 * Medium quality preset — balanced. Matches the previous hardcoded defaults.
 * Images: 800px, quality 0.8. Audio: 128 kbps. Video: 720p, 1000 kbps.
 */
export const mediumPreset: CompressionOptions = {
    image: {
        maxDimension: 800,
        quality: 0.8,
        mimeType: 'image/jpeg',
    },
    audio: {
        bitrate: 128_000,
        codec: 'opus',
        channels: 2,
    },
    video: {
        maxHeight: 720,
        bitrate: 500_000,
        codec: 'avc1.64001F',
    },
};

/**
 * High quality preset — favors quality over file size.
 * Images: 1280px, quality 0.92. Audio: 192 kbps. Video: 1080p, 2500 kbps.
 * Uses H.264 Level 4.0 (avc1.640028) which is required for 1080p.
 */
export const highPreset: CompressionOptions = {
    image: {
        maxDimension: 1280,
        quality: 0.92,
        mimeType: 'image/jpeg',
    },
    audio: {
        bitrate: 192_000,
        codec: 'opus',
        channels: 2,
    },
    video: {
        maxHeight: 1080,
        bitrate: 1_500_000,
        codec: 'avc1.640028',
    },
};

/** Lookup map from preset key to options. Used by the UI to resolve the active preset. */
export const compressionPresets: Record<CompressionPreset, CompressionOptions> = {
    low: lowPreset,
    medium: mediumPreset,
    high: highPreset,
};

/**
 * Builds CompressionOptions by picking each media type's section from its own
 * selected preset. Used by both upload-time and bulk compression.
 */
export function resolveCompressionOptions(presets: MediaCompressionPresets): CompressionOptions {
    return {
        image: compressionPresets[presets.image].image,
        audio: compressionPresets[presets.audio].audio,
        video: compressionPresets[presets.video].video,
    };
}
