import localization from '../src/model/resources/localization';
import { getCompressionDoneSummaryKey } from '../src/utils/mediaCompression/compressionI18n';

// getContent() at fresh import (active=en) keeps sr/ru/uz pristine, so key-set parity is a valid missing-keys guard.
const content = localization.getContent();

// Parity scoped to compression keys; compression strings ship in en/ru only — sr/uz fall back to en.
const COMPRESSION_KEYS = [
	'compressing',
	'compressionFailed',
	'compressMedia',
	'compressionLow',
	'compressionMedium',
	'compressionHigh',
	'compressionSettings',
	'fileTooBigAfterCompression',
	'compressAllMedia',
	'compressionIrreversible',
	'compressionStart',
	'compressionNoMedia',
	'compressionProgress',
	'compressionDoneSummary',
	'compressionDoneSummary2',
	'compressionDoneSummary5',
	'compressionCancelled',
	'unitMB',
	'compressionPresetImages',
	'compressionPresetAudio',
	'compressionPresetVideo',
	'compressionCancelling',
	'compressionHistoryNote',
	'compressionAudioNotSupported',
	'compressionVideoNotSupported',
	'compressionDisabledHint',
	'compressionFailedSummary', // ≠ compressionDoneSummary plural split
	'compressionPartialWarning',
] as const;

const LOCALES = ['en', 'ru'] as const;

describe('locale key parity', () => {
	it.each(LOCALES)('%s has every compression key as a non-empty string', (lang) => {
		for (const key of COMPRESSION_KEYS) {
			const value = (content[lang] as Record<string, unknown>)[key];
			expect(typeof value).toBe('string');
			expect((value as string).length).toBeGreaterThan(0);
		}
	});

	it('plural selector follows Russian one/few/many rule (mod100, corrects TimeHelpers 11-vs-111 edge)', () => {
		expect(getCompressionDoneSummaryKey(1)).toBe('compressionDoneSummary');   // one
		expect(getCompressionDoneSummaryKey(2)).toBe('compressionDoneSummary2'); // few
		expect(getCompressionDoneSummaryKey(4)).toBe('compressionDoneSummary2'); // few
		expect(getCompressionDoneSummaryKey(5)).toBe('compressionDoneSummary5'); // many
		expect(getCompressionDoneSummaryKey(11)).toBe('compressionDoneSummary5'); // 11-14 exception
		expect(getCompressionDoneSummaryKey(14)).toBe('compressionDoneSummary5'); // 11-14 exception
		expect(getCompressionDoneSummaryKey(21)).toBe('compressionDoneSummary'); // ends in 1, not 11
		expect(getCompressionDoneSummaryKey(22)).toBe('compressionDoneSummary2'); // ends in 2-4, not 12-14
		expect(getCompressionDoneSummaryKey(0)).toBe('compressionDoneSummary5');  // zero -> many
		// Diverges from TimeHelpers' buggy absolute !=11: 111/211 must be MANY.
		expect(getCompressionDoneSummaryKey(111)).toBe('compressionDoneSummary5');
		expect(getCompressionDoneSummaryKey(211)).toBe('compressionDoneSummary5');
	});
});
