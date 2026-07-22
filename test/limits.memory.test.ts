import { MAX_MEDIA_BYTES, MAX_DECODED_AUDIO_BYTES } from '../src/utils/mediaCompression/limits';

describe('media-compression-review MAJOR Memory/OOM: limits', () => {
    test('MAX_MEDIA_BYTES caps ENCODED input only — it does not bound decoded PCM', () => {
        // The review (MAJOR Memory/OOM) documents a 200 MB MP3 decoding to
        // ~3.6 GB of PCM on the main thread. MAX_MEDIA_BYTES is checked
        // BEFORE decode and therefore cannot bound the decoded footprint.
        expect(MAX_MEDIA_BYTES).toBe(200 * 1024 * 1024);
    });

    test('MAX_DECODED_AUDIO_BYTES bounds decoded PCM to a safe ceiling', () => {
        // 1 GiB of Float32 PCM ≈ 5.8 min of 48 kHz stereo — covers typical
        // SIGame audio clips while blocking the multi-GB decodes that crash
        // tabs. Enforced in audioCompression.worker.ts after decodeAudioData.
        expect(MAX_DECODED_AUDIO_BYTES).toBe(1024 * 1024 * 1024);
    });
});
