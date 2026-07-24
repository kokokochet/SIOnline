import { CompressionOptions, CompressionPreset, MediaCompressionPresets } from './compressionTypes';

export const compressionPresets: Record<CompressionPreset, CompressionOptions> = {
	low: {
		image: { maxDimension: 1000, quality: 0.7, mimeType: 'image/jpeg' },
		audio: { bitrate: 64_000, codec: 'opus', channels: 2 },
		video: { maxHeight: 720, bitrate: 350_000, codec: 'avc' },
	},
	medium: {
		image: { maxDimension: 1200, quality: 0.8, mimeType: 'image/jpeg' },
		audio: { bitrate: 128_000, codec: 'opus', channels: 2 },
		video: { maxHeight: 720, bitrate: 500_000, codec: 'avc' },
	},
	/** High quality preset. Mediabunny selects the AVC profile/level for the target resolution. */
	high: {
		image: { maxDimension: 1500, quality: 0.9, mimeType: 'image/jpeg' },
		audio: { bitrate: 192_000, codec: 'opus', channels: 2 },
		video: { maxHeight: 1080, bitrate: 1_500_000, codec: 'avc' },
	},
};

export function resolveCompressionOptions(presets: MediaCompressionPresets): CompressionOptions {
	return {
		image: compressionPresets[presets.image].image,
		audio: compressionPresets[presets.audio].audio,
		video: compressionPresets[presets.video].video,
	};
}
