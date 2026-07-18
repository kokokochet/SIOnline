/**
 * Minimal OGG Opus muxer per RFC 7845 / RFC 3533.
 *
 * Correct page size (no stray +1), per-packet segment table
 * delineation, floor(N/255)+1 segment count, guaranteed EOS page.
 */

const OGG_MAGIC = 0x5367674f; // "OggS" little-endian

/** CRC lookup table for OGG CRC-32 (polynomial 0x04c11db7). */
const crcTable: Uint32Array = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let r = i << 24;
        for (let j = 0; j < 8; j++) {
            r = (r & 0x80000000) ? ((r << 1) ^ 0x04c11db7) : (r << 1);
        }
        table[i] = r >>> 0;
    }
    return table;
})();

function oggCrc32(data: Uint8Array): number {
    let crc = 0;
    for (let i = 0; i < data.length; i++) {
        crc = ((crc << 8) ^ crcTable[((crc >>> 24) ^ data[i]) & 0xff]) >>> 0;
    }
    return crc;
}

interface OggPage {
    packets: Uint8Array[];
    granulePosition: bigint;
    pageSequence: number;
    isBos: boolean;
    isEos: boolean;
}

function buildOggPage(page: OggPage): Uint8Array {
    // Segment table: each packet of N bytes needs floor(N/255)+1 entries
    let segmentTableSize = 0;
    let totalDataSize = 0;
    for (const packet of page.packets) {
        segmentTableSize += Math.floor(packet.length / 255) + 1;
        totalDataSize += packet.length;
    }

    const headerSize = 27; // includes number_page_segments byte at offset 26
    const pageSize = headerSize + segmentTableSize + totalDataSize;

    const buf = new Uint8Array(pageSize);
    const view = new DataView(buf.buffer);

    // Capture pattern "OggS"
    view.setUint32(0, OGG_MAGIC, true);
    view.setUint8(4, 0); // version
    let headerType = 0;
    if (page.isBos) headerType |= 0x02;
    if (page.isEos) headerType |= 0x04;
    view.setUint8(5, headerType);
    view.setBigUint64(6, page.granulePosition, true);
    view.setUint32(14, 1, true); // serial number
    view.setUint32(18, page.pageSequence, true);
    view.setUint32(22, 0, true); // CRC (zeroed, filled later)
    view.setUint8(26, segmentTableSize);

    // Segment table: one run per packet, ending with < 255
    let offset = 27;
    for (const packet of page.packets) {
        let remaining = packet.length;
        while (remaining >= 255) {
            buf[offset++] = 255;
            remaining -= 255;
        }
        buf[offset++] = remaining;
    }

    // Packet data
    for (const packet of page.packets) {
        buf.set(packet, offset);
        offset += packet.length;
    }

    // Compute and set CRC over entire page
    const crc = oggCrc32(buf);
    view.setUint32(22, crc, true);

    return buf;
}

function buildOpusHead(sampleRate: number, channels: number, preSkip: number): Uint8Array {
    const buf = new Uint8Array(19);
    const view = new DataView(buf.buffer);
    buf[0] = 0x4f; buf[1] = 0x70; buf[2] = 0x75; buf[3] = 0x73;
    buf[4] = 0x48; buf[5] = 0x65; buf[6] = 0x61; buf[7] = 0x64;
    view.setUint8(8, 1); // version
    view.setUint8(9, channels);
    view.setUint16(10, preSkip, true);
    view.setUint32(12, sampleRate, true);
    view.setInt16(16, 0, true); // output gain
    view.setUint8(18, 0); // mapping family
    return buf;
}

function buildOpusTags(): Uint8Array {
    const encoderString = 'SIOnline WebCodecs';
    const encoderBytes = new TextEncoder().encode(encoderString);
    const buf = new Uint8Array(8 + 4 + encoderBytes.length + 4);
    const view = new DataView(buf.buffer);
    buf[0] = 0x4f; buf[1] = 0x70; buf[2] = 0x75; buf[3] = 0x73;
    buf[4] = 0x54; buf[5] = 0x61; buf[6] = 0x67; buf[7] = 0x73;
    view.setUint32(8, encoderBytes.length, true);
    buf.set(encoderBytes, 12);
    view.setUint32(12 + encoderBytes.length, 0, true); // 0 comments
    return buf;
}

/**
 * Muxes Opus encoded packets into an OGG Opus file.
 * Each Opus packet gets its own segment table entry set (RFC 3533 §6).
 */
export function muxOggOpus(
    packets: { data: Uint8Array; timestamp: number; duration: number }[],
    sampleRate: number,
    channels: number,
): Uint8Array {
    // RFC 7845 §5.1.1: mapping family 0 supports only 1 or 2 channels
    if (channels < 1 || channels > 2) {
        throw new Error(`Unsupported channel count ${channels}: OGG Opus mapping family 0 supports only 1-2 channels`);
    }

    // Assumption: WebCodecs Opus encoder uses CELT-mode delay of 312 samples (6.5ms at 48kHz).
    // WebCodecs does not expose the actual encoder delay. This value may need adjustment
    // for different encoder implementations/modes.
    const OPUS_PRE_SKIP = 312;

    const pages: Uint8Array[] = [];
    let pageSequence = 0;
    // RFC 7845 §4.3: granule position includes pre-skip. PCM position = granule - preSkip.
    // Audio pages start granule at preSkip so the first decoded sample aligns correctly.
    let granulePosition = BigInt(OPUS_PRE_SKIP);

    // Page 0: OpusHead (BOS)
    pages.push(buildOggPage({
        packets: [buildOpusHead(sampleRate, channels, OPUS_PRE_SKIP)],
        granulePosition: 0n,
        pageSequence: pageSequence++,
        isBos: true,
        isEos: false,
    }));

    // Page 1: OpusTags
    pages.push(buildOggPage({
        packets: [buildOpusTags()],
        granulePosition: 0n,
        pageSequence: pageSequence++,
        isBos: false,
        isEos: false,
    }));

    // Audio data pages: pack multiple packets per page (up to ~8KB or 255 segments)
    const maxPageDataSize = 8192;
    const maxSegments = 255;
    let pagePackets: Uint8Array[] = [];
    let pageDataSize = 0;
    let pageSegments = 0;

    for (const packet of packets) {
        const packetSegments = Math.floor(packet.data.length / 255) + 1;

        if (pagePackets.length > 0 && (pageDataSize + packet.data.length > maxPageDataSize ||
            pageSegments + packetSegments > maxSegments)) {
            // Flush current page (not EOS)
            pages.push(buildOggPage({
                packets: pagePackets,
                granulePosition,
                pageSequence: pageSequence++,
                isBos: false,
                isEos: false,
            }));
            pagePackets = [];
            pageDataSize = 0;
            pageSegments = 0;
        }

        pagePackets.push(packet.data);
        pageDataSize += packet.data.length;
        pageSegments += packetSegments;
        // RFC 7845 §4: granule position MUST be in 48kHz units regardless of input rate.
        // Opus internally always runs at 48kHz; the input sample rate is metadata only.
        granulePosition += BigInt(Math.round((packet.duration * 48000) / 1_000_000));
    }

    // Final page — always EOS (even if empty)
    pages.push(buildOggPage({
        packets: pagePackets,
        granulePosition,
        pageSequence: pageSequence++,
        isBos: false,
        isEos: true,
    }));

    return combineUint8Arrays(pages);
}

function combineUint8Arrays(arrays: Uint8Array[]): Uint8Array {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}
