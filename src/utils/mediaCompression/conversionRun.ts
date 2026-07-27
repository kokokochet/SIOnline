import { Conversion, ConversionCanceledError } from 'mediabunny';
import type { BufferTarget } from 'mediabunny';
import type { CompressedMedia } from './compressionTypes';

/** Shared abort guard for every entry point in the compression pipeline. */
export function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }
}

/**
 * Finalizes a Mediabunny BufferTarget into a CompressedMedia result.
 * Returns null when the output is empty or not smaller than the original,
 * so callers can fall back to passthrough via `?? passthroughFromFile(file)`.
 */
export function buildCompressedMedia(
    target: BufferTarget,
    fileName: string,
    originalSize: number,
): CompressedMedia | null {
    const { buffer } = target;
    if (!buffer || buffer.byteLength === 0 || buffer.byteLength >= originalSize) {
        return null;
    }
    const data = new Uint8Array(buffer);
    return { data, fileName, originalSize, compressedSize: data.length, wasCompressed: true };
}

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
