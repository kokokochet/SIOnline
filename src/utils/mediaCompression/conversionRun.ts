import { Conversion, ConversionCanceledError } from 'mediabunny';

/**
 * Runs a prepared Mediabunny `Conversion`, wiring an optional `AbortSignal` to
 * `conversion.cancel()`.
 *
 * Replaces the old worker `abortRace`/`postMessage({type:'abort'})` plumbing.
 * Mediabunny's conversion is async with built-in backpressure, so there is no
 * worker to message; instead we call `cancel()`, which makes the in-flight
 * `execute()` reject with `ConversionCanceledError`.
 *
 * On abort (before or during execution) this rejects with an `AbortError`
 * DOMException, preserving the contract the rest of the pipeline
 * (`compressPackageMedia`, `siquesterSlice`) already relies on for cancel
 * handling. Any other conversion error is rethrown unchanged.
 */
export async function runConversion(conversion: Conversion, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
        await conversion.cancel();
        throw new DOMException('Aborted', 'AbortError');
    }

    if (!signal) {
        await conversion.execute();
        return;
    }

    const onAbort = () => {
        // cancel() makes the running execute() reject with ConversionCanceledError.
        void conversion.cancel().catch(() => { /* already settled or finalized */ });
    };
    signal.addEventListener('abort', onAbort, { once: true });

    try {
        await conversion.execute();
    } catch (err) {
        // execute() never rejects with ConversionCanceledError except via cancel(),
        // so treat it (and any post-abort error) as a clean cancellation.
        if (err instanceof ConversionCanceledError || signal.aborted) {
            throw new DOMException('Aborted', 'AbortError');
        }
        throw err;
    } finally {
        signal.removeEventListener('abort', onAbort);
    }
}
