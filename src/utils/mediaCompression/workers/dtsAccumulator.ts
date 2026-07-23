/**
 * Drift-bounded DTS accumulator for video-encoder output chunks.
 *
 * `Math.round(1_000_000 / framerate)` per fallback frame drifts ~712 ms/2h for
 * NTSC 29.97 (the rounding error piles up monotonically). Fix: separate the two
 * DTS sources.
 *   - When `chunk.duration` is supplied by the encoder, add it directly (already
 *     rounded once; no new rounding introduced).
 *   - When undefined, compute the fallback INCREMENT from a frame counter
 *     (`round((count+1)*1e6/fps) - round(count*1e6/fps)`) and ADD it to nextDts,
 *     not replace it. Bounds total fallback drift to < 1 µs and keeps DTS
 *     monotonic for mixed explicit/fallback streams.
 *
 * Both paths share a single monotonic `nextDts`.
 */
export class DtsAccumulator {
    private nextDts = 0;
    private fallbackFrameCount = 0;

    constructor(private readonly framerate: number) {}

    /**
     * Advances the accumulator by one chunk and returns the chunk's DTS.
     *
     * @param chunkDurationMicros the chunk's `duration`, or null/undefined to
     *        use the framerate-derived fallback (WebCodecs types duration as
     *        `number | null`).
     * @returns the DTS to use for this chunk.
     */
    advance(chunkDurationMicros: number | null | undefined): number {
        const dts = this.nextDts;

        if (chunkDurationMicros != null) {
            this.nextDts += chunkDurationMicros;
        } else {
            const prevFallbackTotal = Math.round((this.fallbackFrameCount * 1_000_000) / this.framerate);
            this.fallbackFrameCount += 1;
            const nextFallbackTotal = Math.round((this.fallbackFrameCount * 1_000_000) / this.framerate);
            this.nextDts += nextFallbackTotal - prevFallbackTotal;
        }

        return dts;
    }
}
