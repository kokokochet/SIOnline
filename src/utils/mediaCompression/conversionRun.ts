import { Conversion, ConversionCanceledError } from 'mediabunny';

/**
 * Runs a Mediabunny Conversion, wiring an optional AbortSignal to
 * conversion.cancel(). On abort rejects with AbortError to preserve the
 * pipeline's existing cancel contract.
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
        void conversion.cancel().catch(() => { /* already settled or finalized */ });
    };
    signal.addEventListener('abort', onAbort, { once: true });

    try {
        await conversion.execute();
    } catch (err) {
        // ConversionCanceledError only occurs via cancel(); treat it (and any post-abort error) as cancellation.
        if (err instanceof ConversionCanceledError || signal.aborted) {
            throw new DOMException('Aborted', 'AbortError');
        }
        throw err;
    } finally {
        signal.removeEventListener('abort', onAbort);
    }
}
