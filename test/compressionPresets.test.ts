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
        expect(lowPreset.image.maxDimension).toBe(480);
        expect(lowPreset.image.quality).toBe(0.6);
        expect(lowPreset.audio.bitrate).toBe(64_000);
        expect(lowPreset.video.maxHeight).toBe(480);
        expect(lowPreset.video.bitrate).toBe(500_000);
    });

    test('mediumPreset matches the previous defaults (backward compat)', () => {
        expect(mediumPreset.image.maxDimension).toBe(800);
        expect(mediumPreset.image.quality).toBe(0.8);
        expect(mediumPreset.image.mimeType).toBe('image/jpeg');
        expect(mediumPreset.audio.bitrate).toBe(128_000);
        expect(mediumPreset.audio.codec).toBe('opus');
        expect(mediumPreset.audio.channels).toBe(2);
        expect(mediumPreset.video.maxHeight).toBe(720);
        expect(mediumPreset.video.bitrate).toBe(1_000_000);
        expect(mediumPreset.video.codec).toBe('avc1.64001F');
    });

    test('highPreset favors quality', () => {
        expect(highPreset.image.maxDimension).toBe(1280);
        expect(highPreset.image.quality).toBe(0.92);
        expect(highPreset.audio.bitrate).toBe(192_000);
        expect(highPreset.video.maxHeight).toBe(1080);
        expect(highPreset.video.bitrate).toBe(2_500_000);
        // Level 4.0 required for 1080p
        expect(highPreset.video.codec).toBe('avc1.640028');
    });

    test('compressionPresets map has all three keys', () => {
        const keys = Object.keys(compressionPresets).sort();
        expect(keys).toEqual(['high', 'low', 'medium']);
    });

    test('compressionPresets map values match the individual exports', () => {
        expect(compressionPresets.low).toBe(lowPreset);
        expect(compressionPresets.medium).toBe(mediumPreset);
        expect(compressionPresets.high).toBe(highPreset);
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
