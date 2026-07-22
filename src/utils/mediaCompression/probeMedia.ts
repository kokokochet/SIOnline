import { CompressibleMediaType, CompressionOptions } from './compressionTypes';
import { isAudioCompressionSupported, isVideoCompressionSupported } from './featureDetection';

export interface MediaProbeResult {
	type: CompressibleMediaType;
	supported: boolean;
	codec: string;
	reason?: string;
}

/**
 * Fast pre-flight: checks whether the OUTPUT encoder for the given media type
 * is supported by the current browser, WITHOUT decoding or demuxing the file.
 *
 * Why: `compressAudio` / `compressVideo` decode the full input before the
 * worker runs `isConfigSupported`, so an unsupported codec wastes minutes per
 * file and then silently passes through. Because the output codec is fixed by
 * the preset (not by the file contents), the result is deterministic per type;
 * the UI calls this once per referenced file but gets the same answer for all
 * files of a type.
 *
 * Advisory: `isConfigSupported` results are NOT authoritative (WebCodecs spec).
 * Some engines may return false negatives. The confirm-screen list is a warning,
 * not a blocker; the actual encode proceeds and may still succeed.
 *
 * - image: always supported (canvas is available everywhere) — no WebCodecs.
 * - audio: `AudioEncoder.isConfigSupported({ codec, sampleRate, numberOfChannels })`.
 * - video: `VideoEncoder.isConfigSupported({ codec })` (dimensions are not
 *   required to check codec support; full config is validated in the worker).
 */
export async function probeMedia(
	file: File,
	type: CompressibleMediaType,
	options: CompressionOptions,
): Promise<MediaProbeResult> {
	if (type === 'image') {
		return { type: 'image', supported: true, codec: options.image.mimeType };
	}

	if (type === 'audio') {
		const codec = options.audio.codec;
		if (!isAudioCompressionSupported()) {
			return { type: 'audio', supported: false, codec, reason: 'AudioEncoder unavailable in this browser' };
		}
		try {
			const probe = await AudioEncoder.isConfigSupported({
				codec,
				sampleRate: 48000,
				numberOfChannels: options.audio.channels,
			});
			if (probe.supported) {
				return { type: 'audio', supported: true, codec };
			}
			return { type: 'audio', supported: false, codec, reason: 'AudioEncoder.isConfigSupported returned not supported' };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return { type: 'audio', supported: false, codec, reason: `AudioEncoder.isConfigSupported: ${message}` };
		}
	}

	// type === 'video'
	const codec = options.video.codec;
	if (!isVideoCompressionSupported()) {
		return { type: 'video', supported: false, codec, reason: 'VideoEncoder unavailable in this browser' };
	}
	try {
		const probe = await VideoEncoder.isConfigSupported({ codec, width: 16, height: 16 });
		if (probe.supported) {
			return { type: 'video', supported: true, codec };
		}
		return { type: 'video', supported: false, codec, reason: 'VideoEncoder.isConfigSupported returned not supported' };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { type: 'video', supported: false, codec, reason: `VideoEncoder.isConfigSupported: ${message}` };
	}
}
