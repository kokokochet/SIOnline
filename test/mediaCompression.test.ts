import {
    isVideoCompressionSupported,
    isAudioCompressionSupported,
} from '../src/utils/mediaCompression/featureDetection';
import { compressMedia } from '../src/utils/mediaCompression';
import { compressionPresets } from '../src/utils/mediaCompression/compressionPresets';

describe('featureDetection', () => {
    describe('isVideoCompressionSupported', () => {
        const originalVideoEncoder = globalThis.VideoEncoder;

        afterEach(() => {
            if (originalVideoEncoder) {
                globalThis.VideoEncoder = originalVideoEncoder;
            } else {
                delete (globalThis as Record<string, unknown>).VideoEncoder;
            }
        });

        test('returns true when VideoEncoder is defined', () => {
            globalThis.VideoEncoder = class MockVideoEncoder {} as unknown as typeof VideoEncoder;
            expect(isVideoCompressionSupported()).toBe(true);
        });

        test('returns false when VideoEncoder is undefined', () => {
            delete (globalThis as Record<string, unknown>).VideoEncoder;
            expect(isVideoCompressionSupported()).toBe(false);
        });
    });

    describe('isAudioCompressionSupported', () => {
        const originalAudioEncoder = globalThis.AudioEncoder;

        afterEach(() => {
            if (originalAudioEncoder) {
                globalThis.AudioEncoder = originalAudioEncoder;
            } else {
                delete (globalThis as Record<string, unknown>).AudioEncoder;
            }
        });

        test('returns true when AudioEncoder is defined', () => {
            globalThis.AudioEncoder = class MockAudioEncoder {} as unknown as typeof AudioEncoder;
            expect(isAudioCompressionSupported()).toBe(true);
        });

        test('returns false when AudioEncoder is undefined', () => {
            delete (globalThis as Record<string, unknown>).AudioEncoder;
            expect(isAudioCompressionSupported()).toBe(false);
        });
    });
});

describe('compressMedia (public API)', () => {
    test('returns passthrough for image when image compression not available', async () => {
        const originalDoc = globalThis.document;
        delete (globalThis as Record<string, unknown>).document;

        try {
            const file = new File([new Uint8Array([1, 2, 3])], 'test.png', { type: 'image/png' });
            const result = await compressMedia(file, 'image', compressionPresets.medium);

            expect(result.wasCompressed).toBe(false);
        } finally {
            if (originalDoc) {
                globalThis.document = originalDoc;
            }
        }
    });
});
