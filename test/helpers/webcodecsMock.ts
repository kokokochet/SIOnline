/**
 * Minimal mock factory for `AudioEncoder`. Returns a class whose static
 * `isConfigSupported` is controlled by the caller — enough to drive the audio
 * worker's `onmessage` end-to-end without a real WebCodecs implementation.
 *
 * Plan 10 (test infrastructure) expands this file into a full WebCodecs mock.
 */

type IsConfigSupported = (config: unknown) => Promise<unknown>;

export function makeMockAudioEncoder(isConfigSupported: IsConfigSupported): typeof AudioEncoder {
    return class MockAudioEncoder {
        static isConfigSupported = isConfigSupported;
        configure(): void {}
        encode(): void {}
        flush(): Promise<void> { return Promise.resolve(); }
        close(): void {}
    } as unknown as typeof AudioEncoder;
}

/**
 * Minimal AudioData mock: records every constructed instance so tests can
 * assert close() was called. WebCodecs AudioData is unavailable in the node
 * test environment, so mediaCompression helpers that construct AudioData
 * require this mock installed on globalThis.
 *
 * Plan 10 (test infrastructure) expands this into a full WebCodecs mock.
 */
export interface MockAudioDataInstance {
    close: jest.Mock;
    init: unknown;
}

export interface AudioDataMockHandle {
    MockClass: new (init: unknown) => MockAudioDataInstance;
    instances: MockAudioDataInstance[];
    restore: () => void;
}

export function installAudioDataMock(): AudioDataMockHandle {
    const instances: MockAudioDataInstance[] = [];
    const MockClass = class {
        init: unknown;
        close: jest.Mock;
        constructor(init: unknown) {
            this.init = init;
            this.close = jest.fn();
            instances.push(this as unknown as MockAudioDataInstance);
        }
    };
    const previous = (globalThis as Record<string, unknown>).AudioData;
    (globalThis as Record<string, unknown>).AudioData = MockClass;
    return {
        MockClass: MockClass as unknown as AudioDataMockHandle['MockClass'],
        instances,
        restore: () => {
            if (previous === undefined) {
                delete (globalThis as Record<string, unknown>).AudioData;
            } else {
                (globalThis as Record<string, unknown>).AudioData = previous;
            }
        },
    };
}
