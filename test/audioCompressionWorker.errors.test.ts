import { makeMockAudioEncoder } from './helpers/webcodecsMock';

/**
 * Drives the real audioCompression worker's `onmessage` end-to-end with a
 * mocked AudioEncoder, capturing the module's registered `self.onmessage` and
 * aliasing `globalThis.self` (Node has no `self`). The worker decodes raw bytes
 * via `OfflineAudioContext.decodeAudioData` before reaching the AudioEncoder,
 * so a minimal decode mock returning empty PCM lets the AudioEncoder rejection
 * surface.
 */

type OnMessage = (ev: { data: unknown }) => void;

let capturedOnMessage: OnMessage | null = null;
let postMessageSpy: jest.Mock;

beforeAll(() => {
    postMessageSpy = jest.fn();
    (globalThis as unknown as { postMessage: jest.Mock }).postMessage = postMessageSpy;
    // Worker module reads `self` at module-eval time; alias it so the require
    // does not throw ReferenceError in Node's test env.
    (globalThis as unknown as { self: typeof globalThis }).self = globalThis;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('../src/utils/mediaCompression/workers/audioCompression.worker');
    capturedOnMessage = (globalThis as unknown as { onmessage: OnMessage }).onmessage;
    if (!capturedOnMessage) {
        throw new Error('audio worker did not register onmessage');
    }
});

function dispatch(message: unknown): void {
    capturedOnMessage!({ data: message });
}

/** Flushes the microtask queue so the async onmessage can run to completion. */
async function flush(): Promise<void> {
    for (let i = 0; i < 10; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
}

describe('audio worker surfaces DOMException.name', () => {
    const originalAudioEncoder = (globalThis as Record<string, unknown>).AudioEncoder;
    const originalOfflineAudioContext = (globalThis as Record<string, unknown>).OfflineAudioContext;

    afterEach(() => {
        postMessageSpy.mockClear();
        (globalThis as Record<string, unknown>).AudioEncoder = originalAudioEncoder;
        (globalThis as Record<string, unknown>).OfflineAudioContext = originalOfflineAudioContext;
    });

    test('isConfigSupported rejection propagates as {type:error, name:NotSupportedError}', async () => {
        const domError = new DOMException('The codec is not supported', 'NotSupportedError');
        (globalThis as Record<string, unknown>).AudioEncoder = makeMockAudioEncoder(() =>
            Promise.reject(domError),
        );
        // Minimal decode mock so the worker reaches the AudioEncoder path.
        (globalThis as Record<string, unknown>).OfflineAudioContext = jest.fn(() => ({
            decodeAudioData: async () => ({
                numberOfChannels: 1,
                length: 0,
                getChannelData: () => new Float32Array(0),
            }),
        })) as unknown;

        dispatch({
            data: new ArrayBuffer(8),
            options: { bitrate: 64000, codec: 'opus', channels: 1 },
        });
        await flush();

        expect(postMessageSpy).toHaveBeenCalledTimes(1);
        const response = postMessageSpy.mock.calls[0][0];
        expect(response.type).toBe('error');
        expect(response.name).toBe('NotSupportedError');
        expect(response.error).toBe('The codec is not supported');
        expect(response.error).not.toMatch(/isConfigSupported error/);
    });

    test('config-not-supported surfaces as {type:error, name:NotSupportedError}', async () => {
        (globalThis as Record<string, unknown>).AudioEncoder = makeMockAudioEncoder(() =>
            Promise.resolve({ supported: false }),
        );
        (globalThis as Record<string, unknown>).OfflineAudioContext = jest.fn(() => ({
            decodeAudioData: async () => ({
                numberOfChannels: 1,
                length: 0,
                getChannelData: () => new Float32Array(0),
            }),
        })) as unknown;

        dispatch({
            data: new ArrayBuffer(8),
            options: { bitrate: 64000, codec: 'opus', channels: 1 },
        });
        await flush();

        const response = postMessageSpy.mock.calls[0][0];
        expect(response.type).toBe('error');
        expect(response.name).toBe('NotSupportedError');
        expect(response.error).toMatch(/opus/);
    });
});
