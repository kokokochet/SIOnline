import { CompressionOptions } from './compressionTypes';
import { mediumPreset } from './compressionPresets';

/**
 * Default compression options — re-exports mediumPreset for backward
 * compatibility. New callers should pass an explicit preset to compressMedia.
 */
export const defaultCompressionOptions: CompressionOptions = mediumPreset;
