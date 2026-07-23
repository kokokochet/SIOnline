import { compressVideo } from '../src/utils/mediaCompression/compressVideo';
import { defaultCompressionOptions } from '../src/utils/mediaCompression/defaultOptions';
import {
    setConversionResult,
    getLastConversion,
    resetMediabunnyMock,
} from './helpers/mediabunnyMock';

// The factory requires the helper module inline rather than closing over the
// imported binding: under ts-jest + TypeScript 6 the named import compiles to a
// `const` in the temporal dead zone when jest's hoisted `jest.mock` factory
// first runs (the compressVideo import chain triggers `require('mediabunny')`
// before that const is initialized). The inline require resolves to the SAME
// cached module instance, so the module-level `state`/`lastConversion`
// singletons stay shared with the control helpers imported above.
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
    return new File([new Uint8Array(bytes).fill(0xaa)], 'in.mp4', { type: 'video/mp4' });
}

describe('compressVideo (Mediabunny Conversion pipeline)', () => {
    const originalVideoEncoder = (globalThis as Record<string, unknown>).VideoEncoder;

    beforeEach(() => {
        // compressVideo gates on isVideoCompressionSupported(); force true so
        // the conversion pipeline is entered.
        (globalThis as Record<string, unknown>).VideoEncoder =
            class MockVideoEncoder {} as unknown as typeof VideoEncoder;
        resetMediabunnyMock();
    });

    afterEach(() => {
        if (originalVideoEncoder) {
            (globalThis as Record<string, unknown>).VideoEncoder = originalVideoEncoder;
        } else {
            delete (globalThis as Record<string, unknown>).VideoEncoder;
        }
        resetMediabunnyMock();
    });

    test('happy path: smaller output is returned with wasCompressed=true', async () => {
        setConversionResult({ buffer: new ArrayBuffer(100) });
        const file = makeFile(1000);

        const result = await compressVideo(file, defaultCompressionOptions.video);

        expect(result.wasCompressed).toBe(true);
        expect(result.originalSize).toBe(1000);
        expect(result.compressedSize).toBe(100);
        expect(result.fileName).toBe('in.mp4');
    });

    test('invalid conversion → passthrough (original returned unchanged)', async () => {
        setConversionResult({ isValid: false });
        const file = makeFile(64);

        const result = await compressVideo(file, defaultCompressionOptions.video);

        expect(result.wasCompressed).toBe(false);
        expect(result.data.length).toBe(64);
        expect(result.fileName).toBe('in.mp4');
        // execute() must not run for an invalid conversion.
        expect(getLastConversion()?.executeCalled).toBe(false);
    });

    test('dropped audio track → passthrough (never silently mute the clip)', async () => {
        setConversionResult({
            discardedTracks: [{ track: { type: 'audio' } }],
        });
        const file = makeFile(64);

        const result = await compressVideo(file, defaultCompressionOptions.video);

        expect(result.wasCompressed).toBe(false);
        expect(result.data.length).toBe(64);
    });

    test('size-guard: empty output → passthrough', async () => {
        setConversionResult({ buffer: new ArrayBuffer(0) });
        const file = makeFile(100);

        const result = await compressVideo(file, defaultCompressionOptions.video);

        expect(result.wasCompressed).toBe(false);
        expect(result.data.length).toBe(100);
    });

    test('size-guard: compressed >= original → passthrough', async () => {
        setConversionResult({ buffer: new ArrayBuffer(100) });
        const file = makeFile(100);

        const result = await compressVideo(file, defaultCompressionOptions.video);

        expect(result.wasCompressed).toBe(false);
        expect(result.data.length).toBe(100);
    });

    test('execute() rejects (non-abort) → error rethrown, preserving its name', async () => {
        const codecError = Object.assign(new Error('avc not supported'), {
            name: 'NotSupportedError',
        });
        setConversionResult({ executeError: codecError });
        const file = makeFile(100);

        // Host surfaces the programmatic error name instead of silent passthrough.
        await expect(compressVideo(file, defaultCompressionOptions.video)).rejects.toMatchObject({
            name: 'NotSupportedError',
        });
    });

    test('signal abort → conversion.cancel() called → rejects with AbortError', async () => {
        setConversionResult({ pending: true });
        const controller = new AbortController();
        const file = makeFile(100);

        const promise = compressVideo(file, defaultCompressionOptions.video, controller.signal);
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
            compressVideo(file, defaultCompressionOptions.video, controller.signal),
        ).rejects.toMatchObject({ name: 'AbortError' });
        // No Conversion should have been created.
        expect(getLastConversion()).toBeUndefined();
    });

    test('unsupported (VideoEncoder undefined) → passthrough', async () => {
        delete (globalThis as Record<string, unknown>).VideoEncoder;
        const file = makeFile(80);

        const result = await compressVideo(file, defaultCompressionOptions.video);

        expect(result.wasCompressed).toBe(false);
        expect(result.fileName).toBe('in.mp4');
    });
});
