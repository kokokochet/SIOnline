import type { Track } from 'mp4box';

/** Fallback frame rate used when MP4 track metadata does not yield a valid fps. */
export const FALLBACK_FRAMERATE = 30;

/**
 * Standard framerates that MP4 metadata commonly encodes with small float
 * error (e.g. NTSC 29.97 stored as 30/1.001=29.97002997…). When the computed
 * fps is within TOLERANCE of one of these, we snap to the canonical value so
 * the encoder paces the entire stream at the standard rate, not a float
 * approximation of it.
 */
const STANDARD_FRAMERATES = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];
const SNAP_TOLERANCE = 0.005; // 0.5%

/**
 * Computes the source video frame rate from MP4 track metadata:
 * `nb_samples / (samples_duration / timescale)`, then snaps to a canonical
 * standard framerate (NTSC/PAL/film) when within 0.5% of one. Snapping
 * eliminates the systematic float drift the encoder would otherwise amplify
 * across the stream's length. Returns FALLBACK_FRAMERATE for degenerate
 * metadata so the encoder always gets a sane positive value.
 */
export function getSourceFramerate(track: Pick<Track, 'nb_samples' | 'samples_duration' | 'timescale'>): number {
    if (track.timescale <= 0 || track.samples_duration <= 0 || track.nb_samples <= 0) {
        return FALLBACK_FRAMERATE;
    }

    const durationSeconds = track.samples_duration / track.timescale;
    const fps = track.nb_samples / durationSeconds;

    if (!Number.isFinite(fps) || fps <= 0) {
        return FALLBACK_FRAMERATE;
    }

    // Nearest-match selection: adjacent standards (23.976/24, 29.97/30,
    // 59.94/60) sit ~0.1% apart — well inside the 0.5% tolerance — so a
    // first-match loop would snap a clean 24 fps source to 23.976 and a clean
    // 30 to 29.97. Picking the standard with the SMALLEST relative error
    // (within tolerance) disambiguates them: NTSC float noise (~1e-6) snaps to
    // the NTSC rate, an exact integer snaps to itself. Tolerance constant is
    // unchanged.
    let bestStandard: number | undefined;
    let bestRelativeError = SNAP_TOLERANCE;
    for (const standard of STANDARD_FRAMERATES) {
        const relativeError = Math.abs(fps - standard) / standard;
        if (relativeError <= bestRelativeError) {
            bestStandard = standard;
            bestRelativeError = relativeError;
        }
    }

    return bestStandard ?? fps;
}
