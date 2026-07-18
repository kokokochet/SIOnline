import { muxOggOpus } from '../src/utils/mediaCompression/oggOpusMuxer';

interface ParsedPage {
    data: Uint8Array;
    view: DataView;
    headerType: number;
    granulePosition: bigint;
    pageSequence: number;
    crc: number;
    numSegments: number;
    segmentTable: number[];
    packetData: Uint8Array;
}

/**
 * Parses a complete OGG stream into its constituent pages, validating the
 * capture pattern and segment table of each. Returns structured fields per page.
 */
function parseOggPages(data: Uint8Array): ParsedPage[] {
    const pages: ParsedPage[] = [];
    let offset = 0;
    while (offset < data.length) {
        const view = new DataView(data.buffer, offset, data.length - offset);
        // Capture pattern "OggS" (0x5367674f little-endian)
        expect(view.getUint32(0, true)).toBe(0x5367674f);
        expect(view.getUint8(4)).toBe(0); // version

        const headerType = view.getUint8(5);
        const granulePosition = view.getBigUint64(6, true);
        const serial = view.getUint32(14, true);
        const pageSequence = view.getUint32(18, true);
        const crc = view.getUint32(22, true);
        const numSegments = view.getUint8(26);

        const segmentTable: number[] = [];
        let dataSize = 0;
        for (let i = 0; i < numSegments; i++) {
            const seg = view.getUint8(27 + i);
            segmentTable.push(seg);
            dataSize += seg;
        }

        const pageSize = 27 + numSegments + dataSize;
        const pageBytes = data.slice(offset, offset + pageSize);
        const packetData = pageBytes.slice(27 + numSegments);

        pages.push({
            data: pageBytes,
            view: new DataView(pageBytes.buffer),
            headerType,
            granulePosition,
            pageSequence,
            crc,
            numSegments,
            segmentTable,
            packetData,
        });

        // Serial number must be 1 for all pages (muxer hardcodes it)
        expect(serial).toBe(1);

        offset += pageSize;
    }
    return pages;
}

/** OGG CRC-32 (polynomial 0x04c11db7, non-reflected) — clean-room reimplementation. */
function oggCrc32(data: Uint8Array): number {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let r = i << 24;
        for (let j = 0; j < 8; j++) {
            r = (r & 0x80000000) ? ((r << 1) ^ 0x04c11db7) : (r << 1);
        }
        table[i] = r >>> 0;
    }
    let crc = 0;
    for (let i = 0; i < data.length; i++) {
        crc = ((crc << 8) ^ table[((crc >>> 24) ^ data[i]) & 0xff]) >>> 0;
    }
    return crc >>> 0;
}

describe('oggOpusMuxer', () => {
    describe('muxOggOpus — basic page structure', () => {
        test('produces 3 pages for empty packet list (OpusHead, OpusTags, empty EOS)', () => {
            const result = muxOggOpus([], 48000, 2);
            const pages = parseOggPages(result);
            expect(pages.length).toBe(3);
        });

        test('page sequence numbers are 0, 1, 2, ... in order', () => {
            const result = muxOggOpus([], 48000, 2);
            const pages = parseOggPages(result);
            expect(pages.map(p => p.pageSequence)).toEqual([0, 1, 2]);
        });

        test('first page is BOS (headerType 0x02) and not EOS', () => {
            const result = muxOggOpus([], 48000, 2);
            const pages = parseOggPages(result);
            expect(pages[0].headerType & 0x02).toBe(0x02); // BOS
            expect(pages[0].headerType & 0x04).toBe(0x00); // not EOS
        });

        test('last page is EOS (headerType 0x04)', () => {
            const result = muxOggOpus([], 48000, 2);
            const pages = parseOggPages(result);
            const last = pages[pages.length - 1];
            expect(last.headerType & 0x04).toBe(0x04); // EOS
        });

        test('OpusTags page (index 1) is neither BOS nor EOS', () => {
            const result = muxOggOpus([], 48000, 2);
            const pages = parseOggPages(result);
            expect(pages[1].headerType & 0x02).toBe(0x00);
            expect(pages[1].headerType & 0x04).toBe(0x00);
        });

        test('middle audio page (when flushing) has neither BOS nor EOS', () => {
            // 10 packets of 1000 bytes: 8 fit in a page (8000 <= 8192),
            // 9th triggers flush (9000 > 8192), so page index 2 is a non-final audio page.
            const packets = Array.from({ length: 10 }, (_, i) => ({
                data: new Uint8Array(1000).fill(i),
                timestamp: i * 20000,
                duration: 20000,
            }));
            const result = muxOggOpus(packets, 48000, 2);
            const pages = parseOggPages(result);
            // 4 pages: OpusHead, OpusTags, audio(8 pkts), audio(2 pkts, EOS)
            expect(pages.length).toBe(4);
            expect(pages[2].headerType & 0x02).toBe(0x00);
            expect(pages[2].headerType & 0x04).toBe(0x00);
            // The last page must be EOS
            expect(pages[3].headerType & 0x04).toBe(0x04);
        });
    });

    describe('muxOggOpus — OpusHead packet', () => {
        function getOpusHeadPacket(): Uint8Array {
            const result = muxOggOpus([], 48000, 2);
            const pages = parseOggPages(result);
            return pages[0].packetData;
        }

        test('contains "OpusHead" magic', () => {
            const packet = getOpusHeadPacket();
            const magic = String.fromCharCode(...packet.slice(0, 8));
            expect(magic).toBe('OpusHead');
        });

        test('version is 1', () => {
            const packet = getOpusHeadPacket();
            expect(packet[8]).toBe(1);
        });

        test('channel count matches input', () => {
            const stereo = muxOggOpus([], 48000, 2);
            const mono = muxOggOpus([], 48000, 1);
            const stereoPacket = parseOggPages(stereo)[0].packetData;
            const monoPacket = parseOggPages(mono)[0].packetData;
            expect(stereoPacket[9]).toBe(2);
            expect(monoPacket[9]).toBe(1);
        });

        test('pre-skip is 312 (uint16 LE at offset 10)', () => {
            const packet = getOpusHeadPacket();
            const view = new DataView(packet.buffer);
            expect(view.getUint16(10, true)).toBe(312);
        });

        test('sample rate matches input (uint32 LE at offset 12)', () => {
            const result = muxOggOpus([], 48000, 2);
            const packet = parseOggPages(result)[0].packetData;
            const view = new DataView(packet.buffer);
            expect(view.getUint32(12, true)).toBe(48000);
        });

        test('output gain is 0 (int16 LE at offset 16)', () => {
            const packet = getOpusHeadPacket();
            const view = new DataView(packet.buffer);
            expect(view.getInt16(16, true)).toBe(0);
        });

        test('mapping family is 0', () => {
            const packet = getOpusHeadPacket();
            expect(packet[18]).toBe(0);
        });

        test('total OpusHead packet is 19 bytes', () => {
            const packet = getOpusHeadPacket();
            expect(packet.length).toBe(19);
        });

        test('OpusHead page granule position is 0', () => {
            const result = muxOggOpus([], 48000, 2);
            const pages = parseOggPages(result);
            expect(pages[0].granulePosition).toBe(0n);
        });
    });

    describe('muxOggOpus — OpusTags packet', () => {
        function getOpusTagsPacket(): Uint8Array {
            const result = muxOggOpus([], 48000, 2);
            const pages = parseOggPages(result);
            return pages[1].packetData;
        }

        test('contains "OpusTags" magic', () => {
            const packet = getOpusTagsPacket();
            const magic = String.fromCharCode(...packet.slice(0, 8));
            expect(magic).toBe('OpusTags');
        });

        test('encoder string is "SIOnline WebCodecs" (18 bytes)', () => {
            const packet = getOpusTagsPacket();
            const view = new DataView(packet.buffer);
            const len = view.getUint32(8, true);
            expect(len).toBe(18);
            const encoder = String.fromCharCode(...packet.slice(12, 12 + len));
            expect(encoder).toBe('SIOnline WebCodecs');
        });

        test('comment count is 0 (uint32 LE after encoder string)', () => {
            const packet = getOpusTagsPacket();
            const view = new DataView(packet.buffer);
            expect(view.getUint32(30, true)).toBe(0);
        });

        test('OpusTags page granule position is 0', () => {
            const result = muxOggOpus([], 48000, 2);
            const pages = parseOggPages(result);
            expect(pages[1].granulePosition).toBe(0n);
        });
    });

    describe('muxOggOpus — segment table lacing (RFC 3533 §6)', () => {
        test('packet of 255 bytes → segment table [255, 0]', () => {
            const packets = [{
                data: new Uint8Array(255).fill(0xab),
                timestamp: 0,
                duration: 20000,
            }];
            const result = muxOggOpus(packets, 48000, 2);
            const pages = parseOggPages(result);
            // Audio data is on page index 2 (after OpusHead, OpusTags)
            const audioPage = pages[2];
            expect(audioPage.segmentTable).toEqual([255, 0]);
            expect(audioPage.packetData.length).toBe(255);
        });

        test('packet of 510 bytes → segment table [255, 255, 0]', () => {
            const packets = [{
                data: new Uint8Array(510).fill(0xcd),
                timestamp: 0,
                duration: 20000,
            }];
            const result = muxOggOpus(packets, 48000, 2);
            const pages = parseOggPages(result);
            expect(pages[2].segmentTable).toEqual([255, 255, 0]);
            expect(pages[2].packetData.length).toBe(510);
        });

        test('packet of 100 bytes → segment table [100]', () => {
            const packets = [{
                data: new Uint8Array(100).fill(0xef),
                timestamp: 0,
                duration: 20000,
            }];
            const result = muxOggOpus(packets, 48000, 2);
            const pages = parseOggPages(result);
            expect(pages[2].segmentTable).toEqual([100]);
            expect(pages[2].packetData.length).toBe(100);
        });

        test('packet of exactly 256 bytes → [255, 1]', () => {
            const packets = [{
                data: new Uint8Array(256).fill(0x01),
                timestamp: 0,
                duration: 20000,
            }];
            const result = muxOggOpus(packets, 48000, 2);
            const pages = parseOggPages(result);
            expect(pages[2].segmentTable).toEqual([255, 1]);
        });

        test('multiple packets in one page have contiguous segment table entries', () => {
            // 3 packets of 100 bytes each: 3 segments [100, 100, 100]
            const packets = Array.from({ length: 3 }, (_, i) => ({
                data: new Uint8Array(100).fill(i),
                timestamp: i * 20000,
                duration: 20000,
            }));
            const result = muxOggOpus(packets, 48000, 2);
            const pages = parseOggPages(result);
            expect(pages[2].segmentTable).toEqual([100, 100, 100]);
            expect(pages[2].packetData.length).toBe(300);
        });
    });

    describe('muxOggOpus — CRC-32 validity', () => {
        test('CRC field is non-zero for OpusHead page (known content)', () => {
            const result = muxOggOpus([], 48000, 2);
            const pages = parseOggPages(result);
            expect(pages[0].crc).not.toBe(0);
        });

        test('CRC is self-consistent: recompute over page (CRC field zeroed) and compare', () => {
            const packets = [{
                data: new Uint8Array(255).fill(0xab),
                timestamp: 0,
                duration: 20000,
            }];
            const result = muxOggOpus(packets, 48000, 2);
            const pages = parseOggPages(result);
            for (const page of pages) {
                // Zero out the CRC field (bytes 22-25) for recomputation
                const copy = page.data.slice();
                copy[22] = 0; copy[23] = 0; copy[24] = 0; copy[25] = 0;
                const recomputed = oggCrc32(copy);
                expect(recomputed).toBe(page.crc);
            }
        });

        test('CRC detects corruption: flipping a byte invalidates the stored CRC', () => {
            const result = muxOggOpus([], 48000, 2);
            const pages = parseOggPages(result);
            const opusHeadPage = pages[0];
            // Flip the last byte of the packet data
            const corrupted = opusHeadPage.data.slice();
            corrupted[corrupted.length - 1] ^= 0xff;
            // Zero CRC field for recomputation
            corrupted[22] = 0; corrupted[23] = 0; corrupted[24] = 0; corrupted[25] = 0;
            const corruptedCrc = oggCrc32(corrupted);
            expect(corruptedCrc).not.toBe(opusHeadPage.crc);
        });

        test('two different inputs produce different CRCs', () => {
            const mono = muxOggOpus([], 48000, 1);
            const stereo = muxOggOpus([], 48000, 2);
            const monoCrc = parseOggPages(mono)[0].crc;
            const stereoCrc = parseOggPages(stereo)[0].crc;
            expect(monoCrc).not.toBe(stereoCrc);
        });
    });

    describe('muxOggOpus — granule position accumulation', () => {
        test('granule starts at pre-skip (312) and accumulates in 48kHz units', () => {
            // 2 packets, 20ms each = 20000μs. At 48kHz: round(20000*48000/1e6) = 960 samples each.
            const packets = [
                { data: new Uint8Array(10), timestamp: 0, duration: 20000 },
                { data: new Uint8Array(10), timestamp: 20000, duration: 20000 },
            ];
            const result = muxOggOpus(packets, 48000, 2);
            const pages = parseOggPages(result);
            // Single audio page (EOS): granule = 312 + 960 + 960 = 2232
            expect(pages.length).toBe(3);
            expect(pages[2].granulePosition).toBe(2232n);
        });

        test('granule uses 48kHz regardless of input sample rate (RFC 7845 §4)', () => {
            // 1 packet, 10ms = 10000μs. At 48kHz: round(10000*48000/1e6) = 480 samples.
            // Input sample rate is 24000 but granule must still be in 48kHz units.
            const packets = [{
                data: new Uint8Array(10),
                timestamp: 0,
                duration: 10000,
            }];
            const result = muxOggOpus(packets, 24000, 2);
            const pages = parseOggPages(result);
            // OpusHead reports 24000, but granule = 312 + 480 = 792 (48kHz units)
            expect(pages[2].granulePosition).toBe(792n);
            // OpusHead sample rate field still reports the input rate
            const opusHeadView = new DataView(pages[0].packetData.buffer);
            expect(opusHeadView.getUint32(12, true)).toBe(24000);
        });

        test('granule accumulates across multiple audio pages', () => {
            // 10 packets of 1000 bytes, 20ms each: 8 in page 2, 2 in page 3 (EOS).
            // Per-packet granule delta = 960. Page 2 granule = 312 + 8*960 = 7992.
            // Page 3 (final) granule = 312 + 10*960 = 9912.
            const packets = Array.from({ length: 10 }, (_, i) => ({
                data: new Uint8Array(1000).fill(i),
                timestamp: i * 20000,
                duration: 20000,
            }));
            const result = muxOggOpus(packets, 48000, 2);
            const pages = parseOggPages(result);
            expect(pages.length).toBe(4);
            expect(pages[2].granulePosition).toBe(312n + 8n * 960n);
            expect(pages[3].granulePosition).toBe(312n + 10n * 960n);
        });

        test('final EOS page granule equals pre-skip plus total samples', () => {
            // 1 packet, 40ms = 40000μs → round(40000*48000/1e6) = 1920 samples
            const packets = [{
                data: new Uint8Array(10),
                timestamp: 0,
                duration: 40000,
            }];
            const result = muxOggOpus(packets, 48000, 2);
            const pages = parseOggPages(result);
            expect(pages[2].granulePosition).toBe(312n + 1920n);
        });
    });

    describe('muxOggOpus — channel assertion (RFC 7845 §5.1.1)', () => {
        test('throws for channels = 0', () => {
            const packets = [{ data: new Uint8Array([1]), timestamp: 0, duration: 20000 }];
            expect(() => muxOggOpus(packets, 48000, 0)).toThrow(/channel/);
        });

        test('throws for channels = 3', () => {
            const packets = [{ data: new Uint8Array([1]), timestamp: 0, duration: 20000 }];
            expect(() => muxOggOpus(packets, 48000, 3)).toThrow(/channel/);
        });

        test('throws for channels = 5 (multichannel needs mapping family > 0)', () => {
            const packets = [{ data: new Uint8Array([1]), timestamp: 0, duration: 20000 }];
            expect(() => muxOggOpus(packets, 48000, 5)).toThrow(/channel/);
        });

        test('mono (channels=1) succeeds', () => {
            const packets = [{ data: new Uint8Array([1]), timestamp: 0, duration: 20000 }];
            expect(() => muxOggOpus(packets, 48000, 1)).not.toThrow();
        });

        test('stereo (channels=2) succeeds', () => {
            const packets = [{ data: new Uint8Array([1]), timestamp: 0, duration: 20000 }];
            expect(() => muxOggOpus(packets, 48000, 2)).not.toThrow();
        });
    });

    describe('muxOggOpus — page packing limits', () => {
        test('a single packet larger than 8KB goes on its own EOS page', () => {
            const packets = [{
                data: new Uint8Array(9000).fill(0x42),
                timestamp: 0,
                duration: 20000,
            }];
            const result = muxOggOpus(packets, 48000, 2);
            const pages = parseOggPages(result);
            // The last page is EOS and contains the 9000-byte packet.
            const last = pages[pages.length - 1];
            expect(last.headerType & 0x04).toBe(0x04); // EOS
            expect(last.packetData.length).toBe(9000);
        });

        test('segment count stays under 255 per page', () => {
            // 100 packets of 1 byte each → 100 segments (< 255), all on one page.
            const packets = Array.from({ length: 100 }, (_, i) => ({
                data: new Uint8Array([i]),
                timestamp: i * 10000,
                duration: 10000,
            }));
            const result = muxOggOpus(packets, 48000, 2);
            const pages = parseOggPages(result);
            for (const page of pages) {
                expect(page.numSegments).toBeLessThanOrEqual(255);
            }
        });

        test('page data size stays under 8192 + single-packet overhead', () => {
            // Many small packets that pack densely
            const packets = Array.from({ length: 50 }, (_, i) => ({
                data: new Uint8Array(200).fill(i),
                timestamp: i * 20000,
                duration: 20000,
            }));
            const result = muxOggOpus(packets, 48000, 2);
            const pages = parseOggPages(result);
            for (const page of pages) {
                // Each non-final page must respect the 8192 limit (final may also).
                // Allow the final page to hold whatever remains.
                expect(page.packetData.length).toBeLessThanOrEqual(8192 + 200);
            }
        });
    });

    describe('muxOggOpus — byte-level integrity', () => {
        test('output starts with "OggS" capture pattern', () => {
            const result = muxOggOpus([], 48000, 2);
            expect(result[0]).toBe(0x4f); // O
            expect(result[1]).toBe(0x67); // g
            expect(result[2]).toBe(0x67); // g
            expect(result[3]).toBe(0x53); // S
        });

        test('output is non-empty even for empty packet list (headers + EOS)', () => {
            const result = muxOggOpus([], 48000, 2);
            // OpusHead page: 27 + 1 + 19 = 47 bytes
            // OpusTags page: 27 + 1 + 34 = 62 bytes
            // Empty EOS page: 27 + 0 = 27 bytes (segment table has 0 entries)
            // Total = 47 + 62 + 27 = 136 bytes
            expect(result.length).toBeGreaterThan(100);
        });

        test('all packet data bytes are preserved in output', () => {
            const packetData = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03]);
            const packets = [{ data: packetData, timestamp: 0, duration: 20000 }];
            const result = muxOggOpus(packets, 48000, 2);
            const pages = parseOggPages(result);
            expect(pages[2].packetData).toEqual(packetData);
        });
    });
});
