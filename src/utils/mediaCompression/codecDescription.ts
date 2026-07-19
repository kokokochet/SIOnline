import { DataStream, Endianness } from 'mp4box';
import type { Sample } from 'mp4box';

/** Minimal structural shape of an mp4box codec configuration box (avcC/hvcC/vpcC/av1C). */
interface CodecConfigBox {
    write(stream: DataStream): void;
}

/**
 * Extracts the codec configuration record for WebCodecs
 * `VideoDecoderConfig.description` from a sample's stsd entry.
 *
 * Why not `sample.description.data`: mp4box fully parses known sample entries
 * (avc1, hvc1, ...) into structured boxes, so the generic `Box.data` field
 * stays undefined; the configuration record lives in the child box (`avcC`
 * for H.264, `hvcC` for HEVC, `vpcC` for VP9, `av1C` for AV1). Chrome
 * requires `description` for AVC-formatted H.264 — without it the decoder
 * assumes Annex B input and `decode()` throws
 * "A key frame is required after configure() or flush()".
 *
 * Returns undefined when the entry carries no known config box (e.g. audio
 * mp4a entries, whose config lives in esds) — the caller then omits
 * `description` and the decoder/muxer applies its own fallback.
 */
export function getCodecDescription(sample: Pick<Sample, 'description'> | undefined): Uint8Array | undefined {
    const entry = sample?.description as
        | { avcC?: CodecConfigBox; hvcC?: CodecConfigBox; vpcC?: CodecConfigBox; av1C?: CodecConfigBox }
        | undefined;
    const configBox = entry?.avcC ?? entry?.hvcC ?? entry?.vpcC ?? entry?.av1C;
    if (!configBox) {
        return undefined;
    }
    const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
    configBox.write(stream);
    // Strip the 8-byte box header (4-byte size + 4-byte fourcc)
    return new Uint8Array(stream.buffer, 8);
}
