import { defaultCompressionOptions } from '../src/utils/mediaCompression/defaultOptions';
import { compressionPresets, mediumPreset } from '../src/utils/mediaCompression/compressionPresets';
import {
    isVideoCompressionSupported,
    isAudioCompressionSupported,
} from '../src/utils/mediaCompression/featureDetection';
import { calculateTargetDimensions } from '../src/utils/mediaCompression/compressImage';
import { compressVideo } from '../src/utils/mediaCompression/compressVideo';
import { compressAudio } from '../src/utils/mediaCompression/compressAudio';
import { compressMedia } from '../src/utils/mediaCompression';

describe('mediaCompression', () => {
    describe('defaultCompressionOptions', () => {
        test('image defaults match medium preset (max 1200px, JPEG quality 0.8)', () => {
            expect(defaultCompressionOptions.image.maxDimension).toBe(1200);
            expect(defaultCompressionOptions.image.quality).toBe(0.8);
            expect(defaultCompressionOptions.image.mimeType).toBe('image/jpeg');
        });

        test('audio defaults: 128 kbps Opus', () => {
            expect(defaultCompressionOptions.audio.bitrate).toBe(128_000);
            expect(defaultCompressionOptions.audio.codec).toBe('opus');
            expect(defaultCompressionOptions.audio.channels).toBe(2);
        });

        test('video defaults: 720px height, 500 kbps, H.264', () => {
            expect(defaultCompressionOptions.video.maxHeight).toBe(720);
            expect(defaultCompressionOptions.video.bitrate).toBe(500_000);
            expect(defaultCompressionOptions.video.codec).toBe('avc');
        });

        test('defaultCompressionOptions IS the medium preset (single source of truth)', () => {
            // defaultOptions.ts re-exports mediumPreset; Object.is prevents drift.
            expect(defaultCompressionOptions).toBe(mediumPreset);
        });
    });
});

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

describe('compressImage', () => {
    describe('calculateTargetDimensions', () => {
        test('scales down landscape image to maxDimension', () => {
            expect(calculateTargetDimensions(1600, 1200, 800)).toEqual({ width: 800, height: 600 });
        });

        test('scales down portrait image to maxDimension', () => {
            expect(calculateTargetDimensions(1200, 1600, 800)).toEqual({ width: 600, height: 800 });
        });

        test('returns original dimensions when within maxDimension', () => {
            expect(calculateTargetDimensions(400, 300, 800)).toEqual({ width: 400, height: 300 });
        });

        test('returns original dimensions for square image within maxDimension', () => {
            expect(calculateTargetDimensions(800, 800, 800)).toEqual({ width: 800, height: 800 });
        });

        test('scales down square image exceeding maxDimension', () => {
            expect(calculateTargetDimensions(1000, 1000, 800)).toEqual({ width: 800, height: 800 });
        });
    });
});

describe('compressVideo', () => {
    test('returns passthrough when VideoEncoder is not available', async () => {
        const originalVideoEncoder = globalThis.VideoEncoder;
        delete (globalThis as Record<string, unknown>).VideoEncoder;

        try {
            const file = new File([new Uint8Array([1, 2, 3, 4])], 'test.mp4', { type: 'video/mp4' });
            const result = await compressVideo(file, defaultCompressionOptions.video);

            expect(result.wasCompressed).toBe(false);
            expect(result.fileName).toBe('test.mp4');
            expect(result.data.length).toBe(4);
        } finally {
            if (originalVideoEncoder) {
                globalThis.VideoEncoder = originalVideoEncoder;
            }
        }
    });
});

describe('compressAudio', () => {
    test('returns passthrough when AudioEncoder is not available', async () => {
        const originalAudioEncoder = globalThis.AudioEncoder;
        delete (globalThis as Record<string, unknown>).AudioEncoder;

        try {
            const file = new File([new Uint8Array([1, 2, 3, 4])], 'test.mp3', { type: 'audio/mpeg' });
            const result = await compressAudio(file, defaultCompressionOptions.audio);

            expect(result.wasCompressed).toBe(false);
            expect(result.fileName).toBe('test.mp3');
            expect(result.data.length).toBe(4);
        } finally {
            if (originalAudioEncoder) {
                globalThis.AudioEncoder = originalAudioEncoder;
            }
        }
    });
});

describe('compressMedia (public API)', () => {
    test('returns passthrough for HTML type', async () => {
        const file = new File(['<p>hello</p>'], 'test.html', { type: 'text/html' });
        const result = await compressMedia(file, 'html', compressionPresets.medium);

        expect(result.wasCompressed).toBe(false);
        expect(result.fileName).toBe('test.html');
    });

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
