/**
 * @jest-environment jsdom
 */
import * as React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider } from 'react-redux';
import { configureStore, createSlice } from '@reduxjs/toolkit';
import JSZip from 'jszip';
import MediaView from '../../src/components/siquester/PackageView/components/MediaView/MediaView';

// MediaView reads `useAppSelector(state => state.siquester.zipRevision)`
// (MediaView.tsx:40), so it must be wrapped in a Redux <Provider> exposing
// `siquester.zipRevision`, or it throws "Could not find react-redux context".
const mediaViewSlice = createSlice({
    name: 'siquester',
    initialState: { zipRevision: 0 },
    reducers: {},
});

test('MediaView does not flash an empty list when mediaFiles are recomputed', async () => {
    const zip = new JSZip();
    zip.file('Images/a.png', new Uint8Array([1]));
    zip.file('Images/b.png', new Uint8Array([2]));

    let emptyStateSeen = false;
    const onRender: React.ProfilerOnRenderCallback = () => {
    };

    const store = configureStore({ reducer: { siquester: mediaViewSlice.reducer } });

    const { container, rerender } = render(
        <Provider store={store}>
            <React.Profiler id="MediaView" onRender={onRender}>
                <MediaView zip={zip} />
            </React.Profiler>
        </Provider>,
    );

    await Promise.resolve();

    // Re-render with the same zip: must not flash empty between renders.
    rerender(
        <Provider store={store}>
            <React.Profiler id="MediaView" onRender={onRender}>
                <MediaView zip={zip} />
            </React.Profiler>
        </Provider>,
    );
    await Promise.resolve();

    const emptyState = container.querySelector('.mediaView__empty');
    if (emptyState !== null) {
        emptyStateSeen = true;
    }
    expect(emptyStateSeen).toBe(false);
});
