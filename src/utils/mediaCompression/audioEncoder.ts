import { AudioCompressionOptions } from './compressionTypes';
import { muxOggOpus, OPUS_SAMPLE_RATE } from './oggOpusMuxer';
import { namedError } from './workerErrors';
import { waitForQueueDrain } from './workers/workerBackpressure';

/**
 * Encodes planar float32 PCM into Opus packets and muxes them into an OGG
 * container. Lives outside the worker so it can be typechecked and unit-tested
 * directly (the worker throws `self is not defined` under Jest's node env).
 */
export async function encodeAudioToOpus(
    channels: ArrayBuffer[],
    numberOfChannels: number,
    totalFrames: number,
    options: AudioCompressionOptions,
): Promise<Uint8Array> {
    const encodedPackets: { data: Uint8Array; timestamp: number; duration: number }[] = [];

    // The WebCodecs error callback runs from its own dispatch context, not this
    // async stack, so a bare throw inside it does NOT propagate to the returned
    // promise — flush() would later reject with a generic InvalidStateError,
    // losing the original DOMException.name. Capture reject and race it against
    // flush to surface the original error.
    let rejectOuter!: (e: unknown) => void;
    const errored = new Promise<never>((_, reject) => {
        rejectOuter = reject;
    });

    const encoder = new AudioEncoder({
        output: (chunk: EncodedAudioChunk) => {
            // WebCodecs does NOT route output-callback errors to the error
            // callback, so a throw here would be swallowed and the worker would
            // post { type: 'done' } with a truncated OGG. Route to rejectOuter
            // so Promise.race(flush, errored) surfaces it.
            try {
                const chunkData = new Uint8Array(chunk.byteLength);
                chunk.copyTo(chunkData);
                encodedPackets.push({
                    data: chunkData,
                    timestamp: chunk.timestamp,
                    duration: chunk.duration ?? 0,
                });
            } catch (e) {
                // Reject raw: DOMException is not instanceof Error, so wrapping
                // as `new Error(String(e))` would drop its programmatic `.name`.
                rejectOuter(e);
            }
        },
        error: (e: DOMException) => {
            // Reject raw so the DOMException's `.name` (NotSupportedError, …)
            // is preserved end-to-end; wrapping in `new Error(...)` would reset
            // it to 'Error'.
            rejectOuter(e);
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
            throw namedError('NotSupportedError', `AudioEncoder config not supported: ${options.codec}`);
        }

        encoder.configure(encoderConfig);

        // Extract channel data from transferred ArrayBuffers.
        const channelData: Float32Array[] = channels.map(buf => new Float32Array(buf));

        // Feed PCM to the encoder (extracted for unit testing).
        await feedPcmToOpus(encoder, channelData, totalFrames, numberOfChannels);

        // Race the error signal against flush with `errored` FIRST: if the
        // encoder errored during the loop it is already settled and wins the
        // race, surfacing the original error instead of a generic
        // InvalidStateError / 'No audio data encoded'.
        await Promise.race([errored, encoder.flush()]);

        if (encodedPackets.length === 0) {
            throw namedError('InvalidStateError', 'No audio data encoded');
        }

        return muxOggOpus(encodedPackets, OPUS_SAMPLE_RATE, numberOfChannels);
    } finally {
        encoder.close();
    }
}

/**
 * Feeds planar PCM to the AudioEncoder in fixed-size (20ms) chunks.
 *
 * Each chunk's AudioData is closed in a `finally` so a throw from
 * `encoder.encode()` cannot leak native AudioData. Before each encode the loop
 * awaits `waitForQueueDrain(encoder)`: a long input would otherwise queue
 * hundreds of chunks in a tight loop, peak native memory and OOM.
 *
 * @internal - exercised directly only by tests; production callers go through encodeAudioToOpus.
 */
export async function feedPcmToOpus(
    encoder: { encode(audioData: AudioData): void; encodeQueueSize?: number },
    channelData: Float32Array[],
    totalFrames: number,
    numberOfChannels: number,
): Promise<void> {
    const chunkDuration = 20; // ms per AudioData chunk
    const chunkFrameCount = Math.floor((OPUS_SAMPLE_RATE * chunkDuration) / 1000);

    for (let offset = 0; offset < totalFrames; offset += chunkFrameCount) {
        // Yield while the encoder's native queue is deep to bound peak memory
        // on long inputs.
        await waitForQueueDrain(encoder);
        const frameCount = Math.min(chunkFrameCount, totalFrames - offset);

        const planarData = new Float32Array(frameCount * numberOfChannels);
        for (let ch = 0; ch < numberOfChannels; ch += 1) {
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
}
