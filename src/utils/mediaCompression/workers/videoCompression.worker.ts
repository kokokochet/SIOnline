
import { createFile, type ISOFile, type MP4BoxBuffer, type Movie, type Track, type Sample } from 'mp4box';
// DEPRECATED: mp4-muxer@5.2.2 is upstream-deprecated (superseded by Mediabunny).
// Migration is tracked in docs/follow-ups/mp4-muxer-to-mediabunny-migration.md.
// It is behavioural (async encoder callbacks, removed compositionTimeOffset,
// auto-deduced track config) and cannot be safely done until Plan 10 adds an
// MP4 round-trip integration test. Do NOT migrate inline as part of a types fix.
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { VideoCompressionOptions, WorkerCompressRequest, WorkerCompressResponse, WorkerAbortMessage } from '../compressionTypes';
import { getSourceFramerate } from '../videoFramerate';
import { getCodecDescription } from '../codecDescription';
import { getRebasedTimestamps } from '../chunkTiming';
import { SampleDtsAccumulator } from '../sampleDts';
import { buildVideoEncoderConfig } from '../videoEncoderConfig';
import { assertAudioMp4Compatible } from '../audioCodecSupport';
import { buildErrorResponse, namedError } from '../workerErrors';
import { validateAvcLevel } from '../avcLevelValidation';
import { waitForQueueDrain } from './workerBackpressure';
import { validateVideoWorkerMessage } from '../workerInputValidation';
import { configureWithCleanup } from '../configureWithCleanup';
import { DtsAccumulator } from './dtsAccumulator';

/**
 * AAC muxer fallbacks for MP4 tracks whose `audio` box lacks explicit
 * `sample_rate`/`channel_count`. Used twice: once for the muxer config and
 * once for the passthrough `decoderConfig` — defined once here so the two
 * sites cannot drift.
 */
const AAC_FALLBACK_SAMPLE_RATE = 44100;
const AAC_FALLBACK_CHANNELS = 2;

/**
 * postMessage(message, transfer) view of the worker global. Under the WebWorker
 * lib (`tsconfig.worker.json`) `self.postMessage` already has this overload
 * natively, so no cast is needed for correctness. This alias exists only so the
 * transfer-list call below also type-checks under the DOM lib, which ts-jest
 * applies when the wiring tests import this file — there `self.postMessage` is
 * `Window.postMessage`, whose overloads reject a transfer array. This replaces
 * the old `self as unknown as WorkerScope` blanket cast + duplicated
 * `WorkerScope` interface (T57): only this one call site needed the treatment,
 * so it is scoped here instead of polluting the module-level `self` type.
 */
const postMessageWithTransfer = self.postMessage as (
    message: unknown,
    transfer: Transferable[],
) => void;

let currentJobRejected = false;

self.onmessage = async (e: MessageEvent<WorkerCompressRequest | WorkerAbortMessage>) => {
    if ('type' in e.data) {
        // Cooperative abort: tell the main thread we stopped. The main-thread
        // Promise.race has already rejected on the signal; this is the clean
        // acknowledgement. Phase 4 may additionally call encoder/decoder close()
        // here for native resource release.
        if (!currentJobRejected) {
            currentJobRejected = true;
            const response: WorkerCompressResponse = { type: 'cancelled' };
            self.postMessage(response);
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
        postMessageWithTransfer(response, [result.buffer]);
    } catch (err) {
        if (currentJobRejected) {
            return;
        }
        self.postMessage(buildErrorResponse(err) as WorkerCompressResponse);
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
                  sampleRate: audioTrack.audio?.sample_rate ?? AAC_FALLBACK_SAMPLE_RATE,
                  numberOfChannels: audioTrack.audio?.channel_count ?? AAC_FALLBACK_CHANNELS,
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

    // Pre-flight: validate the declared H.264 level can carry target res/fps
    // before touching WebCodecs (isConfigSupported does NOT check level-vs-res).
    // On failure the worker throws, the host falls back to passthrough, and
    // Phase 7 surfaces a clear message + a level bump in the UI.
    const levelCheck = validateAvcLevel(options.codec, targetWidth, targetHeight, framerate);
    if (!levelCheck.ok) {
        throw namedError('NotSupportedError', levelCheck.reason ?? 'H.264 level insufficient for target resolution/fps');
    }

    const encoderSupport = await VideoEncoder.isConfigSupported(encoderConfig);
    if (!encoderSupport.supported) {
        throw namedError('NotSupportedError', `VideoEncoder config not supported: ${options.codec} ${targetWidth}x${targetHeight}`);
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
        // Drift-bounded DTS accumulator. Math.round(1e6/fps) per fallback frame
        // drifts ~712ms/2h for NTSC 29.97; the accumulator computes the fallback
        // increment from a frame counter (added to nextDts, not replacing it) so
        // total drift stays < 1 µs and DTS stays monotonic for mixed
        // explicit/fallback streams. See dtsAccumulator.ts for the full rationale.
        const dts = new DtsAccumulator(framerate);

        const encoder = new VideoEncoder({
            output: (chunk, metadata) => {
                try {
                    const nextDecodeTimestamp = dts.advance(chunk.duration);
                    // Clamp to >= 0: mp4-muxer writes ctts as a version-0 UNSIGNED
                    // u32, so a negative offset (legal for B-frames when the encoder
                    // ignores latencyMode:'realtime') wraps to ~4.29 billion and
                    // corrupts PTS order. Realtime mode should prevent this entirely;
                    // the clamp is the backstop.
                    const compositionTimeOffset = Math.max(0, chunk.timestamp - nextDecodeTimestamp);
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

        // Construct both codecs before configuring either: a synchronous throw
        // from VideoEncoder.configure/VideoDecoder.configure (e.g.
        // NotSupportedError, malformed config) must close BOTH codecs so native
        // state is not leaked until worker.terminate(). closeWithCleanup wraps
        // each close in its own try/catch so a secondary close-throw cannot
        // mask the original configure error or skip the sibling close.
        configureWithCleanup({
            configureEncoder: () => encoder.configure(encoderConfig),
            configureDecoder: () => decoder.configure(decoderConfig),
            closeEncoder: () => { if (!encoderClosed) { encoderClosed = true; encoder.close(); } },
            closeDecoder: () => { if (!decoderClosed) { decoderClosed = true; decoder.close(); } },
        });

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
                const videoSampleDts = new SampleDtsAccumulator(track.timescale);
                for (let i = 0; i < samples.length; i += 1) {
                    if (settled) { return; }
                    await waitForQueueDrain(decoder);
                    await waitForQueueDrain(encoder);
                    const sample = samples[i];
                    const chunk = new EncodedVideoChunk({
                        type: sample.is_sync ? 'key' : 'delta',
                        timestamp: rebasedTimestamps[i],
                        duration: videoSampleDts.advance(sample.duration),
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
    const audioSampleDts = new SampleDtsAccumulator(track.timescale);

    for (let i = 0; i < samples.length; i += 1) {
        const sample = samples[i];
        const chunk = new EncodedAudioChunk({
            type: sample.is_sync ? 'key' : 'delta',
            timestamp: rebasedTimestamps[i],
            duration: audioSampleDts.advance(sample.duration),
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
                    sampleRate: track.audio?.sample_rate ?? AAC_FALLBACK_SAMPLE_RATE,
                    numberOfChannels: track.audio?.channel_count ?? AAC_FALLBACK_CHANNELS,
                },
            });
            firstChunk = false;
        } else {
            muxer.addAudioChunk(chunk);
        }
    }
}
