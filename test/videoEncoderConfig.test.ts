import { buildVideoEncoderConfig } from '../src/utils/mediaCompression/videoEncoderConfig';
import { VideoCompressionOptions } from '../src/utils/mediaCompression/compressionTypes';

const baseOptions: VideoCompressionOptions = {
    maxHeight: 720,
    bitrate: 500_000,
    codec: 'avc1.64001F',
};

describe('buildVideoEncoderConfig', () => {
    test('carries through codec, dimensions, bitrate and framerate from inputs', () => {
        const config = buildVideoEncoderConfig(baseOptions, 1280, 720, 30);

        expect(config.codec).toBe('avc1.64001F');
        expect(config.width).toBe(1280);
        expect(config.height).toBe(720);
        expect(config.bitrate).toBe(500_000);
        expect(config.framerate).toBe(30);
    });

    test('requests AVC sample format (avcC box, not hevc/av01)', () => {
        const config = buildVideoEncoderConfig(baseOptions, 1280, 720, 30);

        expect(config.avc).toEqual({ format: 'avc' });
    });

    test('sets latencyMode realtime to suppress B-frames (prevents negative ctts)', () => {
        // Without latencyMode, VideoToolbox/MediaFoundation may emit B-frames:
        // chunk.timestamp then drops below the cumulative decode timestamp and
        // compositionTimeOffset goes negative. mp4-muxer writes ctts as a
        // version-0 UNSIGNED u32, so a negative offset wraps to ~4.29 billion
        // and corrupts PTS order on Safari/QuickTime/Edge. Realtime mode keeps
        // decode and presentation order identical, so the offset stays >= 0.
        const config = buildVideoEncoderConfig(baseOptions, 1280, 720, 30);

        expect(config.latencyMode).toBe('realtime');
    });

    test('high-preset codec (avc1.640028, 1080p) also gets realtime latencyMode', () => {
        const highOptions: VideoCompressionOptions = {
            maxHeight: 1080,
            bitrate: 1_500_000,
            codec: 'avc1.640028',
        };
        const config = buildVideoEncoderConfig(highOptions, 1920, 1080, 60);

        expect(config.codec).toBe('avc1.640028');
        expect(config.latencyMode).toBe('realtime');
    });
});
