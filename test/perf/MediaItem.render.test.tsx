/**
 * @jest-environment jsdom
 */
import * as React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider } from 'react-redux';
import { configureStore, createSlice } from '@reduxjs/toolkit';
import JSZip from 'jszip';
import MediaItem from '../../src/components/siquester/MediaItem/MediaItem';

const siquesterSlice = createSlice({
    name: 'siquester',
    initialState: {
        zip: new JSZip(),
        zipRevision: 0,
        bulkCompression: { phase: 'idle', total: 0, completed: 0, currentFile: '', cancelRequested: false },
    },
    reducers: {
        bulkCompressionProgress(state, action: { payload: { completed: number; currentFile: string } }) {
            state.bulkCompression = {
                phase: 'running',
                total: 10,
                completed: action.payload.completed,
                currentFile: action.payload.currentFile,
                cancelRequested: false,
            };
        },
    },
});

test('MediaItem does not re-render when an unrelated siquester slice changes', () => {
    const store = configureStore({ reducer: { siquester: siquesterSlice.reducer } });

    let updateCommits = 0;
    const onRender: React.ProfilerOnRenderCallback = (_id, phase) => {
        if (phase === 'update') {
            updateCommits += 1;
        }
    };

    render(
        <Provider store={store}>
            <React.Profiler id="MediaItem" onRender={onRender}>
                {/* isRef=false so the effect's `if (zip && isRef)` guard skips
                    the async zip load — loadItem never runs, the only commits
                    are the ones driven by store updates. */}
                <MediaItem src="external.png" type="image" isRef={false} />
            </React.Profiler>
        </Provider>,
    );

    expect(updateCommits).toBe(0);

    store.dispatch(siquesterSlice.actions.bulkCompressionProgress({ completed: 1, currentFile: 'x.png' }));
    store.dispatch(siquesterSlice.actions.bulkCompressionProgress({ completed: 2, currentFile: 'y.png' }));
    store.dispatch(siquesterSlice.actions.bulkCompressionProgress({ completed: 3, currentFile: 'z.png' }));

    // After the fix: narrow selectors return === across these dispatches,
    // react-redux v8's Object.is check skips the commit, updateCommits stays 0.
    expect(updateCommits).toBe(0);
});
