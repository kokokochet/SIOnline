import { compressMedia } from '../src/utils/mediaCompression';
import { compressionPresets } from '../src/utils/mediaCompression/compressionPresets';

describe('compressMedia (public API)', () => {
    test('returns passthrough for image when image compression not available', async () => {
        const originalDoc = globalThis.document;
        delete (globalThis as Record<string, unknown>).document;

        try {
            const file = new File([new Uint8Array([1, 2, 3])], 'test.png', { type: 'image/png' });
            const result = await compressMedia(file, 'image', compressionPresets.medium);

            expect(result.wasCompressed).toBe(false);
        } finally {
            if (originalDoc) {
                globalThis.document = originalDoc;
            }
        }
    });
});
