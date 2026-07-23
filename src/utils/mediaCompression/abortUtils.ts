/**
 * Returns a promise that rejects with AbortError when `signal` aborts, and posts
 * `{type:'abort'}` to the worker so it can stop cleanly. Used in `Promise.race`
 * so the caller's await resolves/rejects promptly on cancel. If `signal` is
 * omitted, returns a never-settling promise (a no-op race participant).
 *
 * The listener is tied to the per-run AbortController, discarded when the thunk
 * exits, so it does not leak across runs.
 */
export function abortRace(signal: AbortSignal | undefined, worker?: { postMessage: (m: unknown) => void }): Promise<never> {
    if (!signal) {
        return new Promise<never>(() => { /* never settles */ });
    }

    return new Promise<never>((_, reject) => {
        const onAbort = () => {
            worker?.postMessage({ type: 'abort' });
            reject(new DOMException('Aborted', 'AbortError'));
        };

        if (signal.aborted) {
            onAbort();
        } else {
            signal.addEventListener('abort', onAbort, { once: true });
        }
    });
}
