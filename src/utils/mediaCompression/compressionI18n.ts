/**
 * Plural-form key selection (one/2/5 suffix per TimeHelpers.ts convention;
 * localized-strings has no plural engine). Diverges from TimeHelpers for
 * counts >=111: uses mod100 !== 11 so 111/211 correctly return `many`.
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

/** Formats bytes as a localized "x.x <unit>"; unit/locale passed in to stay pure and testable. */
export function formatSavedBytes(bytes: number, locale: string, unitLabel: string): string {
	const mebibytes = bytes / (1024 * 1024);
	const number = new Intl.NumberFormat(locale, {
		minimumFractionDigits: 1,
		maximumFractionDigits: 1,
	}).format(mebibytes);
	return `${number} ${unitLabel}`;
}
