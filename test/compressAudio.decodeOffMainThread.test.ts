import { compressAudio } from '../src/utils/mediaCompression/compressAudio';
import { defaultCompressionOptions } from '../src/utils/mediaCompression/defaultOptions';
import { AudioWorkerResponse } from '../src/utils/mediaCompression/compressionTypes';
import { FakeWorker, getLastAudioWorker, resetFakeWorkerRegistry } from './helpers/fakeWorker';

// moduleNameMapper routes `workerFactory` imports (including the one inside
// compressAudio) to test/workerFactoryMock, whose createAudioWorker builds a
// FakeWorker and registers it. getLastAudioWorker lets us observe that
// FakeWorker without jest.mock — the same cached module instance is shared by
// source and test.

describe('audio PCM decode runs off the main thread', () => {
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
        // Clear the registry so the next test's waitForWorker waits for ITS
        // worker, not the stale one from a previous test.
        resetFakeWorkerRegistry();
    });

    /**
     * Wait until the audio worker has been created (the mock factory registers
     * each FakeWorker). jsdom/Node `File.arrayBuffer()` resolves after a
     * handful of microtasks, so a fixed yield count is fragile; poll instead.
     */
    async function waitForWorker(): Promise<FakeWorker> {
        for (let i = 0; i < 50; i++) {
            await Promise.resolve();
            const w = getLastAudioWorker();
            if (w) {
                return w;
            }
        }
        throw new Error('audio worker was never created');
    }

    /**
     * Settles compressAudio's in-flight Promise.race so `await pending`
     * resolves into passthrough instead of hanging on the 60s worker timeout.
     * We fire a 'done' response (not an error) so the host resolves via
     * passthrough, keeping this test focused on its decode assertion.
     */
    function settle(worker: FakeWorker): void {
        worker.emitMessage({ type: 'done', data: new ArrayBuffer(8) } as AudioWorkerResponse);
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

        expect(worker.postedMessages).toHaveLength(1);
        const { message, transfer } = worker.postedMessages[0];
        expect(transfer).toEqual(expect.any(Array));

        const request = message as { data: ArrayBuffer; options: unknown };

        // New contract: raw bytes + options — no channels / numberOfChannels / totalFrames.
        expect(request).toEqual({
            data: expect.any(ArrayBuffer),
            options: expect.any(Object),
        });
        expect(request).not.toHaveProperty('channels');
        expect(request).not.toHaveProperty('numberOfChannels');
        expect(request).not.toHaveProperty('totalFrames');
        expect(request.data.byteLength).toBe(4);

        settle(worker);
        await pending;
    });
});
