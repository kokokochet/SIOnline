import { CompressibleMediaType, CompressionOptions } from './compressionTypes';
import { isAudioCompressionSupported, isVideoCompressionSupported } from './featureDetection';

export interface MediaProbeResult {
	type: CompressibleMediaType;
	supported: boolean;
	codec: string;
	reason?: string;
}

/**
 * Pre-flight encoder support check WITHOUT decoding. Output codec is fixed by
 * the preset, so this is deterministic per type. Advisory only:
 * isConfigSupported can return false negatives (WebCodecs spec).
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
