/**
 * One-shot generator for OGG Opus golden-vector fixtures.
 *
 * Usage:  npx ts-node --project tsconfig.test.json test/helpers/generate-ogg-fixtures.ts
 *
 * NOTE: `--project tsconfig.test.json` is REQUIRED. The repo pins TypeScript 6
 * and the root tsconfig.json's ts-node block has no `ignoreDeprecations`, so a
 * bare `npx ts-node ...` aborts with TS5107 (moduleResolution=node10 deprecation).
 * tsconfig.test.json sets `ignoreDeprecations: "6.0"`, which silences the error.
 *
 * Re-runs the muxer for three tiny inputs and writes:
 *   - test/fixtures/ogg/<name>.expected.ogg   (binary, the muxer output)
 *   - test/fixtures/ogg/manifest.json         (human-readable page structure)
 *
 * Fixtures are committed. Re-run only when the muxer's byte output is
 * *intentionally* changed; the diff makes the change visible in code review.
 *
 * IMPORTANT: these fixtures pin the byte-exact output of `muxOggOpus` as of
 * the generation commit. They catch REGRESSIONS. Spec correctness of the CRC
 * is independently verified by test/oggCrc32.knownAnswer.test.ts (T64),
 * and the OpusHead/OpusTags field layout by the existing field-level tests in
 * oggOpusMuxer.test.ts.
 */
import * as fs from 'fs';
import * as path from 'path';
import { muxOggOpus } from '../../src/utils/mediaCompression/oggOpusMuxer';

interface FixtureSpec {
    name: string;
    packets: { data: Uint8Array; timestamp: number; duration: number }[];
    sampleRate: number;
    channels: number;
    description: string;
}

const specs: FixtureSpec[] = [
    {
        name: 'empty',
        packets: [],
        sampleRate: 48000,
        channels: 2,
        description: 'Empty packet list → OpusHead + OpusTags + empty EOS (3 pages, 136 bytes).',
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
        description: 'Three 100-byte packets on one audio page; segment table [100, 100, 100].',
    },
    {
        name: 'max-segment-65024',
        packets: [
            {
                // floor(65024/255) + 1 = 255 — the maximum legal segment-table size.
                // Boundary case asserted by Phase 4 T28 (>65025 must throw).
                data: new Uint8Array(65024).fill(0x42),
                timestamp: 0,
                duration: 20000,
            },
        ],
        sampleRate: 48000,
        channels: 2,
        description: 'Single 65024-byte packet → 255 segment-table entries (the OGG uint8 max).',
    },
];

interface PageDump {
    index: number;
    headerType: number;
    granulePosition: string;
    pageSequence: number;
    numSegments: number;
    segmentTable: number[];
    dataLength: number;
}

function parsePagesForManifest(data: Uint8Array): PageDump[] {
    const pages: PageDump[] = [];
    let offset = 0;
    let index = 0;
    while (offset < data.length) {
        const view = new DataView(data.buffer, offset, data.length - offset);
        const headerType = view.getUint8(5);
        const granulePosition = view.getBigUint64(6, true).toString();
        const pageSequence = view.getUint32(18, true);
        const numSegments = view.getUint8(26);
        const segmentTable: number[] = [];
        let dataSize = 0;
        for (let i = 0; i < numSegments; i++) {
            const seg = view.getUint8(27 + i);
            segmentTable.push(seg);
            dataSize += seg;
        }
        pages.push({
            index: index++,
            headerType,
            granulePosition,
            pageSequence,
            numSegments,
            segmentTable,
            dataLength: dataSize,
        });
        offset += 27 + numSegments + dataSize;
    }
    return pages;
}

function main(): void {
    const outDir = path.resolve(__dirname, '..', 'fixtures', 'ogg');
    fs.mkdirSync(outDir, { recursive: true });

    const manifest: { [name: string]: { description: string; bytes: number; pages: PageDump[] } } = {};

    for (const spec of specs) {
        const bytes = muxOggOpus(spec.packets, spec.sampleRate, spec.channels);
        const file = path.join(outDir, `${spec.name}.expected.ogg`);
        fs.writeFileSync(file, bytes);
        manifest[spec.name] = {
            description: spec.description,
            bytes: bytes.length,
            pages: parsePagesForManifest(bytes),
        };
        // eslint-disable-next-line no-console
        console.log(`wrote ${file} (${bytes.length} bytes)`);
    }

    fs.writeFileSync(
        path.join(outDir, 'manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
    );
    // eslint-disable-next-line no-console
    console.log(`wrote ${path.join(outDir, 'manifest.json')}`);
}

main();
