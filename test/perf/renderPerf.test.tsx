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
import MediaItem from '../../src/components/siquester/MediaItem/MediaItem';
import { renderWithSiquester } from '../utils/renderWithSiquester';

test('MediaView does not flash an empty list when mediaFiles are recomputed', async () => {
	const zip = new JSZip();
	zip.file('Images/a.png', new Uint8Array([1]));
	zip.file('Images/b.png', new Uint8Array([2]));

	const onRender: React.ProfilerOnRenderCallback = () => {
	};

	// MediaView reads state.siquester.zipRevision, present on the real slice.
	const { container, rerender, store } = renderWithSiquester(
		<React.Profiler id="MediaView" onRender={onRender}>
			<MediaView zip={zip} />
		</React.Profiler>,
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

	expect(container.querySelector('.mediaView__empty')).toBeNull();
});

// MediaItem uses a bespoke slice so it can dispatch bulkCompressionProgress and
// assert no commit occurs — the real slice's action would carry other effects.
const mediaItemSlice = createSlice({
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
	const store = configureStore({ reducer: { siquester: mediaItemSlice.reducer } });

	let updateCommits = 0;
	const onRender: React.ProfilerOnRenderCallback = (_id, phase) => {
		if (phase === 'update') {
			updateCommits += 1;
		}
	};

	render(
		<Provider store={store}>
			<React.Profiler id="MediaItem" onRender={onRender}>
				{/* isRef=false skips the `if (zip && isRef)` async zip load,
				    so commits are driven only by store updates. */}
				<MediaItem src="external.png" type="image" isRef={false} />
			</React.Profiler>
		</Provider>,
	);

	expect(updateCommits).toBe(0);

	store.dispatch(mediaItemSlice.actions.bulkCompressionProgress({ completed: 1, currentFile: 'x.png' }));
	store.dispatch(mediaItemSlice.actions.bulkCompressionProgress({ completed: 2, currentFile: 'y.png' }));
	store.dispatch(mediaItemSlice.actions.bulkCompressionProgress({ completed: 3, currentFile: 'z.png' }));

	// Narrow selectors return === across these dispatches; react-redux v8's
	// Object.is check skips the commit, so updateCommits stays 0.
	expect(updateCommits).toBe(0);
});
