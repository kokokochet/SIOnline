import reducer, {
    SIQuesterState,
    bulkCompressionStarted,
    bulkCompressionFinished,
    bulkCompressionCancelled,
    BulkCompressionSummary,
} from '../src/state/siquesterSlice';

const summary: BulkCompressionSummary = { compressedCount: 5, skippedCount: 1, savedBytes: 12345, errors: [] };

function runningState(): SIQuesterState {
    return {
        bulkCompression: {
            phase: 'running',
            total: 10,
            completed: 7,
            currentFile: 'pic.png',
            cancelRequested: true,
        },
    } as SIQuesterState;
}

describe('bulkCompressionFinished gate (running → done only)', () => {
    test('transitions running → done and writes summary', () => {
        const state = reducer(runningState(), bulkCompressionFinished({ summary }));
        expect(state.bulkCompression?.phase).toBe('done');
        expect(state.bulkCompression?.completed).toBe(10);
        expect(state.bulkCompression?.summary).toEqual(summary);
        // currentFile cleared on Finished; pinned as a regression guard.
        expect(state.bulkCompression?.currentFile).toBeUndefined();
    });

    test('does NOT clobber an already-cancelled state (late Finished after Cancelled)', () => {
        const cancelled = reducer(runningState(), bulkCompressionCancelled());
        const summaryBefore = cancelled.bulkCompression?.summary;
        const completedBefore = cancelled.bulkCompression?.completed;

        const afterLateFinished = reducer(cancelled, bulkCompressionFinished({ summary }));

        expect(afterLateFinished.bulkCompression?.phase).toBe('cancelled');
        expect(afterLateFinished.bulkCompression?.summary).toBe(summaryBefore);
        expect(afterLateFinished.bulkCompression?.completed).toBe(completedBefore);
    });

    test('does NOT clobber an already-done state (double Finished)', () => {
        const done = reducer(runningState(), bulkCompressionFinished({ summary }));
        const firstSummary = done.bulkCompression?.summary;

        const otherSummary: BulkCompressionSummary = { compressedCount: 0, skippedCount: 0, savedBytes: 0, errors: [] };
        const doubleDone = reducer(done, bulkCompressionFinished({ summary: otherSummary }));

        expect(doubleDone.bulkCompression?.phase).toBe('done');
        expect(doubleDone.bulkCompression?.summary).toBe(firstSummary);
    });
});

describe('bulkCompressionCancelled gate (running → cancelled only) + stale-field cleanup', () => {
    test('transitions running → cancelled, clears cancelRequested and currentFile', () => {
        const state = reducer(runningState(), bulkCompressionCancelled());
        expect(state.bulkCompression?.phase).toBe('cancelled');
        expect(state.bulkCompression?.cancelRequested).toBe(false);
        expect(state.bulkCompression?.currentFile).toBeUndefined();
    });

    test('keeps completed as informational (count at termination)', () => {
        const state = reducer(runningState(), bulkCompressionCancelled());
        expect(state.bulkCompression?.completed).toBe(7);
    });

    test('does NOT clobber an already-done state (late Cancelled after Finished)', () => {
        const done = reducer(runningState(), bulkCompressionFinished({ summary }));
        const summaryBefore = done.bulkCompression?.summary;

        const afterLateCancel = reducer(done, bulkCompressionCancelled());

        expect(afterLateCancel.bulkCompression?.phase).toBe('done');
        expect(afterLateCancel.bulkCompression?.summary).toBe(summaryBefore);
    });
});

test('both reducers are no-ops when bulkCompression is undefined', () => {
    const empty = {} as SIQuesterState;
    expect(reducer(empty, bulkCompressionFinished({ summary })).bulkCompression).toBeUndefined();
    expect(reducer(empty, bulkCompressionCancelled()).bulkCompression).toBeUndefined();
});
