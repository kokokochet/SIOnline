/**
 * Drift-bounded DTS accumulator for video-encoder output chunks.
 *
 * Problem: `Math.round(1_000_000 / framerate)` accumulates a per-frame rounding
 * error of up to ~0.5 µs. For NTSC 29.97 fps that's ~3.3 µs/frame, which drifts
 * ~712 ms over 2 hours — enough to break A/V sync. Per-sample rounding does not
 * cancel; it piles up monotonically.
 *
 * Fix: separate the two DTS sources.
 *   - When `chunk.duration` is supplied by the encoder, add it directly (the
 *     encoder's duration is already rounded once and represents the encoder's
 *     own time base; adding it does not introduce NEW rounding).
 *   - When `chunk.duration` is undefined (the fallback path), compute the
 *     fallback INCREMENT from a frame counter — the per-frame step is
 *     `round((count+1) * 1e6 / fps) - round(count * 1e6 / fps)` — and ADD it to
 *     `nextDts` (not replace it). This bounds the TOTAL fallback drift to
 *     < 1 µs regardless of frame count (the rounding happens against the exact
 *     rational, not per-frame), AND keeps DTS monotonic when a stream mixes
 *     explicit-duration and fallback chunks: the fallback never jumps nextDts
 *     backward. Replacing nextDts (an earlier draft) reset DTS to
 *     `round(1 * 1e6 / fps)` after N explicit frames — a ~N×dur backward jump.
 *
 * The two paths share a single monotonic `nextDts` so mixed fallback/supplied
 * frames stay consistent.
 */
export class DtsAccumulator {
    private nextDts = 0;
    private fallbackFrameCount = 0;

    constructor(private readonly framerate: number) {}

    /**
     * Advances the accumulator by one chunk and returns the chunk's DTS.
     * Call once per encoder output chunk, in output order.
     *
     * @param chunkDurationMicros the chunk's `duration` (`EncodedVideoChunk.duration`),
     *        or `null`/`undefined` to use the framerate-derived fallback. WebCodecs
     *        types `duration` as `number | null` (null when unknown); both null and
     *        undefined select the fallback, matching the prior
     *        `chunk.duration ?? frameDurationFallback` behaviour.
     * @returns the DTS to use for this chunk.
     */
    advance(chunkDurationMicros: number | null | undefined): number {
        const dts = this.nextDts;

        if (chunkDurationMicros != null) {
            this.nextDts += chunkDurationMicros;
        } else {
            // Drift-bounded INCREMENT from the frame counter, ADDED to nextDts.
            const prevFallbackTotal = Math.round((this.fallbackFrameCount * 1_000_000) / this.framerate);
            this.fallbackFrameCount += 1;
            const nextFallbackTotal = Math.round((this.fallbackFrameCount * 1_000_000) / this.framerate);
            this.nextDts += nextFallbackTotal - prevFallbackTotal;
        }

        return dts;
    }
}
