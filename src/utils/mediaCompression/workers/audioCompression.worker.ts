
import { AudioWorkerRequest, AudioWorkerResponse } from '../compressionTypes';
import { encodeAudioToOpus } from '../audioEncoder';

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

ctx.onmessage = async (e: MessageEvent<AudioWorkerRequest>) => {
    const { channels, numberOfChannels, totalFrames, options } = e.data;

    try {
        const result = await encodeAudioToOpus(channels, numberOfChannels, totalFrames, options);
        const response: AudioWorkerResponse = { type: 'done', data: result.buffer as ArrayBuffer };
        ctx.postMessage(response, [result.buffer]);
    } catch (err) {
        const response: AudioWorkerResponse = {
            type: 'error',
            error: err instanceof Error ? err.message : String(err),
        };
        ctx.postMessage(response);
    }
};
