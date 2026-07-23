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
 * is supported, WITHOUT decoding the file.
 *
 * Why: compressAudio/compressVideo decode the full input before the worker
 * checks the encoder config, so an unsupported codec wastes time then silently
 * passes through. The output codec is fixed by the preset (not the file), so
 * the result is deterministic per type.
 *
 * Advisory: isConfigSupported results are NOT authoritative (WebCodecs spec);
 * some engines return false negatives. This is a warning, not a blocker.
 *
 * - image: always supported (canvas) — no WebCodecs.
 * - audio: AudioEncoder.isConfigSupported({ codec, sampleRate, numberOfChannels }).
 * - video: VideoEncoder.isConfigSupported({ codec }) (dimensions not required
 *   for codec support; full config validated in the worker).
 */
export async function probeMedia(
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
