import { compressVideo } from '../src/utils/mediaCompression/compressVideo';
import { compressAudio } from '../src/utils/mediaCompression/compressAudio';
import { compressionPresets } from '../src/utils/mediaCompression/compressionPresets';
import { CompressedMedia } from '../src/utils/mediaCompression/compressionTypes';
import {
    setConversionResult,
    getLastConversion,
    resetMediabunnyMock,
} from './helpers/mediabunnyMock';

// Inline require (not import): ts-jest hoists jest.mock before the named import initializes (TDZ); same cached module, state shared with helpers.
jest.mock('mediabunny', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { mockMediabunny } = require('./helpers/mediabunnyMock');
    return mockMediabunny();
});

// Drains microtasks so execute() runs before assertions.
function flushPromises(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

type EncoderGlobal = 'VideoEncoder' | 'AudioEncoder';
type CompressFn = (file: File, options: unknown, signal?: AbortSignal) => Promise<CompressedMedia>;

interface CodecCase {
    name: string;
    encoder: EncoderGlobal;
    compress: CompressFn;
    options: unknown;
    makeFile: (bytes: number) => File;
    // Happy-path expectations differ per codec (audio renames to .opus, sizes differ).
    happy: { buffer: number; fileName: string };
}

const cases: CodecCase[] = [
    {
        name: 'compressVideo',
        encoder: 'VideoEncoder',
        compress: compressVideo as unknown as CompressFn,
        options: compressionPresets.medium.video,
        makeFile: (bytes) => new File([new Uint8Array(bytes).fill(0xaa)], 'in.mp4', { type: 'video/mp4' }),
        happy: { buffer: 100, fileName: 'in.mp4' },
    },
    {
        name: 'compressAudio',
        encoder: 'AudioEncoder',
        compress: compressAudio as unknown as CompressFn,
        options: compressionPresets.medium.audio,
        makeFile: (bytes) => new File([new Uint8Array(bytes).fill(0x11)], 'clip.wav', { type: 'audio/wav' }),
        happy: { buffer: 50, fileName: 'clip.opus' },
    },
];

describe.each(cases)('$name (Mediabunny Conversion pipeline)', (c) => {
    const originalEncoder = (globalThis as Record<string, unknown>)[c.encoder];

    beforeEach(() => {
        (globalThis as Record<string, unknown>)[c.encoder] = class MockEncoder {};
        resetMediabunnyMock();
    });

    afterEach(() => {
        if (originalEncoder) {
            (globalThis as Record<string, unknown>)[c.encoder] = originalEncoder;
        } else {
            delete (globalThis as Record<string, unknown>)[c.encoder];
        }
        resetMediabunnyMock();
    });

    test('happy path: smaller output is returned with wasCompressed=true', async () => {
        setConversionResult({ buffer: new ArrayBuffer(c.happy.buffer) });
        const file = c.makeFile(1000);

        const result = await c.compress(file, c.options);

        expect(result.wasCompressed).toBe(true);
        expect(result.originalSize).toBe(1000);
        expect(result.compressedSize).toBe(c.happy.buffer);
        expect(result.fileName).toBe(c.happy.fileName);
    });

    test('invalid conversion → passthrough (original returned unchanged)', async () => {
        setConversionResult({ isValid: false });
        const file = c.makeFile(64);

        const result = await c.compress(file, c.options);

        expect(result.wasCompressed).toBe(false);
        expect(result.data.length).toBe(64);
        expect(result.fileName).toBe(file.name);
        expect(getLastConversion()?.executeCalled).toBe(false);
    });

    test('size-guard: empty output → passthrough', async () => {
        setConversionResult({ buffer: new ArrayBuffer(0) });
        const file = c.makeFile(100);

        const result = await c.compress(file, c.options);

        expect(result.wasCompressed).toBe(false);
        expect(result.data.length).toBe(100);
    });

    test('size-guard: compressed >= original → passthrough', async () => {
        setConversionResult({ buffer: new ArrayBuffer(100) });
        const file = c.makeFile(100);

        const result = await c.compress(file, c.options);

        expect(result.wasCompressed).toBe(false);
        expect(result.data.length).toBe(100);
    });

    test('execute() rejects (non-abort) → error rethrown, preserving its name', async () => {
        const codecError = Object.assign(new Error('codec not supported'), {
            name: 'NotSupportedError',
        });
        setConversionResult({ executeError: codecError });
        const file = c.makeFile(100);

        // Host surfaces the programmatic error name instead of silent passthrough.
        await expect(c.compress(file, c.options)).rejects.toMatchObject({
            name: 'NotSupportedError',
        });
    });

    test('signal abort → conversion.cancel() called → rejects with AbortError', async () => {
        setConversionResult({ pending: true });
        const controller = new AbortController();
        const file = c.makeFile(100);

        const promise = c.compress(file, c.options, controller.signal);
        await flushPromises();

        controller.abort();

        await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
        expect(getLastConversion()?.cancelCalled).toBe(true);
    });

    test('already-aborted signal → rejects with AbortError before any conversion', async () => {
        const controller = new AbortController();
        controller.abort();
        const file = c.makeFile(100);

        await expect(
            c.compress(file, c.options, controller.signal),
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(getLastConversion()).toBeUndefined();
    });

    test('unsupported (encoder undefined) → passthrough', async () => {
        delete (globalThis as Record<string, unknown>)[c.encoder];
        const file = c.makeFile(80);

        const result = await c.compress(file, c.options);

        expect(result.wasCompressed).toBe(false);
        expect(result.fileName).toBe(file.name);
    });
});

// Video-only: a dropped audio track must never silently mute the clip.
describe('compressVideo dropped-track guard', () => {
    const originalVideoEncoder = (globalThis as Record<string, unknown>).VideoEncoder;

    beforeEach(() => {
        (globalThis as Record<string, unknown>).VideoEncoder = class MockVideoEncoder {};
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

    test('dropped audio track → passthrough (never silently mute the clip)', async () => {
        setConversionResult({
            discardedTracks: [{ track: { type: 'audio' } }],
        });
        const file = new File([new Uint8Array(64).fill(0xaa)], 'in.mp4', { type: 'video/mp4' });

        const result = await compressVideo(file, compressionPresets.medium.video);

        expect(result.wasCompressed).toBe(false);
        expect(result.data.length).toBe(64);
    });
});
