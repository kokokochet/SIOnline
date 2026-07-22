import { configureWithCleanup } from '../src/utils/mediaCompression/configureWithCleanup';

describe('media-compression-review MAJOR: Encoder/decoder leak on configure throw', () => {
    test('closes both codecs when encoder.configure throws', () => {
        const configureEncoder = jest.fn(() => {
            throw new Error('NotSupportedError: bad encoder config');
        });
        const configureDecoder = jest.fn();
        const closeEncoder = jest.fn();
        const closeDecoder = jest.fn();

        expect(() =>
            configureWithCleanup({ configureEncoder, configureDecoder, closeEncoder, closeDecoder }),
        ).toThrow('NotSupportedError: bad encoder config');

        expect(closeEncoder).toHaveBeenCalledTimes(1);
        expect(closeDecoder).toHaveBeenCalledTimes(1);
        expect(configureDecoder).not.toHaveBeenCalled();
    });

    test('closes both codecs when decoder.configure throws', () => {
        const configureEncoder = jest.fn();
        const configureDecoder = jest.fn(() => {
            throw new Error('NotSupportedError: bad decoder config');
        });
        const closeEncoder = jest.fn();
        const closeDecoder = jest.fn();

        expect(() =>
            configureWithCleanup({ configureEncoder, configureDecoder, closeEncoder, closeDecoder }),
        ).toThrow('NotSupportedError: bad decoder config');

        expect(closeEncoder).toHaveBeenCalledTimes(1);
        expect(closeDecoder).toHaveBeenCalledTimes(1);
        expect(configureEncoder).toHaveBeenCalledTimes(1);
    });

    test('does not close anything on the happy path', () => {
        const configureEncoder = jest.fn();
        const configureDecoder = jest.fn();
        const closeEncoder = jest.fn();
        const closeDecoder = jest.fn();

        configureWithCleanup({ configureEncoder, configureDecoder, closeEncoder, closeDecoder });

        expect(closeEncoder).not.toHaveBeenCalled();
        expect(closeDecoder).not.toHaveBeenCalled();
    });

    test('re-throws non-Error values wrapped in Error', () => {
        const configureEncoder = jest.fn(() => {
            throw 'string error';
        });
        expect(() =>
            configureWithCleanup({
                configureEncoder,
                configureDecoder: jest.fn(),
                closeEncoder: jest.fn(),
                closeDecoder: jest.fn(),
            }),
        ).toThrow('string error');
    });

    test('a secondary closeEncoder throw does not mask the original configure error and closeDecoder still runs', () => {
        const original = new Error('NotSupportedError: bad encoder config');
        const configureEncoder = jest.fn(() => {
            throw original;
        });
        const configureDecoder = jest.fn();
        const closeEncoder = jest.fn(() => {
            throw new Error('InvalidStateError: close after failed configure');
        });
        const closeDecoder = jest.fn();

        let caught: unknown = null;
        try {
            configureWithCleanup({ configureEncoder, configureDecoder, closeEncoder, closeDecoder });
        } catch (e) {
            caught = e;
        }

        // The ORIGINAL configure error propagates — not the closeEncoder throw.
        expect(caught).toBe(original);
        // closeDecoder still ran even though closeEncoder threw.
        expect(closeEncoder).toHaveBeenCalledTimes(1);
        expect(closeDecoder).toHaveBeenCalledTimes(1);
        expect(configureDecoder).not.toHaveBeenCalled();
    });
});
