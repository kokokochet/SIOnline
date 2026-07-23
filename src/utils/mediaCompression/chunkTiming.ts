import type { Sample } from 'mp4box';

/**
 * Maps a track's samples to microsecond presentation timestamps rebased so the
 * first sample's timestamp is 0.
 *
 * Why: MP4 files carry an edit list that shifts presentation so playback starts
 * at 0 even when the first sample's cts is non-zero (e.g. B-frame reorder
 * offset). mp4-muxer has no edit-list support and requires the first chunk's
 * timestamps to start at 0, so timestamps are rebased on the first sample's cts.
 *
 * Decode timestamps are assigned by the caller at mux time (cumulative, in
 * encoder output order) because the encoder may reorder frames for B-frames —
 * see videoCompression.worker.ts.
 *
 * Overflow: `(cts - firstCts) * 1_000_000` can exceed MAX_SAFE_INTEGER for long
 * streams at high timescales; when it does, switch to BigInt math for exactness,
 * and throw if the divided result itself is unsafe.
 */
export function getRebasedTimestamps(
    samples: Array<Pick<Sample, 'cts'>>,
    timescale: number,
): number[] {
    // Dividing by a zero/negative/non-finite timescale produces NaN timestamps
    // that silently corrupt the output.
    if (!Number.isFinite(timescale) || timescale <= 0) {
        const err = new Error(
            `Cannot rebase timestamps: track timescale must be a positive finite number (got ${timescale})`,
        );
        err.name = 'InvalidStateError';
        throw err;
    }

    if (samples.length === 0) {
        return [];
    }

    const firstCts = samples[0].cts;
    const result: number[] = new Array(samples.length);

    for (let i = 0; i < samples.length; i += 1) {
        const delta = samples[i].cts - firstCts;
        const product = delta * 1_000_000;

        if (Number.isSafeInteger(product)) {
            // Normal path — unchanged. Small deltas (the common case) never
            // approach MAX_SAFE_INTEGER, so this matches the historical
            // Math.round((delta * 1e6) / timescale) exactly.
            result[i] = Math.round(product / timescale);
        } else {
            // BigInt path: exact for any stream length / timescale. The float
            // product has already lost precision, so recompute from the integer
            // delta via BigInt and divide exactly.
            const exact = Number((BigInt(delta) * 1_000_000n) / BigInt(timescale));
            if (!Number.isSafeInteger(exact)) {
                throw new Error(
                    `getRebasedTimestamps: PTS overflow at sample ${i} ` +
                    `(delta=${delta}, timescale=${timescale}); result ${exact} ` +
                    'exceeds Number.MAX_SAFE_INTEGER.',
                );
            }
            result[i] = exact;
        }
    }

    return result;
}
