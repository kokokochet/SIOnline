import JSZip from 'jszip';
import reducer, {
    bulkCompressionCancelRequested,
    bulkCompressionDialogOpened,
    compressAllPackageMedia,
    defaultMediaCompressionState,
    SIQuesterState,
    abortActiveBulkCompression,
} from '../src/state/siquesterSlice';
import { createDefaultPackage } from '../src/model/siquester/packageGenerator';
import { compressMedia } from '../src/utils/mediaCompression';
import { validateMediaReferences } from '../src/utils/mediaCompression/compressPackageMedia';

jest.mock('../src/utils/mediaCompression', () => {
    const actual = jest.requireActual('../src/utils/mediaCompression');
    return { ...actual, compressMedia: jest.fn() };
});

const mockedCompressMedia = compressMedia as jest.MockedFunction<typeof compressMedia>;

function makeState(): SIQuesterState {
    const zip = new JSZip();
    zip.file('Images/pic.png', new Uint8Array([1, 2, 3]));
    zip.file('Audio/song.mp3', new Uint8Array([4, 5, 6]));

    const pack = createDefaultPackage({
        packageName: '',
        authorName: '',
        roundCount: 1,
        themeCount: 1,
        questionCount: 1,
        includeFinalRound: false,
        finalThemeCount: 0,
    });

    pack.rounds[0].themes[0].questions[0].params.question = {
        items: [
            { type: 'image', value: 'pic.png', isRef: true, placement: 'screen' },
            { type: 'audio', value: 'song.mp3', isRef: true, placement: 'screen' },
        ],
    };

    return { pack, zip, mediaCompression: defaultMediaCompressionState, zipRevision: 0, history: { past: [], future: [] } };
}

/** Mini-store: dispatched actions are applied through the real reducer. */
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
    // Package integrity: every referenced file exists in the zip.
    expect(validateMediaReferences(finalState.pack!, finalState.zip!)).toEqual([]);
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
    // Failed file: original entry and reference kept.
    expect(finalState.zip?.file('Images/pic.png')).not.toBeNull();
    expect(finalState.pack!.rounds[0].themes[0].questions[0].params.question!.items[0].value).toBe('pic.png');
    // Successful file applied.
    expect(finalState.zip?.file('Audio/song.opus')).not.toBeNull();
    expect(validateMediaReferences(finalState.pack!, finalState.zip!)).toEqual([]);
    expect(finalState.bulkCompression?.summary).toEqual({ compressedCount: 1, skippedCount: 1, savedBytes: 99, errors: [] });
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

        // beforeFirstFile pins the in-loop cancel check; afterLastFile pins the
        // post-loop check (makeState has 2 referenced files).
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

test('does not apply staged results when the package is swapped mid-run', async () => {
    mockedCompressMedia.mockImplementation(async (file: File) => ({
        data: new Uint8Array([9, 9]),
        fileName: `${file.name.replace(/\.[^.]+$/, '')}.out`,
        originalSize: 100,
        compressedSize: 2,
        wasCompressed: true,
    }));

    let state = makeState();
    const dispatch = jest.fn((action: any) => {
        state = reducer(state, action);

        // Simulate opening another package mid-run (the dialog is not modal).
        if (action.type === 'siquester/bulkCompressionProgress') {
            state = { ...state, zip: new JSZip() };
        }

        return action;
    });
    const getState = () => ({ siquester: state });

    await compressAllPackageMedia()(dispatch, getState, undefined);

    const types = actionTypes(dispatch);
    expect(types).toContain('siquester/bulkCompressionCancelled');
    expect(types).not.toContain('siquester/bulkMediaCompressed');
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
    // The successful file was applied: new entry written, old entry removed.
    expect(finalState.zip?.file('Images/pic.jpg')).not.toBeNull();
    expect(finalState.zip?.file('Images/pic.png')).toBeNull();
    expect(finalState.bulkCompression?.summary).toEqual({ compressedCount: 1, skippedCount: 1, savedBytes: 99, errors: [] });
    // The missing-file reference was pre-existing; it is left as-is.
    expect(validateMediaReferences(finalState.pack!, finalState.zip!)).toEqual(['audio:song.mp3']);
});

test('rename plan resolves a literal-% collision without breaking the package', async () => {
    // pic.out's compressed target name literally equals the URI-encoded form of
    // the existing 'my photo.png' entry. planRenames must bump pic to a unique
    // name so the apply cannot delete my photo's fresh entry.
    const initial = makeState();
    initial.zip!.file('Images/my%20photo.png', new Uint8Array([7, 7, 7]));
    initial.pack!.rounds[0].themes[0].questions[0].params.question!.items.push(
        { type: 'image', value: 'my photo.png', isRef: true, placement: 'screen' },
    );

    let call = 0;
    mockedCompressMedia.mockImplementation(async (file: File) => {
        call += 1;
        // pic.png -> 'my%20photo.png' (collides with the encoded form of 'my photo.png')
        // my photo.png -> 'my photo.jpg'
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
    expect(validateMediaReferences(finalState.pack!, finalState.zip!)).toEqual([]);
    // makeState provides pic.png + song.mp3, and this test adds 'my photo.png';
    // all three are compressed (the mock's else branch also catches song.mp3).
    expect(finalState.bulkCompression?.summary?.compressedCount).toBe(3);
});

test('rejected thunk after Started transitions phase to cancelled and applies nothing', async () => {
    // The thunk's only explicit throw is BEFORE bulkCompressionStarted (the
    // !zip/!pack guard). If anything throws AFTER Started — a future refactor,
    // an Immer invariant, an OOM in a pure helper — phase would stick at
    // 'running' forever (Cancel only flips cancelRequested, which a dead thunk
    // never reads). The rejected extraReducer closes that gap. We exercise it
    // directly because forcing a real post-Started throw is brittle: the
    // per-file try/catch swallows compressMedia rejections, so even all-failing
    // mocks reach Finished. Dispatching the rejected lifecycle action through
    // the real reducer is the deterministic way to cover running->cancelled.
    const { compressAllPackageMedia: thunk } = await import('../src/state/siquesterSlice');

    let state: SIQuesterState = makeState();
    const dispatch = jest.fn((action: any) => {
        state = reducer(state, action);
        return action;
    });
    const getState = () => ({ siquester: state });

    // Drive the thunk normally so Started dispatches against the real reducer,
    // then simulate a mid-run rejection via the rejected action creator.
    state = reducer(state, { type: 'siquester/bulkCompressionStarted', payload: { total: 2 } });
    expect(state.bulkCompression?.phase).toBe('running');

    // thunk.rejected signature in RTK 2.x: (error, requestId, arg, payload?, meta?).
    // arg is void for this thunk, so undefined.
    const rejectedAction = thunk.rejected(new Error('unexpected'), 'fakeReqId', undefined);
    state = reducer(state, rejectedAction as any);

    expect(state.bulkCompression?.phase).toBe('cancelled');
    // All-or-nothing: bulkMediaCompressed never dispatched, package untouched.
    expect(state.zip?.file('Images/pic.png')).not.toBeNull();
    expect(state.zip?.file('Audio/song.mp3')).not.toBeNull();
    expect(state.zipRevision).toBe(0);
});

test('re-entry guard: a second invocation while phase is running is skipped and leaves the run untouched', async () => {
    // The bug: while a run is in flight (phase === 'running'), reopening the
    // panel and clicking Start again would dispatch a SECOND concurrent thunk
    // against the same zip/pack. The condition guard must refuse the second
    // invocation deterministically.
    mockedCompressMedia.mockImplementation(async (file: File) => ({
        data: new Uint8Array([9, 9]),
        fileName: `${file.name.replace(/\.[^.]+$/, '')}.out`,
        originalSize: 100,
        compressedSize: 2,
        wasCompressed: true,
    }));

    let state = makeState();
    // Simulate an in-flight run: a first thunk has already dispatched Started.
    state = reducer(state, { type: 'siquester/bulkCompressionStarted', payload: { total: 2 } });
    expect(state.bulkCompression?.phase).toBe('running');

    const dispatch = jest.fn((action: any) => {
        state = reducer(state, action);
        return action;
    });
    const getState = () => ({ siquester: state });

    await compressAllPackageMedia()(dispatch, getState, undefined);

    // The thunk body never executed: compressMedia was not called, and no
    // Started/Progress/Finished/MediaCompressed actions were dispatched by the
    // second invocation.
    expect(mockedCompressMedia).not.toHaveBeenCalled();
    const types = actionTypes(dispatch);
    expect(types).not.toContain('siquester/bulkCompressionStarted');
    expect(types).not.toContain('siquester/bulkCompressionProgress');
    expect(types).not.toContain('siquester/bulkMediaCompressed');
    expect(types).not.toContain('siquester/bulkCompressionFinished');

    // The in-flight run's phase is NOT clobbered to 'cancelled' by the
    // condition-rejection (the rejected reducer must ignore condition-rejections).
    expect(state.bulkCompression?.phase).toBe('running');
    expect(state.zip?.file('Images/pic.png')).not.toBeNull();
    expect(state.zip?.file('Audio/song.mp3')).not.toBeNull();
    expect(state.zipRevision).toBe(0);
});

test('bulkCompressionDialogOpened is a no-op while a run is in flight', () => {
    // Defense in depth: even if the UI re-dispatches this action mid-run,
    // it must not reset phase/cancelRequested and undermine the in-flight run.
    let state = makeState();
    state = reducer(state, { type: 'siquester/bulkCompressionStarted', payload: { total: 3 } });
    state = reducer(state, bulkCompressionCancelRequested());
    expect(state.bulkCompression?.phase).toBe('running');
    expect(state.bulkCompression?.cancelRequested).toBe(true);

    state = reducer(state, bulkCompressionDialogOpened());

    expect(state.bulkCompression?.phase).toBe('running');
    expect(state.bulkCompression?.cancelRequested).toBe(true);
    expect(state.bulkCompression?.total).toBe(3);
});

test('aborting mid-file cancels within a tick instead of encoding to completion', async () => {
    // Mock compressMedia as slow (30s) but responsive to the AbortSignal.
    mockedCompressMedia.mockImplementation(
        async (_file: File, _type: any, _opts: any, signal?: AbortSignal) => {
            // Mirror the real compressMedia pre-check: an already-aborted signal
            // rejects immediately (the abort may race ahead of this call because
            // the thunk yields at the JSZip entry read before reaching us).
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
            // Should never reach here within the test timeout.
            return { data: new Uint8Array([1]), fileName: 'x.out', originalSize: 10, compressedSize: 1, wasCompressed: true };
        },
    );

    const harness = createHarness(makeState());
    const started = Date.now();

    // Kick off the thunk; once Started dispatches, abort.
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
    // Package untouched.
    expect(harness.getFinalState().zip?.file('Images/pic.png')).not.toBeNull();
});

test('opening another package mid-run cancels instead of wiping bulkCompression to undefined', async () => {
    // Slow compressMedia so the run is in-flight when openFile.fulfilled fires.
    let resolveFirst: () => void;
    mockedCompressMedia.mockImplementation(async (_file: File, _type: any, _opts: any, signal?: AbortSignal) => {
        // The abort is triggered inside the progress-dispatch callback, which
        // runs synchronously BEFORE compressMedia is reached (the thunk awaits
        // entry.async between them). By the time we get here the signal is
        // already aborted, so a listener-only mock would miss it — check the
        // flag upfront, matching the real compressMedia contract.
        if (signal?.aborted) {
            throw new DOMException('Aborted', 'AbortError');
        }
        await new Promise<void>((resolve, reject) => {
            resolveFirst = resolve;
            const t = setTimeout(resolve, 30_000);
            signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
        });
        return { data: new Uint8Array([1]), fileName: 'x.out', originalSize: 10, compressedSize: 1, wasCompressed: true };
    });

    let state = makeState();
    const dispatch = jest.fn((action: any) => {
        state = reducer(state, action);
        // Simulate openFile.fulfilled landing while the first file encodes.
        if (action.type === 'siquester/bulkCompressionProgress') {
            state = reducer(state, {
                type: 'siquester/openFile/fulfilled',
                payload: { zip: new JSZip(), pack: createDefaultPackage({ packageName: '', authorName: '', roundCount: 1, themeCount: 1, questionCount: 1, includeFinalRound: false, finalThemeCount: 0 }) },
            });
            // CRITICAL — deadlock fix: the real `openFile` thunk body calls
            // `abortActiveBulkCompression()` at its top (Step 3b). Simulating
            // only the `fulfilled` reducer does NOT run the thunk body, so the
            // mocked compressMedia would hang on its 30s timer forever (test
            // deadlock). Invoke the abort here to unblock the signal race so
            // the test can settle.
            abortActiveBulkCompression();
        }
        return action;
    });
    const getState = () => ({ siquester: state });

    await compressAllPackageMedia()(dispatch, getState, undefined);

    // Old behaviour: bulkCompression became undefined → isCancelRequested() false.
    // New behaviour: cancelRequested true, phase cancelled.
    expect(state.bulkCompression?.phase).toBe('cancelled');
    expect(state.bulkCompression?.cancelRequested).toBe(true);
    const types = actionTypes(dispatch);
    expect(types).toContain('siquester/bulkCompressionCancelled');
    expect(types).not.toContain('siquester/bulkMediaCompressed');

    // Let the mocked compressMedia settle so jest doesn't complain about stray ticks.
    if (resolveFirst!) resolveFirst!();
});
