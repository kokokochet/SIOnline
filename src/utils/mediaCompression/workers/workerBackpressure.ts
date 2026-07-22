/**
 * Maximum number of queued decode/encode work items a worker loop tolerates
 * before yielding back to the event loop. WebCodecs encoders/decoders buffer
 * work internally; without backpressure, a long input queues hundreds of
 * frames/samples in a tight loop, peaks memory, OOMs, and silently falls
 * through to passthrough (review MAJOR Memory/OOM: "Worker OOM → silent skip").
 *
 * 8 is intentionally small: healthy pipelines oscillate around 1-4; 8 leaves
 * headroom for encoder reorder buffers without letting memory balloon.
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
 * Resolves on the next macrotask via `setTimeout(0)`. Hoisted to module scope so
 * the per-iteration Promise constructor is not itself a function declared in a
 * loop (keeps the drain loop lint-clean under `@typescript-eslint/no-loop-func`).
 */
const macrotaskYield = (): Promise<void> => new Promise<void>(resolve => setTimeout(resolve, 0));

/**
 * Yields back to the event loop (one macrotask via `setTimeout(0)`) while the
 * given WebCodecs codec reports a queue length above `threshold`. Use inside
 * decode/encode loops to apply backpressure and bound peak memory on long
 * inputs.
 *
 * Each `setTimeout(0)` lets the codec's output/error callbacks drain queued
 * frames, freeing native memory before the next decode/encode call.
 *
 * Note: after nesting depth 5, browsers clamp `setTimeout(0)` to ~4 ms. On a
 * multi-hour archive file this accumulates wall-clock delay; a MessageChannel-
 * based yield would be unclamped. The current choice is correct (the queue
 * does drain) and simpler; revisit if long-file latency becomes a problem.
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
