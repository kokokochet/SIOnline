/**
 * Drift-bounded per-sample DURATION accumulator for MP4 sample tables.
 *
 * Problem: `Math.round((sample.duration * 1_000_000) / timescale)` rounds each
 * sample independently. When timescale does not divide evenly into 1e6 (e.g.
 * 44100 → 22.6757 µs/tick), each sample's rounding error accumulates and the
 * cumulative PTS drift can reach ~600 ms/60s. The fix computes each sample's
 * duration as the difference of two rounded cumulative timestamps, so the
 * per-sample value implicitly corrects the previous sample's rounding error.
 * Total cumulative drift is bounded to < 1 µs regardless of stream length.
 *
 * Used by both the video-frame chunk loop and the AAC passthrough loop in
 * videoCompression.worker.ts.
 */
export class SampleDtsAccumulator {
    private cumulativeTimescaleUnits = 0;

    constructor(private readonly timescale: number) {
        if (timescale <= 0) {
            throw new Error(`SampleDtsAccumulator: timescale must be positive, got ${timescale}`);
        }
    }

    /**
     * Advances the accumulator by one sample's worth of timescale units and
     * returns that sample's DURATION in microseconds.
     *
     * @param sampleDurationInTimescale the sample's `duration` field (mp4box
     *        exposes durations in the track's timescale units).
     * @returns the sample's duration in microseconds.
     */
    advance(sampleDurationInTimescale: number): number {
        const startMicros = Math.round((this.cumulativeTimescaleUnits * 1_000_000) / this.timescale);
        this.cumulativeTimescaleUnits += sampleDurationInTimescale;
        const endMicros = Math.round((this.cumulativeTimescaleUnits * 1_000_000) / this.timescale);
        return endMicros - startMicros;
    }
}
