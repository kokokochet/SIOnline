import * as fs from 'fs';
import * as path from 'path';
import { muxOggOpus } from '../src/utils/mediaCompression/oggOpusMuxer';

interface FixtureCase {
    name: string;
    packets: { data: Uint8Array; timestamp: number; duration: number }[];
    sampleRate: number;
    channels: number;
}

const fixturesDir = path.resolve(__dirname, 'fixtures', 'ogg');

const cases: FixtureCase[] = [
    {
        name: 'empty',
        packets: [],
        sampleRate: 48000,
        channels: 2,
    },
    {
        name: 'three-packets-100b',
        packets: [
            { data: new Uint8Array(100).fill(0x01), timestamp: 0, duration: 20000 },
            { data: new Uint8Array(100).fill(0x02), timestamp: 20000, duration: 20000 },
            { data: new Uint8Array(100).fill(0x03), timestamp: 40000, duration: 20000 },
        ],
        sampleRate: 48000,
        channels: 2,
    },
    {
        name: 'max-segment-65024',
        packets: [{ data: new Uint8Array(65024).fill(0x42), timestamp: 0, duration: 20000 }],
        sampleRate: 48000,
        channels: 2,
    },
];

describe('media-compression-review MAJOR: OGG golden vectors (byte-exact regression pinning)', () => {
    test.each(cases)('$name: muxer output matches committed .expected.ogg byte-for-byte', (c) => {
        const fixturePath = path.join(fixturesDir, `${c.name}.expected.ogg`);
        const expected = fs.readFileSync(fixturePath);
        const actual = muxOggOpus(c.packets, c.sampleRate, c.channels);

        // Byte-for-byte comparison. If this fails, the muxer output has changed;
        // regenerate via `npx ts-node --project tsconfig.test.json test/helpers/generate-ogg-fixtures.ts` only
        // if the change is intentional.
        expect(actual.byteLength).toBe(expected.byteLength);
        // Buffer.from(actual) lets jest print a diff on failure.
        expect(Buffer.from(actual)).toEqual(expected);
    });

    test('the committed manifest.json matches the current muxer output structure', () => {
        const manifestPath = path.join(fixturesDir, 'manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
            [name: string]: { bytes: number; pages: { numSegments: number; dataLength: number }[] };
        };
        for (const c of cases) {
            const actual = muxOggOpus(c.packets, c.sampleRate, c.channels);
            expect(manifest[c.name].bytes).toBe(actual.byteLength);
        }
    });
});
