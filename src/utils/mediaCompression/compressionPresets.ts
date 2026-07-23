import { CompressionOptions, CompressionPreset, MediaCompressionPresets } from './compressionTypes';

/** Low quality preset — aggressive compression for smallest file size. */
export const lowPreset: CompressionOptions = {
    image: {
        maxDimension: 1000,
        quality: 0.7,
        mimeType: 'image/jpeg',
    },
    audio: {
        bitrate: 64_000,
        codec: 'opus',
        channels: 2,
    },
    video: {
        maxHeight: 720,
        bitrate: 350_000,
        codec: 'avc1.64001F',
    },
};

/** Medium quality preset — balanced. */
export const mediumPreset: CompressionOptions = {
    image: {
        maxDimension: 1200,
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
 * Uses H.264 Level 4.0 (avc1.640028), which covers 1080p up to 30 fps;
 * 1080p60+ would require Level 4.2 (avc1.64002A).
 */
export const highPreset: CompressionOptions = {
    image: {
        maxDimension: 1500,
        quality: 0.9,
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
