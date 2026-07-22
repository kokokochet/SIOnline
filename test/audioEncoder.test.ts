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
