/* eslint-disable no-var, @typescript-eslint/no-redeclare -- ambient `declare var`
 * pairs are the standard value+type global shape (mirrors lib.dom.d.ts). */
/**
 * Minimal Web Audio ambient declarations for the worker program.
 *
 * `tsconfig.worker.json` uses `lib.webworker` (not `lib.dom`), so TypeScript
 * doesn't see AudioContext/OfflineAudioContext/AudioBuffer even though the
 * audio worker relies on them for `decodeAudioData`. This script re-declares
 * just that surface, augmenting the worker program's global scope without
 * re-introducing the DOM lib's window-flavoured postMessage overload.
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
