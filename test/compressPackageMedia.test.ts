import JSZip from 'jszip';
import { ContentItem, Package } from '../src/model/siquester/package';
import {
    collectExistingMediaNames,
    planRenames,
    renameMediaReferences,
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

describe('collectExistingMediaNames', () => {
    test('collects media folder entries with decoded variants, skips other files', () => {
        const zip = new JSZip();
        zip.file('content.xml', '<xml/>');
        zip.file('Images/pic.png', new Uint8Array([1]));
        zip.file('Images/my%20photo.png', new Uint8Array([2]));
        zip.file('Audio/song.mp3', new Uint8Array([3]));
        zip.file('Html/page.html', '<p/>');

        const names = collectExistingMediaNames(zip);

        expect(names.has('image:pic.png')).toBe(true);
        expect(names.has('image:my%20photo.png')).toBe(true);
        expect(names.has('image:my photo.png')).toBe(true);
        expect(names.has('audio:song.mp3')).toBe(true);
        expect(names.has('html:page.html')).toBe(false);
    });
});

describe('planRenames', () => {
    const staged = (oldValue: string, newValue: string): StagedMediaFile => ({
        type: 'image',
        oldValue,
        newValue,
        data: new Uint8Array([1]),
    });

    test('identity renames keep their names', () => {
        const plan = planRenames([staged('a.jpg', 'a.jpg')], new Set(['image:a.jpg']));
        expect(plan.get('image:a.jpg')).toBe('a.jpg');
    });

    test('appends a numeric suffix when the candidate exists in the zip', () => {
        const plan = planRenames([staged('a.png', 'a.jpg')], new Set(['image:a.png', 'image:a.jpg']));
        expect(plan.get('image:a.png')).toBe('a-1.jpg');
    });

    test('appends a numeric suffix when two staged files target the same name', () => {
        const plan = planRenames(
            [staged('a.png', 'a.jpg'), staged('a.jpeg', 'a.jpg')],
            new Set(['image:a.png', 'image:a.jpeg']),
        );
        expect(plan.get('image:a.png')).toBe('a.jpg');
        expect(plan.get('image:a.jpeg')).toBe('a-1.jpg');
    });

    test('identity-renamed files still block rename candidates', () => {
        // a.jpg is re-compressed in place; a.png must not take its name.
        const plan = planRenames(
            [staged('a.jpg', 'a.jpg'), staged('a.png', 'a.jpg')],
            new Set(['image:a.jpg', 'image:a.png']),
        );
        expect(plan.get('image:a.jpg')).toBe('a.jpg');
        expect(plan.get('image:a.png')).toBe('a-1.jpg');
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
