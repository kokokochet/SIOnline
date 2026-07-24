import { compressMedia } from '../src/utils/mediaCompression';
import { compressionPresets } from '../src/utils/mediaCompression/compressionPresets';

describe('HTML passthrough is byte-identical', () => {
	test('windows-1251 bytes round-trip byte-identical through compressMedia(file, "html")', async () => {
		// "Привет" in windows-1251.
		const cp1251 = new Uint8Array([0xCF, 0xF0, 0xE8, 0xE2, 0xE5, 0xF2]);
		const file = new File([cp1251], 'hello.html', { type: 'text/html' });

		const result = await compressMedia(file, 'html', compressionPresets.medium);

		expect(result.wasCompressed).toBe(false);
		expect(result.fileName).toBe('hello.html');
		expect(Array.from(result.data)).toEqual(Array.from(cp1251));
	});

	test('UTF-16 LE with BOM round-trips byte-identical', async () => {
		// BOM (FF FE) + "Hi" as UTF-16LE: H=00 48, i=00 69.
		const utf16le = new Uint8Array([0xFF, 0xFE, 0x48, 0x00, 0x69, 0x00]);
		const file = new File([utf16le], 'bom.html', { type: 'text/html' });

		const result = await compressMedia(file, 'html', compressionPresets.medium);

		expect(Array.from(result.data)).toEqual(Array.from(utf16le));
		expect(result.originalSize).toBe(utf16le.length);
		expect(result.compressedSize).toBe(utf16le.length);
	});

	test('plain ASCII HTML is unchanged', async () => {
		const ascii = new Uint8Array([0x3C, 0x70, 0x3E, 0x68, 0x69, 0x3C, 0x2F, 0x70, 0x3E]); // <p>hi</p>
		const file = new File([ascii], 'plain.html', { type: 'text/html' });

		const result = await compressMedia(file, 'html', compressionPresets.medium);

		expect(Array.from(result.data)).toEqual(Array.from(ascii));
	});
});
