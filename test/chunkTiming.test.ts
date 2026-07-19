import { getChunkTiming, getTrackChunkTimings } from '../src/utils/mediaCompression/chunkTiming';

describe('getChunkTiming', () => {
    test('first sample gets timestamp 0 and zero composition offset', () => {
        // cts=1024, dts=0 at timescale 15360 — typical B-frame reorder offset
        const timing = getChunkTiming({ cts: 1024, dts: 0 }, 1024, 15360);
        expect(timing.timestamp).toBe(0);
        expect(timing.compositionTimeOffset).toBe(0);
    });

    test('shifts later samples by firstCts and keeps PTS-DTS offset consistent', () => {
        // cts=3072, dts=512: PTS' = (3072-1024)/15360 = 0.1333s, DTS = 512/15360 = 0.0333s
        const timing = getChunkTiming({ cts: 3072, dts: 512 }, 1024, 15360);
        expect(timing.timestamp).toBe(133333);
        expect(timing.compositionTimeOffset).toBe(133333 - 33333);
    });

    test('audio-like sample with cts == dts gets zero composition offset', () => {
        // AAC frame: cts=dts=1024 at timescale 44100, no rebase needed (firstCts=0)
        const timing = getChunkTiming({ cts: 1024, dts: 1024 }, 0, 44100);
        expect(timing.timestamp).toBe(Math.round((1024 * 1_000_000) / 44100));
        expect(timing.compositionTimeOffset).toBe(0);
    });

    test('handles firstCts = 0 (no rebase)', () => {
        const timing = getChunkTiming({ cts: 512, dts: 512 }, 0, 15360);
        expect(timing.timestamp).toBe(Math.round((512 * 1_000_000) / 15360));
        expect(timing.compositionTimeOffset).toBe(0);
    });
});

describe('getTrackChunkTimings', () => {
    // Mirrors the real failing file: B-frame reorder, first cts=1024 at timescale 15360
    const samples = [
        { cts: 1024, dts: 0 },
        { cts: 3072, dts: 512 },
        { cts: 2048, dts: 1024 },
        { cts: 1536, dts: 1536 },
        { cts: 2560, dts: 2048 },
    ];

    test('rebases presentation timestamps so the first one is 0', () => {
        const timings = getTrackChunkTimings(samples, 15360);
        expect(timings[0].timestamp).toBe(0);
    });

    test('derived decode timestamps (timestamp - offset) stay monotonic in decode order', () => {
        const timings = getTrackChunkTimings(samples, 15360);
        const dts = timings.map((t) => t.timestamp - t.compositionTimeOffset);
        expect(dts[0]).toBe(0);
        for (let i = 1; i < dts.length; i++) {
            expect(dts[i]).toBeGreaterThan(dts[i - 1]);
        }
    });

    test('all timestamps are non-negative (muxer validation)', () => {
        const timings = getTrackChunkTimings(samples, 15360);
        for (const t of timings) {
            expect(t.timestamp).toBeGreaterThanOrEqual(0);
        }
    });

    test('returns empty array for empty input', () => {
        expect(getTrackChunkTimings([], 15360)).toEqual([]);
    });
});
