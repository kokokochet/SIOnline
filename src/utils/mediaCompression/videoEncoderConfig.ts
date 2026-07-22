import { VideoCompressionOptions } from './compressionTypes';

/**
 * Builds the WebCodecs `VideoEncoderConfig` for the re-encode path.
 *
 * Extracted from the video worker so the config — in particular the
 * `latencyMode` choice that prevents B-frame ctts corruption — is typechecked
 * and unit-tested in CI (the worker itself is mocked at the module boundary in
 * tests and otherwise only compiled by ts-loader).
 *
 * `latencyMode: 'realtime'` is set deliberately: it tells the platform encoder
 * (VideoToolbox / MediaFoundation / etc.) to emit frames in decode order with
 * no B-frame reordering. With B-frames, `chunk.timestamp` can drop below the
 * cumulative decode timestamp and the resulting negative
 * `compositionTimeOffset` is written by mp4-muxer into a version-0 unsigned
 * `ctts` entry — wrapping `-33334` to `4294933962` and corrupting PTS order on
 * Safari / QuickTime / Edge. `latencyMode: 'realtime'` is a platform hint, not
 * a guarantee: encoders SHOULD suppress B-frame reordering, but not every
 * backend honors it. This is why the muxer-side `compositionTimeOffset` clamp
 * (T8) exists as defense-in-depth against negative offsets.
 */
export function buildVideoEncoderConfig(
    options: VideoCompressionOptions,
    width: number,
    height: number,
    framerate: number,
): VideoEncoderConfig {
    return {
        codec: options.codec,
        width,
        height,
        bitrate: options.bitrate,
        framerate,
        avc: { format: 'avc' },
        latencyMode: 'realtime',
    };
}

/**
 * Minimal structural alias of the DOM `VideoEncoderConfig`. We avoid importing
 * the global type directly so the return shape is explicit and stable regardless
 * of which WebCodecs type declarations are in scope: prod `tsconfig.json` ships
 * `lib: ["es2020","dom",...]` with no WebCodecs lib, while `tsconfig.test.json`
 * pulls `dom-webcodecs` in via its `types` array.
 */
export interface VideoEncoderConfig {
    codec: string;
    width: number;
    height: number;
    bitrate: number;
    framerate: number;
    avc: { format: 'avc' };
    latencyMode: 'realtime';
}
