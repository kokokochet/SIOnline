import { DataStream } from 'mp4box';
import { getCodecDescription } from '../src/utils/mediaCompression/codecDescription';

/** Builds a fake codec config box that serializes itself like an mp4box box (8-byte header + payload). */
function fakeConfigBox(payload: number[]): { write(stream: DataStream): void } {
    return {
        write(stream: DataStream) {
            stream.writeUint32(payload.length + 8);
            stream.writeUint8Array([0x61, 0x76, 0x63, 0x43]); // 'avcC' fourcc
            stream.writeUint8Array(payload);
        },
    };
}

describe('getCodecDescription', () => {
    test('returns undefined when sample is undefined', () => {
        expect(getCodecDescription(undefined)).toBeUndefined();
    });

    test('returns undefined when entry has no known config box (e.g. mp4a audio entry)', () => {
        expect(getCodecDescription({ description: {} as never })).toBeUndefined();
    });

    test('serializes avcC and strips the 8-byte box header', () => {
        const payload = [0x01, 0x64, 0x00, 0x1e, 0xff];
        const description = { avcC: fakeConfigBox(payload) };
        const result = getCodecDescription({ description: description as never });
        expect(result).toEqual(new Uint8Array(payload));
    });

    test('falls back to hvcC when avcC is absent', () => {
        const payload = [0x01, 0x01, 0x60];
        const description = { hvcC: fakeConfigBox(payload) };
        const result = getCodecDescription({ description: description as never });
        expect(result).toEqual(new Uint8Array(payload));
    });
});
