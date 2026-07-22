/**
 * Returns a promise that rejects with AbortError when `signal` aborts.
 * Also posts `{type:'abort'}` to the worker so it can stop cleanly.
 *
 * Used in `Promise.race` so the caller's await resolves/rejects promptly on
 * cancel without waiting for the worker. If `signal` is omitted, returns a
 * promise that never settles (a no-op race participant).
 *
 * The abort listener is tied to `signal`'s lifetime (the per-run
 * AbortController), which is discarded when the thunk exits — so the listener
 * does not leak across runs. Phase 4 may add `encoder.close()` on the same
 * signal for native resource release inside the worker.
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
