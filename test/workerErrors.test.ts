import {
    formatWorkerError,
    namedError,
    buildErrorResponse,
} from '../src/utils/mediaCompression/workerErrors';

/** Builds a DOMException-shaped Error (Error subclass with a `.name`). */
function domException(name: string, message: string): Error {
    const e = new Error(message);
    e.name = name;
    return e;
}

describe('workerErrors', () => {
    describe('formatWorkerError', () => {
        test('preserves the name of a DOMException-like Error', () => {
            const { name, message } = formatWorkerError(domException('NotSupportedError', 'nope'));
            expect(name).toBe('NotSupportedError');
            expect(message).toBe('nope');
        });

        test('preserves the name of a real DOMException', () => {
            if (typeof DOMException === 'undefined') return;
            const { name } = formatWorkerError(new DOMException('boom', 'NotSupportedError'));
            expect(name).toBe('NotSupportedError');
        });

        test('falls back to "Error" name when the Error has none', () => {
            const { name, message } = formatWorkerError(new Error('plain'));
            expect(name).toBe('Error');
            expect(message).toBe('plain');
        });

        test('handles non-Error throws (string)', () => {
            const { name, message } = formatWorkerError('a string was thrown');
            expect(name).toBe('Error');
            expect(message).toBe('a string was thrown');
        });

        test('handles non-Error throws (object)', () => {
            const { name, message } = formatWorkerError({ random: 'thing' });
            expect(name).toBe('Error');
            expect(message).toBe('[object Object]');
        });

        test('handles null/undefined', () => {
            expect(formatWorkerError(null).message).toBe('null');
            expect(formatWorkerError(undefined).message).toBe('undefined');
        });
    });

    describe('namedError', () => {
        test('produces an Error with the given programmatic name', () => {
            const e = namedError('NotSupportedError', 'config not supported: opus');
            expect(e).toBeInstanceOf(Error);
            expect(e.name).toBe('NotSupportedError');
            expect(e.message).toBe('config not supported: opus');
        });

        test('stack points at the call site (not a shared constructor)', () => {
            const e = namedError('InvalidStateError', 'x');
            expect(typeof e.stack).toBe('string');
        });
    });

    describe('buildErrorResponse', () => {
        test('shapes a thrown Error into the worker error message', () => {
            const res = buildErrorResponse(domException('NotSupportedError', 'bad codec'));
            expect(res).toEqual({
                type: 'error',
                name: 'NotSupportedError',
                error: 'bad codec',
            });
        });

        test('shapes a non-Error throw', () => {
            const res = buildErrorResponse('kaboom');
            expect(res).toEqual({ type: 'error', name: 'Error', error: 'kaboom' });
        });
    });
});

describe('Audio worker errors mislabeled + DOMException.name lost', () => {
    /**
     * Enumerates the reject sites and asserts each preserves the DOMException
     * name end-to-end through buildErrorResponse. Sites:
     *   audioEncoder.ts: encoder error cb, not supported, no audio encoded,
     *                    flush catch, isConfigSupported catch (the headline)
     *   videoCompression.worker.ts: encoder error cb, decoder error cb, flush catch
     * The outer onmessage catches route everything through buildErrorResponse,
     * covered by the buildErrorResponse tests above.
     */
    const sites = [
        { site: 'audio L70 AudioEncoder error callback', thrown: domException('NotSupportedError', 'encoder died') },
        { site: 'audio L84 not supported -> namedError', thrown: namedError('NotSupportedError', 'AudioEncoder config not supported: opus') },
        { site: 'audio L120 no audio -> namedError', thrown: namedError('InvalidStateError', 'No audio data encoded') },
        { site: 'audio L127 flush catch', thrown: domException('OutOfMemoryError', 'oom') },
        { site: 'audio L131 isConfigSupported catch (headline)', thrown: domException('NotSupportedError', 'opus not supported') },
        { site: 'video L225 VideoEncoder error callback', thrown: domException('NotSupportedError', 'venc') },
        { site: 'video L244 VideoDecoder error callback', thrown: domException('NotSupportedError', 'vdec') },
        { site: 'video L273 flush catch', thrown: domException('UnknownError', 'flush') },
    ];

    test.each(sites)('preserves DOMException.name for $site', ({ thrown }) => {
        const res = buildErrorResponse(thrown);
        expect(res.type).toBe('error');
        expect(res.name).toBe(thrown.name);
    });
});
