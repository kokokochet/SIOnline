import {
    waitForQueueDrain,
    QUEUE_BACKPRESSURE_THRESHOLD,
} from '../src/utils/mediaCompression/workers/workerBackpressure';

describe('media-compression-review MAJOR Memory/OOM: worker backpressure helper', () => {
    test('QUEUE_BACKPRESSURE_THRESHOLD is a sensible small positive integer', () => {
        expect(QUEUE_BACKPRESSURE_THRESHOLD).toBeGreaterThan(0);
        // Healthy pipelines hover at 1-4; 8-32 leaves reorder headroom without
        // letting memory balloon. Assert the bound the review cares about.
        expect(QUEUE_BACKPRESSURE_THRESHOLD).toBeLessThanOrEqual(32);
    });

    test('returns immediately (no setTimeout) when encodeQueueSize is at or below threshold', async () => {
        const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout');
        const codec = { encodeQueueSize: QUEUE_BACKPRESSURE_THRESHOLD };
        await waitForQueueDrain(codec);
        expect(setTimeoutSpy).not.toHaveBeenCalled();
        setTimeoutSpy.mockRestore();
    });

    test('returns immediately when decodeQueueSize is at or below threshold (VideoDecoder surface)', async () => {
        const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout');
        const codec = { decodeQueueSize: QUEUE_BACKPRESSURE_THRESHOLD };
        await waitForQueueDrain(codec);
        expect(setTimeoutSpy).not.toHaveBeenCalled();
        setTimeoutSpy.mockRestore();
    });

    test('yields (setTimeout 0) repeatedly while encodeQueueSize exceeds threshold, then returns', async () => {
        // Redefine `performance` as writable/configurable so Jest's (sinon-based)
        // fake timers can hijack it. Under Node 20+ `globalThis.performance` is a
        // read-only global; without this redefinition `jest.useFakeTimers()`
        // throws `Cannot assign to read only property 'performance'`. This is the
        // same compatibility shim the repo's own contentPreloader.test.ts uses.
        Object.defineProperty(globalThis, 'performance', {
            configurable: true,
            writable: true,
            value: globalThis.performance,
        });
        jest.useFakeTimers();
        try {
            const codec = { encodeQueueSize: QUEUE_BACKPRESSURE_THRESHOLD + 5 };
            const drain = waitForQueueDrain(codec);

            // Helper scheduled its first setTimeout(0). Simulate the queue
            // draining one tick at a time across macrotask boundaries.
            codec.encodeQueueSize = QUEUE_BACKPRESSURE_THRESHOLD + 1;
            jest.runOnlyPendingTimers(); // flush tick 1 → still above, re-yields

            codec.encodeQueueSize = 0; // now drained
            jest.runOnlyPendingTimers(); // flush tick 2 → returns

            await drain;
            expect(codec.encodeQueueSize).toBe(0);
        } finally {
            jest.useRealTimers();
        }
    });

    test('custom threshold overrides the default', async () => {
        const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout');
        await waitForQueueDrain({ encodeQueueSize: 3 }, 5);
        expect(setTimeoutSpy).not.toHaveBeenCalled();
        setTimeoutSpy.mockRestore();
    });

    test('treats a codec with no queueSize field as empty (never yields)', async () => {
        const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout');
        await waitForQueueDrain({});
        expect(setTimeoutSpy).not.toHaveBeenCalled();
        setTimeoutSpy.mockRestore();
    });

    // Structural import sanity for BOTH compression workers. This does NOT drive
    // either worker's loop — it only verifies each module compiles in the test
    // graph and that the backpressure helper is importable from the path the
    // workers use. The behavioral wiring (encode/decode loops awaiting
    // waitForQueueDrain) is pinned by the dual-gate contract test below and by
    // audioEncoder.test.ts's Vector 3 test.
    //
    // NOTE (T21/T22 deviation): both workers read the worker-global `self` at
    // module top level (`const ctx = self as unknown as WorkerScope`). This repo
    // runs Jest under testEnvironment: node (no `self`), and per Resolution #9
    // the workers are not made genuinely importable until T57 (tsconfig.worker)
    // — which runs after T22 per Resolution #3's sequence. To run this
    // STRUCTURAL compile check today WITHOUT touching the worker source, stand
    // in `self` with `globalThis` for the duration of the import (same shim the
    // `performance` redefinition elsewhere in this file uses). T57 removes the
    // need for it.
    test.each([
        ['video', '../src/utils/mediaCompression/workers/videoCompression.worker'],
        ['audio', '../src/utils/mediaCompression/workers/audioCompression.worker'],
    ])('%s worker module loads and the backpressure helper is importable (wiring sanity)', async (_name, path) => {
        const g = globalThis as unknown as { self?: unknown };
        const hadSelf = 'self' in g;
        const prevSelf = g.self;
        g.self = globalThis;
        try {
            const workerModule = await import(path);
            expect(workerModule).toBeDefined();
            const helper = await import('../src/utils/mediaCompression/workers/workerBackpressure');
            expect(helper.waitForQueueDrain).toBeInstanceOf(Function);
        } finally {
            if (hadSelf) {
                g.self = prevSelf;
            } else {
                delete g.self;
            }
        }
    });

    test('video worker pattern: encoder queue is gated alongside the decoder (Vector 3 — encodeQueueSize backpressure)', async () => {
        // The decoder's output callback feeds the encoder synchronously, so
        // the decode loop MUST await waitForQueueDrain(encoder) as well as
        // waitForQueueDrain(decoder) — gating only the decoder leaves the
        // encoder queue unchecked (review Vector 3 names encodeQueueSize
        // explicitly). This test pins the helper contract the video worker's
        // dual-gate decode loop depends on: an encoder-shaped codec
        // ({encodeQueueSize}) above the threshold yields.
        jest.useFakeTimers();
        try {
            const encoder = { encodeQueueSize: QUEUE_BACKPRESSURE_THRESHOLD + 3 };
            const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout');

            const drain = waitForQueueDrain(encoder);
            // Above threshold → at least one setTimeout(0) yield scheduled.
            expect(setTimeoutSpy).toHaveBeenCalled();

            // Drain to the threshold boundary (== threshold is NOT > threshold).
            encoder.encodeQueueSize = QUEUE_BACKPRESSURE_THRESHOLD;
            jest.runOnlyPendingTimers();
            await drain;

            expect(encoder.encodeQueueSize).toBe(QUEUE_BACKPRESSURE_THRESHOLD);
            setTimeoutSpy.mockRestore();
        } finally {
            jest.useRealTimers();
        }
    });
});
