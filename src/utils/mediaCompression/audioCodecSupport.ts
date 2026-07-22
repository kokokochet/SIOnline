/** Codec prefix for AAC (ISO/IEC 14496-3 subparts 1–3), per MP4 `mp4a.40.*`. */
const AAC_CODEC_PREFIX = 'mp4a.40.';

/**
 * Thrown when a source MP4 carries an audio track whose codec is not AAC.
 *
 * Why: the video worker re-muxes into an MP4 with an AAC audio track via
 * mp4-muxer. Only AAC can be passthrough-copied; any other codec (Opus, AC-3,
 * MP3) would silently produce a muted file. Surfacing this as an explicit
 * error lets the host fall back to byte-exact passthrough instead.
 */
export class UnsupportedAudioCodecError extends Error {
    constructor(codec: string) {
        super(
            `Audio codec "${codec}" is not supported in MP4 output (only AAC "${AAC_CODEC_PREFIX}*" ` +
                'can be copied). Aborting video compression to avoid a silent/muted file.',
        );
        this.name = 'UnsupportedAudioCodecError';
    }
}

/**
 * Asserts that the given MP4 audio codec is AAC (or absent). Throws
 * UnsupportedAudioCodecError for any non-AAC codec.
 *
 * @param codec - MP4 track codec string (e.g. 'mp4a.40.2'); undefined if no audio track.
 */
export function assertAudioMp4Compatible(codec: string | undefined): void {
    if (codec !== undefined && !codec.startsWith(AAC_CODEC_PREFIX)) {
        throw new UnsupportedAudioCodecError(codec);
    }
}
