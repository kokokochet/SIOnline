import JSZip from 'jszip';
import reducer, {
    bulkCompressionCancelRequested,
    compressAllPackageMedia,
    defaultMediaCompressionState,
    SIQuesterState,
    abortActiveBulkCompression,
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
    zip.file('Audio/song.mp3', new Uint8Array([4, 5, 6]));

    const pack = createDefaultPackage({ packageName: '', authorName: '', roundCount: 1, themeCount: 1, questionCount: 1, includeFinalRound: false, finalThemeCount: 0 });

    pack.rounds[0].themes[0].questions[0].params.question = {
        items: [
            { type: 'image', value: 'pic.png', isRef: true, placement: 'screen' },
            { type: 'audio', value: 'song.mp3', isRef: true, placement: 'screen' },
        ],
    };

    return { pack, zip, mediaCompression: { ...defaultMediaCompressionState, enabled: true }, zipRevision: 0, history: { past: [], future: [] } };
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

beforeEach(() => {
    mockedCompressMedia.mockReset();
});

test('compresses all referenced media and applies results in one dispatch', async () => {
    mockedCompressMedia.mockImplementation(async (file: File) => ({
        data: new Uint8Array([9, 9]),
        fileName: `${file.name.replace(/\.[^.]+$/, '')}.out`,
        originalSize: 100,
        compressedSize: 2,
        wasCompressed: true,
    }));

    const harness = createHarness(makeState());
    await compressAllPackageMedia()(harness.dispatch, harness.getState, undefined);

    const types = actionTypes(harness.dispatch);
    expect(types).toContain('siquester/bulkCompressionStarted');
    expect(types).toContain('siquester/bulkCompressionProgress');
    expect(types.filter(t => t === 'siquester/bulkMediaCompressed')).toHaveLength(1);
    expect(types).toContain('siquester/bulkCompressionFinished');

    const finalState = harness.getFinalState();
    expect(finalState.zip?.file('Images/pic.out')).not.toBeNull();
    expect(finalState.zip?.file('Audio/song.out')).not.toBeNull();
    expect(finalState.zipRevision).toBe(1);
    expect(finalState.bulkCompression?.phase).toBe('done');
    expect(finalState.bulkCompression?.summary).toEqual({ compressedCount: 2, skippedCount: 0, savedBytes: 196, errors: [] });
});

test('skips files that fail compression and keeps the package valid', async () => {
    mockedCompressMedia
        .mockRejectedValueOnce(new Error('boom'))
        .mockImplementationOnce(async () => ({
            data: new Uint8Array([9]),
            fileName: 'song.opus',
            originalSize: 100,
            compressedSize: 1,
            wasCompressed: true,
        }));

    const harness = createHarness(makeState());
    await compressAllPackageMedia()(harness.dispatch, harness.getState, undefined);

    const finalState = harness.getFinalState();
    expect(finalState.zip?.file('Images/pic.png')).not.toBeNull();
    expect(finalState.pack!.rounds[0].themes[0].questions[0].params.question!.items[0].value).toBe('pic.png');
    expect(finalState.zip?.file('Audio/song.opus')).not.toBeNull();
    expect(finalState.bulkCompression?.summary).toEqual({
        compressedCount: 1,
        skippedCount: 1,
        savedBytes: 99,
        errors: [{ type: 'image', fileName: 'pic.png', name: 'Error', message: 'boom' }],
    });
    expect(finalState.bulkCompression?.phase).toBe('done');
});

test('passthrough results keep originals and apply nothing', async () => {
    mockedCompressMedia.mockImplementation(async (file: File) => ({
        data: new Uint8Array([1, 2, 3]),
        fileName: file.name,
        originalSize: 3,
        compressedSize: 3,
        wasCompressed: false,
    }));

    const harness = createHarness(makeState());
    await compressAllPackageMedia()(harness.dispatch, harness.getState, undefined);

    expect(actionTypes(harness.dispatch)).not.toContain('siquester/bulkMediaCompressed');

    const finalState = harness.getFinalState();
    expect(finalState.zipRevision).toBe(0);
    expect(finalState.bulkCompression?.phase).toBe('done');
    expect(finalState.bulkCompression?.summary).toEqual({ compressedCount: 0, skippedCount: 2, savedBytes: 0, errors: [] });
});

test.each(['beforeFirstFile', 'afterLastFile'] as const)('cancel (%s) discards staged results and leaves the package untouched', async (mode) => {
    mockedCompressMedia.mockImplementation(async () => ({
        data: new Uint8Array([9]),
        fileName: 'x.out',
        originalSize: 100,
        compressedSize: 1,
        wasCompressed: true,
    }));

    let state = makeState();
    let progressSeen = 0;
    const dispatch = jest.fn((action: any) => {
        state = reducer(state, action);

        if (action.type === 'siquester/bulkCompressionProgress') {
            progressSeen += 1;
        }

        // beforeFirstFile = in-loop check; afterLastFile = post-loop check (2 files).
        const shouldCancel = mode === 'beforeFirstFile'
            ? action.type === 'siquester/bulkCompressionStarted'
            : action.type === 'siquester/bulkCompressionProgress' && progressSeen === 2;

        if (shouldCancel) {
            state = reducer(state, bulkCompressionCancelRequested());
        }

        return action;
    });
    const getState = () => ({ siquester: state });

    await compressAllPackageMedia()(dispatch, getState, undefined);

    const types = actionTypes(dispatch);
    expect(types).toContain('siquester/bulkCompressionCancelled');
    expect(types).not.toContain('siquester/bulkMediaCompressed');
    expect(state.zip?.file('Images/pic.png')).not.toBeNull();
    expect(state.zip?.file('Audio/song.mp3')).not.toBeNull();
    expect(state.bulkCompression?.phase).toBe('cancelled');
});

test('skips referenced files missing from the zip', async () => {
    const initial = makeState();
    initial.zip!.remove('Audio/song.mp3');

    mockedCompressMedia.mockImplementation(async () => ({
        data: new Uint8Array([9]),
        fileName: 'pic.jpg',
        originalSize: 100,
        compressedSize: 1,
        wasCompressed: true,
    }));

    const harness = createHarness(initial);
    await compressAllPackageMedia()(harness.dispatch, harness.getState, undefined);

    expect(mockedCompressMedia).toHaveBeenCalledTimes(1);
    expect(actionTypes(harness.dispatch)).toContain('siquester/bulkMediaCompressed');

    const finalState = harness.getFinalState();
    expect(finalState.zip?.file('Images/pic.jpg')).not.toBeNull();
    expect(finalState.zip?.file('Images/pic.png')).toBeNull();
    expect(finalState.bulkCompression?.summary).toEqual({ compressedCount: 1, skippedCount: 1, savedBytes: 99, errors: [] });
    // Missing-file ref was pre-existing, left as-is.
});

test('rename plan resolves a literal-% collision without breaking the package', async () => {
    // pic's target 'my%20photo.png' collides with the URI-encoded form of existing 'my photo.png'.
    const initial = makeState();
    initial.zip!.file('Images/my%20photo.png', new Uint8Array([7, 7, 7]));
    initial.pack!.rounds[0].themes[0].questions[0].params.question!.items.push(
        { type: 'image', value: 'my photo.png', isRef: true, placement: 'screen' },
    );

    let call = 0;
    mockedCompressMedia.mockImplementation(async (file: File) => {
        call += 1;
        // pic.png -> 'my%20photo.png', my photo.png -> 'my photo.jpg'
        const target = file.name === 'pic.png' ? 'my%20photo.png' : 'my photo.jpg';
        return {
            data: new Uint8Array([call]),
            fileName: target,
            originalSize: 100,
            compressedSize: 1,
            wasCompressed: true,
        };
    });

    const harness = createHarness(initial);
    await compressAllPackageMedia()(harness.dispatch, harness.getState, undefined);

    const finalState = harness.getFinalState();
    // 3 files: pic.png, song.mp3, plus added 'my photo.png'.
    expect(finalState.bulkCompression?.summary?.compressedCount).toBe(3);
});

test('rejected thunk after Started transitions phase to failed and applies nothing', async () => {
    // A post-Started throw would strand phase='running'; forced directly since per-file try/catch swallows compressMedia rejections.
    const { compressAllPackageMedia: thunk } = await import('../src/state/siquesterSlice');

    let state: SIQuesterState = makeState();
    const dispatch = jest.fn((action: any) => {
        state = reducer(state, action);
        return action;
    });
    const getState = () => ({ siquester: state });

    state = reducer(state, { type: 'siquester/bulkCompressionStarted', payload: { total: 2 } });
    expect(state.bulkCompression?.phase).toBe('running');

    // RTK 2.x thunk.rejected(error, requestId, arg, ...); arg is void here.
    const rejectedAction = thunk.rejected(new Error('unexpected'), 'fakeReqId', undefined);
    state = reducer(state, rejectedAction as any);

    expect(state.bulkCompression?.phase).toBe('failed');
    expect(state.bulkCompression?.failedReason).toBe('unexpected');
    expect(state.zip?.file('Images/pic.png')).not.toBeNull();
    expect(state.zip?.file('Audio/song.mp3')).not.toBeNull();
    expect(state.zipRevision).toBe(0);
});

test('aborting mid-file cancels within a tick instead of encoding to completion', async () => {
    // Slow (30s) but AbortSignal-responsive mock.
    mockedCompressMedia.mockImplementation(
        async (_file: File, _type: any, _opts: any, signal?: AbortSignal) => {
            // Already-aborted signal rejects at once (abort can race ahead past the JSZip entry read).
            if (signal?.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }
            await new Promise<void>((resolve, reject) => {
                const t = setTimeout(resolve, 30_000);
                signal?.addEventListener('abort', () => {
                    clearTimeout(t);
                    reject(new DOMException('Aborted', 'AbortError'));
                }, { once: true });
            });
            return { data: new Uint8Array([1]), fileName: 'x.out', originalSize: 10, compressedSize: 1, wasCompressed: true };
        },
    );

    const harness = createHarness(makeState());
    const started = Date.now();

    const promise = compressAllPackageMedia()(harness.dispatch, harness.getState, undefined);
    await new Promise<void>(r => {
        const check = () => {
            if (harness.getFinalState().bulkCompression?.phase === 'running') r();
            else setTimeout(check, 0);
        };
        check();
    });
    abortActiveBulkCompression();

    await promise;
    const elapsed = Date.now() - started;

    const types = actionTypes(harness.dispatch);
    expect(types).toContain('siquester/bulkCompressionCancelled');
    expect(types).not.toContain('siquester/bulkMediaCompressed');
    expect(elapsed).toBeLessThan(1000);
    expect(harness.getFinalState().bulkCompression?.phase).toBe('cancelled');
    expect(harness.getFinalState().zip?.file('Images/pic.png')).not.toBeNull();
});

test('a pre-loop throw dispatches bulkCompressionFailed instead of stranding on confirm', async () => {
    // No zip/pack → the very first guard throws before bulkCompressionStarted.
    const state: SIQuesterState = { mediaCompression: defaultMediaCompressionState, history: { past: [], future: [] } } as any;
    const dispatch = jest.fn((action: any) => action);
    const getState = () => ({ siquester: state });

    await compressAllPackageMedia()(dispatch, getState, undefined);

    const types = actionTypes(dispatch);
    expect(types).toContain('siquester/bulkCompressionFailed');
    expect(types).not.toContain('siquester/bulkCompressionStarted');
});

test('thunk is a defensive no-op that transitions to phase "failed" when compression is disabled', async () => {
    // UI disables the trigger; guard the case it's dispatched anyway.
    const initial = makeState();
    initial.mediaCompression = { enabled: false, presets: { image: 'medium', audio: 'low', video: 'low' } };
    initial.bulkCompression = { phase: 'confirm', total: 0, completed: 0, cancelRequested: false };

    const harness = createHarness(initial);
    await compressAllPackageMedia()(harness.dispatch, harness.getState, undefined);

    const types = actionTypes(harness.dispatch);
    expect(types).not.toContain('siquester/bulkCompressionStarted');
    expect(types).not.toContain('siquester/bulkMediaCompressed');
    expect(types).toContain('siquester/bulkCompressionFailed');

    const finalState = harness.getFinalState();
    expect(finalState.bulkCompression?.phase).toBe('failed');
    expect(finalState.bulkCompression?.failedReason).toBe('compression-disabled');
    expect(finalState.zip?.file('Images/pic.png')).not.toBeNull();
    expect(finalState.zip?.file('Audio/song.mp3')).not.toBeNull();
});

test('all-files-failed transitions to phase "failed" with collected errors', async () => {
    mockedCompressMedia.mockRejectedValue(new Error('encode failed'));

    const harness = createHarness(makeState());
    await compressAllPackageMedia()(harness.dispatch, harness.getState, undefined);

    const types = actionTypes(harness.dispatch);
    expect(types).not.toContain('siquester/bulkMediaCompressed');
    expect(types).toContain('siquester/bulkCompressionFailed');

    const finalState = harness.getFinalState();
    expect(finalState.bulkCompression?.phase).toBe('failed');
    expect(finalState.bulkCompression?.summary?.errors).toHaveLength(2);
    expect(finalState.bulkCompression?.summary?.errors?.[0]).toMatchObject({ name: 'Error', message: 'encode failed' });
    expect(finalState.zip?.file('Images/pic.png')).not.toBeNull();
    expect(finalState.zip?.file('Audio/song.mp3')).not.toBeNull();
});
