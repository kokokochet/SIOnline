import { AudioCompressionOptions, CompressedMedia, AudioWorkerRequest, AudioWorkerResponse } from './compressionTypes';
import { isAudioCompressionSupported } from './featureDetection';
import { createAudioWorker } from './workerFactory';
import { passthroughMedia } from './passthrough';

const WORKER_TIMEOUT_MS = 60_000;

/**
 * Opus native sample rate (RFC 7845) — Opus always operates internally at
 * 48 kHz, so input audio is decoded/resampled to 48 kHz before encoding.
 * Keep in sync with the identical constant in workers/audioCompression.worker.ts
 * (the worker is bundled separately and cannot import this module).
 */
export const OPUS_SAMPLE_RATE = 48000;

/**
 * Compresses an audio file using WebCodecs AudioEncoder in a Web Worker.
 *
 * Decoding (decodeAudioData) runs on the main thread because OfflineAudioContext
 * is not available in Web Workers. Decoded PCM is transferred to the worker,
 * which encodes to Opus (128 kbps, 48 kHz) and muxes into OGG.
 *
 * Output extension: .opus (already in allowedExtensionsByType.audio).
 * Opus is ~1.5-2× more efficient than MP3 — 128 kbps ≈ MP3 192 kbps.
 *
 * If WebCodecs AudioEncoder is unavailable, the file is returned uncompressed.
 * Safety check: if compressed is larger than original, returns original.
 */
export async function compressAudio(
    file: File,
    options: AudioCompressionOptions,
): Promise<CompressedMedia> {
    const originalData = new Uint8Array(await file.arrayBuffer());

    if (!isAudioCompressionSupported()) {
        return passthroughMedia(originalData, file.name);
    }

    try {
        // Extract decode + channel-copy into helper so audioBuffer goes out of
        // scope before awaiting the worker, halving peak PCM memory.
        const pcmData = await decodeAndExtractPcm(originalData, options);

        const worker = createAudioWorker();

        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        try {
            const compressedBuffer = await Promise.race([
                new Promise<ArrayBuffer>((resolve, reject) => {
                    worker.onmessage = (e: MessageEvent<AudioWorkerResponse>) => {
                        if (e.data.type === 'done' && e.data.data) {
                            resolve(e.data.data);
                        } else if (e.data.type === 'error') {
                            reject(new Error(e.data.error));
                        }
                    };

                    worker.onerror = (e: ErrorEvent) => {
                        reject(new Error(e.message || 'Worker error'));
                    };

                    const request: AudioWorkerRequest = {
                        channels: pcmData.channels,
                        numberOfChannels: pcmData.numberOfChannels,
                        totalFrames: pcmData.totalFrames,
                        options,
                    };

                    // Transfer all channel ArrayBuffers (zero-copy)
                    worker.postMessage(request, pcmData.channels);
                }),
                new Promise<ArrayBuffer>((_, reject) => {
                    timeoutId = setTimeout(() => reject(new Error('Audio compression worker timeout')), WORKER_TIMEOUT_MS);
                }),
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
    } catch (err) {
        console.warn('Audio compression failed, using original:', err);
        return passthroughMedia(originalData, file.name);
    }
}

/**
 * Decodes audio to PCM on the main thread (OfflineAudioContext not in workers)
 * and extracts per-channel data as ArrayBuffers for transfer.
 * Extracted into a helper so audioBuffer can be GC'd before the worker runs.
 */
async function decodeAndExtractPcm(
    originalData: Uint8Array,
    options: AudioCompressionOptions,
): Promise<{ channels: ArrayBuffer[]; numberOfChannels: number; totalFrames: number }> {
    const audioContext = new OfflineAudioContext(
        options.channels,
        1,
        OPUS_SAMPLE_RATE,
    );
    const audioBuffer = await audioContext.decodeAudioData(originalData.buffer.slice(0) as ArrayBuffer);

    const numberOfChannels = Math.min(audioBuffer.numberOfChannels, options.channels);
    const totalFrames = audioBuffer.length;

    const channels: ArrayBuffer[] = [];
    for (let ch = 0; ch < numberOfChannels; ch++) {
        const data = audioBuffer.getChannelData(ch);
        // Copy to a new ArrayBuffer for transfer (getChannelData returns a view)
        const buf = new ArrayBuffer(data.byteLength);
        new Float32Array(buf).set(data);
        channels.push(buf);
    }

    // audioBuffer goes out of scope here — freed before worker runs
    return { channels, numberOfChannels, totalFrames };
}
