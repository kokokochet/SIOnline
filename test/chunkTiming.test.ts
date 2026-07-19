import { getRebasedTimestamps } from '../src/utils/mediaCompression/chunkTiming';

describe('getRebasedTimestamps', () => {
    // Mirrors the real failing file: B-frame reorder, first cts=1024 at timescale 15360
    const samples = [
        { cts: 1024 },
        { cts: 3072 },
        { cts: 2048 },
        { cts: 1536 },
        { cts: 2560 },
    ];

    test('rebases presentation timestamps so the first one is 0', () => {
        const timestamps = getRebasedTimestamps(samples, 15360);
        expect(timestamps[0]).toBe(0);
    });

    test('converts inter-sample cts deltas to microseconds using the track timescale', () => {
        // delta of 512 at timescale 15360 → 33333 µs
        const timestamps = getRebasedTimestamps([{ cts: 1024 }, { cts: 1536 }], 15360);
        expect(timestamps).toEqual([0, 33333]);
    });

    test('preserves presentation offsets between samples (no re-ordering)', () => {
        const timestamps = getRebasedTimestamps(samples, 15360);
        expect(timestamps).toEqual([
            0,
            Math.round((2048 * 1_000_000) / 15360),
            Math.round((1024 * 1_000_000) / 15360),
            Math.round((512 * 1_000_000) / 15360),
            Math.round((1536 * 1_000_000) / 15360),
        ]);
    });

    test('all timestamps are non-negative (muxer validation)', () => {
        const timestamps = getRebasedTimestamps(samples, 15360);
        for (const t of timestamps) {
            expect(t).toBeGreaterThanOrEqual(0);
        }
    });

    test('applies no shift when the first cts is already 0', () => {
        // AAC-like stream: cts starts at 0, delta of 1024 at timescale 44100 → 23220 µs
        const timestamps = getRebasedTimestamps([{ cts: 0 }, { cts: 1024 }], 44100);
        expect(timestamps).toEqual([0, Math.round((1024 * 1_000_000) / 44100)]);
    });

    test('returns empty array for empty input', () => {
        expect(getRebasedTimestamps([], 15360)).toEqual([]);
    });
});
