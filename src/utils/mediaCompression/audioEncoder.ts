import { AudioCompressionOptions } from './compressionTypes';
import { muxOggOpus } from './oggOpusMuxer';
import { waitForQueueDrain } from './workers/workerBackpressure';

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
 * particular the output/error-callback error handling — is typechecked and
 * unit-tested in CI. The worker itself is mocked at the module boundary in
 * tests and otherwise only compiled by ts-loader; importing it directly under
 * Jest's `node` test env throws `ReferenceError: self is not defined` at module
 * top level. This module has no `self` / `postMessage` references and is safe
 * to import under any Jest environment.
 */
export async function encodeAudioToOpus(
    channels: ArrayBuffer[],
    numberOfChannels: number,
    totalFrames: number,
    options: AudioCompressionOptions,
): Promise<Uint8Array> {
    const encodedPackets: { data: Uint8Array; timestamp: number; duration: number }[] = [];
    const chunkDuration = 20; // ms per AudioData chunk
    const chunkFrameCount = Math.floor((OPUS_SAMPLE_RATE * chunkDuration) / 1000);

    // Capture the reject fn so the WebCodecs `error` callback — invoked from
    // the implementation's OWN dispatch context, NOT from this async call
    // stack — can reject the returned promise. A bare `throw` inside the
    // callback does NOT propagate to the async function's implicit Promise:
    // it escapes WebCodecs' invocation, the original error info (incl.
    // DOMException.name) is lost, and a later `encoder.flush()` rejects with a
    // generic InvalidStateError. Explicit reject + Promise.race preserves the
    // original AudioEncoder error (Resolution 15). (See review MAJOR "Audio
    // worker errors mislabeled".)
    let rejectOuter!: (e: unknown) => void;
    const errored = new Promise<never>((_, reject) => {
        rejectOuter = reject;
    });

    const encoder = new AudioEncoder({
        output: (chunk: EncodedAudioChunk) => {
            // Mirror videoCompression.worker.ts: WebCodecs does NOT route
            // output-callback errors to the error callback, so a throw in
            // copyTo/push would otherwise be swallowed and the worker would
            // post { type: 'done' } with a truncated/corrupt OGG. Route to
            // rejectOuter so the Promise.race(flush, errored) below surfaces it
            // with the ORIGINAL error (T11's try/catch intent, preserved).
            try {
                const chunkData = new Uint8Array(chunk.byteLength);
                chunk.copyTo(chunkData);
                encodedPackets.push({
                    data: chunkData,
                    timestamp: chunk.timestamp,
                    duration: chunk.duration ?? 0,
                });
            } catch (e) {
                rejectOuter(e instanceof Error ? e : new Error(String(e)));
            }
        },
        error: (e: DOMException) => {
            rejectOuter(new Error(`AudioEncoder error: ${e.name}: ${e.message}`));
        },
    });

    try {
        const encoderConfig = {
            codec: options.codec,
            sampleRate: OPUS_SAMPLE_RATE,
            numberOfChannels,
            bitrate: options.bitrate,
        };

        const support = await AudioEncoder.isConfigSupported(encoderConfig);
        if (!support.supported) {
            throw new Error(`AudioEncoder config not supported: ${options.codec}`);
        }

        encoder.configure(encoderConfig);

        // Extract channel data from transferred ArrayBuffers.
        const channelData: Float32Array[] = channels.map(buf => new Float32Array(buf));

        // Feed PCM to encoder in chunks, yielding while the encoder's native
        // queue is deep. Prevents the tight-loop OOM documented in review
        // MAJOR Memory/OOM (Worker OOM → silent skip).
        for (let offset = 0; offset < totalFrames; offset += chunkFrameCount) {
            await waitForQueueDrain(encoder);
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

            try {
                encoder.encode(audioData);
            } finally {
                audioData.close();
            }
        }

        // Race the error signal against flush, with `errored` FIRST: if the
        // encoder errored during the loop (or an output-callback throw called
        // rejectOuter), `errored` is already settled and Promise.race prefers
        // it over a fulfilled/rejected flush() — surfacing the ORIGINAL error
        // (DOMException name + message, or the copyTo throw) instead of a
        // generic InvalidStateError / 'No audio data encoded'. (Putting flush
        // first would let a settled flush win and lose the named error, which
        // is exactly the R15 regression this avoids.)
        await Promise.race([errored, encoder.flush()]);

        if (encodedPackets.length === 0) {
            throw new Error('No audio data encoded');
        }

        return muxOggOpus(encodedPackets, OPUS_SAMPLE_RATE, numberOfChannels);
    } finally {
        encoder.close();
    }
}
