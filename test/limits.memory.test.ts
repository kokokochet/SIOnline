import { MAX_MEDIA_BYTES } from '../src/utils/mediaCompression/limits';

describe('limits', () => {
    test('MAX_MEDIA_BYTES caps the size of media handed to the compressor', () => {
        // Applied before any decode/encode, bounding peak memory for both upload
        // and bulk compression. Mediabunny streams reads from the blob, so there
        // is no longer a separate "decoded PCM" ceiling to enforce.
        expect(MAX_MEDIA_BYTES).toBe(200 * 1024 * 1024);
    });
});
