import { CompressedMedia, VideoCompressionOptions, WorkerCompressRequest, WorkerCompressResponse } from './compressionTypes';
import { isVideoCompressionSupported } from './featureDetection';
import { createVideoWorker } from './workerFactory';
import { passthroughMedia } from './passthrough';
import { abortRace } from './abortUtils';
import { namedError } from './workerErrors';

/** Maximum time to wait for the compression worker before giving up. */
const WORKER_TIMEOUT_MS = 60_000;

/**
 * Compresses a video file using a WebCodecs worker.
 *
 * Passthrough (returns the original unchanged) when WebCodecs is unavailable
 * or the compressed output is not smaller than the input. Decode/encode
 * failures and worker timeouts REJECT with a named error (preserving
 * `DOMException.name`) so callers can surface them: the bulk thunk records a
 * per-file error, and ScreensView shows the compressionFailed toast (the
 * intended single-file policy). AbortError propagates for cancel handling.
 */
export async function compressVideo(
    file: File,
    options: VideoCompressionOptions,
    signal?: AbortSignal,
): Promise<CompressedMedia> {
    if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }

    const originalData = new Uint8Array(await file.arrayBuffer());

    if (!isVideoCompressionSupported()) {
        return passthroughMedia(originalData, file.name);
    }

    const worker = createVideoWorker();

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
        const compressedBuffer = await Promise.race([
            new Promise<ArrayBuffer>((resolve, reject) => {
                worker.onmessage = (e: MessageEvent<WorkerCompressResponse>) => {
                    if (e.data.type === 'done' && e.data.data) {
                        resolve(e.data.data);
                    } else if (e.data.type === 'error') {
                        reject(namedError(e.data.name ?? 'Error', e.data.error));
                    } else if (e.data.type === 'cancelled') {
                        reject(new DOMException('Aborted', 'AbortError'));
                    }
                };

                worker.onerror = (e: ErrorEvent) => {
                    // Prevent the uncaught worker error from reaching the
                    // window error handlers (dev-server overlay) — the
                    // compression failure is handled gracefully via reject.
                    e.preventDefault();
                    reject(namedError('Error', e.message || 'Worker error'));
                };

                const request: WorkerCompressRequest = {
                    data: originalData.buffer.slice(0) as ArrayBuffer,
                    options,
                };

                worker.postMessage(request, [request.data]);
            }),
            new Promise<ArrayBuffer>((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error('Video compression worker timeout')), WORKER_TIMEOUT_MS);
            }),
            abortRace(signal, worker),
        ]);

        const compressedData = new Uint8Array(compressedBuffer);

        if (compressedData.length === 0 || compressedData.length >= originalData.length) {
            return passthroughMedia(originalData, file.name);
        }

        return {
            data: compressedData,
            fileName: file.name,
            originalSize: originalData.length,
            compressedSize: compressedData.length,
            wasCompressed: true,
        };
    } finally {
        if (timeoutId) { clearTimeout(timeoutId); }
        worker.terminate();
    }
}
