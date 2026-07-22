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
});
