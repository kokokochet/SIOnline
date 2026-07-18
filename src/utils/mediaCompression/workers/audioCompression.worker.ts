
import { AudioWorkerRequest, AudioWorkerResponse, AudioCompressionOptions } from '../compressionTypes';
import { muxOggOpus } from '../oggOpusMuxer';

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
    const { channels, sampleRate, numberOfChannels, totalFrames, options } = e.data;

    try {
        const result = await encodeAudioToOpus(channels, sampleRate, numberOfChannels, totalFrames, options);
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

function encodeAudioToOpus(
    channels: ArrayBuffer[],
    sampleRate: number,
    numberOfChannels: number,
    totalFrames: number,
    options: AudioCompressionOptions,
): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        const encodedPackets: { data: Uint8Array; timestamp: number; duration: number }[] = [];
        const chunkDuration = 20; // ms per AudioData chunk
        const chunkFrameCount = Math.floor((sampleRate * chunkDuration) / 1000);
        let encoderClosed = false;

        const closeEncoder = () => {
            if (!encoderClosed) {
                encoderClosed = true;
                encoder.close();
            }
        };

        const encoder = new AudioEncoder({
            output: (chunk: EncodedAudioChunk) => {
                const chunkData = new Uint8Array(chunk.byteLength);
                chunk.copyTo(chunkData);
                encodedPackets.push({
                    data: chunkData,
                    timestamp: chunk.timestamp,
                    duration: chunk.duration ?? 0,
                });
            },
            error: (e: DOMException) => {
                closeEncoder();
                reject(new Error(`AudioEncoder error: ${e.message}`));
            },
        });

        const encoderConfig = {
            codec: options.codec,
            sampleRate,
            numberOfChannels,
            bitrate: options.bitrate,
        };

        AudioEncoder.isConfigSupported(encoderConfig).then((support) => {
            if (!support.supported) {
                closeEncoder();
                reject(new Error(`AudioEncoder config not supported: ${options.codec}`));
                return;
            }

            encoder.configure(encoderConfig);

            // Extract channel data from transferred ArrayBuffers
            const channelData: Float32Array[] = channels.map(buf => new Float32Array(buf));

            // Feed PCM to encoder in chunks
            for (let offset = 0; offset < totalFrames; offset += chunkFrameCount) {
                const frameCount = Math.min(chunkFrameCount, totalFrames - offset);

                // Build planar float32 buffer (f32-planar format) — bulk copy via .set()
                const planarData = new Float32Array(frameCount * numberOfChannels);
                for (let ch = 0; ch < numberOfChannels; ch++) {
                    planarData.set(channelData[ch].subarray(offset, offset + frameCount), ch * frameCount);
                }

                const audioData = new AudioData({
                    format: 'f32-planar',
                    sampleRate,
                    numberOfFrames: frameCount,
                    numberOfChannels,
                    timestamp: Math.round((offset / sampleRate) * 1_000_000),
                    data: planarData,
                });

                encoder.encode(audioData);
                audioData.close();
            }

            // Await flush to ensure all encoded output is emitted, then close
            encoder.flush().then(() => {
                closeEncoder();
                if (encodedPackets.length === 0) {
                    reject(new Error('No audio data encoded'));
                    return;
                }
                const result = muxOggOpus(encodedPackets, sampleRate, numberOfChannels);
                resolve(result);
            }).catch((e: DOMException) => {
                closeEncoder();
                reject(new Error(`AudioEncoder flush error: ${e.message}`));
            });
        }).catch((e: DOMException) => {
            closeEncoder();
            reject(new Error(`AudioEncoder isConfigSupported error: ${e.message}`));
        });
    });
}
