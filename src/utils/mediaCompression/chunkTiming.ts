import type { Sample } from 'mp4box';

/**
 * Maps a track's samples to microsecond presentation timestamps rebased so the
 * first sample's timestamp is 0.
 *
 * Why: MP4 files typically carry an edit list that shifts presentation so
 * playback starts at 0 even when the first sample's cts is non-zero (e.g.
 * B-frame reorder offset). mp4-muxer has no edit-list support and requires the
 * first chunk's timestamps to start at 0 — so timestamps are rebased on the
 * first sample's cts instead, reproducing the edit-list behavior for typical
 * camera/screen-recording files.
 *
 * Note: only presentation timestamps live here. Decode timestamps are assigned
 * by the caller at mux time (cumulative, in encoder output order) because the
 * encoder may reorder frames for B-frames — see videoCompression.worker.ts.
 */
export function getRebasedTimestamps(
    samples: Array<Pick<Sample, 'cts'>>,
    timescale: number,
): number[] {
    // Guard against corrupt track metadata: dividing by a zero/negative/non-finite
    // timescale produces NaN timestamps that silently corrupt the output.
    // The sibling videoFramerate.ts already gates the zero case; this mirrors it
    // (review MAJOR: "timescale === 0 unguarded").
    if (!Number.isFinite(timescale) || timescale <= 0) {
        const err = new Error(
            `Cannot rebase timestamps: track timescale must be a positive finite number (got ${timescale})`,
        );
        err.name = 'InvalidStateError';
        throw err;
    }

    const firstCts = samples.length > 0 ? samples[0].cts : 0;
    return samples.map((sample) => Math.round(((sample.cts - firstCts) * 1_000_000) / timescale));
}
