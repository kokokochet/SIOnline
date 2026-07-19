import type { Track } from 'mp4box';

/** Fallback frame rate used when MP4 track metadata does not yield a valid fps. */
export const FALLBACK_FRAMERATE = 30;

/**
 * Computes the source video frame rate from MP4 track metadata:
 * `nb_samples / (samples_duration / timescale)`.
 *
 * Why: the encoder should preserve the original cadence of each file instead of
 * forcing a fixed rate. Returns FALLBACK_FRAMERATE for degenerate metadata
 * (zero timescale, zero duration, zero samples) so the encoder always gets a
 * sane positive value. The result is intentionally not rounded — fractional
 * rates (e.g. 29.97) are valid for WebCodecs.
 */
export function getSourceFramerate(track: Pick<Track, 'nb_samples' | 'samples_duration' | 'timescale'>): number {
    const durationSeconds = track.samples_duration / track.timescale;
    const fps = track.nb_samples / durationSeconds;
    return Number.isFinite(fps) && fps > 0 ? fps : FALLBACK_FRAMERATE;
}
