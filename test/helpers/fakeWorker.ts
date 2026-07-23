/**
 * Generic controllable fake for the `Worker` surface used by
 * `compressVideo.ts` / `compressAudio.ts` (`onmessage` / `onerror` /
 * `postMessage` / `terminate`).
 *
 * Why a generic fake rather than a `worker_threads` harness: the host code
 * under test only depends on the Worker's message surface, not its internal
 * logic. A deterministic fake lets tests fire success/error/timeout in any
 * order without `MessagePort` plumbing, and runs synchronously in the Node
 * jest environment.
 *
 * Test flow:
 *   1. Call `compressVideo(file, opts)` (or `compressAudio`).
 *   2. The host calls the (mocked) factory → a `FakeWorker` is constructed
 *      and pushed onto the registry.
 *   3. Grab it via `getLastVideoWorker()` / `getLastAudioWorker()`.
 *   4. Drive the pipeline by calling `emitMessage(...)` / `emitError(...)`,
 *      and assert on `postedMessages`, `isTerminated`, etc.
 */

/** A message captured by `FakeWorker.postMessage`, with its transfer list. */
export interface PostedMessage {
    message: unknown;
    transfer: Transferable[];
}

export class FakeWorker {
    /** Host assigns this; the fake fires it from `emitMessage`. */
    public onmessage: ((e: MessageEvent) => void) | null = null;
    /** Host assigns this; the fake fires it from `emitError`. */
    public onerror: ((e: ErrorEvent) => void) | null = null;

    /** Every message the host posted, in order, with the transfer list. */
    public readonly postedMessages: PostedMessage[] = [];
    /** True after `terminate()` has been called at least once. */
    public isTerminated = false;

    private readonly listeners: Map<string, Set<(e: unknown) => void>> = new Map();

    /**
     * Records the message. Mirrors the browser Worker: does not throw after
     * terminate (the host's `finally` calls terminate after the promise
     * settles, so late postMessages are benign).
     */
    public postMessage(message: unknown, transfer: Transferable[] = []): void {
        this.postedMessages.push({ message, transfer });
    }

    /** Marks the worker terminated. Idempotent. */
    public terminate(): void {
        this.isTerminated = true;
    }

    /** Minimal addEventListener so the fake satisfies the full Worker type. */
    public addEventListener(type: string, handler: (e: unknown) => void): void {
        let set = this.listeners.get(type);
        if (!set) {
            set = new Set();
            this.listeners.set(type, set);
        }
        set.add(handler);
    }

    /** Removes a previously-added listener. */
    public removeEventListener(type: string, handler: (e: unknown) => void): void {
        this.listeners.get(type)?.delete(handler);
    }

    // --- Test-side API (not part of the Worker contract) ---

    /** Fires `onmessage` (and any 'message' listeners) with `data`. */
    public emitMessage(data: unknown): void {
        const event = { data } as MessageEvent;
        this.onmessage?.(event);
        this.listeners.get('message')?.forEach((h) => h(event));
    }

    /**
     * Fires `onerror` (and any 'error' listeners) with a synthetic ErrorEvent.
     * The event exposes `.message` and a `.preventDefault()` (the video host
     * at compressVideo.ts:44 calls `e.preventDefault()` to suppress the
     * dev-server overlay).
     */
    public emitError(message = 'Worker error'): void {
        const event = {
            message,
            preventDefault(): void { /* no-op, matches browser surface */ },
        } as unknown as ErrorEvent;
        this.onerror?.(event);
        this.listeners.get('error')?.forEach((h) => h(event));
    }

    /** Convenience: the most recently posted message, or undefined. */
    public get lastMessage(): unknown {
        return this.postedMessages[this.postedMessages.length - 1]?.message;
    }
}

// --- Registry: lets tests reach the FakeWorker created inside compress* ---

const videoWorkers: FakeWorker[] = [];
const audioWorkers: FakeWorker[] = [];

/** Tracks a newly constructed video worker; called by the mock factory. */
export function registerVideoWorker(w: FakeWorker): void {
    videoWorkers.push(w);
}

/** Tracks a newly constructed audio worker; called by the mock factory. */
export function registerAudioWorker(w: FakeWorker): void {
    audioWorkers.push(w);
}

/** Most recently constructed video worker, or undefined. Does not pop. */
export function getLastVideoWorker(): FakeWorker | undefined {
    return videoWorkers[videoWorkers.length - 1];
}

/** Most recently constructed audio worker, or undefined. Does not pop. */
export function getLastAudioWorker(): FakeWorker | undefined {
    return audioWorkers[audioWorkers.length - 1];
}

/** Clears both registries. Call in `beforeEach`/`afterEach` of pipeline tests. */
export function resetFakeWorkerRegistry(): void {
    videoWorkers.length = 0;
    audioWorkers.length = 0;
}
