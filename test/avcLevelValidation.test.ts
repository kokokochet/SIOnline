import { validateAvcLevel } from '../src/utils/mediaCompression/avcLevelValidation';

describe('H.264 level insufficient for res/fps', () => {
    describe('validateAvcLevel — spec-compliant combos (ok: true)', () => {
        test('1080p30 @ avc1.640028 (Level 4.0) is within limits', () => {
            // frameSizeMB = ceil(1920/16)*ceil(1080/16) = 120*68 = 8160 <= 8192 (MaxFS L4.0)
            // mbps = 8160 * 30 = 244800 <= 245760 (MaxMBPS L4.0)
            const r = validateAvcLevel('avc1.640028', 1920, 1080, 30);
            expect(r.ok).toBe(true);
        });

        test('720p30 @ avc1.64001F (Level 3.1) is within limits', () => {
            // frameSizeMB = 80*45 = 3600 <= 3600; mbps = 3600*30 = 108000 <= 108000
            const r = validateAvcLevel('avc1.64001F', 1280, 720, 30);
            expect(r.ok).toBe(true);
        });

        test('720p60 @ avc1.640028 (Level 4.0) is within limits', () => {
            // mbps = 3600*60 = 216000 <= 245760
            const r = validateAvcLevel('avc1.640028', 1280, 720, 60);
            expect(r.ok).toBe(true);
        });

        test('1080p60 @ avc1.64002A (Level 4.2) is within limits (regression for L4.2 MaxMBPS)', () => {
            // L4.2 MaxMBPS = 552960 per ITU-T H.264 Table A-5.1.
            // frameSizeMB = 120*68 = 8160 <= 8192 (MaxFS L4.2)
            // mbps = 8160*60 = 489600 <= 552960 (MaxMBPS L4.2) — would false-reject
            // if L4.2 incorrectly inherited L4.1's 245760.
            const r = validateAvcLevel('avc1.64002A', 1920, 1080, 60);
            expect(r.ok).toBe(true);
        });

        test('480p @ avc1.64001F is well within Level 3.1', () => {
            const r = validateAvcLevel('avc1.64001F', 854, 480, 30);
            expect(r.ok).toBe(true);
        });
    });

    describe('validateAvcLevel — non-compliant combos (ok: false)', () => {
        test('1080p60 @ avc1.640028 exceeds Level 4.0 MaxMBPS', () => {
            // mbps = 8160*60 = 489600 > 245760
            const r = validateAvcLevel('avc1.640028', 1920, 1080, 60);
            expect(r.ok).toBe(false);
            expect(r.reason).toMatch(/MaxMBPS/);
        });

        test('720p60 @ avc1.64001F exceeds Level 3.1 MaxMBPS', () => {
            // mbps = 3600*60 = 216000 > 108000
            const r = validateAvcLevel('avc1.64001F', 1280, 720, 60);
            expect(r.ok).toBe(false);
            expect(r.reason).toMatch(/MaxMBPS/);
        });

        test('1080p30 @ avc1.64001F exceeds Level 3.1 MaxFS', () => {
            // frameSizeMB = 8160 > 3600
            const r = validateAvcLevel('avc1.64001F', 1920, 1080, 30);
            expect(r.ok).toBe(false);
            expect(r.reason).toMatch(/MaxFS/);
        });

        test('4K30 @ avc1.640028 exceeds both MaxFS and MaxMBPS (MaxFS checked first)', () => {
            const r = validateAvcLevel('avc1.640028', 3840, 2160, 30);
            expect(r.ok).toBe(false);
            expect(r.reason).toMatch(/MaxFS/);
        });
    });

    describe('validateAvcLevel — codec handling', () => {
        test('non-AVC codec is skipped (ok: true)', () => {
            expect(validateAvcLevel('vp09.00.10.08', 1920, 1080, 60).ok).toBe(true);
            expect(validateAvcLevel('av01.0.04M.08', 1920, 1080, 60).ok).toBe(true);
        });

        test('unparseable avc1 string reports a parse error', () => {
            const r = validateAvcLevel('avc1.bogus', 1920, 1080, 30);
            expect(r.ok).toBe(false);
            expect(r.reason).toMatch(/level/i);
        });

        test('avc1 with uppercase hex parses correctly (1080p30 L4.0 ok)', () => {
            const r = validateAvcLevel('avc1.640028'.toUpperCase(), 1920, 1080, 30);
            expect(r.ok).toBe(true);
        });

        test('avc3 prefix is accepted (avc3.640028 1080p30 ok)', () => {
            const r = validateAvcLevel('avc3.640028', 1920, 1080, 30);
            expect(r.ok).toBe(true);
        });
    });

    describe('validateAvcLevel — invalid inputs', () => {
        test('zero width is rejected', () => {
            expect(validateAvcLevel('avc1.640028', 0, 1080, 30).ok).toBe(false);
        });

        test('negative fps is rejected', () => {
            expect(validateAvcLevel('avc1.640028', 1920, 1080, -30).ok).toBe(false);
        });
    });
});
