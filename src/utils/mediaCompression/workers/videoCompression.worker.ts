
import { createFile, type ISOFile, type MP4BoxBuffer, type Movie, type Track, type Sample } from 'mp4box';
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

/** AAC fallbacks for tracks whose `audio` box lacks sample_rate/channel_count. */
const AAC_FALLBACK_SAMPLE_RATE = 44100;
const AAC_FALLBACK_CHANNELS = 2;

/**
 * Cast so the transfer-list overload type-checks under the DOM lib that ts-jest
 * applies in wiring tests (there `self.postMessage` is Window.postMessage).
 */
const postMessageWithTransfer = self.postMessage as (
    message: unknown,
    transfer: Transferable[],
) => void;

let currentJobRejected = false;

self.onmessage = async (e: MessageEvent<WorkerCompressRequest | WorkerAbortMessage>) => {
    if ('type' in e.data) {
        // Cooperative abort acknowledgement: the main-thread Promise.race has
        // already rejected on the signal.
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

    // Fail loudly on non-AAC audio instead of producing a muted file.
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

    // Pre-flight: validate H.264 level can carry target res/fps before touching
    // WebCodecs (isConfigSupported does NOT check level-vs-res).
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

        // DTS in encoder output order (mp4-muxer requires monotonic arrival;
        // B-frame reorder means source decode order can't be reused). The
        // accumulator bounds fallback-frame rounding drift; see dtsAccumulator.ts.
        const dts = new DtsAccumulator(framerate);

        const encoder = new VideoEncoder({
            output: (chunk, metadata) => {
                try {
                    const nextDecodeTimestamp = dts.advance(chunk.duration);
                    // Clamp >= 0: mp4-muxer writes ctts as a version-0 UNSIGNED u32,
                    // so a negative B-frame offset wraps to ~4.29 billion and
                    // corrupts PTS order.
                    const compositionTimeOffset = Math.max(0, chunk.timestamp - nextDecodeTimestamp);
                    muxer.addVideoChunk(chunk, metadata, chunk.timestamp, compositionTimeOffset);
                } catch (err) {
                    // Reject raw: DOMException is not instanceof Error; wrapping
                    // would drop `.name`. buildErrorResponse (in the onmessage
                    // catch) preserves it.
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
                    // Reject raw (see encoder output callback): encoder.encode can
                    // throw a DOMException whose `.name` buildErrorResponse preserves.
                    if (!settled) { settled = true; closeBoth(); reject(err); }
                } finally {
                    frame.close();
                }
            },
            error: (e: DOMException) => {
                if (!settled) { settled = true; closeBoth(); reject(e); }
            },
        });

        // Configure both codecs via configureWithCleanup: a synchronous throw
        // from configure must still close BOTH codecs so native state isn't
        // leaked until worker.terminate().
        configureWithCleanup({
            configureEncoder: () => encoder.configure(encoderConfig),
            configureDecoder: () => decoder.configure(decoderConfig),
            closeEncoder: () => { if (!encoderClosed) { encoderClosed = true; encoder.close(); } },
            closeDecoder: () => { if (!decoderClosed) { decoderClosed = true; decoder.close(); } },
        });

        // Dual-gate backpressure: yield while EITHER codec's queue is deep. The
        // decoder feeds the encoder synchronously, so on a slow encoder the
        // encoder queue balloons if only the decoder is gated. The encoder gate
        // can't await inside the decoder's sync output callback, so both gates
        // ride along here.
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
            // No description: mp4-muxer already generates the AAC-LC
            // AudioSpecificConfig from sampleRate/channels; passing one here
            // would overwrite it via Object.assign.
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
