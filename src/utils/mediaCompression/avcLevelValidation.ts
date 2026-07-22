/**
 * H.264 level limits per ITU-T H.264 Table A-5.1 (subset relevant to web video).
 * Keyed by the level_idc * 10 (so 40 = level 4.0, 31 = level 3.1, …).
 *
 * - maxFS:     maximum frame size in macroblocks (16x16 each).
 * - maxMBPS:   maximum macroblock processing rate (≈ frameSizeMB * fps).
 *
 * Note: MaxDpbMbs (decoded picture buffer — limits reference frames at a given
 * resolution) is intentionally out of scope for v1. For single-pass web encoding
 * with default reference frames this has no effect; reference-heavy configs that
 * violate MaxDpbMbs would false-pass here. Deferred to a future hardening pass.
 */
interface AvcLevelLimits {
    maxFS: number;
    maxMBPS: number;
}

const AVC_LEVELS: Record<number, AvcLevelLimits> = {
    30: { maxFS: 1620, maxMBPS: 40500 },    // 3.0
    31: { maxFS: 3600, maxMBPS: 108000 },   // 3.1
    32: { maxFS: 5120, maxMBPS: 216000 },   // 3.2
    40: { maxFS: 8192, maxMBPS: 245760 },   // 4.0
    41: { maxFS: 8192, maxMBPS: 245760 },   // 4.1
    42: { maxFS: 8192, maxMBPS: 552960 },   // 4.2  (MaxMBPS per ITU-T H.264 Table A-5.1)
    50: { maxFS: 22080, maxMBPS: 589824 },  // 5.0
    51: { maxFS: 36864, maxMBPS: 983040 },  // 5.1
    52: { maxFS: 36864, maxMBPS: 2073600 }, // 5.2
};

export interface AvcLevelCheck {
    ok: boolean;
    reason?: string;
}

/**
 * Parses the level_idc from an AVC codec string of the form
 * `avc1.PPCCLL` / `avc3.PPCCLL` (profile_idc + constraint flags + level_idc,
 * each two hex digits per ISO 14496-15 / RFC 6381). Returns undefined if the
 * string does not match.
 */
function parseAvcLevel(codec: string): number | undefined {
    const match = /^avc[13]\.([0-9a-fA-F]{6})$/i.exec(codec.trim());
    if (!match) {
        return undefined;
    }
    return parseInt(match[1].slice(4, 6), 16);
}

/**
 * Validates that the H.264 level declared in `codec` can carry the given
 * resolution and frame rate, per the level's MaxFS (frame size in macroblocks)
 * and MaxMBPS (macroblock rate) limits.
 *
 * Why: `VideoEncoder.isConfigSupported` validates codec/param *support*, not
 * level-vs-resolution compliance — so a High@L4.0 stream carrying 1080p60
 * encodes "successfully" but is spec-noncompliant and rejected by strict
 * decoders (Safari/QuickTime/Edge). This helper catches the mismatch up front
 * so the worker can fail and the host can fall back to passthrough.
 *
 * Non-AVC codecs (VP9, AV1) return `{ ok: true }` — they are not validated here.
 *
 * @returns `{ ok: true }` or `{ ok: false, reason }`.
 */
export function validateAvcLevel(codec: string, width: number, height: number, fps: number): AvcLevelCheck {
    if (!/^avc[13]\./i.test(codec.trim())) {
        return { ok: true }; // non-AVC: out of scope for this validator
    }

    const level = parseAvcLevel(codec);
    if (level === undefined) {
        return { ok: false, reason: `Cannot parse H.264 level from codec "${codec}"` };
    }
    const limits = AVC_LEVELS[level];
    if (!limits) {
        return { ok: false, reason: `Unknown H.264 level ${(level / 10).toFixed(1)} in codec "${codec}"` };
    }

    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
        return { ok: false, reason: `Invalid resolution ${width}x${height}` };
    }
    if (!Number.isFinite(fps) || fps <= 0) {
        return { ok: false, reason: `Invalid frame rate ${fps}` };
    }

    const frameSizeMB = Math.ceil(width / 16) * Math.ceil(height / 16);
    const mbps = frameSizeMB * fps;
    const levelLabel = (level / 10).toFixed(1);

    if (frameSizeMB > limits.maxFS) {
        return {
            ok: false,
            reason: `Frame size ${frameSizeMB} macroblocks (${width}x${height}) exceeds H.264 level ${levelLabel} MaxFS ${limits.maxFS}`,
        };
    }
    if (mbps > limits.maxMBPS) {
        return {
            ok: false,
            reason: `Macroblock rate ${mbps} (${width}x${height}@${fps}fps) exceeds H.264 level ${levelLabel} MaxMBPS ${limits.maxMBPS}`,
        };
    }
    return { ok: true };
}
