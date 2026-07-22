/** Concrete shape of the worker error-response arm (shared by both response unions). */
export interface WorkerErrorResponse {
    type: 'error';
    name: string;
    error: string;
}

/** { name, message } pair extracted from any thrown value. */
export interface WorkerErrorInfo {
    name: string;
    message: string;
}

/**
 * Extracts a { name, message } pair from any thrown value, preserving the
 * programmatic `.name` of DOMException-like errors (NotSupportedError,
 * OutOfMemoryError, …) instead of collapsing them to a locale-dependent
 * message string. Falls back to `{ name: 'Error', message: String(e) }` for
 * non-Error throws.
 *
 * Note: `DOMException` is NOT a subclass of `Error` (per WHATWG spec — it
 * implements an Error-like interface but has its own prototype chain), so a
 * bare `e instanceof Error` check drops `.name` for the very WebCodecs errors
 * (VideoEncoder/AudioEncoder `error` callbacks pass real `DOMException`s) this
 * helper exists to triage. The second branch catches them.
 */
export function formatWorkerError(e: unknown): WorkerErrorInfo {
    if (e instanceof Error) {
        return { name: e.name || 'Error', message: e.message };
    }
    if (typeof DOMException !== 'undefined' && e instanceof DOMException) {
        return { name: e.name || 'Error', message: e.message };
    }
    return { name: 'Error', message: String(e) };
}

/**
 * Builds an Error carrying a specific programmatic `.name` (mirroring
 * DOMException naming). Used at reject sites that synthesize an error without
 * a caught exception (e.g. "config not supported"), so the resulting worker
 * message still has a stable, triageable name instead of the generic "Error".
 */
export function namedError(name: string, message: string): Error {
    const err = new Error(message);
    err.name = name;
    return err;
}

/**
 * Shapes any thrown value into a worker error response message
 * (`{ type:'error'; name; error }`), preserving the diagnostic name.
 * The returned object matches the `'error'` arm of both `WorkerCompressResponse`
 * and `AudioWorkerResponse`; callers cast (`as AudioWorkerResponse` /
 * `as WorkerCompressResponse`) to satisfy their worker-scope postMessage type.
 */
export function buildErrorResponse(e: unknown): WorkerErrorResponse {
    const { name, message } = formatWorkerError(e);
    return { type: 'error', name, error: message };
}
