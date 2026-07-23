import { DtsAccumulator } from '../../src/utils/mediaCompression/workers/dtsAccumulator';

test('DtsAccumulator bounds drift to < 1 µs over 216 000 NTSC fallback frames (2h)', () => {
    const framerate = 30000 / 1001; // 29.97 NTSC
    const acc = new DtsAccumulator(framerate);
    const frames = 216_000; // ~2h at 29.97 fps

    let lastDts = 0;
    for (let i = 0; i < frames; i += 1) {
        lastDts = acc.advance(undefined);
    }

    const exactDts = (frames - 1) * 1_000_000 / framerate;
    const driftMicros = Math.abs(lastDts - exactDts);

    expect(driftMicros).toBeLessThan(1);
});

test('DtsAccumulator uses chunk.duration when supplied (no fallback drift)', () => {
    const framerate = 30;
    const acc = new DtsAccumulator(framerate);

    const d0 = acc.advance(33_333);
    const d1 = acc.advance(33_333);
    const d2 = acc.advance(33_334);

    expect(d0).toBe(0);
    expect(d1).toBe(33_333);
    expect(d2).toBe(66_666);
});

test('DtsAccumulator mixed explicit/fallback stream stays monotonic (CC1 regression)', () => {
    // Regression for the mixed-mode bug: the fallback path REPLACED nextDts
    // with round(fallbackFrameCount * 1e6 / fps) instead of adding a drift-
    // bounded increment. After N explicit frames (nextDts = N × dur), a single
    // fallback frame reset nextDts to round(1 * 1e6 / fps) — a ~N×dur backward
    // DTS jump.
    const framerate = 30;
    const acc = new DtsAccumulator(framerate);

    const d0 = acc.advance(33_333);
    const d1 = acc.advance(33_333);
    const d2 = acc.advance(33_333);
    expect(d0).toBe(0);
    expect(d1).toBe(33_333);
    expect(d2).toBe(66_666);

    // Fallback (undefined-duration) frame. Post-fix: the fallback increment
    // round(1*1e6/30) - round(0*1e6/30) = 33333 is ADDED to nextDts, so d3
    // stays monotonic.
    const d3 = acc.advance(undefined);
    expect(d3).toBe(99_999);

    // One more fallback frame: round(2*1e6/30) - round(1*1e6/30) = 33334,
    // so nextDts becomes 133332 + 33334 = 166666 and d4 = 133332.
    const d4 = acc.advance(undefined);
    expect(d4).toBe(133_332);
});
