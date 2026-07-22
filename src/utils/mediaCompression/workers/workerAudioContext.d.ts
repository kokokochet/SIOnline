/* eslint-disable no-var, @typescript-eslint/no-redeclare -- ambient .d.ts
 * globals use the idiomatic `interface X {} declare var X: { new(...) }` shape
 * (mirroring lib.dom.d.ts); `no-var` and `no-redeclare` are false positives here
 * because `declare var` is the only way to type a constructable global and the
 * interface/var pair is the standard "value+type" global declaration. */
/**
 * Minimal Web Audio ambient declarations for the worker program.
 *
 * Why this file exists: `tsconfig.worker.json` drops `lib.dom` in favour of
 * `lib.webworker` (so `self`, global `onmessage` and the worker-flavoured
 * `postMessage(message, transfer)` resolve correctly). TypeScript's stdlib only
 * declares `AudioContext` / `OfflineAudioContext` / `AudioBuffer` under the DOM
 * lib, even though browsers expose `OfflineAudioContext`/`AudioContext` to
 * DedicatedWorkerGlobalScope at runtime (the audio worker relies on this for
 * `decodeAudioData` — see audioCompression.worker.ts `decodePcm`). This file
 * re-declares just the surface that worker uses so the WebWorker-lib program
 * type-checks without re-introducing the DOM lib (and its window-flavoured
 * `postMessage` overload that forced the original `as unknown as WorkerScope`
 * cast). It is a script (no top-level import/export) so its declarations augment
 * the GLOBAL scope of whichever program includes it — and only the worker
 * program includes the (otherwise excluded) workers directory.
 *
 * Signatures mirror lib.dom.d.ts (TS 6.x) for the members actually referenced.
 */

interface AudioBuffer {
	readonly numberOfChannels: number;
	readonly length: number;
	getChannelData(channel: number): Float32Array;
}

declare var AudioBuffer: {
	prototype: AudioBuffer;
	new (numberOfChannels: number, length: number, sampleRate: number): AudioBuffer;
};

interface AudioContextOptions {
	sampleRate?: number;
}

interface AudioContext {
	readonly sampleRate: number;
	decodeAudioData(
		audioData: ArrayBuffer,
		successCallback?: (decodedData: AudioBuffer) => void,
		errorCallback?: (error: DOMException) => void,
	): Promise<AudioBuffer>;
	close(): Promise<void>;
}

declare var AudioContext: {
	prototype: AudioContext;
	new (contextOptions?: AudioContextOptions): AudioContext;
};

interface OfflineAudioContext {
	readonly sampleRate: number;
	readonly length: number;
	decodeAudioData(
		audioData: ArrayBuffer,
		successCallback?: (decodedData: AudioBuffer) => void,
		errorCallback?: (error: DOMException) => void,
	): Promise<AudioBuffer>;
}

declare var OfflineAudioContext: {
	prototype: OfflineAudioContext;
	new (numberOfChannels: number, length: number, sampleRate: number): OfflineAudioContext;
};
