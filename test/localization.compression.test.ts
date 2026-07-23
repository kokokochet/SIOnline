import localization from '../src/model/resources/localization';
import { getCompressionDoneSummaryKey } from '../src/utils/mediaCompression/compressionI18n';

// Snapshot the raw locale dictionaries exactly once at module load.
// localized-strings only fills fallbacks for the *active* language on
// setLanguage, so at fresh import (active = en) sr/ru/uz are still pristine
// and getContent() reflects the authored key sets — this is what makes the
// parity check a valid "missing keys" regression guard.
const content = localization.getContent();

// The compression keys. Parity is scoped to this array, NOT full-keyset
// equality: en/ru/sr/uz have divergent non-compression key sets by design
// (`stake`, `noStake`, `yourScore` are absent from sr/uz), so full parity
// would fail on gaps unrelated to compression. `compressionQuality` is
// intentionally excluded (no component references it).
const COMPRESSION_KEYS = [
	// (a) Original feature keys (pre-existing in en/ru, missing from sr/uz):
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
	// (b) Plural split + unit + legends:
	'compressionDoneSummary',
	'compressionDoneSummary2',
	'compressionDoneSummary5',
	'compressionCancelled',
	'unitMB',
	'compressionPresetImages',
	'compressionPresetAudio',
	'compressionPresetVideo',
	// (c) Cross-plan keys (translated into sr/uz):
	'compressionCancelling',
	'compressionHistoryNote',
	'compressionAudioNotSupported',
	'compressionVideoNotSupported',
	'compressionDisabledHint',
	'compressionFailedSummary', // ≠ compressionDoneSummary plural split
	'compressionPartialWarning',
	'compressionUnsupportedFiles',
] as const;

const LOCALES = ['en', 'ru', 'sr', 'uz'] as const;

describe('locale key parity', () => {
	it('every locale exposes the same compression keys', () => {
		// Scoped to COMPRESSION_KEYS (not full-keyset equality): sr/uz are
		// intentionally missing some non-compression keys (`stake`, `noStake`,
		// `yourScore`). The non-empty-string guard in the next test locks the
		// value for every COMPRESSION_KEY.
		for (const lang of LOCALES) {
			for (const key of COMPRESSION_KEYS) {
				expect(Object.prototype.hasOwnProperty.call(content[lang], key)).toBe(true);
			}
		}
	});

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
		// Pins the intentional divergence from TimeHelpers' buggy `!= 11` (absolute):
		// 111/211 must be MANY (TimeHelpers would wrongly return 'one').
		expect(getCompressionDoneSummaryKey(111)).toBe('compressionDoneSummary5');
		expect(getCompressionDoneSummaryKey(211)).toBe('compressionDoneSummary5');
	});
});
