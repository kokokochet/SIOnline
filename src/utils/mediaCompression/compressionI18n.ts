/**
 * Plural-form key selection for the bulk-compression summary, following the
 * codebase's manual one / `2` / `5` suffix convention (see TimeHelpers.ts).
 * `localized-strings` has no built-in plural engine, so we pick the flat
 * property name from the count and let each locale supply the string.
 *
 * Intentionally diverges from `TimeHelpers.getLocalizedMinutes` for counts
 * ≥111: TimeHelpers uses `!= 11` (absolute), so 111/211 wrongly return `one`;
 * this selector uses `mod100 !== 11`, so they correctly return `many`.
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
 * Formats a byte count as a localized "x.x <unit>" string. The unit label and
 * locale are passed in (not read from the `localized-strings` singleton) so
 * this stays a pure, testable function.
 */
export function formatSavedBytes(bytes: number, locale: string, unitLabel: string): string {
	const mebibytes = bytes / (1024 * 1024);
	const number = new Intl.NumberFormat(locale, {
		minimumFractionDigits: 1,
		maximumFractionDigits: 1,
	}).format(mebibytes);
	return `${number} ${unitLabel}`;
}
