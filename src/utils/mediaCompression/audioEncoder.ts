import { AudioCompressionOptions } from './compressionTypes';
import { muxOggOpus } from './oggOpusMuxer';

/**
 * Opus native sample rate (RFC 7845) — Opus always runs at 48 kHz.
 * Duplicated from compressAudio.ts because the worker is bundled separately.
 * Keep in sync with OPUS_SAMPLE_RATE in compressAudio.ts.
 */
const OPUS_SAMPLE_RATE = 48000;

/**
 * Encodes planar float32 PCM into Opus packets and muxes them into an OGG
 * container.
 *
 * Extracted from audioCompression.worker.ts so the encoding logic — in
 * particular the output-callback error handling — is typechecked and
 * unit-tested in CI. The worker itself is mocked at the module boundary in
 * tests and otherwise only compiled by ts-loader; importing it directly under
 * Jest's `node` test env throws `ReferenceError: self is not defined` at module
 * top level. This module has no `self` / `postMessage` references and is safe
 * to import under any Jest environment.
 */
export function encodeAudioToOpus(
    channels: ArrayBuffer[],
    numberOfChannels: number,
    totalFrames: number,
    options: AudioCompressionOptions,
): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        const encodedPackets: { data: Uint8Array; timestamp: number; duration: number }[] = [];
        const chunkDuration = 20; // ms per AudioData chunk
        const chunkFrameCount = Math.floor((OPUS_SAMPLE_RATE * chunkDuration) / 1000);
        let encoderClosed = false;

        const closeEncoder = () => {
            if (!encoderClosed) {
                encoderClosed = true;
                encoder.close();
            }
        };

        const encoder = new AudioEncoder({
            output: (chunk: EncodedAudioChunk) => {
                // Mirror videoCompression.worker.ts: WebCodecs does NOT route
                // output-callback errors to the error callback, so a throw in
                // copyTo/push would otherwise be swallowed and the worker would
                // post { type: 'done' } with a truncated/corrupt OGG.
                try {
                    const chunkData = new Uint8Array(chunk.byteLength);
                    chunk.copyTo(chunkData);
                    encodedPackets.push({
                        data: chunkData,
                        timestamp: chunk.timestamp,
                        duration: chunk.duration ?? 0,
                    });
                } catch (e) {
                    closeEncoder();
                    reject(e instanceof Error ? e : new Error(String(e)));
                }
            },
            error: (e: DOMException) => {
                closeEncoder();
                reject(new Error(`AudioEncoder error: ${e.message}`));
            },
        });

        const encoderConfig = {
            codec: options.codec,
            sampleRate: OPUS_SAMPLE_RATE,
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
                    sampleRate: OPUS_SAMPLE_RATE,
                    numberOfFrames: frameCount,
                    numberOfChannels,
                    timestamp: Math.round((offset / OPUS_SAMPLE_RATE) * 1_000_000),
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
                const result = muxOggOpus(encodedPackets, OPUS_SAMPLE_RATE, numberOfChannels);
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
