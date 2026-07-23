/**
 * Drift-bounded per-sample DURATION accumulator for MP4 sample tables.
 *
 * `Math.round((sample.duration * 1_000_000) / timescale)` rounds each sample
 * independently; when timescale doesn't divide evenly into 1e6 (e.g. 44100),
 * rounding error accumulates and cumulative PTS drift can reach ~600 ms/60s.
 * The fix computes each duration as the difference of two rounded cumulative
 * timestamps, so the per-sample value implicitly corrects the previous sample's
 * rounding error. Total drift is bounded to < 1 µs.
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
