import { parseImageDimensions, calculateTargetDimensions, compressImage } from '../src/utils/mediaCompression/compressImage';
import { mediumPreset } from '../src/utils/mediaCompression/compressionPresets';

/** Minimal PNG byte stream with the given IHDR width/height and no pixel data. */
function makePng(width: number, height: number): Uint8Array {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]; // PNG signature
    const length = [0x00, 0x00, 0x00, 0x0d]; // IHDR data length = 13
    const type = [0x49, 0x48, 0x44, 0x52]; // 'IHDR'
    const w = [width >>> 24, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff];
    const h = [height >>> 24, (height >>> 16) & 0xff, (height >>> 8) & 0xff, height & 0xff];
    const rest = [0x08, 0x02, 0x00, 0x00, 0x00]; // bit depth 8, color type 2 (RGB), compression/filter/interlace
    const crc = [0x00, 0x00, 0x00, 0x00]; // CRC not validated by dimension parsing
    return new Uint8Array([...sig, ...length, ...type, ...w, ...h, ...rest, ...crc]);
}

/** Minimal JPEG byte stream with an SOF0 frame of the given width/height. */
function makeJpeg(width: number, height: number): Uint8Array {
    // SOI + an APP0-ish segment we skip via its length + SOF0.
    const soi = [0xff, 0xd8];
    // APP0 marker + 2-byte length (say 16, includes the length bytes).
    const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
    // SOF0 marker: precision(1) + height(2 BE) + width(2 BE) + components(1) + ...
    const wHi = (width >>> 8) & 0xff;
    const wLo = width & 0xff;
    const hHi = (height >>> 8) & 0xff;
    const hLo = height & 0xff;
    const sof0 = [0xff, 0xc0, 0x00, 0x0b, 0x08, hHi, hLo, wHi, wLo, 0x01, 0x01, 0x11, 0x00];
    const eoi = [0xff, 0xd9];
    return new Uint8Array([...soi, ...app0, ...sof0, ...eoi]);
}

describe('parseImageDimensions', () => {
    test('reads width and height from a PNG IHDR chunk', () => {
        expect(parseImageDimensions(makePng(1920, 1080))).toEqual({ width: 1920, height: 1080 });
    });

    test('reads the oversized 40000x40000 decompression-bomb PNG without decoding it', () => {
        // ~1.6 billion pixels — the exact payload the post-decode guard fails on.
        expect(parseImageDimensions(makePng(40000, 40000))).toEqual({ width: 40000, height: 40000 });
    });

    test('reads width and height from a JPEG SOF0 segment, skipping APPn segments', () => {
        expect(parseImageDimensions(makeJpeg(1280, 720))).toEqual({ width: 1280, height: 720 });
    });

    test('returns null for an unknown / truncated format', () => {
        expect(parseImageDimensions(new Uint8Array([0x00, 0x01, 0x02]))).toBeNull();
    });

    test('returns null for an empty buffer', () => {
        expect(parseImageDimensions(new Uint8Array(0))).toBeNull();
    });
});

// Re-exercise the pre-existing pure helper to lock in its contract while we are
// in this file (no behavior change expected).
describe('calculateTargetDimensions (unchanged)', () => {
    test('scales down landscape image to maxDimension', () => {
        expect(calculateTargetDimensions(1600, 1200, 800)).toEqual({ width: 800, height: 600 });
    });
});

describe('compressImage decompression-bomb guard', () => {
    const originalCreateImageBitmap = (globalThis as { createImageBitmap?: unknown }).createImageBitmap;

    afterEach(() => {
        if (originalCreateImageBitmap !== undefined) {
            (globalThis as { createImageBitmap?: unknown }).createImageBitmap = originalCreateImageBitmap;
        } else {
            delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
        }
    });

    test('returns passthrough for an oversized PNG WITHOUT calling createImageBitmap', async () => {
        // createImageBitmap is the expensive step that allocates the full raster.
        // The guard must reject before it is ever invoked. We assert the spy is
        // never called — if it is, the bomb would already have OOMed in a browser.
        const createBitmapMock = jest.fn();
        (globalThis as { createImageBitmap?: unknown }).createImageBitmap = createBitmapMock;

        // 40000x40000 PNG = ~1.6e9 pixels, far above MAX_IMAGE_PIXELS (33_177_600).
        // Built via the same IHDR helper as the dimension-parsing test.
        const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
        const length = [0x00, 0x00, 0x00, 0x0d];
        const type = [0x49, 0x48, 0x44, 0x52];
        const w = [0x00, 0x00, 0x9c, 0x40]; // 40000
        const h = [0x00, 0x00, 0x9c, 0x40]; // 40000
        const rest = [0x08, 0x02, 0x00, 0x00, 0x00];
        const crc = [0x00, 0x00, 0x00, 0x00];
        const bytes = new Uint8Array([...sig, ...length, ...type, ...w, ...h, ...rest, ...crc]);
        const file = new File([bytes], 'bomb.png', { type: 'image/png' });

        const result = await compressImage(file, mediumPreset.image);

        expect(createBitmapMock).not.toHaveBeenCalled();
        expect(result.wasCompressed).toBe(false);
        expect(result.fileName).toBe('bomb.png');
        // Passthrough preserves original bytes.
        expect(result.data.length).toBe(bytes.length);
    });

    test('lets a normally-sized PNG through to the existing pipeline', async () => {
        // Smoke test: the guard must NOT short-circuit legitimate images. The
        // jest node env has no real canvas/toBlob, so compressImage falls back
        // to passthrough via its outer try/catch — the point is that it does NOT
        // reject on the pre-decode guard for a 100x100 image.
        const createBitmapMock = jest.fn().mockResolvedValue({
            width: 100,
            height: 100,
            close: () => {},
        });
        (globalThis as { createImageBitmap?: unknown }).createImageBitmap = createBitmapMock;

        const small = makePng(100, 100);
        const file = new File([new Uint8Array(small)], 'small.png', { type: 'image/png' });

        await compressImage(file, mediumPreset.image);

        // A legitimate image reaches createImageBitmap (the guard did not fire).
        expect(createBitmapMock).toHaveBeenCalledTimes(1);
    });
});
