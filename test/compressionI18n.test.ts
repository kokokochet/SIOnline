import { formatSavedBytes } from '../src/utils/mediaCompression/compressionI18n';

describe('media-compression-review MAJOR i18n — locale-aware byte formatting', () => {
	it('uses a comma decimal separator for ru', () => {
		// 1572864 bytes = 1.5 MiB exactly
		expect(formatSavedBytes(1572864, 'ru', 'МБ')).toBe('1,5 МБ');
	});

	it('uses a dot decimal separator for en', () => {
		expect(formatSavedBytes(1572864, 'en', 'MB')).toBe('1.5 MB');
	});

	it('keeps one decimal place and rounds', () => {
		// 1'048'576 = 1.0; 1'572'864 = 1.5; 1'836_283 ≈ 1.8
		expect(formatSavedBytes(1048576, 'en', 'MB')).toBe('1.0 MB');
		expect(formatSavedBytes(1836283, 'en', 'MB')).toBe('1.8 MB');
	});

	it('appends the localized unit with a single space', () => {
		expect(formatSavedBytes(1048576, 'sr', 'MB')).toBe('1,0 MB');
		expect(formatSavedBytes(1048576, 'uz', 'MB')).toBe('1,0 MB');
	});
});
