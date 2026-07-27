import localization from '../src/model/resources/localization';

// getContent() at fresh import (active=en) keeps sr/ru/uz pristine, so key-set parity is a valid missing-keys guard.
const content = localization.getContent();

// Parity scoped to compression keys; compression strings ship in en/ru only — sr/uz fall back to en.
const COMPRESSION_KEYS = [
	'compressing',
	'compressionStart',
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
});
