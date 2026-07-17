import { defaultCompressionOptions } from '../src/utils/mediaCompression/defaultOptions';
import { CompressibleMediaType, CompressedMedia } from '../src/utils/mediaCompression/compressionTypes';
import {
    isVideoCompressionSupported,
    isAudioCompressionSupported,
} from '../src/utils/mediaCompression/featureDetection';

describe('mediaCompression', () => {
    describe('defaultCompressionOptions', () => {
        test('image defaults match spec: max 800px, JPEG quality 0.8', () => {
            expect(defaultCompressionOptions.image.maxDimension).toBe(800);
            expect(defaultCompressionOptions.image.quality).toBe(0.8);
            expect(defaultCompressionOptions.image.mimeType).toBe('image/jpeg');
        });

        test('audio defaults: 128 kbps Opus, 48 kHz (Opus 128k ≈ MP3 192k)', () => {
            expect(defaultCompressionOptions.audio.bitrate).toBe(128_000);
            expect(defaultCompressionOptions.audio.codec).toBe('opus');
            expect(defaultCompressionOptions.audio.sampleRate).toBe(48000);
        });

        test('video defaults match spec: max 720px height, 1000 kbps, H.264', () => {
            expect(defaultCompressionOptions.video.maxHeight).toBe(720);
            expect(defaultCompressionOptions.video.bitrate).toBe(1_000_000);
            expect(defaultCompressionOptions.video.codec).toMatch(/^avc1\./);
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
