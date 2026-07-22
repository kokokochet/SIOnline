
import { AudioWorkerRequest, AudioWorkerResponse, WorkerAbortMessage, AudioCompressionOptions } from '../compressionTypes';
import { encodeAudioToOpus } from '../audioEncoder';
import { MAX_DECODED_AUDIO_BYTES } from '../limits';

/**
 * Opus native sample rate (RFC 7845) — Opus always runs at 48 kHz. Duplicated
 * locally (the worker is bundled separately and cannot import compressAudio.ts
 * / audioEncoder.ts' private copy). Keep in sync with the other copies.
 */
const OPUS_SAMPLE_RATE = 48000;

/**
 * Minimal worker scope type — avoids `/// <reference lib="webworker" />` which
 * pollutes the global `navigator` type as `WorkerNavigator` across the project.
 */
type WorkerScope = {
    onmessage: ((ev: MessageEvent) => void) | null;
    postMessage(message: unknown, transfer: Transferable[]): void;
    postMessage(message: unknown): void;
};
const ctx = self as unknown as WorkerScope;

let currentJobRejected = false;

ctx.onmessage = async (e: MessageEvent<AudioWorkerRequest | WorkerAbortMessage>) => {
    if ('type' in e.data) {
        if (!currentJobRejected) {
            currentJobRejected = true;
            const response: AudioWorkerResponse = { type: 'cancelled' };
            ctx.postMessage(response);
        }
        return;
    }

    const { data, options } = e.data;
    currentJobRejected = false;

    try {
        const pcm = await decodePcm(data, options);
        if (currentJobRejected) {
            return; // abort arrived during decode; skip encode
        }
        const result = await encodeAudioToOpus(pcm.channels, pcm.numberOfChannels, pcm.totalFrames, options);
        if (currentJobRejected) {
            return;
        }
        const response: AudioWorkerResponse = { type: 'done', data: result.buffer as ArrayBuffer };
        ctx.postMessage(response, [result.buffer]);
    } catch (err) {
        if (currentJobRejected) {
            return;
        }
        const response: AudioWorkerResponse = {
            type: 'error',
            error: err instanceof Error ? err.message : String(err),
        };
        ctx.postMessage(response);
    }
};

/**
 * Decodes raw encoded audio bytes to per-channel Float32 PCM inside the worker.
 *
 * `decodeAudioData` is available in DedicatedWorkerGlobalScope via
 * OfflineAudioContext (Chrome 100+, Safari 16+, Firefox 100+) or AudioContext.
 * We prefer OfflineAudioContext (no live audio graph); fall back to AudioContext.
 * If neither is present, throw — `compressAudio`'s error handler returns the
 * original file (passthrough). This keeps the multi-hundred-MB PCM footprint
 * off the main thread (review MAJOR Memory/OOM).
 *
 * Enforces MAX_DECODED_AUDIO_BYTES after decode (best-effort post-decode cap;
 * primary protection is worker isolation — see limits.ts).
 */
async function decodePcm(
    data: ArrayBuffer,
    options: AudioCompressionOptions,
): Promise<{ channels: ArrayBuffer[]; numberOfChannels: number; totalFrames: number }> {
    const Ctx: (typeof OfflineAudioContext) | (typeof AudioContext) | undefined =
        (typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext : undefined) ??
        (typeof AudioContext !== 'undefined' ? AudioContext : undefined);

    if (!Ctx) {
        throw new Error('No AudioContext/OfflineAudioContext available in worker for decodeAudioData');
    }

    // decodeAudioData does not render the context; a 1-frame, 1-channel,
    // 48 kHz context is the smallest valid configuration. OfflineAudioContext
    // takes the (numberOfChannels, length, sampleRate) numeric signature, but
    // AudioContext takes a single AudioContextOptions object ({ sampleRate }) —
    // the numeric args are IGNORED by AudioContext, so the fallback would decode
    // at the device-default rate (often 44100) and resample/pitch-shift. Branch
    // the ctor so each context type uses its correct signature.
    const isOffline = Ctx === OfflineAudioContext;
    const audioContext = isOffline
        ? new OfflineAudioContext(1, 1, OPUS_SAMPLE_RATE)
        : new AudioContext({ sampleRate: OPUS_SAMPLE_RATE });
    try {
        // data is the transferred ArrayBuffer copy and is never reused after
        // decode, so no slice(0) is needed (it would only double peak memory).
        const audioBuffer = await audioContext.decodeAudioData(data);

        const numberOfChannels = Math.min(audioBuffer.numberOfChannels, options.channels);
        const totalFrames = audioBuffer.length;

        const decodedBytes = totalFrames * numberOfChannels * 4; // Float32
        if (decodedBytes > MAX_DECODED_AUDIO_BYTES) {
            throw new Error(
                `Decoded audio too large: ${decodedBytes} bytes > MAX_DECODED_AUDIO_BYTES (${MAX_DECODED_AUDIO_BYTES})`,
            );
        }

        const channels: ArrayBuffer[] = [];
        for (let ch = 0; ch < numberOfChannels; ch++) {
            const channelData = audioBuffer.getChannelData(ch);
            const buf = new ArrayBuffer(channelData.byteLength);
            new Float32Array(buf).set(channelData);
            channels.push(buf);
        }

        return { channels, numberOfChannels, totalFrames };
    } finally {
        // Only AudioContext owns hardware resources and needs closing;
        // OfflineAudioContext has no close().
        if (!isOffline) {
            await (audioContext as AudioContext).close();
        }
    }
}
