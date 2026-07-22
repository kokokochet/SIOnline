
import { createFile, type ISOFile, type MP4BoxBuffer, type Movie, type Track, type Sample } from 'mp4box';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { VideoCompressionOptions, WorkerCompressRequest, WorkerCompressResponse, WorkerAbortMessage } from '../compressionTypes';
import { getSourceFramerate } from '../videoFramerate';
import { getCodecDescription } from '../codecDescription';
import { getRebasedTimestamps } from '../chunkTiming';
import { buildVideoEncoderConfig } from '../videoEncoderConfig';
import { assertAudioMp4Compatible } from '../audioCodecSupport';
import { buildErrorResponse } from '../workerErrors';
import { waitForQueueDrain } from './workerBackpressure';
import { validateVideoWorkerMessage } from '../workerInputValidation';

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

ctx.onmessage = async (e: MessageEvent<WorkerCompressRequest | WorkerAbortMessage>) => {
    if ('type' in e.data) {
        // Cooperative abort: tell the main thread we stopped. The main-thread
        // Promise.race has already rejected on the signal; this is the clean
        // acknowledgement. Phase 4 may additionally call encoder/decoder close()
        // here for native resource release.
        if (!currentJobRejected) {
            currentJobRejected = true;
            const response: WorkerCompressResponse = { type: 'cancelled' };
            ctx.postMessage(response);
        }
        return;
    }

    currentJobRejected = false;

    try {
        validateVideoWorkerMessage(e.data);
        const { data, options } = e.data;

        const result = await compressVideoData(data, options as VideoCompressionOptions);
        if (currentJobRejected) {
            return;
        }
        const response: WorkerCompressResponse = { type: 'done', data: result.buffer as ArrayBuffer };
        ctx.postMessage(response, [result.buffer]);
    } catch (err) {
        if (currentJobRejected) {
            return;
        }
        ctx.postMessage(buildErrorResponse(err) as WorkerCompressResponse);
    }
};

async function compressVideoData(
    fileData: ArrayBuffer,
    options: VideoCompressionOptions,
): Promise<Uint8Array> {
    const mp4File = createFile(true);
    const { movie, allSamples } = demuxMp4(mp4File, fileData);

    const videoTrack = movie.tracks.find((t) => t.type === 'video');
    const audioTrack = movie.tracks.find((t) => t.type === 'audio');

    if (!videoTrack) {
        throw new Error('No video track found in input file');
    }

    // Fail loudly on non-AAC audio instead of producing a muted file
    // (review MAJOR: "Non-AAC audio в MP4 молча дропается").
    assertAudioMp4Compatible(audioTrack?.codec);

    const srcWidth = videoTrack.track_width || videoTrack.video?.width || 1920;
    const srcHeight = videoTrack.track_height || videoTrack.video?.height || 1080;
    const { width: targetWidth, height: targetHeight } = calculateVideoDimensions(
        srcWidth,
        srcHeight,
        options.maxHeight,
    );

    const isAAC = audioTrack?.codec?.startsWith('mp4a.40.') ?? false;

    const muxerTarget = new ArrayBufferTarget();
    const muxer = new Muxer({
        target: muxerTarget,
        video: {
            codec: 'avc',
            width: targetWidth,
            height: targetHeight,
        },
        audio: (audioTrack && isAAC)
            ? {
                  codec: 'aac',
                  sampleRate: audioTrack.audio?.sample_rate ?? 44100,
                  numberOfChannels: audioTrack.audio?.channel_count ?? 2,
              }
            : undefined,
        fastStart: 'in-memory',
    });

    await reencodeVideo(
        videoTrack,
        allSamples[videoTrack.id] ?? [],
        options,
        targetWidth,
        targetHeight,
        srcWidth,
        srcHeight,
        muxer,
    );

    if (audioTrack && isAAC) {
        passThroughAudio(audioTrack, allSamples[audioTrack.id] ?? [], muxer);
    }

    muxer.finalize();

    return new Uint8Array(muxerTarget.buffer);
}

interface DemuxResult {
    movie: Movie;
    allSamples: Record<number, Sample[]>;
}

function demuxMp4(mp4File: ISOFile, fileData: ArrayBuffer): DemuxResult {
    const allSamples: Record<number, Sample[]> = {};
    let movie: Movie | undefined;

    mp4File.onReady = (info: Movie) => {
        movie = info;
        for (const track of info.tracks) {
            allSamples[track.id] = [];
            mp4File.setExtractionOptions(track.id, null, { nbSamples: 100 });
        }
        mp4File.start();
    };

    mp4File.onSamples = (trackId: number, _user: unknown, samples: Sample[]) => {
        allSamples[trackId].push(...samples);
    };

    mp4File.onError = (module: string, message: string) => {
        throw new Error(`MP4 demux error [${module}]: ${message}`);
    };

    const buffer = fileData.slice(0) as MP4BoxBuffer;
    buffer.fileStart = 0;
    mp4File.appendBuffer(buffer);

    if (!movie) {
        throw new Error('MP4 demux failed: no info received');
    }

    return { movie, allSamples };
}

function calculateVideoDimensions(
    srcWidth: number,
    srcHeight: number,
    maxHeight: number,
): { width: number; height: number } {
    if (srcHeight <= maxHeight) {
        // Ensure even dimensions (H.264 requires it)
        return { width: Math.round(srcWidth / 2) * 2, height: Math.round(srcHeight / 2) * 2 };
    }
    const scale = maxHeight / srcHeight;
    const width = Math.round((srcWidth * scale) / 2) * 2;
    const height = Math.round(maxHeight / 2) * 2;
    return { width, height };
}

async function reencodeVideo(
    track: Track,
    samples: Sample[],
    options: VideoCompressionOptions,
    targetWidth: number,
    targetHeight: number,
    srcWidth: number,
    srcHeight: number,
    muxer: Muxer<ArrayBufferTarget>,
): Promise<void> {
    if (samples.length === 0) {
        return;
    }

    if (srcWidth > 8192 || srcHeight > 8192) {
        throw new Error(`Source video dimensions too large: ${srcWidth}x${srcHeight}`);
    }

    const framerate = getSourceFramerate(track);
    // latencyMode: 'realtime' suppresses B-frame reordering — see videoEncoderConfig.
    const encoderConfig = buildVideoEncoderConfig(options, targetWidth, targetHeight, framerate);
    const encoderSupport = await VideoEncoder.isConfigSupported(encoderConfig);
    if (!encoderSupport.supported) {
        throw new Error(`VideoEncoder config not supported: ${options.codec} ${targetWidth}x${targetHeight}`);
    }

    const decoderConfig = {
        codec: track.codec,
        codedWidth: srcWidth,
        codedHeight: srcHeight,
        description: getCodecDescription(samples[0]),
    };
    const decoderSupport = await VideoDecoder.isConfigSupported(decoderConfig);
    if (!decoderSupport.supported) {
        throw new Error(`VideoDecoder config not supported: ${track.codec}`);
    }

    return new Promise((resolve, reject) => {
        let encoderClosed = false;
        let decoderClosed = false;
        let settled = false;

        const closeBoth = () => {
            if (!encoderClosed) { encoderClosed = true; encoder.close(); }
            if (!decoderClosed) { decoderClosed = true; decoder.close(); }
        };

        // Presentation timestamps rebased to start at 0 (edit-list semantics).
        const rebasedTimestamps = getRebasedTimestamps(samples, track.timescale);

        // Decode timestamps are assigned cumulatively in encoder output order:
        // the encoder reorders frames for B-frames into its own decode order,
        // and mp4-muxer requires DTS to be monotonically increasing in arrival
        // order — the source decode order cannot be assumed.
        let nextDecodeTimestamp = 0;
        const frameDurationFallback = Math.round(1_000_000 / framerate);

        const encoder = new VideoEncoder({
            output: (chunk, metadata) => {
                try {
                    // Clamp to >= 0: mp4-muxer writes ctts as a version-0 UNSIGNED
                    // u32, so a negative offset (legal for B-frames when the encoder
                    // ignores latencyMode:'realtime') wraps to ~4.29 billion and
                    // corrupts PTS order. Realtime mode should prevent this entirely;
                    // the clamp is the backstop.
                    const compositionTimeOffset = Math.max(0, chunk.timestamp - nextDecodeTimestamp);
                    nextDecodeTimestamp += chunk.duration ?? frameDurationFallback;
                    muxer.addVideoChunk(chunk, metadata, chunk.timestamp, compositionTimeOffset);
                } catch (err) {
                    // Reject raw: a DOMException (e.g. muxer addVideoChunk failure)
                    // is NOT instanceof Error, so wrapping as `new Error(String(err))`
                    // would reset `.name` to 'Error' and drop the only stable
                    // diagnostic. The outer onmessage catch routes through
                    // buildErrorResponse (Error + DOMException + fallback), which
                    // preserves `.name`. Mirrors the error-callback `reject(e)` below.
                    if (!settled) { settled = true; closeBoth(); reject(err); }
                }
            },
            error: (e: DOMException) => {
                if (!settled) { settled = true; closeBoth(); reject(e); }
            },
        });

        encoder.configure(encoderConfig);

        const decoder = new VideoDecoder({
            output: (frame: VideoFrame) => {
                try {
                    encoder.encode(frame);
                } catch (err) {
                    // Reject raw: encoder.encode(frame) can throw synchronously as
                    // a DOMException (e.g. InvalidStateError), which is NOT
                    // instanceof Error — wrapping would drop `.name`. The outer
                    // onmessage catch → buildErrorResponse preserves it. Mirrors
                    // the encoder output-callback and error-callback rejects.
                    if (!settled) { settled = true; closeBoth(); reject(err); }
                } finally {
                    frame.close();
                }
            },
            error: (e: DOMException) => {
                if (!settled) { settled = true; closeBoth(); reject(e); }
            },
        });

        decoder.configure(decoderConfig);

        // Dual-gate backpressure loop (Resolution 16). Yield while EITHER the
        // decoder's OR the encoder's native queue is deep. The decoder's
        // output callback feeds the encoder synchronously
        // (encoder.encode(frame)); on a software-encode path or a slow hardware
        // encoder the decoder stays ahead of the encoder and the encoder's
        // native queue balloons. Gating only the decoder leaves the encoder
        // queue unchecked — half of review Vector 3 ("decode/encode in tight
        // loop without decodeQueueSize/encodeQueueSize backpressure"). We
        // therefore await BOTH gates before each decode. (The encoder gate
        // cannot live inside the decoder's synchronous output callback — a
        // plain await is impossible there — so it rides along in this loop.)
        (async () => {
            try {
                for (let i = 0; i < samples.length; i += 1) {
                    if (settled) { return; }
                    await waitForQueueDrain(decoder);
                    await waitForQueueDrain(encoder);
                    const sample = samples[i];
                    const chunk = new EncodedVideoChunk({
                        type: sample.is_sync ? 'key' : 'delta',
                        timestamp: rebasedTimestamps[i],
                        duration: Math.round((sample.duration * 1_000_000) / track.timescale),
                        data: sample.data!,
                    });
                    decoder.decode(chunk);
                }
                await decoder.flush();
                if (!decoderClosed) { decoderClosed = true; decoder.close(); }
                await encoder.flush();
                if (!encoderClosed) { encoderClosed = true; encoder.close(); }
                if (!settled) { settled = true; resolve(); }
            } catch (e) {
                if (!settled) {
                    settled = true;
                    closeBoth();
                    reject(e);
                }
            }
        })();
    });
}

function passThroughAudio(
    track: Track,
    samples: Sample[],
    muxer: Muxer<ArrayBufferTarget>,
): void {
    let firstChunk = true;
    // Rebase like the video track: first presentation timestamp must be 0
    // (mp4-muxer strict mode; the source edit list is not carried over).
    const rebasedTimestamps = getRebasedTimestamps(samples, track.timescale);

    for (let i = 0; i < samples.length; i += 1) {
        const sample = samples[i];
        const chunk = new EncodedAudioChunk({
            type: sample.is_sync ? 'key' : 'delta',
            timestamp: rebasedTimestamps[i],
            duration: Math.round((sample.duration * 1_000_000) / track.timescale),
            data: sample.data!,
        });

        if (firstChunk) {
            // No description passed: mp4box keeps the AAC config in the parsed
            // esds box (not in Box.data), and mp4-muxer already generates an
            // AudioSpecificConfig for AAC-LC from sampleRate/channels — passing
            // undefined here would overwrite it via Object.assign.
            muxer.addAudioChunk(chunk, {
                decoderConfig: {
                    codec: track.codec,
                    sampleRate: track.audio?.sample_rate ?? 44100,
                    numberOfChannels: track.audio?.channel_count ?? 2,
                },
            });
            firstChunk = false;
        } else {
            muxer.addAudioChunk(chunk);
        }
    }
}
