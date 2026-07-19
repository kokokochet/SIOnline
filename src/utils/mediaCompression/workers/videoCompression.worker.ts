
import { createFile, type ISOFile, type MP4BoxBuffer, type Movie, type Track, type Sample } from 'mp4box';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { VideoCompressionOptions, WorkerCompressRequest, WorkerCompressResponse } from '../compressionTypes';
import { getSourceFramerate } from '../videoFramerate';

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

ctx.onmessage = async (e: MessageEvent<WorkerCompressRequest>) => {
    const { data, options } = e.data;

    try {
        const result = await compressVideoData(data, options as VideoCompressionOptions);
        const response: WorkerCompressResponse = { type: 'done', data: result.buffer as ArrayBuffer };
        ctx.postMessage(response, [result.buffer]);
    } catch (err) {
        const response: WorkerCompressResponse = {
            type: 'error',
            error: err instanceof Error ? err.message : String(err),
        };
        ctx.postMessage(response);
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

    const encoderConfig = {
        codec: options.codec,
        width: targetWidth,
        height: targetHeight,
        bitrate: options.bitrate,
        framerate: getSourceFramerate(track),
        avc: { format: 'avc' as const },
    };
    const encoderSupport = await VideoEncoder.isConfigSupported(encoderConfig);
    if (!encoderSupport.supported) {
        throw new Error(`VideoEncoder config not supported: ${options.codec} ${targetWidth}x${targetHeight}`);
    }

    const description = samples[0]?.description?.data;
    const decoderConfig = {
        codec: track.codec,
        codedWidth: srcWidth,
        codedHeight: srcHeight,
        description: description ? new Uint8Array(description) : undefined,
    };
    const decoderSupport = await VideoDecoder.isConfigSupported(decoderConfig);
    if (!decoderSupport.supported) {
        throw new Error(`VideoDecoder config not supported: ${track.codec}`);
    }

    return new Promise((resolve, reject) => {
        let encoderClosed = false;
        let decoderClosed = false;

        const encoder = new VideoEncoder({
            output: (chunk, metadata) => {
                muxer.addVideoChunk(chunk, metadata);
            },
            error: (e: DOMException) => {
                if (!encoderClosed) { encoderClosed = true; encoder.close(); }
                if (!decoderClosed) { decoderClosed = true; decoder.close(); }
                reject(new Error(`VideoEncoder error: ${e.message}`));
            },
        });

        encoder.configure(encoderConfig);

        const decoder = new VideoDecoder({
            output: (frame: VideoFrame) => {
                try {
                    encoder.encode(frame);
                } finally {
                    frame.close();
                }
            },
            error: (e: DOMException) => {
                if (!decoderClosed) { decoderClosed = true; decoder.close(); }
                if (!encoderClosed) { encoderClosed = true; encoder.close(); }
                reject(new Error(`VideoDecoder error: ${e.message}`));
            },
        });

        decoder.configure(decoderConfig);

        for (const sample of samples) {
            const chunk = new EncodedVideoChunk({
                type: sample.is_sync ? 'key' : 'delta',
                timestamp: Math.round((sample.cts * 1_000_000) / track.timescale),
                duration: Math.round((sample.duration * 1_000_000) / track.timescale),
                data: sample.data!,
            });
            decoder.decode(chunk);
        }

        decoder.flush()
            .then(() => {
                if (!decoderClosed) { decoderClosed = true; decoder.close(); }
                return encoder.flush();
            })
            .then(() => {
                if (!encoderClosed) { encoderClosed = true; encoder.close(); }
                resolve();
            })
            .catch((e: DOMException) => {
                if (!decoderClosed) { decoderClosed = true; decoder.close(); }
                if (!encoderClosed) { encoderClosed = true; encoder.close(); }
                reject(new Error(`Flush error: ${e.message}`));
            });
    });
}

function passThroughAudio(
    track: Track,
    samples: Sample[],
    muxer: Muxer<ArrayBufferTarget>,
): void {
    let firstChunk = true;

    for (const sample of samples) {
        const chunk = new EncodedAudioChunk({
            type: sample.is_sync ? 'key' : 'delta',
            timestamp: Math.round((sample.cts * 1_000_000) / track.timescale),
            duration: Math.round((sample.duration * 1_000_000) / track.timescale),
            data: sample.data!,
        });

        if (firstChunk) {
            const description = sample.description?.data;
            muxer.addAudioChunk(chunk, {
                decoderConfig: {
                    codec: track.codec,
                    description: description ? new Uint8Array(description) : undefined,
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
