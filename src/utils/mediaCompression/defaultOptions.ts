import { CompressionOptions } from './compressionTypes';
import { mediumPreset } from './compressionPresets';

/**
 * Default compression options. Kept for backward compatibility with existing
 * callers and tests. New callers should pass an explicit preset from
 * `compressionPresets` to `compressMedia`.
 *
 * Re-exports mediumPreset so existing `defaultCompressionOptions` imports keep
 * working without duplication.
 */
export const defaultCompressionOptions: CompressionOptions = mediumPreset;
