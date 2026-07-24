import { parseImageDimensions, calculateTargetDimensions, compressImage } from '../src/utils/mediaCompression/compressImage';
import { compressionPresets } from '../src/utils/mediaCompression/compressionPresets';

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

describe('calculateTargetDimensions', () => {
    test('scales down landscape image to maxDimension', () => {
        expect(calculateTargetDimensions(1600, 1200, 800)).toEqual({ width: 800, height: 600 });
    });

    test('scales down portrait image to maxDimension', () => {
        expect(calculateTargetDimensions(1200, 1600, 800)).toEqual({ width: 600, height: 800 });
    });

    test('returns original dimensions when within maxDimension', () => {
        expect(calculateTargetDimensions(400, 300, 800)).toEqual({ width: 400, height: 300 });
    });

    test('returns original dimensions for square image within maxDimension', () => {
        expect(calculateTargetDimensions(800, 800, 800)).toEqual({ width: 800, height: 800 });
    });

    test('scales down square image exceeding maxDimension', () => {
        expect(calculateTargetDimensions(1000, 1000, 800)).toEqual({ width: 800, height: 800 });
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
        // createImageBitmap allocates the full raster; guard must reject before it's invoked.
        const createBitmapMock = jest.fn();
        (globalThis as { createImageBitmap?: unknown }).createImageBitmap = createBitmapMock;

		// 40000x40000 PNG ~ 1.6e9 pixels, far above MAX_IMAGE_PIXELS (33_177_600).
		const bytes = makePng(40000, 40000);
		const file = new File([new Uint8Array(bytes)], 'bomb.png', { type: 'image/png' });

        const result = await compressImage(file, compressionPresets.medium.image);

        expect(createBitmapMock).not.toHaveBeenCalled();
        expect(result.wasCompressed).toBe(false);
        expect(result.fileName).toBe('bomb.png');
        expect(result.data.length).toBe(bytes.length);
    });

    test('lets a normally-sized PNG through to the existing pipeline', async () => {
        // Guard must not short-circuit legit images; jsdom lacks canvas/toBlob so it falls back to passthrough — no pre-decode rejection.
        const createBitmapMock = jest.fn().mockResolvedValue({
            width: 100,
            height: 100,
            close: () => {},
        });
        (globalThis as { createImageBitmap?: unknown }).createImageBitmap = createBitmapMock;

        const small = makePng(100, 100);
        const file = new File([new Uint8Array(small)], 'small.png', { type: 'image/png' });

        await compressImage(file, compressionPresets.medium.image);

        expect(createBitmapMock).toHaveBeenCalledTimes(1);
    });
});
