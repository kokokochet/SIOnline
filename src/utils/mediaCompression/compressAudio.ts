import { AudioCompressionOptions, CompressedMedia, AudioWorkerRequest, AudioWorkerResponse } from './compressionTypes';
import { isAudioCompressionSupported } from './featureDetection';
import { createAudioWorker } from './workerFactory';
import { passthroughMedia } from './passthrough';
import { abortRace } from './abortUtils';
import { namedError } from './workerErrors';

const WORKER_TIMEOUT_MS = 60_000;

/**
 * Opus native sample rate (RFC 7845) — Opus always operates internally at
 * 48 kHz. Kept here for reference; the worker carries its own copy (bundled
 * separately, see workers/audioCompression.worker.ts).
 */
const OPUS_SAMPLE_RATE = 48000;

/**
 * Compresses an audio file using WebCodecs AudioEncoder in a Web Worker.
 *
 * DECODE RUNS IN THE WORKER. The main thread posts the raw encoded bytes
 * (`{data, options}`) and never materializes PCM — a 200 MB MP3 no longer
 * peaks at ~3.6 GB on the main thread (review MAJOR Memory/OOM: "Audio PCM
 * on main thread"). The worker decodes via `OfflineAudioContext.decodeAudioData`,
 * enforces `MAX_DECODED_AUDIO_BYTES`, then encodes to Opus (options.bitrate,
 * 48 kHz) and muxes into OGG.
 *
 * Output extension: .opus. Opus is ~1.5-2× more efficient than MP3.
 *
 * Passthrough (returns the original unchanged) when WebCodecs AudioEncoder is
 * unavailable or the compressed output is empty/larger than the original.
 * Decode/encode failures and worker timeouts REJECT with a named error
 * (preserving `DOMException.name`) so callers can surface them: the bulk thunk
 * records a per-file error, and ScreensView shows the compressionFailed toast
 * (the intended single-file policy). AbortError propagates for cancel handling.
 */
export async function compressAudio(
    file: File,
    options: AudioCompressionOptions,
    signal?: AbortSignal,
): Promise<CompressedMedia> {
    if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }

    const originalData = new Uint8Array(await file.arrayBuffer());

    if (!isAudioCompressionSupported()) {
        return passthroughMedia(originalData, file.name);
    }

    const worker = createAudioWorker();

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
        const compressedBuffer = await Promise.race([
            new Promise<ArrayBuffer>((resolve, reject) => {
                worker.onmessage = (e: MessageEvent<AudioWorkerResponse>) => {
                    if (e.data.type === 'done' && e.data.data) {
                        resolve(e.data.data);
                    } else if (e.data.type === 'error') {
                        reject(namedError(e.data.name ?? 'Error', e.data.error));
                    } else if (e.data.type === 'cancelled') {
                        reject(new DOMException('Aborted', 'AbortError'));
                    }
                };

                worker.onerror = (e: ErrorEvent) => {
                    reject(namedError('Error', e.message || 'Worker error'));
                };

                const request: AudioWorkerRequest = {
                    data: originalData.buffer.slice(0) as ArrayBuffer,
                    options,
                };

                // Transfer the encoded input (zero-copy); PCM stays in the worker.
                worker.postMessage(request, [request.data]);
            }),
            new Promise<ArrayBuffer>((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error('Audio compression worker timeout')), WORKER_TIMEOUT_MS);
            }),
            abortRace(signal, worker),
        ]);

        const compressedData = new Uint8Array(compressedBuffer);

        // Safety check: reject empty or larger-than-original output
        if (compressedData.length === 0 || compressedData.length >= originalData.length) {
            return passthroughMedia(originalData, file.name);
        }

        // Change extension to .opus (Opus in OGG container)
        const baseName = file.name.replace(/\.[^.]+$/, '');
        const newFileName = `${baseName}.opus`;

        return {
            data: compressedData,
            fileName: newFileName,
            originalSize: originalData.length,
            compressedSize: compressedData.length,
            wasCompressed: true,
        };
    } finally {
        if (timeoutId) { clearTimeout(timeoutId); }
        worker.terminate();
    }
}
