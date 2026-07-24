import {
    lowPreset,
    mediumPreset,
    highPreset,
    compressionPresets,
    resolveCompressionOptions,
} from '../src/utils/mediaCompression/compressionPresets';
import { CompressionOptions, CompressionPreset } from '../src/utils/mediaCompression/compressionTypes';

describe('compressionPresets', () => {
    test('lowPreset has aggressive compression values', () => {
        expect(lowPreset.image.maxDimension).toBe(1000);
        expect(lowPreset.image.quality).toBe(0.7);
        expect(lowPreset.image.mimeType).toBe('image/jpeg');
        expect(lowPreset.audio.bitrate).toBe(64_000);
        expect(lowPreset.audio.codec).toBe('opus');
        expect(lowPreset.audio.channels).toBe(2);
        expect(lowPreset.video.maxHeight).toBe(720);
        expect(lowPreset.video.bitrate).toBe(350_000);
        expect(lowPreset.video.codec).toBe('avc');
    });

    test('mediumPreset has balanced compression values', () => {
        expect(mediumPreset.image.maxDimension).toBe(1200);
        expect(mediumPreset.image.quality).toBe(0.8);
        expect(mediumPreset.image.mimeType).toBe('image/jpeg');
        expect(mediumPreset.audio.bitrate).toBe(128_000);
        expect(mediumPreset.audio.codec).toBe('opus');
        expect(mediumPreset.audio.channels).toBe(2);
        expect(mediumPreset.video.maxHeight).toBe(720);
        expect(mediumPreset.video.bitrate).toBe(500_000);
        expect(mediumPreset.video.codec).toBe('avc');
    });

    test('highPreset favors quality', () => {
        expect(highPreset.image.maxDimension).toBe(1500);
        expect(highPreset.image.quality).toBe(0.9);
        expect(highPreset.image.mimeType).toBe('image/jpeg');
        expect(highPreset.audio.bitrate).toBe(192_000);
        expect(highPreset.audio.codec).toBe('opus');
        expect(highPreset.audio.channels).toBe(2);
        expect(highPreset.video.maxHeight).toBe(1080);
        expect(highPreset.video.bitrate).toBe(1_500_000);
        // AVC base codec; Mediabunny picks profile/level for the target resolution.
        expect(highPreset.video.codec).toBe('avc');
    });

    test('compressionPresets map has all three keys', () => {
        const keys = Object.keys(compressionPresets).sort();
        expect(keys).toEqual(['high', 'low', 'medium']);
    });

    test('all presets satisfy the CompressionOptions shape', () => {
        const presets: CompressionPreset[] = ['low', 'medium', 'high'];
        for (const key of presets) {
            const opts: CompressionOptions = compressionPresets[key];
            expect(typeof opts.image.maxDimension).toBe('number');
            expect(typeof opts.image.quality).toBe('number');
            expect(typeof opts.image.mimeType).toBe('string');
            expect(typeof opts.audio.bitrate).toBe('number');
            expect(typeof opts.video.maxHeight).toBe('number');
            expect(typeof opts.video.bitrate).toBe('number');
            expect(opts.audio.channels === 1 || opts.audio.channels === 2).toBe(true);
        }
    });

    // Invariants: guard against accidental inversion; survive legitimate re-tunes but fail on low>medium.
    describe('preset ordering invariants', () => {
        test('image maxDimension is monotonically non-decreasing low -> high', () => {
            expect(lowPreset.image.maxDimension).toBeLessThanOrEqual(mediumPreset.image.maxDimension);
            expect(mediumPreset.image.maxDimension).toBeLessThanOrEqual(highPreset.image.maxDimension);
        });

        test('image quality is monotonically non-decreasing low -> high', () => {
            expect(lowPreset.image.quality).toBeLessThanOrEqual(mediumPreset.image.quality);
            expect(mediumPreset.image.quality).toBeLessThanOrEqual(highPreset.image.quality);
        });

        test('audio bitrate strictly increases low -> high', () => {
            expect(lowPreset.audio.bitrate).toBeLessThan(mediumPreset.audio.bitrate);
            expect(mediumPreset.audio.bitrate).toBeLessThan(highPreset.audio.bitrate);
        });

        test('video bitrate strictly increases low -> high', () => {
            expect(lowPreset.video.bitrate).toBeLessThan(mediumPreset.video.bitrate);
            expect(mediumPreset.video.bitrate).toBeLessThan(highPreset.video.bitrate);
        });

        test('video maxHeight is monotonically non-decreasing low -> high', () => {
            expect(lowPreset.video.maxHeight).toBeLessThanOrEqual(mediumPreset.video.maxHeight);
            expect(mediumPreset.video.maxHeight).toBeLessThanOrEqual(highPreset.video.maxHeight);
        });

        test('low/medium/high are pairwise distinct presets', () => {
            expect(lowPreset).not.toEqual(mediumPreset);
            expect(mediumPreset).not.toEqual(highPreset);
            expect(lowPreset).not.toEqual(highPreset);
        });

    });

    describe('resolveCompressionOptions', () => {
        test('picks each media type options from its own preset', () => {
            const options = resolveCompressionOptions({ image: 'low', audio: 'medium', video: 'high' });

            expect(options.image).toEqual(lowPreset.image);
            expect(options.audio).toEqual(mediumPreset.audio);
            expect(options.video).toEqual(highPreset.video);
        });

        test('uniform per-type presets equal the corresponding preset itself', () => {
            expect(resolveCompressionOptions({ image: 'high', audio: 'high', video: 'high' })).toEqual(highPreset);
        });
    });
});
