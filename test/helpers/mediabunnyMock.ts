/**
 * Manual mock for the `mediabunny` library, used by the media-compression
 * compressors (`compressVideo`/`compressAudio`) and `conversionRun` in unit
 * tests. Real Mediabunny needs WebCodecs + actual decoding, which jsdom can't
 * provide, so the compressors are tested against this controllable stand-in.
 *
 * Usage in a test file:
 *
 *   import {
 *       mockMediabunny, setConversionResult, getLastConversion, resetMediabunnyMock,
 *   } from './helpers/mediabunnyMock';
 *   jest.mock('mediabunny', () => mockMediabunny());
 *
 * `jest.mock` factories are hoisted above imports and may only reference
 * bindings whose names start with "mock" — hence the export name `mockMediabunny`.
 *
 * Tests steer behavior by calling `setConversionResult({...})` BEFORE invoking
 * the compressor; the next `Conversion.init` snapshots those values.
 */

export interface ConversionResultState {
    /** `conversion.isValid` after init (default `true`). */
    isValid?: boolean;
    /** `conversion.discardedTracks` (default `[]`); each item is `{ track: { type } }`. */
    discardedTracks?: { track: { type: 'video' | 'audio' | 'subtitle' } }[];
    /** `BufferTarget.buffer` visible after `execute` resolves (default `null`). */
    buffer?: ArrayBuffer | null;
    /** If set, `Conversion.execute()` throws this synchronously. */
    executeError?: unknown;
    /** If `true`, `execute()` stays pending until `cancel()` rejects it (abort path). */
    pending?: boolean;
}

interface ResolvedState {
    isValid: boolean;
    discardedTracks: { track: { type: string } }[];
    buffer: ArrayBuffer | null;
    executeError: unknown;
    pending: boolean;
}

const defaultState = (): ResolvedState => ({
    isValid: true,
    discardedTracks: [],
    buffer: null,
    executeError: undefined,
    pending: false,
});

let state: ResolvedState = defaultState();
let lastConversion: MockConversion | undefined;

/** Configures what the NEXT `Conversion.init` (and its target) will expose. */
export function setConversionResult(next: ConversionResultState): void {
    state = { ...state, ...next };
}

/** The most recently created `Conversion`, for behavior assertions (e.g. cancel). */
export function getLastConversion(): MockConversion | undefined {
    return lastConversion;
}

/** Resets all mock state between tests. */
export function resetMediabunnyMock(): void {
    state = defaultState();
    lastConversion = undefined;
}

/** Mirrors `mediabunny.ConversionCanceledError` so `conversionRun` throws it. */
export class ConversionCanceledError extends Error {
    constructor(message?: string) {
        super(message);
        this.name = 'ConversionCanceledError';
    }
}

/** The mocked `Conversion` instance returned by `Conversion.init`. */
export class MockConversion {
    readonly isValid: boolean;
    readonly discardedTracks: { track: { type: string } }[];
    onProgress: ((progress: number, processedTime: number) => unknown) | undefined;
    conversionState: 'idle' | 'executing' | 'canceled' | 'done' = 'idle';
    executeCalled = false;
    cancelCalled = false;

    private readonly executeError: unknown;
    private readonly pending: boolean;
    private rejectExecute: ((err: unknown) => void) | undefined;

    constructor() {
        this.isValid = state.isValid;
        this.discardedTracks = state.discardedTracks;
        this.executeError = state.executeError;
        this.pending = state.pending;
    }

    async execute(): Promise<void> {
        this.executeCalled = true;
        this.conversionState = 'executing';
        if (this.executeError !== undefined) {
            throw this.executeError;
        }
        if (this.pending) {
            // Stays pending until cancel() rejects it, mirroring a real long encode.
            await new Promise<void>((_resolve, reject) => {
                this.rejectExecute = reject;
            });
            return;
        }
        this.conversionState = 'done';
    }

    async cancel(): Promise<void> {
        this.cancelCalled = true;
        this.conversionState = 'canceled';
        this.rejectExecute?.(new ConversionCanceledError('canceled'));
    }
}

/** A no-op class used for Mediabunny constructors the compressors don't introspect. */
function makeClass(): { new (...args: unknown[]): unknown } {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    return class { constructor(..._args: unknown[]) {} };
}

/**
 * The mock module factory. The export name MUST start with "mock" so that
 * `jest.mock('mediabunny', () => mockMediabunny())` satisfies jest's hoisting
 * rule for out-of-scope references.
 */
export function mockMediabunny(): Record<string, unknown> {
    return {
        Input: makeClass(),
        Output: makeClass(),
        BufferTarget: class {
            get buffer(): ArrayBuffer | null {
                return state.buffer;
            }
        },
        BlobSource: makeClass(),
        Mp4OutputFormat: makeClass(),
        OggOutputFormat: makeClass(),
        Conversion: {
            init: async (_options: unknown): Promise<MockConversion> => {
                lastConversion = new MockConversion();
                return lastConversion;
            },
        },
        ConversionCanceledError,
        // Opaque input-format singletons.
        MP4: 'MP4',
        WEBM: 'WEBM',
        QTFF: 'QTFF',
        MP3: 'MP3',
        WAVE: 'WAVE',
        OGG: 'OGG',
        FLAC: 'FLAC',
    };
}
