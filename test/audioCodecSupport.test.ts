import {
    UnsupportedAudioCodecError,
    assertAudioMp4Compatible,
} from '../src/utils/mediaCompression/audioCodecSupport';

describe('Non-AAC audio silently dropped in MP4', () => {
    describe('assertAudioMp4Compatible', () => {
        test('passes for AAC (mp4a.40.2)', () => {
            expect(() => assertAudioMp4Compatible('mp4a.40.2')).not.toThrow();
        });

        test('passes for AAC-LC variant mp4a.40.5', () => {
            expect(() => assertAudioMp4Compatible('mp4a.40.5')).not.toThrow();
        });

        test('passes when there is no audio codec (undefined)', () => {
            expect(() => assertAudioMp4Compatible(undefined)).not.toThrow();
        });

        test('throws UnsupportedAudioCodecError for Opus', () => {
            expect(() => assertAudioMp4Compatible('Opus')).toThrow(UnsupportedAudioCodecError);
            expect(() => assertAudioMp4Compatible('Opus')).toThrow(/Opus/);
        });

        test('throws UnsupportedAudioCodecError for AC-3 (ac-3)', () => {
            expect(() => assertAudioMp4Compatible('ac-3')).toThrow(UnsupportedAudioCodecError);
        });

        test('throws UnsupportedAudioCodecError for MP3 (mp4a.6b)', () => {
            expect(() => assertAudioMp4Compatible('mp4a.6b')).toThrow(UnsupportedAudioCodecError);
        });

        test('the thrown error carries a programmatic name for telemetry', () => {
            try {
                assertAudioMp4Compatible('opus');
                throw new Error('expected throw');
            } catch (e) {
                expect((e as Error).name).toBe('UnsupportedAudioCodecError');
                expect((e as Error).message).toMatch(/opus/);
                expect((e as Error).message).toMatch(/silent/i);
            }
        });

        test('does not throw for an AAC-prefixed codec with suffix (mp4a.40.2.1)', () => {
            expect(() => assertAudioMp4Compatible('mp4a.40.2.1')).not.toThrow();
        });
    });
});
