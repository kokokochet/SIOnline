import { getSourceFramerate, FALLBACK_FRAMERATE } from '../src/utils/mediaCompression/videoFramerate';

test('getSourceFramerate snaps authoring-correct NTSC 29.97 to exactly 29.97', () => {
    const track = { nb_samples: 30, samples_duration: 1001, timescale: 1000 };
    expect(getSourceFramerate(track)).toBe(29.97);
});

test('getSourceFramerate returns exactly 30 for clean 30 fps source', () => {
    expect(getSourceFramerate({ nb_samples: 30, samples_duration: 1000, timescale: 1000 })).toBe(30);
});

test('getSourceFramerate returns exactly 25 for PAL source', () => {
    expect(getSourceFramerate({ nb_samples: 50, samples_duration: 2000, timescale: 1000 })).toBe(25);
});

test('getSourceFramerate returns exactly 24 for film source', () => {
    expect(getSourceFramerate({ nb_samples: 24, samples_duration: 1000, timescale: 1000 })).toBe(24);
});

test('getSourceFramerate snaps NTSC 59.94 and 23.976', () => {
    // NOTE: plan fixture used nb_samples=60000/24000 with samples_duration=1001,
    // which yields 59940/23976 fps (1000x the intended rate) — not within
    // tolerance of any standard. Corrected to nb_samples=60/24 to mirror the
    // passing 29.97 case (30 samples over the same 1.001s window), which is the
    // canonical NTSC 59.94/23.976 representation the plan intended to snap.
    expect(getSourceFramerate({ nb_samples: 60, samples_duration: 1001, timescale: 1000 })).toBe(59.94);
    expect(getSourceFramerate({ nb_samples: 24, samples_duration: 1001, timescale: 1000 })).toBe(23.976);
});

test('getSourceFramerate preserves exotic framerates (no snap)', () => {
    expect(getSourceFramerate({ nb_samples: 33, samples_duration: 2000, timescale: 1000 })).toBeCloseTo(16.5, 5);
});

test('getSourceFramerate returns FALLBACK for degenerate metadata', () => {
    expect(getSourceFramerate({ nb_samples: 0, samples_duration: 1000, timescale: 1000 })).toBe(FALLBACK_FRAMERATE);
    expect(getSourceFramerate({ nb_samples: 30, samples_duration: 0, timescale: 1000 })).toBe(FALLBACK_FRAMERATE);
    expect(getSourceFramerate({ nb_samples: 30, samples_duration: 1000, timescale: 0 })).toBe(FALLBACK_FRAMERATE);
});
