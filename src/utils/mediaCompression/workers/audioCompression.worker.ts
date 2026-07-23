
import { AudioWorkerRequest, AudioWorkerResponse, WorkerAbortMessage, AudioCompressionOptions } from '../compressionTypes';
import { encodeAudioToOpus } from '../audioEncoder';
import { OPUS_SAMPLE_RATE } from '../oggOpusMuxer';
import { buildErrorResponse } from '../workerErrors';
import { MAX_DECODED_AUDIO_BYTES } from '../limits';
import { validateAudioWorkerMessage } from '../workerInputValidation';

/**
 * Cast so the transfer-list overload type-checks under the DOM lib that ts-jest
 * applies in wiring tests (there `self.postMessage` is Window.postMessage).
 */
const postMessageWithTransfer = self.postMessage as (
    message: unknown,
    transfer: Transferable[],
) => void;

let currentJobRejected = false;

self.onmessage = async (e: MessageEvent<AudioWorkerRequest | WorkerAbortMessage>) => {
    if ('type' in e.data) {
        if (!currentJobRejected) {
            currentJobRejected = true;
            const response: AudioWorkerResponse = { type: 'cancelled' };
            self.postMessage(response);
        }
        return;
    }

    currentJobRejected = false;

    try {
        validateAudioWorkerMessage(e.data);
        const { data, options } = e.data;

        const pcm = await decodePcm(data, options);
        if (currentJobRejected) {
            return; // abort arrived during decode; skip encode
        }
        const result = await encodeAudioToOpus(pcm.channels, pcm.numberOfChannels, pcm.totalFrames, options);
        if (currentJobRejected) {
            return;
        }
        const response: AudioWorkerResponse = { type: 'done', data: result.buffer as ArrayBuffer };
        postMessageWithTransfer(response, [result.buffer]);
    } catch (err) {
        if (currentJobRejected) {
            return;
        }
        self.postMessage(buildErrorResponse(err) as AudioWorkerResponse);
    }
};

/**
 * Decodes raw encoded audio bytes to per-channel Float32 PCM inside the worker
 * (keeps the multi-hundred-MB PCM footprint off the main thread). Prefers
 * OfflineAudioContext; falls back to AudioContext. If neither is present,
 * throws and the host returns the original file.
 *
 * Enforces MAX_DECODED_AUDIO_BYTES after decode; primary protection is worker
 * isolation.
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

    // OfflineAudioContext takes (numberOfChannels, length, sampleRate); AudioContext
    // takes a single options object and IGNORES numeric args, so the fallback
    // would decode at device-default rate. Branch the ctor per context type.
    const isOffline = Ctx === OfflineAudioContext;
    const audioContext = isOffline
        ? new OfflineAudioContext(1, 1, OPUS_SAMPLE_RATE)
        : new AudioContext({ sampleRate: OPUS_SAMPLE_RATE });
    try {
        // data is the transferred copy, never reused after decode — no slice(0).
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
