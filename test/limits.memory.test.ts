import { MAX_MEDIA_BYTES } from '../src/utils/mediaCompression/limits';

describe('limits', () => {
    test('MAX_MEDIA_BYTES caps the size of media handed to the compressor', () => {
        // Applied before decode/encode, bounding peak memory; Mediabunny streams blob reads, so no separate decoded-PCM ceiling.
        expect(MAX_MEDIA_BYTES).toBe(200 * 1024 * 1024);
    });
});
