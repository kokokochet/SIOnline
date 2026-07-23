import { compressAudio } from '../src/utils/mediaCompression/compressAudio';
import { compressVideo } from '../src/utils/mediaCompression/compressVideo';
import { defaultCompressionOptions } from '../src/utils/mediaCompression/defaultOptions';

// Mock the worker factory so onmessage fires with a worker error response.
// The worker emits its canned response asynchronously when postMessage is
// called (mirrors real worker timing), so the host's onmessage handler runs
// and the named-throw path is exercised end-to-end.
jest.mock('../src/utils/mediaCompression/workerFactory', () => {
	function makeWorkerResponse(msg: unknown) {
		let cb: ((e: MessageEvent) => void) | null = null;
		return {
			postMessage: jest.fn(() => {
				setTimeout(() => cb?.({ data: msg } as MessageEvent), 0);
			}),
			terminate: jest.fn(),
			set onmessage(handler: ((e: MessageEvent) => void) | null) { cb = handler; },
			get onmessage() { return cb; },
			onerror: null as ((e: ErrorEvent) => void) | null,
		};
	}
	return {
		createAudioWorker: jest.fn(() => makeWorkerResponse({ type: 'error', name: 'NotSupportedError', error: 'opus not supported' })),
		createVideoWorker: jest.fn(() => makeWorkerResponse({ type: 'error', name: 'NotSupportedError', error: 'avc not supported' })),
	};
});

describe('host surfaces named errors instead of silent passthrough', () => {
	test('compressAudio rejects with a named Error when the worker reports NotSupportedError', async () => {
		// AudioEncoder must be "available" so we reach the encode path.
		(globalThis as Record<string, unknown>).AudioEncoder = class { static isConfigSupported() { return Promise.resolve({ supported: true }); } } as unknown as typeof AudioEncoder;
		// decodeAndExtractPcm uses OfflineAudioContext.decodeAudioData.
		(globalThis as Record<string, unknown>).OfflineAudioContext = class {
			constructor() {}
			decodeAudioData(_buf: ArrayBuffer, resolve: (b: AudioBuffer) => void) {
				resolve({ numberOfChannels: 2, length: 1, sampleRate: 48000, getChannelData: () => new Float32Array(1) } as unknown as AudioBuffer);
				return {} as Promise<AudioBuffer>;
			}
		} as unknown as typeof OfflineAudioContext;

		const file = new File([new Uint8Array([1, 2, 3, 4])], 'song.mp3', { type: 'audio/mpeg' });
		await expect(compressAudio(file, defaultCompressionOptions.audio)).rejects.toMatchObject({
			name: 'NotSupportedError',
			message: 'opus not supported',
		});

		delete (globalThis as Record<string, unknown>).AudioEncoder;
		delete (globalThis as Record<string, unknown>).OfflineAudioContext;
	});

	test('compressVideo rejects with a named Error when the worker reports NotSupportedError', async () => {
		(globalThis as Record<string, unknown>).VideoEncoder = class {} as unknown as typeof VideoEncoder;

		const file = new File([new Uint8Array([1, 2, 3, 4])], 'clip.mp4', { type: 'video/mp4' });
		await expect(compressVideo(file, defaultCompressionOptions.video)).rejects.toMatchObject({
			name: 'NotSupportedError',
			message: 'avc not supported',
		});

		delete (globalThis as Record<string, unknown>).VideoEncoder;
	});
});
