import JSZip from 'jszip';
import reducer, {
    compressSinglePackageMedia,
    defaultMediaCompressionState,
    SIQuesterState,
} from '../src/state/siquesterSlice';
import { createDefaultPackage } from '../src/model/siquester/packageGenerator';
import { compressMedia } from '../src/utils/mediaCompression';

jest.mock('../src/utils/mediaCompression', () => {
    const actual = jest.requireActual('../src/utils/mediaCompression');
    return { ...actual, compressMedia: jest.fn() };
});

const mockedCompressMedia = compressMedia as jest.MockedFunction<typeof compressMedia>;

function makeState(): SIQuesterState {
    const zip = new JSZip();
    zip.file('Images/pic.png', new Uint8Array([1, 2, 3]));

    const pack = createDefaultPackage({ packageName: '', authorName: '', roundCount: 1, themeCount: 1, questionCount: 1, includeFinalRound: false, finalThemeCount: 0 });

    pack.rounds[0].themes[0].questions[0].params.question = {
        items: [
            { type: 'image', value: 'pic.png', isRef: true, placement: 'screen' },
        ],
    };

    return { pack, zip, mediaCompression: { ...defaultMediaCompressionState }, zipRevision: 0, history: { past: [], future: [] } };
}

function createHarness(initial: SIQuesterState) {
    let state = initial;
    const dispatch = jest.fn((action: any) => {
        state = reducer(state, action);
        return action;
    });
    const getState = () => ({ siquester: state });
    return { dispatch, getState, getFinalState: () => state };
}

const actionTypes = (dispatch: jest.Mock): string[] => dispatch.mock.calls.map(call => call[0].type);

const run = (harness: ReturnType<typeof createHarness>, value = 'pic.png') =>
    compressSinglePackageMedia({ type: 'image', value })(harness.dispatch, harness.getState, undefined) as Promise<any>;

beforeEach(() => {
    mockedCompressMedia.mockReset();
});

test('compresses a single referenced file and dispatches mediaCompressed exactly once', async () => {
    mockedCompressMedia.mockImplementation(async (file: File) => ({
        data: new Uint8Array([9, 9]),
        fileName: `${file.name.replace(/\.[^.]+$/, '')}.jpg`,
        originalSize: 100,
        compressedSize: 2,
        wasCompressed: true,
    }));

    const harness = createHarness(makeState());
    const result = await run(harness);

    expect(result.payload).toEqual({ kind: 'applied' });
    expect(actionTypes(harness.dispatch).filter(t => t === 'siquester/mediaCompressed')).toHaveLength(1);

    const finalState = harness.getFinalState();
    expect(finalState.zip?.file('Images/pic.jpg')).not.toBeNull();
    expect(finalState.zip?.file('Images/pic.png')).toBeNull();
    expect(finalState.pack!.rounds[0].themes[0].questions[0].params.question!.items[0].value).toBe('pic.jpg');
    expect(finalState.zipRevision).toBe(1);
});

test('passthrough (wasCompressed=false) dispatches nothing and returns skipped', async () => {
    mockedCompressMedia.mockImplementation(async (file: File) => ({
        data: new Uint8Array([1, 2, 3]),
        fileName: file.name,
        originalSize: 3,
        compressedSize: 3,
        wasCompressed: false,
    }));

    const harness = createHarness(makeState());
    const result = await run(harness);

    expect(result.payload).toEqual({ kind: 'skipped' });
    expect(actionTypes(harness.dispatch)).not.toContain('siquester/mediaCompressed');
    expect(harness.getFinalState().zipRevision).toBe(0);
});

test('missing entry returns missing and dispatches nothing', async () => {
    const initial = makeState();
    initial.zip!.remove('Images/pic.png');

    const harness = createHarness(initial);
    const result = await run(harness);

    expect(result.payload).toEqual({ kind: 'missing' });
    expect(mockedCompressMedia).not.toHaveBeenCalled();
    expect(actionTypes(harness.dispatch)).not.toContain('siquester/mediaCompressed');
});

test('compress error is returned as error kind without applying anything', async () => {
    mockedCompressMedia.mockRejectedValue(new Error('encode failed'));

    const harness = createHarness(makeState());
    const result = await run(harness);

    expect(result.payload).toEqual({ kind: 'error', message: 'encode failed' });
    expect(actionTypes(harness.dispatch)).not.toContain('siquester/mediaCompressed');
    expect(harness.getFinalState().zip?.file('Images/pic.png')).not.toBeNull();
});

test('busy flag is toggled around the job and cleared at the end', async () => {
    mockedCompressMedia.mockImplementation(async (file: File) => ({
        data: new Uint8Array([9]),
        fileName: file.name,
        originalSize: 3,
        compressedSize: 1,
        wasCompressed: true,
    }));

    const harness = createHarness(makeState());
    await run(harness);

    expect(actionTypes(harness.dispatch).filter(t => t === 'siquester/setMediaCompressionBusy')).toHaveLength(2);
    expect(harness.getFinalState().mediaCompression.busy).toBe(false);
});

test('rejects with busy when a compression job is already in flight', async () => {
    const initial = makeState();
    initial.mediaCompression.busy = true;

    const harness = createHarness(initial);
    const result = await run(harness);

    expect(result.payload).toEqual({ kind: 'busy' });
    expect(mockedCompressMedia).not.toHaveBeenCalled();
    expect(actionTypes(harness.dispatch)).not.toContain('siquester/mediaCompressed');
});

test('rename collision suffixes the output name and updates the reference', async () => {
    const initial = makeState();
    // pic.png -> pic.jpg, but pic.jpg already exists in the zip.
    initial.zip!.file('Images/pic.jpg', new Uint8Array([7, 7]));

    mockedCompressMedia.mockImplementation(async () => ({
        data: new Uint8Array([9]),
        fileName: 'pic.jpg',
        originalSize: 3,
        compressedSize: 1,
        wasCompressed: true,
    }));

    const harness = createHarness(initial);
    await run(harness);

    const finalState = harness.getFinalState();
    expect(finalState.zip?.file('Images/pic-1.jpg')).not.toBeNull();
    expect(finalState.zip?.file('Images/pic.jpg')).not.toBeNull();
    expect(finalState.pack!.rounds[0].themes[0].questions[0].params.question!.items[0].value).toBe('pic-1.jpg');
});

test('syncs the package logo when the compressed file is the logo', async () => {
    const initial = makeState();
    initial.pack!.logo = '@pic.png';

    mockedCompressMedia.mockImplementation(async () => ({
        data: new Uint8Array([9]),
        fileName: 'pic.jpg',
        originalSize: 3,
        compressedSize: 1,
        wasCompressed: true,
    }));

    const harness = createHarness(initial);
    await run(harness);

    expect(harness.getFinalState().pack!.logo).toBe('@pic.jpg');
});
