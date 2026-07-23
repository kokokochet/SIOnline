import {
    AudioCompressionOptions,
    AudioWorkerRequest,
    VideoCompressionOptions,
    WorkerCompressRequest,
} from './compressionTypes';

/**
 * Thrown when a worker `message` event fails runtime validation. Carries a
 * stable `.name` so the worker error pipeline (see workerErrors.ts) reports
 * `WorkerValidationError` instead of an opaque mid-encode crash.
 */
export class WorkerValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'WorkerValidationError';
    }
}

function fail(message: string): never {
    throw new WorkerValidationError(message);
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function assertPositiveFiniteNumber(value: unknown, field: string): asserts value is number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        fail(`${field} must be a positive finite number (got ${JSON.stringify(value)})`);
    }
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
    if (typeof value !== 'string' || value.length === 0) {
        fail(`${field} must be a non-empty string (got ${JSON.stringify(value)})`);
    }
}

function assertAudioOptions(value: unknown): asserts value is AudioCompressionOptions {
    if (!isObject(value)) fail('options must be an object');
    assertNonEmptyString(value.codec, 'options.codec');
    assertPositiveFiniteNumber(value.bitrate, 'options.bitrate');
    if (value.channels !== 1 && value.channels !== 2) {
        fail(`options.channels must be 1 or 2 for OGG Opus (got ${JSON.stringify(value.channels)})`);
    }
}

function assertVideoOptions(value: unknown): asserts value is VideoCompressionOptions {
    if (!isObject(value)) fail('options must be an object');
    assertNonEmptyString(value.codec, 'options.codec');
    assertPositiveFiniteNumber(value.bitrate, 'options.bitrate');
    assertPositiveFiniteNumber(value.maxHeight, 'options.maxHeight');
}

/**
 * Validates an audio worker message at runtime, before any WebCodecs use:
 * `data` is a non-empty ArrayBuffer and `options` carries valid
 * codec/bitrate/channels. Throws WorkerValidationError on the first violation.
 */
export function validateAudioWorkerMessage(msg: unknown): asserts msg is AudioWorkerRequest {
    if (!isObject(msg)) fail('audio worker message must be an object');
    if (!(msg.data instanceof ArrayBuffer)) fail('data must be an ArrayBuffer');
    if (msg.data.byteLength === 0) fail('data.byteLength must be > 0 (got empty buffer)');
    assertAudioOptions(msg.options);
}

/**
 * Validates a video worker message at runtime, before any WebCodecs use.
 * Throws WorkerValidationError on the first violation.
 */
export function validateVideoWorkerMessage(msg: unknown): asserts msg is WorkerCompressRequest {
    if (!isObject(msg)) fail('video worker message must be an object');
    if (!(msg.data instanceof ArrayBuffer)) fail('data must be an ArrayBuffer');
    if (msg.data.byteLength === 0) fail('data.byteLength must be > 0 (got empty buffer)');
    assertVideoOptions(msg.options);
}
