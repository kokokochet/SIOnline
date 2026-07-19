import { FALLBACK_FRAMERATE, getSourceFramerate } from '../src/utils/mediaCompression/videoFramerate';

describe('getSourceFramerate', () => {
    test('computes fps from track metadata (30 fps)', () => {
        // 90 samples over 270000/90000 = 3 seconds → exactly 30 fps
        expect(getSourceFramerate({ nb_samples: 90, samples_duration: 270_000, timescale: 90_000 })).toBe(30);
    });

    test('preserves fractional NTSC frame rate (≈29.97, unrounded)', () => {
        // 1000 samples over 3003000/90000 ≈ 33.3667 s → ≈29.97 fps
        const fps = getSourceFramerate({ nb_samples: 1000, samples_duration: 3_003_000, timescale: 90_000 });
        expect(fps).toBeCloseTo(29.97, 2);
    });

    test('falls back to 30 when samples_duration is 0', () => {
        expect(getSourceFramerate({ nb_samples: 90, samples_duration: 0, timescale: 90_000 })).toBe(FALLBACK_FRAMERATE);
    });

    test('falls back to 30 when timescale is 0', () => {
        expect(getSourceFramerate({ nb_samples: 90, samples_duration: 270_000, timescale: 0 })).toBe(FALLBACK_FRAMERATE);
    });

    test('falls back to 30 when track has no samples', () => {
        expect(getSourceFramerate({ nb_samples: 0, samples_duration: 270_000, timescale: 90_000 })).toBe(FALLBACK_FRAMERATE);
    });
});
