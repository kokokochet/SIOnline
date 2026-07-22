import localization from '../src/model/resources/localization';
import { getCompressionDoneSummaryKey } from '../src/utils/mediaCompression/compressionI18n';

// Snapshot the raw locale dictionaries exactly once at module load.
// localized-strings only fills fallbacks for the *active* language on
// setLanguage, so at fresh import (active = en) sr/ru/uz are still pristine
// and getContent() reflects the authored key sets — this is what makes the
// parity check a valid "missing keys" regression guard.
const content = localization.getContent();

// The compression keys, grouped by owner. The parity assertion (first test)
// is SCOPED to this array (F7): it checks that every COMPRESSION_KEYS entry
// exists in every locale — NOT full-keyset equality. So this array is both the
// parity scope AND the explicit non-empty-string guard for the known
// compression keys across all four locales. Full-keyset equality is
// deliberately NOT asserted: en/ru/sr/uz have divergent non-compression key
// sets by design (e.g. `stake`, `noStake`, `yourScore` are absent from sr/uz),
// which would turn the test red on gaps unrelated to this plan.
//
// NOTE: `compressionQuality` is intentionally EXCLUDED — Plan 11 (P4) deletes
// it from all four locales (zero component references), so asserting its
// presence here would turn red the moment Plan 11 lands. It is also outside
// the (COMPRESSION_KEYS-scoped) parity assertion for the same reason: the
// parity test does not reference it, so removing it everywhere in Plan 11
// leaves parity green.
// sr/uz still ADD the key in Steps 5–6 because en/ru still have it at P3
// execution time, keeping all four locales in sync until Plan 11 removes it.
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
	'compressionIrreversible', // Plan 05 (T37) updates this text; key is pre-existing
	'compressionStart',
	'compressionNoMedia',
	'compressionProgress',
	// (b) This plan's additions (plural split + unit + legends):
	'compressionDoneSummary',
	'compressionDoneSummary2',
	'compressionDoneSummary5',
	'compressionCancelled',
	'unitMB',
	'compressionPresetImages',
	'compressionPresetAudio',
	'compressionPresetVideo',
	// (c) Cross-plan keys (added to en/ru by Plans 02/06/07; sr/uz translated in Step 7):
	'compressionCancelling',              // Plan 02 (T14)
	'compressionHistoryNote',             // Plan 06 (T42)
	'compressionAudioNotSupported',       // Plan 07 (T47)
	'compressionVideoNotSupported',       // Plan 07 (T47)
	'compressionDisabledHint',            // Plan 07 (T47)
	'compressionFailedSummary',           // Plan 07 (T47) — ≠ compressionDoneSummary plural split
	'compressionPartialWarning',          // Plan 07 (T47)
	'compressionUnsupportedFiles',        // Plan 07 (T47)
] as const;

const LOCALES = ['en', 'ru', 'sr', 'uz'] as const;

describe('media-compression-review MAJOR i18n — locale key parity', () => {
	it('every locale exposes the same compression keys', () => {
		// F7: scoped to COMPRESSION_KEYS (not full-keyset equality). sr/uz are
		// intentionally missing some non-compression keys (`stake`, `noStake`,
		// `yourScore`), so full-keyset parity would fail on pre-existing gaps
		// unrelated to this plan. The non-empty-string guard in the next test
		// then locks the value for every COMPRESSION_KEY.
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
