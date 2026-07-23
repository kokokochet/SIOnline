import { TextDecoder, TextEncoder } from 'util';

/**
 * jsdom removed `TextEncoder`/`TextDecoder` from the global object, but
 * Mediabunny instantiates them at module-load. `setupFiles` runs before the
 * test file's imports, so this polyfill is in place by the time it's required.
 */
(globalThis as unknown as { TextDecoder: typeof TextDecoder }).TextDecoder = TextDecoder;
(globalThis as unknown as { TextEncoder: typeof TextEncoder }).TextEncoder = TextEncoder;
