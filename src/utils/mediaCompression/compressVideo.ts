import { CompressedMedia, VideoCompressionOptions, WorkerCompressRequest, WorkerCompressResponse } from './compressionTypes';
import { isVideoCompressionSupported } from './featureDetection';
import { createVideoWorker } from './workerFactory';
import { passthroughMedia } from './passthrough';

/** Maximum time to wait for the compression worker before giving up. */
const WORKER_TIMEOUT_MS = 60_000;

/**
 * Compresses a video file using a WebCodecs worker.
 *
 * When WebCodecs is unavailable, the worker errors, the output is not smaller,
 * or the worker times out, the original file is returned unchanged (passthrough).
 */
export async function compressVideo(
    file: File,
    options: VideoCompressionOptions,
): Promise<CompressedMedia> {
    const originalData = new Uint8Array(await file.arrayBuffer());

    if (!isVideoCompressionSupported()) {
        return passthroughMedia(originalData, file.name);
    }

    try {
        const worker = createVideoWorker();

        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        try {
            const compressedBuffer = await Promise.race([
                new Promise<ArrayBuffer>((resolve, reject) => {
                    worker.onmessage = (e: MessageEvent<WorkerCompressResponse>) => {
                        if (e.data.type === 'done' && e.data.data) {
                            resolve(e.data.data);
                        } else if (e.data.type === 'error') {
                            reject(new Error(e.data.error));
                        }
                    };

                    worker.onerror = (e: ErrorEvent) => {
                        reject(new Error(e.message || 'Worker error'));
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
    } catch (err) {
        console.warn('Video compression failed, using original:', err);
        return passthroughMedia(originalData, file.name);
    }
}
