import { probeMedia } from '../src/utils/mediaCompression/probeMedia';
import { compressionPresets } from '../src/utils/mediaCompression/compressionPresets';

function installAudioEncoder(isConfigSupported: (c: unknown) => Promise<{ supported: boolean }>) {
	(globalThis as Record<string, unknown>).AudioEncoder = class {
		static isConfigSupported = isConfigSupported;
	} as unknown as typeof AudioEncoder;
}
function installVideoEncoder(isConfigSupported: (c: unknown) => Promise<{ supported: boolean }>) {
	(globalThis as Record<string, unknown>).VideoEncoder = class {
		static isConfigSupported = isConfigSupported;
	} as unknown as typeof VideoEncoder;
}
function clearEncoders() {
	delete (globalThis as Record<string, unknown>).AudioEncoder;
	delete (globalThis as Record<string, unknown>).VideoEncoder;
}

describe('decode-before-probe — fast pre-flight', () => {
	afterEach(clearEncoders);

	test('audio probe returns supported when AudioEncoder.isConfigSupported agrees', async () => {
		installAudioEncoder(async () => ({ supported: true }));
		const result = await probeMedia('audio', compressionPresets.medium);
		expect(result).toEqual({ type: 'audio', supported: true, codec: 'opus' });
	});

	test('audio probe returns unsupported when AudioEncoder.isConfigSupported denies', async () => {
		installAudioEncoder(async () => ({ supported: false }));
		const result = await probeMedia('audio', compressionPresets.medium);
		expect(result.supported).toBe(false);
		expect(result.codec).toBe('opus');
		expect(result.reason).toMatch(/AudioEncoder/i);
	});

	test('audio probe returns unsupported when AudioEncoder is unavailable', async () => {
		clearEncoders();
		const result = await probeMedia('audio', compressionPresets.medium);
		expect(result.supported).toBe(false);
		expect(result.reason).toMatch(/AudioEncoder/i);
	});

	test('video probe returns supported when VideoEncoder.isConfigSupported agrees', async () => {
		installVideoEncoder(async () => ({ supported: true }));
		const result = await probeMedia('video', compressionPresets.medium);
		expect(result).toEqual({ type: 'video', supported: true, codec: 'avc1.64001F' });
	});

	test('video probe returns unsupported when VideoEncoder.isConfigSupported denies', async () => {
		installVideoEncoder(async () => ({ supported: false }));
		const result = await probeMedia('video', compressionPresets.medium);
		expect(result.supported).toBe(false);
		expect(result.codec).toMatch(/^avc1\./);
	});

	test('image probe is always supported (canvas)', async () => {
		const result = await probeMedia('image', compressionPresets.medium);
		expect(result.supported).toBe(true);
	});

	test('probe does NOT call decodeAudioData (fast path) — verified by absence of OfflineAudioContext use', async () => {
		let decodeCalled = false;
		installAudioEncoder(async () => ({ supported: true }));
		(globalThis as Record<string, unknown>).OfflineAudioContext = class {
			decodeAudioData() { decodeCalled = true; return Promise.resolve({} as AudioBuffer); }
		} as unknown as typeof OfflineAudioContext;
		await probeMedia('audio', compressionPresets.medium);
		expect(decodeCalled).toBe(false);
		delete (globalThis as Record<string, unknown>).OfflineAudioContext;
	});
});
