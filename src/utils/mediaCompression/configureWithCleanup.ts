/**
 * Arguments for configureWithCleanup. Bound callbacks let the caller plug in
 * its own close-idempotency logic (e.g. the video worker's `encoderClosed`/
 * `decoderClosed` flags) without this helper knowing about WebCodecs types.
 */
export interface ConfigureWithCleanupArgs {
    configureEncoder: () => void;
    configureDecoder: () => void;
    closeEncoder: () => void;
    closeDecoder: () => void;
}

/**
 * Runs encoder.configure + decoder.configure, closing BOTH codecs if either
 * throws synchronously, to avoid leaking native codec state on a configure throw.
 *
 * Each close is wrapped in its own try/catch: a secondary throw from
 * closeEncoder (e.g. InvalidStateError on close-after-failed-configure)
 * must neither mask the original configure error nor skip closeDecoder.
 * The *original* error is always the one rethrown.
 *
 * Bound callbacks (rather than codec objects) keep this helper free of
 * WebCodecs type dependencies and directly unit-testable.
 */
export function configureWithCleanup(args: ConfigureWithCleanupArgs): void {
    try {
        args.configureEncoder();
        args.configureDecoder();
    } catch (e) {
        const original = e instanceof Error ? e : new Error(String(e));
        try { args.closeEncoder(); } catch { /* swallow secondary close error */ }
        try { args.closeDecoder(); } catch { /* swallow secondary close error */ }
        throw original;
    }
}
