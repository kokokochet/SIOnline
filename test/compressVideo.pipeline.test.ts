import {
    compressVideo,
} from '../src/utils/mediaCompression/compressVideo';
import { defaultCompressionOptions } from '../src/utils/mediaCompression/defaultOptions';
import {
    getLastVideoWorker,
    resetFakeWorkerRegistry,
} from './helpers/fakeWorker';

/**
 * Flushes the microtask queue so the async compressVideo can run past its
 * `await file.arrayBuffer()` and `Promise.race` settlement.
 *
 * Uses `setImmediate` (a macrotask), so the FULL microtask queue drains before
 * it resolves — robust across any number of internal host awaits. These tests
 * keep REAL timers throughout (see `captureTimeout` below), so `setImmediate`
 * is genuine and this helper never hangs.
 */
function flushPromises(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

function makeFile(bytes: number): File {
    return new File([new Uint8Array(bytes).fill(0xaa)], 'in.mp4', { type: 'video/mp4' });
}

/**
 * Host timeout value (`WORKER_TIMEOUT_MS` in compressVideo.ts — not exported,
 * so mirrored here). Used by `captureTimeout` to recognise the host's one and
 * only 60s race timer without touching jest's own (5s) timers.
 */
const HOST_WORKER_TIMEOUT_MS = 60_000;

/**
 * Replaces globalThis.setTimeout with a scoped stub that captures the host's
 * 60s `WORKER_TIMEOUT_MS` callback (so a test can fire it deterministically via
 * `fireHostTimeout()`) and delegates EVERY other scheduling call to the real
 * implementation (jest's own timer needs keep working).
 *
 * Why not `jest.useFakeTimers()` (the plan's original choice): under Node 26,
 * `@sinonjs/fake-timers` (jest 28) throws `Cannot assign to read only property
 * 'performance'` because Node made `globalThis.performance` read-only; and jest
 * 28.1.3 does not ship `advanceTimersByTimeAsync` (the plan's microtask flush).
 * Keeping real timers sidesteps both: `flushPromises()` drains the host's
 * `await file.arrayBuffer()` naturally, and the timeout fires on demand.
 */
type TimerFn = (...args: unknown[]) => unknown;
const realSetTimeout = globalThis.setTimeout as TimerFn;
let capturedTimeoutFn: (() => void) | undefined;

function captureTimeout(): void {
    capturedTimeoutFn = undefined;
    (globalThis as { setTimeout: TimerFn }).setTimeout = (...args: unknown[]): unknown => {
        const [handler, timeout] = args;
        if (typeof handler === 'function' && timeout === HOST_WORKER_TIMEOUT_MS) {
            capturedTimeoutFn = handler as () => void;
            return 0;
        }
        return realSetTimeout(...args);
    };
}

/** Fires the host's captured 60s timeout callback → the race-loser rejects. */
function fireHostTimeout(): void {
    if (!capturedTimeoutFn) {
        throw new Error('fireHostTimeout: no 60s host timeout was captured');
    }
    capturedTimeoutFn();
}

function restoreTimeout(): void {
    (globalThis as { setTimeout: TimerFn }).setTimeout = realSetTimeout;
}

describe('media-compression-review MAJOR: compressVideo worker pipeline (was zero coverage)', () => {
    const originalVideoEncoder = (globalThis as Record<string, unknown>).VideoEncoder;

    beforeEach(() => {
        // compressVideo gates on isVideoCompressionSupported(); force true so the
        // worker pipeline is entered.
        (globalThis as Record<string, unknown>).VideoEncoder =
            class MockVideoEncoder {} as unknown as typeof VideoEncoder;
        resetFakeWorkerRegistry();
        captureTimeout();
    });

    afterEach(() => {
        if (originalVideoEncoder) {
            (globalThis as Record<string, unknown>).VideoEncoder = originalVideoEncoder;
        } else {
            delete (globalThis as Record<string, unknown>).VideoEncoder;
        }
        restoreTimeout();
        resetFakeWorkerRegistry();
    });

    test('posts a transfer-list-carrying request to the worker', async () => {
        const file = makeFile(100);
        const promise = compressVideo(file, defaultCompressionOptions.video);
        await flushPromises();

        const worker = getLastVideoWorker();
        expect(worker).toBeDefined();
        expect(worker!.postedMessages).toHaveLength(1);
        const posted = worker!.postedMessages[0];
        expect((posted.message as { options: unknown }).options).toBe(defaultCompressionOptions.video);
        // The host transfers the data ArrayBuffer (zero-copy): transfer list non-empty.
        expect(posted.transfer).toHaveLength(1);
        expect(posted.transfer[0]).toBeInstanceOf(ArrayBuffer);

        // Let the promise settle so afterEach's reset doesn't race an unhandled
        // rejection. The host REJECTS on a worker {type:'error'} message (T24),
        // so drain it as a rejection rather than a resolve.
        worker!.emitMessage({ type: 'error', name: 'Error', error: 'cancel' });
        await expect(promise).rejects.toBeDefined();
    });

    test('happy path: smaller compressed output is returned with wasCompressed=true', async () => {
        const originalSize = 1000;
        const compressed = new ArrayBuffer(100);
        const file = makeFile(originalSize);
        const promise = compressVideo(file, defaultCompressionOptions.video);
        await flushPromises();

        getLastVideoWorker()!.emitMessage({ type: 'done', data: compressed });
        const result = await promise;

        expect(result.wasCompressed).toBe(true);
        expect(result.originalSize).toBe(originalSize);
        expect(result.compressedSize).toBe(100);
        expect(result.fileName).toBe('in.mp4');
    });

    test('worker {type:"error"} message → rejects with named error (T24)', async () => {
        const file = makeFile(100);
        const promise = compressVideo(file, defaultCompressionOptions.video);
        await flushPromises();

        getLastVideoWorker()!.emitMessage({ type: 'error', name: 'NotSupportedError', error: 'bad codec' });

        // The host preserves the programmatic error name (T24 named-error
        // contract) so callers can triage: NotSupportedError is surfaced, not
        // collapsed to a generic passthrough.
        await expect(promise).rejects.toMatchObject({ name: 'NotSupportedError' });
    });

    test('worker onerror event → rejects with named Error', async () => {
        const file = makeFile(100);
        const promise = compressVideo(file, defaultCompressionOptions.video);
        await flushPromises();

        getLastVideoWorker()!.emitError('uncaught worker crash');

        // onerror is rejected (not swallowed to passthrough); the host calls
        // preventDefault() inside the handler to keep the dev-server overlay out
        // of scope here.
        await expect(promise).rejects.toMatchObject({ name: 'Error' });
    });

    test('60s timeout → rejects with timeout Error when neither onmessage nor onerror fires', async () => {
        const file = makeFile(100);
        const promise = compressVideo(file, defaultCompressionOptions.video);
        // Real timers: flushPromises() drains the host's `await
        // file.arrayBuffer()` so createVideoWorker() has run and the 60s race
        // timer is captured by the setTimeout stub.
        await flushPromises();
        expect(getLastVideoWorker()).toBeDefined();

        // No worker event is fired. Fire the captured 60s timeout → the race's
        // timeout arm rejects with a timeout Error (not passthrough).
        fireHostTimeout();
        await expect(promise).rejects.toThrow('Video compression worker timeout');
    });

    test('size-guard: empty compressed output → passthrough', async () => {
        const file = makeFile(100);
        const promise = compressVideo(file, defaultCompressionOptions.video);
        await flushPromises();

        // Worker reports done with a 0-length buffer.
        getLastVideoWorker()!.emitMessage({ type: 'done', data: new ArrayBuffer(0) });
        const result = await promise;

        expect(result.wasCompressed).toBe(false);
        expect(result.data.length).toBe(100);
    });

    test('size-guard: compressed >= original → passthrough', async () => {
        const originalSize = 50;
        const file = makeFile(originalSize);
        const promise = compressVideo(file, defaultCompressionOptions.video);
        await flushPromises();

        // Worker reports a buffer as large as the original.
        getLastVideoWorker()!.emitMessage({ type: 'done', data: new ArrayBuffer(originalSize) });
        const result = await promise;

        expect(result.wasCompressed).toBe(false);
        expect(result.data.length).toBe(originalSize);
    });

    test('terminate() is called in finally on success', async () => {
        const file = makeFile(1000);
        const promise = compressVideo(file, defaultCompressionOptions.video);
        await flushPromises();

        const worker = getLastVideoWorker()!;
        worker.emitMessage({ type: 'done', data: new ArrayBuffer(10) });
        await promise;

        expect(worker.isTerminated).toBe(true);
    });

    test('terminate() is called in finally on worker error', async () => {
        const file = makeFile(1000);
        const promise = compressVideo(file, defaultCompressionOptions.video);
        await flushPromises();

        const worker = getLastVideoWorker()!;
        worker.emitMessage({ type: 'error', name: 'Error', error: 'x' });
        // The host rejects on worker error (T24); consume the rejection, then
        // assert the finally still terminated the worker.
        await expect(promise).rejects.toMatchObject({ name: 'Error' });

        expect(worker.isTerminated).toBe(true);
    });

    test('terminate() is called in finally on timeout', async () => {
        const file = makeFile(1000);
        const promise = compressVideo(file, defaultCompressionOptions.video);
        await flushPromises();

        const worker = getLastVideoWorker()!;
        // Fire the captured 60s timeout → race rejects → finally terminates.
        fireHostTimeout();
        await expect(promise).rejects.toThrow('Video compression worker timeout');

        expect(worker.isTerminated).toBe(true);
    });

    test('signal abort → host posts {type:"abort"} → worker emits {type:"cancelled"} → rejects with AbortError (was zero coverage)', async () => {
        const controller = new AbortController();
        const file = makeFile(100);
        const promise = compressVideo(file, defaultCompressionOptions.video, controller.signal);
        await flushPromises();

        const worker = getLastVideoWorker()!;

        // Fire the abort. abortRace's listener runs synchronously inside
        // dispatchEvent: it posts {type:'abort'} to the worker AND rejects the
        // host promise with AbortError. Both effects are asserted below.
        controller.abort();
        const abortPost = worker.postedMessages.find(
            (m) => (m.message as { type?: string }).type === 'abort',
        );
        expect(abortPost).toBeDefined();

        // Also drive the worker's {type:'cancelled'} acknowledgement arm — the
        // host's onmessage handler must reject with AbortError (NOT resolve as
        // passthrough). Pins the cancelled-arm wiring (T12) which had zero
        // coverage before this test; a regression that drops the arm leaves the
        // message as a silent no-op.
        worker.emitMessage({ type: 'cancelled' });

        await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
        expect(worker.isTerminated).toBe(true);
    });
});
