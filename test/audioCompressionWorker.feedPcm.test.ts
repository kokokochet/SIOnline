import { jest } from '@jest/globals';
import { installAudioDataMock } from './helpers/webcodecsMock';
import { feedPcmToOpus } from '../src/utils/mediaCompression/audioEncoder';

describe('media-compression-review MAJOR: AudioData leak on encode throw', () => {
    let handle: ReturnType<typeof installAudioDataMock>;

    beforeEach(() => {
        handle = installAudioDataMock();
    });

    afterEach(() => {
        handle.restore();
    });

    test('closes every AudioData when encode throws on the first chunk', async () => {
        const encoder = {
            encode: jest.fn(() => {
                throw new Error('InvalidStateError: encoder not configured');
            }),
        };

        // totalFrames large enough to construct at least 3 chunks (chunkFrameCount = 960).
        const stereo: Float32Array[] = [
            new Float32Array(3000),
            new Float32Array(3000),
        ];

        // feedPcmToOpus is async (it awaits the T22 backpressure drain), so a
        // throw from encoder.encode rejects the returned promise rather than
        // escaping synchronously.
        await expect(feedPcmToOpus(encoder as never, stereo, 3000, 2)).rejects.toThrow('InvalidStateError');

        // At least one AudioData was constructed and every constructed one was closed.
        expect(handle.instances.length).toBeGreaterThanOrEqual(1);
        for (const inst of handle.instances) {
            expect(inst.close).toHaveBeenCalledTimes(1);
        }
    });

    test('closes AudioData when encode throws on the SECOND chunk (finally across iterations)', async () => {
        let callCount = 0;
        const encoder = {
            encode: jest.fn(() => {
                callCount += 1;
                if (callCount === 2) {
                    throw new Error('InvalidStateError: encoder died mid-stream');
                }
            }),
        };

        // 2000 frames -> 3 chunks (chunkFrameCount = 960). Chunk 1 succeeds,
        // chunk 2 throws. Both chunk 1 and chunk 2 AudioData must be closed.
        const mono: Float32Array[] = [new Float32Array(2000)];

        await expect(feedPcmToOpus(encoder as never, mono, 2000, 1)).rejects.toThrow('InvalidStateError');

        // Two AudioData constructed (chunk 1 + chunk 2); chunk 3 never reached.
        expect(handle.instances.length).toBe(2);
        for (const inst of handle.instances) {
            expect(inst.close).toHaveBeenCalledTimes(1);
        }
    });

    test('closes AudioData on the happy path too (no double-close, no leak)', async () => {
        const encoder = { encode: jest.fn() };
        const mono: Float32Array[] = [new Float32Array(960)];
        await feedPcmToOpus(encoder as never, mono, 960, 1);

        expect(handle.instances.length).toBe(1);
        expect(handle.instances[0].close).toHaveBeenCalledTimes(1);
        expect(encoder.encode).toHaveBeenCalledTimes(1);
    });

    test('constructs the expected number of chunks for a multi-chunk stream', async () => {
        const encoder = { encode: jest.fn() };
        // chunkFrameCount = floor(48000*20/1000) = 960. 2000 frames -> 3 chunks.
        const mono: Float32Array[] = [new Float32Array(2000)];
        await feedPcmToOpus(encoder as never, mono, 2000, 1);

        expect(handle.instances.length).toBe(3);
        expect(encoder.encode).toHaveBeenCalledTimes(3);
        for (const inst of handle.instances) {
            expect(inst.close).toHaveBeenCalledTimes(1);
        }
    });
});
