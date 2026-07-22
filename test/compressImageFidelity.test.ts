// test/compressImageFidelity.test.ts
import {
    installImageCompressionMock,
    uninstallImageCompressionMock,
    ImageCompressionMockHandle,
} from './helpers/imageCompressionMock';
import { compressImage } from '../src/utils/mediaCompression/compressImage';
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
});
