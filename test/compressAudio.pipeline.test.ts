import { compressAudio } from '../src/utils/mediaCompression/compressAudio';
import { defaultCompressionOptions } from '../src/utils/mediaCompression/defaultOptions';
import {
    getLastAudioWorker,
    resetFakeWorkerRegistry,
} from './helpers/fakeWorker';

function flushPromises(): Promise<void> {
    // setImmediate (macrotask) drains the full microtask queue before resolving.
    // Post-T19 there is a SINGLE host await (`file.arrayBuffer()`) before
    // createAudioWorker — PCM decode moved into the worker, so no main-thread
    // OfflineAudioContext construction and no second await. These tests keep REAL
    // timers throughout (see `captureTimeout` below), so `setImmediate` is
    // genuine and this helper never hangs.
    return new Promise((resolve) => setImmediate(resolve));
}

function makeFile(bytes: number): File {
    return new File([new Uint8Array(bytes).fill(0x11)], 'clip.wav', { type: 'audio/wav' });
}

/**
 * Host timeout value (`WORKER_TIMEOUT_MS` in compressAudio.ts — not exported,
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

describe('media-compression-review MAJOR: compressAudio worker pipeline (was zero coverage)', () => {
    const originalAudioEncoder = (globalThis as Record<string, unknown>).AudioEncoder;

    beforeEach(() => {
        // compressAudio gates on isAudioCompressionSupported(); force true so the
        // worker pipeline is entered. Post-T19 the host never constructs an
        // OfflineAudioContext (decode runs inside the worker), so no main-thread
        // AudioContext stub is required here — the FakeWorker in T60 short-circuits
        // the decode path entirely.
        (globalThis as Record<string, unknown>).AudioEncoder =
            class MockAudioEncoder {} as unknown as typeof AudioEncoder;
        resetFakeWorkerRegistry();
        captureTimeout();
    });

    afterEach(() => {
        if (originalAudioEncoder) {
            (globalThis as Record<string, unknown>).AudioEncoder = originalAudioEncoder;
        } else {
            delete (globalThis as Record<string, unknown>).AudioEncoder;
        }
        restoreTimeout();
        resetFakeWorkerRegistry();
    });

    test('posts the raw encoded bytes as a single transfer-list ArrayBuffer', async () => {
        const file = makeFile(8);
        const promise = compressAudio(file, defaultCompressionOptions.audio);
        await flushPromises();

        const worker = getLastAudioWorker();
        expect(worker).toBeDefined();
        expect(worker!.postedMessages).toHaveLength(1);
        const posted = worker!.postedMessages[0];
        // Post-T19 contract: the request is `{ data: ArrayBuffer; options }` and
        // the host transfers the single encoded input (zero-copy). The worker
        // decodes inside its own global scope — no per-channel PCM is transferred.
        expect(posted.transfer).toHaveLength(1);
        expect(posted.transfer[0]).toBeInstanceOf(ArrayBuffer);

        // Let the promise settle so afterEach's reset doesn't race an unhandled
        // rejection. The host REJECTS on a worker {type:'error'} message (T24),
        // so drain it as a rejection rather than a resolve.
        worker!.emitMessage({ type: 'error', name: 'Error', error: 'cancel' });
        await expect(promise).rejects.toBeDefined();
    });

    test('happy path: renames extension to .opus and reports compressedSize', async () => {
        const file = makeFile(1000);
        const promise = compressAudio(file, defaultCompressionOptions.audio);
        await flushPromises();

        getLastAudioWorker()!.emitMessage({ type: 'done', data: new ArrayBuffer(50) });
        const result = await promise;

        expect(result.wasCompressed).toBe(true);
        expect(result.fileName).toBe('clip.opus');
        expect(result.compressedSize).toBe(50);
        expect(result.originalSize).toBe(1000);
    });

    test('worker {type:"error"} message → rejects with named error (T24)', async () => {
        const file = makeFile(1000);
        const promise = compressAudio(file, defaultCompressionOptions.audio);
        await flushPromises();

        getLastAudioWorker()!.emitMessage({ type: 'error', name: 'NotSupportedError', error: 'opus' });

        // The host preserves the programmatic error name (T24) — the original
        // name is kept, the promise rejects (no silent passthrough).
        await expect(promise).rejects.toMatchObject({ name: 'NotSupportedError' });
    });

    test('worker onerror → rejects with named Error', async () => {
        const file = makeFile(1000);
        const promise = compressAudio(file, defaultCompressionOptions.audio);
        await flushPromises();

        getLastAudioWorker()!.emitError('crash');

        await expect(promise).rejects.toMatchObject({ name: 'Error' });
    });

    test('60s timeout → rejects with timeout Error', async () => {
        const file = makeFile(1000);
        const promise = compressAudio(file, defaultCompressionOptions.audio);
        // Real timers: flushPromises() drains the host's single await
        // (`file.arrayBuffer()`; post-T19 decode runs in the worker) so
        // createAudioWorker() has run and the 60s race timer is captured.
        await flushPromises();
        expect(getLastAudioWorker()).toBeDefined();

        // No worker event is fired. Fire the captured 60s timeout → the race's
        // timeout arm rejects with a timeout Error (not passthrough).
        fireHostTimeout();
        await expect(promise).rejects.toThrow('Audio compression worker timeout');
    });

    test('size-guard: empty output → passthrough', async () => {
        const file = makeFile(1000);
        const promise = compressAudio(file, defaultCompressionOptions.audio);
        await flushPromises();

        getLastAudioWorker()!.emitMessage({ type: 'done', data: new ArrayBuffer(0) });
        const result = await promise;

        expect(result.wasCompressed).toBe(false);
    });

    test('size-guard: compressed >= original → passthrough', async () => {
        const file = makeFile(10);
        const promise = compressAudio(file, defaultCompressionOptions.audio);
        await flushPromises();

        getLastAudioWorker()!.emitMessage({ type: 'done', data: new ArrayBuffer(10) });
        const result = await promise;

        expect(result.wasCompressed).toBe(false);
    });

    test('terminate() is called in finally on success', async () => {
        const file = makeFile(1000);
        const promise = compressAudio(file, defaultCompressionOptions.audio);
        await flushPromises();
        const worker = getLastAudioWorker()!;
        worker.emitMessage({ type: 'done', data: new ArrayBuffer(10) });
        await promise;

        expect(worker.isTerminated).toBe(true);
    });

    test('terminate() is called in finally on error', async () => {
        const file = makeFile(1000);
        const promise = compressAudio(file, defaultCompressionOptions.audio);
        await flushPromises();
        const worker = getLastAudioWorker()!;
        worker.emitError('boom');
        // The host rejects on onerror (T24); consume the rejection, then assert
        // the finally still terminated the worker.
        await expect(promise).rejects.toMatchObject({ name: 'Error' });

        expect(worker.isTerminated).toBe(true);
    });

    test('terminate() is called in finally on timeout', async () => {
        const file = makeFile(1000);
        const promise = compressAudio(file, defaultCompressionOptions.audio);
        await flushPromises();
        const worker = getLastAudioWorker()!;
        // Fire the captured 60s timeout → race rejects → finally terminates.
        fireHostTimeout();
        await expect(promise).rejects.toThrow('Audio compression worker timeout');

        expect(worker.isTerminated).toBe(true);
    });

    test('signal abort → host posts {type:"abort"} → worker emits {type:"cancelled"} → rejects with AbortError (was zero coverage)', async () => {
        const controller = new AbortController();
        const file = makeFile(1000);
        const promise = compressAudio(file, defaultCompressionOptions.audio, controller.signal);
        await flushPromises();

        const worker = getLastAudioWorker()!;

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
        // coverage before this test.
        worker.emitMessage({ type: 'cancelled' });

        await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
        expect(worker.isTerminated).toBe(true);
    });
});
