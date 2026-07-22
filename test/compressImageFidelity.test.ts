// test/compressImageFidelity.test.ts
import {
    installImageCompressionMock,
    uninstallImageCompressionMock,
    ImageCompressionMockHandle,
} from './helpers/imageCompressionMock';
import { compressImage, calculateTargetDimensions } from '../src/utils/mediaCompression/compressImage';
import { ImageCompressionOptions } from '../src/utils/mediaCompression/compressionTypes';

const jpegOptions: ImageCompressionOptions = {
    maxDimension: 800,
    quality: 0.8,
    mimeType: 'image/jpeg',
};

describe('media-compression-review MAJOR Image corruption', () => {
    describe('imageCompressionMock harness (smoke)', () => {
        let mock: ImageCompressionMockHandle;

        beforeEach(() => {
            mock = installImageCompressionMock({
                bitmapWidth: 1000,
                bitmapHeight: 1000,
                toBlobBytes: new Uint8Array(50), // smaller than the 100-byte original
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

    describe('#img-1 EXIF orientation is respected', () => {
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

    describe('#img-6 calculateTargetDimensions guards zero dimensions', () => {
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

    describe('#img-6 compressImage passes through on zero output dimensions', () => {
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

    describe('#img-2 transparency is preserved (alpha-aware format)', () => {
        // Minimal PNG: signature + IHDR (length 13) with the given color type.
        // Note: return type inferred (Uint8Array<ArrayBuffer>) so it's a valid BlobPart.
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
            expect(result.fileName).toBe('logo.png'); // kept .png, not .jpg
            expect(mock.toBlobCalls[0].mimeType).toBe('image/png');
            expect(mock.fillRectCalls).toHaveLength(0); // no white fill
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
            expect(mock.fillRectCalls).toHaveLength(1); // white fill applied
        });
    });
});
