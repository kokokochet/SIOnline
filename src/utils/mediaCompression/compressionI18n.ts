/**
 * Plural-form key selection for the bulk-compression summary, following the
 * codebase's manual one / `2` / `5` suffix convention (see `src/utils/TimeHelpers.ts`
 * which selects `localization.minutes2` / `localization.minutes5` the same way).
 *
 * `localized-strings@2.0.3` has no built-in plural engine, so — like TimeHelpers —
 * we pick the flat property name ourselves from the count and let each locale
 * supply the correctly-spelled string.
 *
 * Rule (Russian-style with the 11–14 exception, using mod100):
 *   1, 21, 31 … (not 11)        -> one   (compressionDoneSummary)
 *   2–4, 22–24 … (not 12–14)    -> few   (compressionDoneSummary2)
 *   0, 5–20, 25–30, 11–14       -> many  (compressionDoneSummary5)
 *
 * This intentionally diverges from `TimeHelpers.getLocalizedMinutes` for counts
 * ≥111: TimeHelpers uses `minutes != 11` (absolute), so 111/211 wrongly return
 * `minute`. This selector uses `mod100 !== 11`, so 111/211 correctly return
 * `many`. Pinned by the test in test/localization.compression.test.ts.
 *
 * English/Uzbek apply the same numeric rule uniformly; en few==many ("files"),
 * uz all three identical (no grammatical number). Applying one rule everywhere
 * matches how TimeHelpers already treats en/ru uniformly.
 */
export function getCompressionDoneSummaryKey(totalCount: number): 'compressionDoneSummary' | 'compressionDoneSummary2' | 'compressionDoneSummary5' {
	const mod10 = totalCount % 10;
	const mod100 = totalCount % 100;

	if (mod10 === 1 && mod100 !== 11) {
		return 'compressionDoneSummary';
	}

	if (mod10 > 1 && mod10 < 5 && (mod100 < 11 || mod100 > 14)) {
		return 'compressionDoneSummary2';
	}

	return 'compressionDoneSummary5';
}

/**
 * Formats a byte count as a localized "x.x <unit>" string for the compression
 * summary. Replaces the old `(bytes / MB).toFixed(1) + ' MB'` which (a) hardcoded
 * Latin "MB" even in Russian where the feature otherwise uses Cyrillic "МБ", and
 * (b) ignored the locale decimal separator (ru expects "1,5").
 *
 * The unit label is passed in (not read from the singleton) so this stays a pure,
 * locale-explicit function that is trivial to test without the `localized-strings`
 * global. Callers pass `localization.unitMB` and `localization.getLanguage()`.
 *
 * `locale` is a BCP-47 tag; the project's `localized-strings` language codes
 * ('en' | 'ru' | 'sr' | 'uz') are valid BCP-47 tags as-is.
 *
 * (Pre-existing nit: divides by 1024*1024 = MiB but labels with "MB"/"МБ".
 * Matches the original `formatSaved`; out of scope here.)
 */
export function formatSavedBytes(bytes: number, locale: string, unitLabel: string): string {
	const mebibytes = bytes / (1024 * 1024);
	const number = new Intl.NumberFormat(locale, {
		minimumFractionDigits: 1,
		maximumFractionDigits: 1,
	}).format(mebibytes);
	return `${number} ${unitLabel}`;
}
