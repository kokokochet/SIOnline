/**
 * Jest mock for `src/utils/mediaCompression/workerFactory.ts`.
 *
 * Mapped via `moduleNameMapper` (`"workerFactory$": "<rootDir>/test/workerFactoryMock"`)
 * so that `compressVideo.ts:3` / `compressAudio.ts:3` construct a `FakeWorker`
 * instead of a real Web Worker. Each constructed fake is registered so tests
 * can grab it via `getLastVideoWorker` / `getLastAudioWorker` and drive the
 * pipeline.
 *
 * Note on the `require('./workerFactoryMock')` (untyped) pattern in tests:
 * the real `workerFactory.ts:7` returns `Worker`; this mock returns `FakeWorker`.
 * `moduleNameMapper` swaps at runtime and ts-jest typechecks `compressVideo.ts`
 * against the *real* signature, so no typecheck error occurs. Tests that reach
 * the factory directly use `require` (untyped) to avoid the `FakeWorker` →
 * `Worker` assignability caveat.
 */
import {
    FakeWorker,
    registerVideoWorker,
    registerAudioWorker,
} from './helpers/fakeWorker';

export {
    FakeWorker,
    getLastVideoWorker,
    getLastAudioWorker,
    resetFakeWorkerRegistry,
} from './helpers/fakeWorker';
export type { PostedMessage } from './helpers/fakeWorker';

export function createVideoWorker(): FakeWorker {
    const w = new FakeWorker();
    registerVideoWorker(w);
    return w;
}

export function createAudioWorker(): FakeWorker {
    const w = new FakeWorker();
    registerAudioWorker(w);
    return w;
}
