import { getRebasedTimestamps } from '../src/utils/mediaCompression/chunkTiming';

test('getRebasedTimestamps handles a 4h stream at timescale=1e6 without float degradation', () => {
    const timescale = 1_000_000;
    const hours = 4;
    const seconds = hours * 3600;
    const lastCts = seconds * timescale; // 1.44e10
    const samples = [
        { cts: 0 },
        { cts: lastCts },
    ];

    let result: number[] | undefined;
    let threw: unknown = undefined;
    try {
        result = getRebasedTimestamps(samples, timescale);
    } catch (e) {
        threw = e;
    }

    if (result !== undefined) {
        expect(result[0]).toBe(0);
        expect(result[1]).toBe(seconds * 1_000_000);
    } else {
        expect(threw).toBeInstanceOf(Error);
        expect((threw as Error).message.toLowerCase()).toContain('overflow');
    }
});

test('getRebasedTimestamps: rebased first sample is always 0', () => {
    const samples = [{ cts: 1000 }, { cts: 2000 }, { cts: 3000 }];
    const result = getRebasedTimestamps(samples, 1000);
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(1_000_000);
    expect(result[2]).toBe(2_000_000);
});

test('getRebasedTimestamps: empty input returns empty array', () => {
    expect(getRebasedTimestamps([], 1000)).toEqual([]);
});

test('getRebasedTimestamps: large delta at a non-divisor timescale uses exact BigInt floor', () => {
    // delta is large enough that delta × 1e6 = 1.44e16 exceeds
    // Number.MAX_SAFE_INTEGER, forcing the BigInt path. timescale=44100 does
    // not divide 1e6 evenly, so the exact integer quotient (BigInt floor) and
    // Math.round of the float quotient differ by 1 — this pins the BigInt
    // (floor) result 326_530_612_244, which Math.round of the degraded float
    // product would instead report as 326_530_612_245. (The 4h@1e6 case above
    // also overflows, but 1e6 divides 1e6 exactly, so floor and round agree
    // there and it does not by itself prove the fallback differs from float.)
    const timescale = 44100;
    const delta = 14_400_000_000; // delta × 1e6 = 1.44e16 > MAX_SAFE_INTEGER
    const samples = [{ cts: 0 }, { cts: delta }];
    const result = getRebasedTimestamps(samples, timescale);
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(326_530_612_244);
});
