import { CompressionOptions } from './compressionTypes';
import { mediumPreset } from './compressionPresets';

/** Backward-compat alias for mediumPreset; new callers should pass an explicit preset. */
export const defaultCompressionOptions: CompressionOptions = mediumPreset;
