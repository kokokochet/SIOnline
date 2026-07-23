import { TextDecoder, TextEncoder } from 'util';

/**
 * jest's `jsdom` environment does not expose `TextEncoder`/`TextDecoder` on the
 * global object (they were removed from jsdom). Mediabunny instantiates them at
 * module-load time, so any test whose import graph reaches the media-compression
 * pipeline (e.g. component tests that import `siquesterSlice`) needs them
 * available globally before its modules load.
 *
 * `setupFiles` runs in the test environment before the test file's imports are
 * evaluated, so this polyfill is in place by the time Mediabunny is required.
 */
(globalThis as unknown as { TextDecoder: typeof TextDecoder }).TextDecoder = TextDecoder;
(globalThis as unknown as { TextEncoder: typeof TextEncoder }).TextEncoder = TextEncoder;
