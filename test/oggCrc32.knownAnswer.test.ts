import { oggCrc32 } from '../src/utils/mediaCompression/oggOpusMuxer';

/**
 * Independent bitwise reference for OGG CRC-32.
 *
 * Deliberately uses NO lookup table and a different control structure
 * (bit-by-bit instead of table-lookup) so a bug in the source's table
 * generation (oggOpusMuxer.ts:11-21) or its update loop cannot be replicated
 * here. If the source and this reference disagree, one of them is wrong.
 */
function oggCrc32BitwiseReference(bytes: Uint8Array): number {
    let crc = 0;
    for (let i = 0; i < bytes.length; i++) {
        crc ^= bytes[i] << 24;
        for (let bit = 0; bit < 8; bit++) {
            if (crc & 0x80000000) {
                crc = ((crc << 1) ^ 0x04c11db7) >>> 0;
            } else {
                crc = (crc << 1) >>> 0;
            }
        }
    }
    return crc >>> 0;
}

function toBytes(s: string): Uint8Array {
    return new Uint8Array([...s].map((c) => c.charCodeAt(0)));
}

describe('media-compression-review MAJOR: OGG CRC-32 known-answer vectors', () => {
    describe('hardcoded known-answer vectors (independent of the source algorithm)', () => {
        // Each expected value was computed from the bitwise reference above
        // (poly 0x04c11db7, non-reflected, init 0, xorOut 0) — NOT from the
        // source's table-based implementation. A bug in the source's table
        // generation will fail these.

        test('CRC of empty input is 0x00000000', () => {
            expect(oggCrc32(new Uint8Array(0))).toBe(0x00000000);
        });

        test('CRC of "123456789" is 0x89A1897F (NOT 0xCBF43926 — that is the reflected ISO CRC)', () => {
            expect(oggCrc32(toBytes('123456789'))).toBe(0x89a1897f);
        });

        test('CRC of "OggS" (capture pattern) is 0x5FB0A94F', () => {
            expect(oggCrc32(toBytes('OggS'))).toBe(0x5fb0a94f);
        });

        test('CRC of a single 0x00 byte is 0x00000000', () => {
            expect(oggCrc32(new Uint8Array([0x00]))).toBe(0x00000000);
        });

        test('CRC of a single 0xFF byte is 0xB1F740B4', () => {
            // 0xFF << 24 seeds the register; each of 8 shifts XORs the poly
            // (MSB stays set throughout). Value confirmed by bitwise reference.
            expect(oggCrc32(new Uint8Array([0xff]))).toBe(0xb1f740b4);
        });

        test('CRC of a 256-byte ramp (0..255) is 0xAC148725', () => {
            const ramp = new Uint8Array(256);
            for (let i = 0; i < 256; i++) { ramp[i] = i; }
            // Hardcode the reference value so a bug in BOTH the source and the
            // bitwise reference is still caught. Confirmed via the standalone
            // verification command in Step 3.
            expect(oggCrc32(ramp)).toBe(0xac148725);
            expect(oggCrc32(ramp)).toBe(oggCrc32BitwiseReference(ramp));
        });
    });

    describe('property: source table-based impl matches bitwise reference', () => {
        const seeds: Uint8Array[] = [
            new Uint8Array(0),
            new Uint8Array([0x01]),
            new Uint8Array([0xff]),
            toBytes('OpusHead'),
            toBytes('SIOnline WebCodecs'),
            (() => { const b = new Uint8Array(65024); b.fill(0x42); return b; })(),
            (() => {
                // pseudo-random but deterministic
                const b = new Uint8Array(1000);
                for (let i = 0; i < b.length; i++) { b[i] = (i * 1103515245 + 12345) & 0xff; }
                return b;
            })(),
        ];

        test.each(seeds)('source oggCrc32 === bitwise reference (length %i)', (bytes) => {
            expect(oggCrc32(bytes)).toBe(oggCrc32BitwiseReference(bytes));
        });
    });
});
