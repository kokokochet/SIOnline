/**
 * Mediabunny mock for the media-compression compressors. Real Mediabunny needs
 * WebCodecs (absent in jsdom), so compressors run against this stand-in.
 * `jest.mock` factories are hoisted and may only reference bindings whose names
 * start with "mock" — hence `mockMediabunny`.
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

export class MockConversion {
    readonly isValid: boolean;
    readonly discardedTracks: { track: { type: string } }[];
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
    }

    async cancel(): Promise<void> {
        this.cancelCalled = true;
        this.rejectExecute?.(new ConversionCanceledError('canceled'));
    }
}

/** A no-op class used for Mediabunny constructors the compressors don't introspect. */
function makeClass(): { new (...args: unknown[]): unknown } {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    return class { constructor(..._args: unknown[]) {} };
}

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
