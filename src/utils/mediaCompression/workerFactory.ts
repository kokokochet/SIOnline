/**
 * Worker factory module — isolates `new Worker(new URL(..., import.meta.url))`
 * so that ts-jest (module: "commonjs") doesn't fail on import.meta syntax.
 * Tests mock this module via moduleNameMapper.
 */

export function createVideoWorker(): Worker {
    return new Worker(
        new URL('./workers/videoCompression.worker.ts', import.meta.url),
        { type: 'module' },
    );
}

export function createAudioWorker(): Worker {
    return new Worker(
        new URL('./workers/audioCompression.worker.ts', import.meta.url),
        { type: 'module' },
    );
}
