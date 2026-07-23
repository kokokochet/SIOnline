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
 * OutOfMemoryError, …) instead of collapsing them to a locale message.
 *
 * `DOMException` is NOT a subclass of `Error`, so a bare `instanceof Error`
 * check would drop `.name` for the very WebCodecs errors this helper exists
 * to triage; the second branch catches them.
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
 * (`{ type:'error'; name; error }`), preserving the diagnostic name. Matches
 * the `'error'` arm of both worker response unions.
 */
export function buildErrorResponse(e: unknown): WorkerErrorResponse {
    const { name, message } = formatWorkerError(e);
    return { type: 'error', name, error: message };
}
