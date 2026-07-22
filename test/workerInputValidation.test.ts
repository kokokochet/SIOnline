import {
    WorkerValidationError,
    validateAudioWorkerMessage,
    validateVideoWorkerMessage,
} from '../src/utils/mediaCompression/workerInputValidation';

function validAudioMessage(overrides: Record<string, unknown> = {}) {
    return {
        data: new ArrayBuffer(8),
        options: { bitrate: 64000, codec: 'opus', channels: 2 },
        ...overrides,
    };
}

function validVideoMessage(overrides: Record<string, unknown> = {}) {
    return {
        data: new ArrayBuffer(8),
        options: { maxHeight: 720, bitrate: 500_000, codec: 'avc1.64001F' },
        ...overrides,
    };
}

describe('media-compression-review MAJOR: Unvalidated worker input', () => {
    describe('validateAudioWorkerMessage', () => {
        test('accepts a well-formed message', () => {
            expect(() => validateAudioWorkerMessage(validAudioMessage())).not.toThrow();
        });

        test('accepts mono (options.channels = 1)', () => {
            expect(() =>
                validateAudioWorkerMessage(
                    validAudioMessage({
                        options: { bitrate: 64000, codec: 'opus', channels: 1 },
                    }),
                ),
            ).not.toThrow();
        });

        test('throws when data is not an ArrayBuffer', () => {
            expect(() => validateAudioWorkerMessage(validAudioMessage({ data: 'nope' }))).toThrow(/data/);
        });

        test('throws when data.byteLength is 0', () => {
            expect(() => validateAudioWorkerMessage(validAudioMessage({ data: new ArrayBuffer(0) }))).toThrow(/byteLength/);
        });

        test('throws when options.codec is empty', () => {
            expect(() =>
                validateAudioWorkerMessage(
                    validAudioMessage({ options: { bitrate: 64000, codec: '', channels: 2 } }),
                ),
            ).toThrow(WorkerValidationError);
        });

        test('throws when options.bitrate <= 0', () => {
            expect(() =>
                validateAudioWorkerMessage(
                    validAudioMessage({ options: { bitrate: 0, codec: 'opus', channels: 2 } }),
                ),
            ).toThrow(/bitrate/);
        });

        test('throws when options.channels is not 1 or 2 (OGG Opus family 0)', () => {
            expect(() =>
                validateAudioWorkerMessage(
                    validAudioMessage({ options: { bitrate: 64000, codec: 'opus', channels: 3 } }),
                ),
            ).toThrow(/channels/);
        });

        test('throws when options is not an object', () => {
            expect(() => validateAudioWorkerMessage(validAudioMessage({ options: 'nope' }))).toThrow(/options/);
        });

        test('throws when the whole message is not an object', () => {
            expect(() => validateAudioWorkerMessage(null)).toThrow(WorkerValidationError);
        });

        test('the thrown error has a programmatic name', () => {
            try {
                validateAudioWorkerMessage(validAudioMessage({ data: 'nope' }));
                throw new Error('expected throw');
            } catch (e) {
                expect((e as Error).name).toBe('WorkerValidationError');
            }
        });
    });

    describe('validateVideoWorkerMessage', () => {
        test('accepts a well-formed message', () => {
            expect(() => validateVideoWorkerMessage(validVideoMessage())).not.toThrow();
        });

        test('throws when options.maxHeight <= 0', () => {
            expect(() =>
                validateVideoWorkerMessage(
                    validVideoMessage({ options: { maxHeight: 0, bitrate: 500_000, codec: 'avc1.64001F' } }),
                ),
            ).toThrow(/maxHeight/);
        });

        test('throws when options.bitrate <= 0', () => {
            expect(() =>
                validateVideoWorkerMessage(
                    validVideoMessage({ options: { maxHeight: 720, bitrate: -1, codec: 'avc1.64001F' } }),
                ),
            ).toThrow(/bitrate/);
        });

        test('throws when options.codec is empty', () => {
            expect(() =>
                validateVideoWorkerMessage(
                    validVideoMessage({ options: { maxHeight: 720, bitrate: 500_000, codec: '' } }),
                ),
            ).toThrow(/codec/);
        });

        test('throws when data is not an ArrayBuffer', () => {
            expect(() => validateVideoWorkerMessage(validVideoMessage({ data: 'nope' }))).toThrow(/data/);
        });

        test('throws when data.byteLength is 0', () => {
            expect(() => validateVideoWorkerMessage(validVideoMessage({ data: new ArrayBuffer(0) }))).toThrow(/byteLength/);
        });
    });
});
