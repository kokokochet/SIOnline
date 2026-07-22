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
});
