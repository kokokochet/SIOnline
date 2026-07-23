/**
 * Queued decode/encode items a worker loop tolerates before yielding to the
 * event loop. Without backpressure a long input queues hundreds of frames,
 * peaks memory, and OOMs. 8 leaves headroom for encoder reorder buffers
 * without letting memory balloon.
 */
export const QUEUE_BACKPRESSURE_THRESHOLD = 8;

/**
 * Codec-agnostic shape: VideoDecoder exposes `decodeQueueSize`, VideoEncoder
 * and AudioEncoder expose `encodeQueueSize`. We accept either/both.
 */
interface QueuedCodec {
    decodeQueueSize?: number;
    encodeQueueSize?: number;
}

/**
 * Resolves on the next macrotask via `setTimeout(0)`. Module-scoped so the
 * drain loop stays lint-clean under `@typescript-eslint/no-loop-func`.
 */
const macrotaskYield = (): Promise<void> => new Promise<void>(resolve => setTimeout(resolve, 0));

/**
 * Yields to the event loop (one `setTimeout(0)` macrotask) while the given
 * codec's queue length exceeds `threshold`, so its output/error callbacks can
 * drain queued frames and free native memory before the next decode/encode.
 */
export async function waitForQueueDrain(
    codec: QueuedCodec,
    threshold: number = QUEUE_BACKPRESSURE_THRESHOLD,
): Promise<void> {
    while ((codec.decodeQueueSize ?? codec.encodeQueueSize ?? 0) > threshold) {
        // macrotask yield — lets encoder/decoder output callbacks run.
        await macrotaskYield();
    }
}
