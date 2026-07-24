import {
    compressionPresets,
    resolveCompressionOptions,
} from '../src/utils/mediaCompression/compressionPresets';

describe('compressionPresets', () => {
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
