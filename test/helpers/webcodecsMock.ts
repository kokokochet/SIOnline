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
