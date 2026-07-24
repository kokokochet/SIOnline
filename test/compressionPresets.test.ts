import {
    compressionPresets,
    resolveCompressionOptions,
} from '../src/utils/mediaCompression/compressionPresets';

describe('compressionPresets', () => {
    test('low preset has aggressive compression values', () => {
        expect(compressionPresets.low.image.maxDimension).toBe(1000);
        expect(compressionPresets.low.image.quality).toBe(0.7);
        expect(compressionPresets.low.image.mimeType).toBe('image/jpeg');
        expect(compressionPresets.low.audio.bitrate).toBe(64_000);
        expect(compressionPresets.low.audio.codec).toBe('opus');
        expect(compressionPresets.low.audio.channels).toBe(2);
        expect(compressionPresets.low.video.maxHeight).toBe(720);
        expect(compressionPresets.low.video.bitrate).toBe(350_000);
        expect(compressionPresets.low.video.codec).toBe('avc');
    });

    test('medium preset has balanced compression values', () => {
        expect(compressionPresets.medium.image.maxDimension).toBe(1200);
        expect(compressionPresets.medium.image.quality).toBe(0.8);
        expect(compressionPresets.medium.image.mimeType).toBe('image/jpeg');
        expect(compressionPresets.medium.audio.bitrate).toBe(128_000);
        expect(compressionPresets.medium.audio.codec).toBe('opus');
        expect(compressionPresets.medium.audio.channels).toBe(2);
        expect(compressionPresets.medium.video.maxHeight).toBe(720);
        expect(compressionPresets.medium.video.bitrate).toBe(500_000);
        expect(compressionPresets.medium.video.codec).toBe('avc');
    });

    test('high preset favors quality', () => {
        expect(compressionPresets.high.image.maxDimension).toBe(1500);
        expect(compressionPresets.high.image.quality).toBe(0.9);
        expect(compressionPresets.high.image.mimeType).toBe('image/jpeg');
        expect(compressionPresets.high.audio.bitrate).toBe(192_000);
        expect(compressionPresets.high.audio.codec).toBe('opus');
        expect(compressionPresets.high.audio.channels).toBe(2);
        expect(compressionPresets.high.video.maxHeight).toBe(1080);
        expect(compressionPresets.high.video.bitrate).toBe(1_500_000);
        // AVC base codec; Mediabunny picks profile/level for the target resolution.
        expect(compressionPresets.high.video.codec).toBe('avc');
    });

    // Invariants: guard against accidental inversion; survive legitimate re-tunes but fail on low>medium.
    describe('preset ordering invariants', () => {
        test('image maxDimension is monotonically non-decreasing low -> high', () => {
            expect(compressionPresets.low.image.maxDimension).toBeLessThanOrEqual(compressionPresets.medium.image.maxDimension);
            expect(compressionPresets.medium.image.maxDimension).toBeLessThanOrEqual(compressionPresets.high.image.maxDimension);
        });

        test('image quality is monotonically non-decreasing low -> high', () => {
            expect(compressionPresets.low.image.quality).toBeLessThanOrEqual(compressionPresets.medium.image.quality);
            expect(compressionPresets.medium.image.quality).toBeLessThanOrEqual(compressionPresets.high.image.quality);
        });

        test('audio bitrate strictly increases low -> high', () => {
            expect(compressionPresets.low.audio.bitrate).toBeLessThan(compressionPresets.medium.audio.bitrate);
            expect(compressionPresets.medium.audio.bitrate).toBeLessThan(compressionPresets.high.audio.bitrate);
        });

        test('video bitrate strictly increases low -> high', () => {
            expect(compressionPresets.low.video.bitrate).toBeLessThan(compressionPresets.medium.video.bitrate);
            expect(compressionPresets.medium.video.bitrate).toBeLessThan(compressionPresets.high.video.bitrate);
        });

        test('video maxHeight is monotonically non-decreasing low -> high', () => {
            expect(compressionPresets.low.video.maxHeight).toBeLessThanOrEqual(compressionPresets.medium.video.maxHeight);
            expect(compressionPresets.medium.video.maxHeight).toBeLessThanOrEqual(compressionPresets.high.video.maxHeight);
        });

        test('low/medium/high are pairwise distinct presets', () => {
            expect(compressionPresets.low).not.toEqual(compressionPresets.medium);
            expect(compressionPresets.medium).not.toEqual(compressionPresets.high);
            expect(compressionPresets.low).not.toEqual(compressionPresets.high);
        });

    });

    describe('resolveCompressionOptions', () => {
        test('picks each media type options from its own preset', () => {
            const options = resolveCompressionOptions({ image: 'low', audio: 'medium', video: 'high' });

            expect(options.image).toEqual(compressionPresets.low.image);
            expect(options.audio).toEqual(compressionPresets.medium.audio);
            expect(options.video).toEqual(compressionPresets.high.video);
        });

        test('uniform per-type presets equal the corresponding preset itself', () => {
            expect(resolveCompressionOptions({ image: 'high', audio: 'high', video: 'high' })).toEqual(compressionPresets.high);
        });
    });
});
