import { CompressionOptions, CompressionPreset, MediaCompressionPresets } from './compressionTypes';

export const compressionPresets: Record<CompressionPreset, CompressionOptions> = {
	low: {
		image: { maxDimension: 1000, quality: 0.7, mimeType: 'image/jpeg' },
	},
	medium: {
		image: { maxDimension: 1200, quality: 0.8, mimeType: 'image/jpeg' },
	},
	high: {
		image: { maxDimension: 1500, quality: 0.9, mimeType: 'image/jpeg' },
	},
};

export function resolveCompressionOptions(presets: MediaCompressionPresets): CompressionOptions {
	return {
		image: compressionPresets[presets.image].image,
	};
}
