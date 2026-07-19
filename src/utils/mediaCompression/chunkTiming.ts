import type { Sample } from 'mp4box';

/** Microsecond chunk timing for the muxer: presentation timestamp + composition offset. */
export interface ChunkTiming {
    /** Presentation timestamp in microseconds, rebased so the track's first PTS is 0. */
    timestamp: number;
    /** Composition time offset in microseconds (PTS − DTS); 0 for non-reordered streams. */
    compositionTimeOffset: number;
}

/**
 * Converts an mp4box sample's cts/dts to microsecond chunk timing for mp4-muxer.
 *
 * Why: MP4 files typically carry an edit list that shifts presentation so playback
 * starts at 0 even when the first sample's cts is non-zero (e.g. B-frame reorder
 * offset). mp4-muxer has no edit-list support and requires the first chunk's DTS
 * to be 0 — so timestamps are rebased on the first sample's cts instead, which
 * reproduces the edit-list behavior for typical camera/screen-recording files.
 *
 * The composition offset is exactly `timestamp − dts(µs)` (after rounding) so the
 * muxer's derived decode timestamps stay consistent with the passed presentation
 * timestamps — DTS must be monotonically increasing in decode order.
 */
export function getChunkTiming(
    sample: Pick<Sample, 'cts' | 'dts'>,
    firstCts: number,
    timescale: number,
): ChunkTiming {
    const timestamp = Math.round(((sample.cts - firstCts) * 1_000_000) / timescale);
    const decodeTimestamp = Math.round((sample.dts * 1_000_000) / timescale);
    return { timestamp, compositionTimeOffset: timestamp - decodeTimestamp };
}

/**
 * Maps a whole track's samples (in decode order) to muxer chunk timings,
 * rebased on the first sample's cts — see getChunkTiming for the rationale.
 *
 * Why a dedicated helper: the video worker must guarantee mp4-muxer's
 * invariants (first DTS = 0, monotonic DTS, non-negative timestamps) for
 * arbitrary input files; keeping the mapping in one pure function makes those
 * invariants unit-testable without a browser.
 */
export function getTrackChunkTimings(
    samples: Array<Pick<Sample, 'cts' | 'dts'>>,
    timescale: number,
): ChunkTiming[] {
    const firstCts = samples.length > 0 ? samples[0].cts : 0;
    return samples.map((sample) => getChunkTiming(sample, firstCts, timescale));
}
