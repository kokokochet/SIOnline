import JSZip from 'jszip';
import { ContentItem, Package } from '../src/model/siquester/package';
import {
    applyStagedFileToZip,
    renameMediaReferences,
    resolveUniqueMediaValue,
    resolveZipEntry,
    StagedMediaFile,
} from '../src/utils/mediaCompression/compressPackageMedia';

function makePackage(items: ContentItem[], extraParams: Record<string, unknown> = {}): Package {
    return {
        name: 'Test',
        version: '1',
        id: 'id',
        restriction: '',
        date: '',
        publisher: '',
        difficulty: 5,
        language: 'en',
        tags: [],
        isQualityMarked: false,
        rounds: [{
            name: 'R1',
            type: 'standart',
            themes: [{
                name: 'T1',
                questions: [{
                    price: 100,
                    params: { question: { items }, ...extraParams },
                    right: { answer: [''] },
                }],
            }],
        }],
    };
}

const imageRef = (value: string): ContentItem => ({ type: 'image', value, isRef: true, placement: 'screen' });

describe('resolveZipEntry', () => {
    test('finds raw entries and falls back to URI-encoded entries', async () => {
        const zip = new JSZip();
        zip.file('Images/raw.png', new Uint8Array([1]));
        zip.file('Images/my%20photo.png', new Uint8Array([2]));

        expect(await resolveZipEntry(zip, 'Images', 'raw.png')?.async('uint8array')).toEqual(new Uint8Array([1]));
        expect(await resolveZipEntry(zip, 'Images', 'my photo.png')?.async('uint8array')).toEqual(new Uint8Array([2]));
        expect(resolveZipEntry(zip, 'Images', 'missing.png')).toBeNull();
    });
});

describe('resolveUniqueMediaValue', () => {
    test('returns the name unchanged when value is unchanged', () => {
        const zip = new JSZip();
        zip.file('Images/a.png', new Uint8Array([1]));

        expect(resolveUniqueMediaValue(zip, 'image', 'a.png', 'a.png')).toBe('a.png');
    });

    test('appends a numeric suffix when the target name already exists', () => {
        const zip = new JSZip();
        zip.file('Images/a.png', new Uint8Array([1])); // source being replaced
        zip.file('Images/a.jpg', new Uint8Array([2])); // existing target -> collision

        expect(resolveUniqueMediaValue(zip, 'image', 'a.png', 'a.jpg')).toBe('a-1.jpg');
    });

    test('does not treat the source file itself as a collision', () => {
        const zip = new JSZip();
        zip.file('Images/a.png', new Uint8Array([1]));

        expect(resolveUniqueMediaValue(zip, 'image', 'a.png', 'a.png')).toBe('a.png');
    });

    test('handles URI-encoded existing entries', () => {
        const zip = new JSZip();
        zip.file('Images/my%20photo.png', new Uint8Array([1])); // source
        zip.file('Images/my%20photo.jpg', new Uint8Array([2])); // collision (encoded)

        expect(resolveUniqueMediaValue(zip, 'image', 'my photo.png', 'my photo.jpg')).toBe('my photo-1.jpg');
    });
});

describe('applyStagedFileToZip', () => {
    test('writes the new entry, removes the old (raw + encoded), returns the rename map', () => {
        const zip = new JSZip();
        zip.file('Images/my%20photo.png', new Uint8Array([1]));

        const file: StagedMediaFile = {
            type: 'image',
            oldValue: 'my photo.png',
            newValue: 'my photo.jpg',
            data: new Uint8Array([9]),
        };

        const renames = applyStagedFileToZip(zip, file);

        expect(zip.file('Images/my photo.jpg')).not.toBeNull();
        expect(zip.file('Images/my%20photo.png')).toBeNull();
        expect(renames.get('image:my photo.png')).toBe('my photo.jpg');
    });

    test('identity rename (same value) writes in place and returns an empty rename map', () => {
        const zip = new JSZip();
        zip.file('Images/a.png', new Uint8Array([1]));

        const file: StagedMediaFile = { type: 'image', oldValue: 'a.png', newValue: 'a.png', data: new Uint8Array([9]) };

        const renames = applyStagedFileToZip(zip, file);

        expect(zip.file('Images/a.png')).not.toBeNull();
        expect(renames.size).toBe(0);
    });

    test('restores zip.files on a mid-apply throw (all-or-nothing)', () => {
        const zip = new JSZip();
        zip.file('Images/my a.png', new Uint8Array([1, 2, 3]));

        const filesBefore = { ...zip.files };
        // 'my a.png' has distinct raw ('Images/my a.png') and URI-encoded
        // ('Images/my%20a.png') remove paths -> two genuine remove calls.
        const file = { type: 'image' as const, oldValue: 'my a.png', newValue: 'my a.jpg', data: new Uint8Array([10]) };

        const realRemove = zip.remove.bind(zip);
        let removeCalls = 0;

        jest.spyOn(zip, 'remove').mockImplementation((path: string) => {
            removeCalls += 1;
            if (removeCalls === 2) {
                throw new Error('injected mid-apply');
            }
            return realRemove(path);
        });

        expect(() => applyStagedFileToZip(zip, file)).toThrow('injected mid-apply');

        // The raw original was genuinely deleted by call 1 before the throw; only snapshot/restore brings it back.
        expect(zip.file('Images/my a.png')).not.toBeNull();
        expect(zip.file('Images/my a.jpg')).toBeNull();
        expect(Object.keys(zip.files).sort()).toEqual(Object.keys(filesBefore).sort());
    });
});

describe('renameMediaReferences', () => {
    test('rewrites matching refs including nested answer and answerOptions, leaves others untouched', () => {
        const pack = makePackage(
            [imageRef('a.png'), imageRef('keep.png')],
            {
                answerOptions: { A: { items: [imageRef('a.png')] } },
                answer: { items: [imageRef('a.png')] },
            },
        );

        renameMediaReferences(pack, new Map([['image:a.png', 'a.jpg']]));

        const params = pack.rounds[0].themes[0].questions[0].params;
        expect(params.question?.items[0].value).toBe('a.jpg');
        expect(params.question?.items[1].value).toBe('keep.png');
        expect(params.answerOptions?.A.items[0].value).toBe('a.jpg');
        expect(params.answer?.items[0].value).toBe('a.jpg');
    });
});
