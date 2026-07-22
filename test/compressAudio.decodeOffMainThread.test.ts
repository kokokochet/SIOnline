import { compressAudio } from '../src/utils/mediaCompression/compressAudio';
import { defaultCompressionOptions } from '../src/utils/mediaCompression/defaultOptions';
import { AudioWorkerResponse } from '../src/utils/mediaCompression/compressionTypes';
import * as workerFactory from '../src/utils/mediaCompression/workerFactory';

interface CapturingWorker {
    postMessage: jest.Mock;
    terminate: jest.Mock;
    onmessage: ((e: MessageEvent<AudioWorkerResponse>) => void) | null;
    onerror: ((e: ErrorEvent) => void) | null;
}

// moduleNameMapper routes `workerFactory` imports to test/workerFactoryMock.js
// (a no-automock capturing stub), so the same cached module is shared by source
// and test — `createAudioWorker._last` is observable without jest.mock.
type CapturingFactory = (() => CapturingWorker) & { _last?: CapturingWorker };
const createAudioWorker = workerFactory.createAudioWorker as unknown as CapturingFactory;

describe('media-compression-review MAJOR Memory/OOM: audio PCM decode off main thread', () => {
    const originalAudioEncoder = (globalThis as { AudioEncoder?: unknown }).AudioEncoder;
    const originalOfflineAudioContext = (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext;

    afterEach(() => {
        if (originalAudioEncoder !== undefined) {
            (globalThis as { AudioEncoder?: unknown }).AudioEncoder = originalAudioEncoder;
        } else {
            delete (globalThis as { AudioEncoder?: unknown }).AudioEncoder;
        }
        if (originalOfflineAudioContext !== undefined) {
            (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = originalOfflineAudioContext;
        } else {
            delete (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext;
        }
        jest.clearAllMocks();
        // clearAllMocks resets jest.fn() call records but NOT the `_last`
        // property stashed on the factory function — clear it so the next
        // test's waitForWorker waits for ITS worker, not the stale one.
        createAudioWorker._last = undefined;
    });

    /**
     * Wait until the audio worker has been created (its capturing mock stashes
     * itself on `createAudioWorker._last`). jsdom/Node `File.arrayBuffer()`
     * resolves after a handful of microtasks, so a fixed 1-2 yield count is
     * fragile (flagged in the plan's review note); poll instead.
     */
    async function waitForWorker(): Promise<CapturingWorker> {
        for (let i = 0; i < 50; i++) {
            await Promise.resolve();
            if (createAudioWorker._last) {
                return createAudioWorker._last;
            }
        }
        throw new Error('audio worker was never created');
    }

    /**
     * Settles compressAudio's in-flight Promise.race so `await pending`
     * resolves into passthrough instead of hanging on the 60s worker timeout.
     * The capturing mock's `terminate` is a no-op stub (Step 1). We fire a
     * 'done' response whose output is not smaller than the input, so the host
     * resolves via passthrough. (T49 changed the host to THROW on worker
     * errors rather than passthrough; a 'done' keeps this test focused on its
     * off-main-thread decode assertion instead of error handling.)
     */
    function settle(worker: CapturingWorker): void {
        worker.onmessage?.({ data: { type: 'done', data: new ArrayBuffer(8) } } as MessageEvent<AudioWorkerResponse>);
    }

    test('compressAudio does NOT construct OfflineAudioContext or call decodeAudioData on the main thread', async () => {
        // WebCodecs present -> compression path is taken (not early-passthrough).
        (globalThis as { AudioEncoder?: unknown }).AudioEncoder =
            class MockAudioEncoder {} as unknown as typeof AudioEncoder;

        const decodeSpy = jest.fn(async () => ({
            numberOfChannels: 2,
            length: 1,
            getChannelData: () => new Float32Array(1),
        }));
        const ctorSpy = jest.fn(() => ({ decodeAudioData: decodeSpy }));
        (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = ctorSpy as unknown;

        const file = new File([new Uint8Array([1, 2, 3, 4])], 'song.mp3', { type: 'audio/mpeg' });

        const pending = compressAudio(file, defaultCompressionOptions.audio);
        const worker = await waitForWorker();

        // The MAIN THREAD must not have decoded.
        expect(ctorSpy).not.toHaveBeenCalled();
        expect(decodeSpy).not.toHaveBeenCalled();

        settle(worker);
        await pending;
    });

    test('compressAudio posts {data: ArrayBuffer, options} to the worker — no pre-decoded channels', async () => {
        (globalThis as { AudioEncoder?: unknown }).AudioEncoder =
            class MockAudioEncoder {} as unknown as typeof AudioEncoder;

        const file = new File([new Uint8Array([10, 20, 30, 40])], 'clip.mp3', { type: 'audio/mpeg' });
        const pending = compressAudio(file, defaultCompressionOptions.audio);
        const worker = await waitForWorker();

        expect(worker.postMessage).toHaveBeenCalledTimes(1);
        const [request, transfer] = worker.postMessage.mock.calls[0];
        expect(transfer).toEqual(expect.any(Array));

        // New contract (Section B post-Plan-03 arm): raw bytes + options.
        // No channels / numberOfChannels / totalFrames.
        expect(request).toEqual({
            data: expect.any(ArrayBuffer),
            options: expect.any(Object),
        });
        expect(request).not.toHaveProperty('channels');
        expect(request).not.toHaveProperty('numberOfChannels');
        expect(request).not.toHaveProperty('totalFrames');
        expect((request.data as ArrayBuffer).byteLength).toBe(4);

        settle(worker);
        await pending;
    });
});
