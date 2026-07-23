import { compressAudio } from '../src/utils/mediaCompression/compressAudio';
import { defaultCompressionOptions } from '../src/utils/mediaCompression/defaultOptions';
import {
    setConversionResult,
    getLastConversion,
    resetMediabunnyMock,
} from './helpers/mediabunnyMock';

// NOTE: the factory requires the helper module inline instead of closing over
// the imported `mockMediabunny` binding. Under ts-jest + TypeScript 6 the named
// import compiles to a `const` in the temporal dead zone when jest's hoisted
// `jest.mock` factory first runs (the compressAudio import chain triggers
// `require('mediabunny')` before that const is initialized). Requiring the
// helper here resolves to the SAME cached module instance, so the module-level
// `state`/`lastConversion` singletons stay shared with the helpers imported
// below — setConversionResult/getLastConversion/resetMediabunnyMock all see the
// same state. See test/helpers/mediabunnyMock.ts for the control API.
jest.mock('mediabunny', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { mockMediabunny } = require('./helpers/mediabunnyMock');
    return mockMediabunny();
});

/**
 * Drains the microtask queue so the async compressor advances past its
 * `Conversion.init` await and into `execute()` before assertions run.
 */
function flushPromises(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

function makeFile(bytes: number): File {
    return new File([new Uint8Array(bytes).fill(0x11)], 'clip.wav', { type: 'audio/wav' });
}

describe('compressAudio (Mediabunny Conversion pipeline)', () => {
    const originalAudioEncoder = (globalThis as Record<string, unknown>).AudioEncoder;

    beforeEach(() => {
        // compressAudio gates on isAudioCompressionSupported(); force true so
        // the conversion pipeline is entered.
        (globalThis as Record<string, unknown>).AudioEncoder =
            class MockAudioEncoder {} as unknown as typeof AudioEncoder;
        resetMediabunnyMock();
    });

    afterEach(() => {
        if (originalAudioEncoder) {
            (globalThis as Record<string, unknown>).AudioEncoder = originalAudioEncoder;
        } else {
            delete (globalThis as Record<string, unknown>).AudioEncoder;
        }
        resetMediabunnyMock();
    });

    test('happy path: renames to .opus and reports compressedSize', async () => {
        setConversionResult({ buffer: new ArrayBuffer(50) });
        const file = makeFile(1000);

        const result = await compressAudio(file, defaultCompressionOptions.audio);

        expect(result.wasCompressed).toBe(true);
        expect(result.fileName).toBe('clip.opus');
        expect(result.compressedSize).toBe(50);
        expect(result.originalSize).toBe(1000);
    });

    test('invalid conversion → passthrough (original returned unchanged)', async () => {
        setConversionResult({ isValid: false });
        const file = makeFile(64);

        const result = await compressAudio(file, defaultCompressionOptions.audio);

        expect(result.wasCompressed).toBe(false);
        expect(result.data.length).toBe(64);
        expect(result.fileName).toBe('clip.wav');
        // execute() must not run for an invalid conversion.
        expect(getLastConversion()?.executeCalled).toBe(false);
    });

    test('size-guard: empty output → passthrough', async () => {
        setConversionResult({ buffer: new ArrayBuffer(0) });
        const file = makeFile(100);

        const result = await compressAudio(file, defaultCompressionOptions.audio);

        expect(result.wasCompressed).toBe(false);
        expect(result.data.length).toBe(100);
        expect(result.fileName).toBe('clip.wav');
    });

    test('size-guard: compressed >= original → passthrough', async () => {
        setConversionResult({ buffer: new ArrayBuffer(100) });
        const file = makeFile(100);

        const result = await compressAudio(file, defaultCompressionOptions.audio);

        expect(result.wasCompressed).toBe(false);
        expect(result.data.length).toBe(100);
    });

    test('execute() rejects (non-abort) → error rethrown, preserving its name', async () => {
        const codecError = Object.assign(new Error('opus not supported'), {
            name: 'NotSupportedError',
        });
        setConversionResult({ executeError: codecError });
        const file = makeFile(100);

        // Host surfaces the programmatic error name instead of silent passthrough.
        await expect(compressAudio(file, defaultCompressionOptions.audio)).rejects.toMatchObject({
            name: 'NotSupportedError',
        });
    });

    test('signal abort → conversion.cancel() called → rejects with AbortError', async () => {
        setConversionResult({ pending: true });
        const controller = new AbortController();
        const file = makeFile(100);

        const promise = compressAudio(file, defaultCompressionOptions.audio, controller.signal);
        await flushPromises(); // advance to the pending execute()

        controller.abort();

        await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
        expect(getLastConversion()?.cancelCalled).toBe(true);
    });

    test('already-aborted signal → rejects with AbortError before any conversion', async () => {
        const controller = new AbortController();
        controller.abort();
        const file = makeFile(100);

        await expect(
            compressAudio(file, defaultCompressionOptions.audio, controller.signal),
        ).rejects.toMatchObject({ name: 'AbortError' });
        // No Conversion should have been created.
        expect(getLastConversion()).toBeUndefined();
    });

    test('unsupported (AudioEncoder undefined) → passthrough', async () => {
        delete (globalThis as Record<string, unknown>).AudioEncoder;
        const file = makeFile(80);

        const result = await compressAudio(file, defaultCompressionOptions.audio);

        expect(result.wasCompressed).toBe(false);
        expect(result.fileName).toBe('clip.wav');
    });
});
