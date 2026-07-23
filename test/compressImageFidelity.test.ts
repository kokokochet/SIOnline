import {
    installImageCompressionMock,
    uninstallImageCompressionMock,
    ImageCompressionMockHandle,
} from './helpers/imageCompressionMock';
import { compressImage, calculateTargetDimensions } from '../src/utils/mediaCompression/compressImage';
import { ImageCompressionOptions } from '../src/utils/mediaCompression/compressionTypes';
import {
    hasAlphaChannel,
    detectImageFormat,
} from '../src/utils/mediaCompression/imageFormatDetect';

const jpegOptions: ImageCompressionOptions = {
    maxDimension: 800,
    quality: 0.8,
    mimeType: 'image/jpeg',
};

describe('image corruption', () => {
    describe('imageCompressionMock harness (smoke)', () => {
        let mock: ImageCompressionMockHandle;

        beforeEach(() => {
            mock = installImageCompressionMock({
                bitmapWidth: 1000,
                bitmapHeight: 1000,
                toBlobBytes: new Uint8Array(50),
            });
        });

        afterEach(() => {
            uninstallImageCompressionMock();
        });

        test('drives the existing canvas path to a compressed JPEG result', async () => {
            const file = new File([new Uint8Array(100)], 'photo.jpg', { type: 'image/jpeg' });
            const result = await compressImage(file, jpegOptions);

            expect(result.wasCompressed).toBe(true);
            expect(result.fileName).toBe('photo.jpg');
            expect(result.compressedSize).toBe(50);
            expect(mock.createImageBitmapCalls).toHaveLength(1);
            expect(mock.toBlobCalls).toHaveLength(1);
            expect(mock.toBlobCalls[0].mimeType).toBe('image/jpeg');
        });
    });

    describe('EXIF orientation is respected', () => {
        let mock: ImageCompressionMockHandle;

        beforeEach(() => {
            mock = installImageCompressionMock({
                bitmapWidth: 1600,
                bitmapHeight: 1200,
                toBlobBytes: new Uint8Array(10),
            });
        });

        afterEach(() => {
            uninstallImageCompressionMock();
        });

        test('createImageBitmap is called with imageOrientation:"from-image"', async () => {
            const file = new File([new Uint8Array(100)], 'portrait.jpg', { type: 'image/jpeg' });
            await compressImage(file, jpegOptions);

            expect(mock.createImageBitmapCalls[0].options).toEqual({
                imageOrientation: 'from-image',
            });
        });
    });

    describe('calculateTargetDimensions guards zero dimensions', () => {
        test('returns null when input width is 0', () => {
            expect(calculateTargetDimensions(0, 100, 800)).toBeNull();
        });

        test('returns null when input height is 0', () => {
            expect(calculateTargetDimensions(100, 0, 800)).toBeNull();
        });

        test('returns null when maxDimension is 0', () => {
            expect(calculateTargetDimensions(100, 100, 0)).toBeNull();
        });

        test('returns null when downscale produces a zero height', () => {
            // height/width*max = 1/10000*800 = 0.08 → Math.round(0) = 0
            expect(calculateTargetDimensions(10000, 1, 800)).toBeNull();
        });

        test('returns null when downscale produces a zero width', () => {
            expect(calculateTargetDimensions(1, 10000, 800)).toBeNull();
        });

        test('still scales valid landscape inputs (regression)', () => {
            expect(calculateTargetDimensions(1600, 1200, 800)).toEqual({ width: 800, height: 600 });
        });
    });

    describe('compressImage passes through on zero output dimensions', () => {
        let mock: ImageCompressionMockHandle;

        afterEach(() => {
            uninstallImageCompressionMock();
        });

        test('passes through when the decoded bitmap has zero width', async () => {
            mock = installImageCompressionMock({
                bitmapWidth: 0,
                bitmapHeight: 100,
                toBlobBytes: new Uint8Array(1),
            });
            const file = new File([new Uint8Array(10)], 'edge.jpg', { type: 'image/jpeg' });

            const result = await compressImage(file, jpegOptions);

            expect(result.wasCompressed).toBe(false);
            expect(result.fileName).toBe('edge.jpg');
            expect(mock.toBlobCalls).toHaveLength(0);
        });
    });

    describe('transparency is preserved (alpha-aware format)', () => {
        function makePngIhdr(colorType: number, bitDepth = 8) {
            return new Uint8Array([
                0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
                0x00, 0x00, 0x00, 0x0d, // IHDR length = 13
                0x49, 0x48, 0x44, 0x52, // "IHDR"
                0x00, 0x00, 0x00, 0x01, // width = 1
                0x00, 0x00, 0x00, 0x01, // height = 1
                bitDepth, // offset 24
                colorType, // offset 25
                0x00, 0x00, 0x00, // compression, filter, interlace
            ]);
        }

        let mock: ImageCompressionMockHandle;

        afterEach(() => {
            uninstallImageCompressionMock();
        });

        test('RGBA PNG (color type 6) is re-encoded as PNG and skips the white fill', async () => {
            mock = installImageCompressionMock({
                bitmapWidth: 100,
                bitmapHeight: 100,
                toBlobBytes: new Uint8Array(10),
            });
            const file = new File([makePngIhdr(6)], 'logo.png', { type: 'image/png' });

            const result = await compressImage(file, jpegOptions);

            expect(result.wasCompressed).toBe(true);
            expect(result.fileName).toBe('logo.png');
            expect(mock.toBlobCalls[0].mimeType).toBe('image/png');
            expect(mock.fillRectCalls).toHaveLength(0);
        });

        test('gray+alpha PNG (color type 4) is re-encoded as PNG', async () => {
            mock = installImageCompressionMock({
                bitmapWidth: 100,
                bitmapHeight: 100,
                toBlobBytes: new Uint8Array(10),
            });
            const file = new File([makePngIhdr(4)], 'alpha.png', { type: 'image/png' });

            const result = await compressImage(file, jpegOptions);

            expect(result.fileName).toBe('alpha.png');
            expect(mock.toBlobCalls[0].mimeType).toBe('image/png');
            expect(mock.fillRectCalls).toHaveLength(0);
        });

        test('opaque PNG (color type 2) keeps the JPEG path and white fill', async () => {
            mock = installImageCompressionMock({
                bitmapWidth: 100,
                bitmapHeight: 100,
                toBlobBytes: new Uint8Array(10),
            });
            const file = new File([makePngIhdr(2)], 'photo.png', { type: 'image/png' });

            await compressImage(file, jpegOptions);

            expect(mock.toBlobCalls[0].mimeType).toBe('image/jpeg');
            expect(mock.fillRectCalls).toHaveLength(1);
        });
    });

    describe('animation is preserved (content-based passthrough)', () => {
        function makeGif() {
            // GIF89a magic bytes + a minimal logical screen descriptor.
            return new Uint8Array([
                0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // "GIF89a"
                0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, // canvas w/h/packed
                0xff, 0xff, 0xff, 0x00, 0x00, 0x00, // palette
                0x3b, // trailer
            ]);
        }

        function makeAnimatedWebp() {
            return new Uint8Array([
                0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, // "RIFF" + size
                0x57, 0x45, 0x42, 0x50, // "WEBP"
                0x41, 0x4e, 0x49, 0x4d, 0x00, 0x00, 0x00, 0x00, // "ANIM" chunk
            ]);
        }

        function makeApng() {
            // signature + IHDR(13) + dummy CRC + acTL(8) + dummy CRC
            return new Uint8Array([
                0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
                0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR len + "IHDR"
                0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // w=1, h=1
                0x08, 0x02, 0x00, 0x00, 0x00, // bitDepth=8, colorType=2, comp/filter/interlace
                0x00, 0x00, 0x00, 0x00, // CRC (dummy)
                0x00, 0x00, 0x00, 0x08, 0x61, 0x63, 0x54, 0x4c, // acTL len=8 + "acTL"
                0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, // num_frames=1, num_plays=0
                0x00, 0x00, 0x00, 0x00, // CRC (dummy)
            ]);
        }

        function makeStaticPng() {
            // signature + IHDR only (no acTL) → static.
            return new Uint8Array([
                0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
                0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
                0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
                0x08, 0x02, 0x00, 0x00, 0x00,
            ]);
        }

        let mock: ImageCompressionMockHandle;

        beforeEach(() => {
            mock = installImageCompressionMock({
                bitmapWidth: 100,
                bitmapHeight: 100,
                toBlobBytes: new Uint8Array(1),
            });
        });

        afterEach(() => {
            uninstallImageCompressionMock();
        });

        test('animated WebP passes through unchanged', async () => {
            const bytes = makeAnimatedWebp();
            const file = new File([bytes], 'anim.webp', { type: 'image/webp' });

            const result = await compressImage(file, jpegOptions);

            expect(result.wasCompressed).toBe(false);
            expect(result.fileName).toBe('anim.webp');
            expect(mock.toBlobCalls).toHaveLength(0);
        });

        test('APNG (acTL chunk) passes through unchanged', async () => {
            const bytes = makeApng();
            const file = new File([bytes], 'anim.png', { type: 'image/png' });

            const result = await compressImage(file, jpegOptions);

            expect(result.wasCompressed).toBe(false);
            expect(result.fileName).toBe('anim.png');
            expect(mock.toBlobCalls).toHaveLength(0);
        });

        test('GIF passes through by magic bytes even with a non-.gif filename', async () => {
            const file = new File([makeGif()], 'photo.jpg', { type: 'image/jpeg' });

            const result = await compressImage(file, jpegOptions);

            expect(result.wasCompressed).toBe(false);
            expect(result.fileName).toBe('photo.jpg');
            expect(mock.toBlobCalls).toHaveLength(0);
        });

        test('static PNG (no acTL) still proceeds to compression (regression)', async () => {
            const file = new File([makeStaticPng()], 'still.png', { type: 'image/png' });

            // Only assert animation detection didn't short-circuit (toBlobBytes 1 < PNG 29 bytes).
            await compressImage(file, jpegOptions);

            expect(mock.createImageBitmapCalls).toHaveLength(1);
        });
    });

    describe('SVG passes through (no lossy rasterization)', () => {
        let mock: ImageCompressionMockHandle;

        beforeEach(() => {
            mock = installImageCompressionMock({
                bitmapWidth: 100,
                bitmapHeight: 100,
                toBlobBytes: new Uint8Array(1),
            });
        });

        afterEach(() => {
            uninstallImageCompressionMock();
        });

        test('inline SVG content passes through unchanged', async () => {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>`;
            const file = new File([svg], 'icon.svg', { type: 'image/svg+xml' });

            const result = await compressImage(file, jpegOptions);

            expect(result.wasCompressed).toBe(false);
            expect(result.fileName).toBe('icon.svg');
            expect(mock.toBlobCalls).toHaveLength(0);
            expect(mock.createImageBitmapCalls).toHaveLength(0);
        });

        test('SVG with an XML declaration still passes through', async () => {
            const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg viewBox="0 0 24 24"></svg>`;
            const file = new File([svg], 'logo.svg', { type: 'image/svg+xml' });

            const result = await compressImage(file, jpegOptions);

            expect(result.wasCompressed).toBe(false);
            expect(mock.toBlobCalls).toHaveLength(0);
        });

        test('SVGZ (gzipped SVG, gzip magic bytes 0x1f 0x8b) passes through unchanged', async () => {
            // SVGZ: gzip magic + zeros, no <svg/image signature; without the gzip-magic guard it would rasterize.
            const svgz = new Uint8Array([0x1f, 0x8b, ...new Uint8Array(30)]);
            const file = new File([svgz], 'icon.svgz', { type: 'image/svg+xml' });

            const result = await compressImage(file, jpegOptions);

            expect(result.wasCompressed).toBe(false);
            expect(result.fileName).toBe('icon.svgz');
            expect(mock.toBlobCalls).toHaveLength(0);
            expect(mock.createImageBitmapCalls).toHaveLength(0);
        });
    });

    describe('color fidelity (lossless escape hatch + 16-bit guard)', () => {
        function makePngIhdr(colorType: number, bitDepth = 8) {
            return new Uint8Array([
                0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
                0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
                0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
                bitDepth, colorType, 0x00, 0x00, 0x00,
            ]);
        }

        let mock: ImageCompressionMockHandle;

        beforeEach(() => {
            mock = installImageCompressionMock({
                bitmapWidth: 100,
                bitmapHeight: 100,
                toBlobBytes: new Uint8Array(1),
            });
        });

        afterEach(() => {
            uninstallImageCompressionMock();
        });

        test('lossless option bypasses the canvas re-encode', async () => {
            const file = new File([new Uint8Array(100)], 'profile.jpg', { type: 'image/jpeg' });

            const result = await compressImage(file, { ...jpegOptions, lossless: true });

            expect(result.wasCompressed).toBe(false);
            expect(result.fileName).toBe('profile.jpg');
            expect(mock.createImageBitmapCalls).toHaveLength(0);
            expect(mock.toBlobCalls).toHaveLength(0);
        });

        test('16-bit PNG passes through (canvas would clip to 8-bit)', async () => {
            const file = new File([makePngIhdr(2, 16)], 'hdr.png', { type: 'image/png' });

            const result = await compressImage(file, jpegOptions);

            expect(result.wasCompressed).toBe(false);
            expect(result.fileName).toBe('hdr.png');
            expect(mock.toBlobCalls).toHaveLength(0);
        });

        test('8-bit PNG still proceeds to compression (regression)', async () => {
            const file = new File([makePngIhdr(2, 8)], 'normal.png', { type: 'image/png' });

            await compressImage(file, jpegOptions);

            expect(mock.createImageBitmapCalls).toHaveLength(1);
        });
    });

    describe('compressionIrreversible warning discloses color loss', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const localization = (require('../src/model/resources/localization') as {
            default: { getString: (key: string, language?: string) => string };
        }).default;

        test('English warning mentions ICC and 8-bit', () => {
            const text = localization.getString('compressionIrreversible', 'en');
            expect(text).toMatch(/ICC/);
            expect(text).toMatch(/8-bit/);
        });

        test('Russian warning mentions ICC and 8-бит', () => {
            const text = localization.getString('compressionIrreversible', 'ru');
            expect(text).toMatch(/ICC/);
            expect(text).toMatch(/8-бит/);
        });
    });
});

describe('WebP alpha detection (imageFormatDetect)', () => {
    function concatBytes(...arrays: Uint8Array[]): Uint8Array {
        let total = 0;
        for (const a of arrays) {
            total += a.length;
        }
        const out = new Uint8Array(total);
        let pos = 0;
        for (const a of arrays) {
            out.set(a, pos);
            pos += a.length;
        }
        return out;
    }

    /** 12-byte RIFF/WEBP header; size left zero (unused by walker). */
    const WEBP_HEADER = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, // "RIFF"
        0x00, 0x00, 0x00, 0x00, // file size
        0x57, 0x45, 0x42, 0x50, // "WEBP"
    ]);

    /** VP8X: flags at offset 20, bit 0x10 = alpha flag. */
    function makeWebpVp8x(flags: number): Uint8Array {
        return concatBytes(
            WEBP_HEADER,
            new Uint8Array([
                0x56, 0x50, 0x38, 0x58, // "VP8X"
                0x0a, 0x00, 0x00, 0x00, // payload size = 10
                flags, // flags byte 0 (offset 20, dataStart)
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // rest of 10-byte payload
            ]),
        );
    }

    /** VP8L: alpha hint at offset 24 (dataStart+4), bit 0x10 = alpha used; 0x2f sig precedes. */
    function makeWebpVp8l(alphaHint: number): Uint8Array {
        return concatBytes(
            WEBP_HEADER,
            new Uint8Array([
                0x56, 0x50, 0x38, 0x4c, // "VP8L"
                0x00, 0x00, 0x00, 0x00, // payload size (unused by the walker)
                0x2f, // signature byte (offset 20, dataStart)
                0x00, 0x00, 0x00, // width/height bit fields (offsets 21-23)
                alphaHint, // alpha hint (offset 24, dataStart+4)
            ]),
        );
    }

    test('detectImageFormat returns "webp" for a RIFF/WEBP container', () => {
        expect(detectImageFormat(makeWebpVp8x(0x10))).toBe('webp');
        expect(detectImageFormat(makeWebpVp8l(0x10))).toBe('webp');
    });

    test('VP8X extended chunk with alpha flag (bit 0x10) reports alpha', () => {
        expect(hasAlphaChannel(makeWebpVp8x(0x10))).toBe(true);
    });

    test('VP8X extended chunk without the alpha flag is opaque', () => {
        expect(hasAlphaChannel(makeWebpVp8x(0x00))).toBe(false);
    });

    test('VP8L lossless chunk with alpha hint (bit 0x10) reports alpha', () => {
        expect(hasAlphaChannel(makeWebpVp8l(0x10))).toBe(true);
    });

    test('VP8L lossless chunk without the alpha hint is opaque', () => {
        expect(hasAlphaChannel(makeWebpVp8l(0x00))).toBe(false);
    });

    test('lossy VP8 chunk carries no alpha channel', () => {
        // "VP8 " (trailing space) is neither VP8X nor VP8L; walker skips it, no alpha signal.
        const lossy = concatBytes(
            WEBP_HEADER,
            new Uint8Array([
                0x56, 0x50, 0x38, 0x20, // "VP8 "
                0x00, 0x00, 0x00, 0x00, // payload size = 0
                0x00, // a payload byte so the chunk header parses
            ]),
        );
        expect(hasAlphaChannel(lossy)).toBe(false);
    });

    test('truncated WebP below a chunk header returns false (no throw)', () => {
        // 12 + 8 > length 14: chunk loop never starts. Safe default, no OOB read.
        const truncated = new Uint8Array([
            0x52, 0x49, 0x46, 0x46, // "RIFF"
            0x00, 0x00, 0x00, 0x00, // size
            0x57, 0x45, 0x42, 0x50, // "WEBP"
            0x56, 0x50, // start of a chunk type, cut immediately
        ]);
        expect(() => hasAlphaChannel(truncated)).not.toThrow();
        expect(hasAlphaChannel(truncated)).toBe(false);
    });

    test('WebP with a VP8X chunk header but no flags byte returns false (no OOB)', () => {
        // length 20 == dataStart 20: flags byte absent, guard returns false.
        const headerOnly = new Uint8Array([
            0x52, 0x49, 0x46, 0x46, // "RIFF"
            0x00, 0x00, 0x00, 0x00, // size
            0x57, 0x45, 0x42, 0x50, // "WEBP"
            0x56, 0x50, 0x38, 0x58, // "VP8X"
            0x00, 0x00, 0x00, 0x00, // size = 0
        ]);
        expect(() => hasAlphaChannel(headerOnly)).not.toThrow();
        expect(hasAlphaChannel(headerOnly)).toBe(false);
    });

    test('truncated PNG at or before the color-type byte returns false (no throw)', () => {
        // length 25: color-type byte at offset 25 absent, length guard returns false.
        const truncatedPng = new Uint8Array([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
            0x00, 0x00, 0x00, 0x0d, // IHDR length = 13
            0x49, 0x48, 0x44, 0x52, // "IHDR"
            0x00, 0x00, 0x00, 0x01, // width = 1
            0x00, 0x00, 0x00, 0x01, // height = 1
            0x08, // bitDepth (offset 24) - color type at offset 25 missing
        ]);
        expect(detectImageFormat(truncatedPng)).toBe('png');
        expect(() => hasAlphaChannel(truncatedPng)).not.toThrow();
        expect(hasAlphaChannel(truncatedPng)).toBe(false);
    });
});
