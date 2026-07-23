import { encodeAudioToOpus } from '../src/utils/mediaCompression/audioEncoder';
import { AudioCompressionOptions } from '../src/utils/mediaCompression/compressionTypes';

const options: AudioCompressionOptions = { bitrate: 64_000, codec: 'opus', channels: 1 };

/**
 * Minimal AudioEncoder mock. The encode() path synchronously drives the
 * captured output callback with a chunk whose copyTo() throws — reproducing
 * the bug (output-callback error not surfaced by WebCodecs) deterministically.
 */
interface MockEncoderInit {
    output: (chunk: unknown) => void;
    error: (e: DOMException) => void;
}

class MockAudioEncoder {
    static lastInit: MockEncoderInit | null = null;
    static lastInstance: MockAudioEncoder | null = null;
    private init: MockEncoderInit;
    closed = false;

    constructor(init: MockEncoderInit) {
        this.init = init;
        MockAudioEncoder.lastInit = init;
        MockAudioEncoder.lastInstance = this;
    }

    configure(_config: unknown): void {}

    encode(audioData: { close(): void }): void {
        // Simulate WebCodecs emitting an encoded chunk whose copyTo throws.
        this.init.output({
            byteLength: 10,
            timestamp: 0,
            duration: 20000,
            copyTo: () => {
                throw new Error('copyTo boom');
            },
        });
        audioData.close();
    }

    flush(): Promise<void> {
        return Promise.resolve();
    }

    close(): void {
        this.closed = true;
    }

    static isConfigSupported(_config: unknown): Promise<{ supported: boolean }> {
        return Promise.resolve({ supported: true });
    }
}

class MockAudioData {
    close(): void {}
}

describe('audioEncoder output-callback error handling', () => {
    const originalAudioEncoder = (globalThis as { AudioEncoder?: unknown }).AudioEncoder;
    const originalAudioData = (globalThis as { AudioData?: unknown }).AudioData;

    beforeEach(() => {
        MockAudioEncoder.lastInit = null;
        MockAudioEncoder.lastInstance = null;
        (globalThis as { AudioEncoder?: unknown }).AudioEncoder = MockAudioEncoder;
        (globalThis as { AudioData?: unknown }).AudioData = MockAudioData;
    });

    afterEach(() => {
        (globalThis as { AudioEncoder?: unknown }).AudioEncoder = originalAudioEncoder;
        (globalThis as { AudioData?: unknown }).AudioData = originalAudioData;
    });

    test('rejects with the original error when copyTo throws in the output callback', async () => {
        // One channel, one frame of float32 PCM.
        const buf = new ArrayBuffer(4);
        const promise = encodeAudioToOpus([buf], 1, 1, options);

        // The fix wraps the output callback body in try/catch and rejects with
        // the ORIGINAL error. Before the fix, the synchronous throw escaped into
        // the outer isConfigSupported .catch and got mislabeled as
        // "AudioEncoder isConfigSupported error: copyTo boom" — so an exact
        // message match fails pre-fix and passes post-fix. (Uses an explicit
        // catch + exact .toBe() rather than jest-extended's toSatisfy, which
        // is not installed in this repo.)
        const err = await promise.catch((e: unknown) => e);
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toBe('copyTo boom');
    });

    test('closes the encoder when the output callback throws', async () => {
        const buf = new ArrayBuffer(4);
        const promise = encodeAudioToOpus([buf], 1, 1, options);

        await expect(promise).rejects.toBeTruthy();
        // closeEncoder() must have run — leaking a native AudioEncoder is the
        // secondary symptom the fix addresses.
        expect(MockAudioEncoder.lastInstance?.closed).toBe(true);
    });
});

describe('encodeAudioToOpus: backpressure + error callback', () => {
    const originalAudioEncoder = (globalThis as { AudioEncoder?: unknown }).AudioEncoder;
    const originalAudioData = (globalThis as { AudioData?: unknown }).AudioData;

    interface CapturedInit {
        output: (chunk: unknown) => void;
        error: (e: { name: string; message: string }) => void;
    }

    /**
     * Mock AudioEncoder whose `encodeQueueSize` is controllable (so the encode
     * loop's `waitForQueueDrain` gate is observable) and whose `flush` either
     * resolves or never settles (so Promise.race(flush, errored) is decided by
     * the error callback). The ctor init is captured so a test can fire the
     * error callback on demand.
     */
    function installControllableEncoder(opts: {
        initialQueueSize: number;
        neverResolvingFlush?: boolean;
    }): { setQueueSize(n: number): void; fireError(e: { name: string; message: string }): void } {
        let queueSize = opts.initialQueueSize;
        let captured: CapturedInit | null = null;

        class Encoder {
            constructor(init: CapturedInit) {
                captured = init;
            }
            get encodeQueueSize(): number {
                return queueSize;
            }
            configure(): void {}
            encode(): void {}
            flush(): Promise<void> {
                return opts.neverResolvingFlush ? new Promise<void>(() => {}) : Promise.resolve();
            }
            close(): void {}
            static isConfigSupported(): Promise<{ supported: boolean }> {
                return Promise.resolve({ supported: true });
            }
        }

        (globalThis as { AudioEncoder?: unknown }).AudioEncoder = Encoder as unknown as typeof AudioEncoder;
        (globalThis as { AudioData?: unknown }).AudioData = class {
            close(): void {}
        } as unknown as typeof AudioData;

        return {
            setQueueSize: (n: number) => {
                queueSize = n;
            },
            fireError: (e: { name: string; message: string }) => captured?.error(e),
        };
    }

    afterEach(() => {
        (globalThis as { AudioEncoder?: unknown }).AudioEncoder = originalAudioEncoder;
        (globalThis as { AudioData?: unknown }).AudioData = originalAudioData;
        jest.restoreAllMocks();
    });

    test('encode loop awaits waitForQueueDrain(encoder) before encoding', async () => {
        const backpressure = await import('../src/utils/mediaCompression/workers/workerBackpressure');
        const drainSpy = jest.spyOn(backpressure, 'waitForQueueDrain');

        const ctrl = installControllableEncoder({ initialQueueSize: 100 });

        // Queue above the threshold forces the helper to yield. encode is a
        // no-op (no output callback), so the function ultimately rejects with
        // 'No audio data encoded'; here we only assert the loop CALLED the
        // helper on the encoder before reaching encode.
        const pending = encodeAudioToOpus([new ArrayBuffer(4)], 1, 1, options);
        // Attach a handler immediately: the loop (having no output) rejects
        // while the poll below is still yielding microtasks, and Node 26
        // crashes the worker on an unhandled rejection.
        const settled = pending.then(
            () => 'resolved',
            () => 'rejected',
        );

        // isConfigSupported resolves on a microtask; poll until the loop has
        // invoked waitForQueueDrain.
        for (let i = 0; i < 50 && drainSpy.mock.calls.length === 0; i++) {
            await Promise.resolve();
        }
        expect(drainSpy).toHaveBeenCalled();

        // Release the yield so the pending promise can settle (drop the queue,
        // let flush resolve → empty packets → reject) instead of hanging.
        ctrl.setQueueSize(0);
        await settled;
    });

    test('error callback rejects with the raw DOMException, preserving .name', async () => {
        // flush never resolves: Promise.race(flush, errored) MUST be decided by
        // rejectOuter firing in the error callback — a bare throw in the
        // WebCodecs error callback would NOT reject the async function's
        // promise and a later flush() would surface a generic InvalidStateError.
        const ctrl = installControllableEncoder({ initialQueueSize: 0, neverResolvingFlush: true });

        const pending = encodeAudioToOpus([new ArrayBuffer(4)], 1, 1, options);
        // Attach the handler synchronously to avoid an unhandled-rejection
        // window once the error callback fires.
        const errP = pending.catch((e: unknown) => e);

        // Let the loop run (queueSize 0 → no yield) then fire the encoder error
        // callback with a REAL DOMException, exactly as WebCodecs does.
        await Promise.resolve();
        const domError = new DOMException('codec rejected', 'NotSupportedError');
        ctrl.fireError(domError);

        const err = await errP;
        // The raw DOMException is propagated unchanged (rejectOuter(e)), so its
        // programmatic .name survives end-to-end and buildErrorResponse lifts it
        // to the worker wire {type:'error'; name; error}. Identity travels via
        // .name, not a locale-dependent prefix string.
        expect(err).toBe(domError);
        expect((err as { name: string }).name).toBe('NotSupportedError');
        expect((err as { message: string }).message).toBe('codec rejected');
    });
});
