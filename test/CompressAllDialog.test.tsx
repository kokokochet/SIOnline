/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import reducer, {
	SIQuesterState,
	bulkCompressionStarted,
	defaultMediaCompressionState,
} from '../src/state/siquesterSlice';
import { Package } from '../src/model/siquester/package';
import CompressAllDialog from '../src/components/siquester/PackageView/components/CompressAllDialog';

function makeStore(overrides: Partial<SIQuesterState> = {}): ReturnType<typeof configureStore> {
	return configureStore({
		reducer: { siquester: reducer },
		preloadedState: {
			siquester: {
				mediaCompression: defaultMediaCompressionState,
				...overrides,
			} as SIQuesterState,
		},
	});
}

/** Minimal package referencing one image, so the confirm screen shows its warning block. */
function makePackWithImageRef(): Package {
	return {
		name: 'Test',
		version: '1',
		id: 'test',
		restriction: '',
		date: '',
		publisher: '',
		difficulty: 0,
		language: 'ru',
		tags: [],
		isQualityMarked: false,
		rounds: [
			{
				name: 'Round',
				type: 'standart',
				themes: [
					{
						name: 'Theme',
						questions: [
							{
								price: 1,
								params: {
									question: {
										items: [
											{ type: 'image', value: 'foo.png', isRef: true, placement: 'screen' },
										],
									},
								},
								right: { answer: [] },
							},
						],
					},
				],
			},
		],
	};
}

describe('CompressAllDialog', () => {
	test('Escape during running requests cancel and shows a Cancelling overlay (no immediate close)', () => {
		const store = makeStore({});
		render(
			<Provider store={store}>
				<CompressAllDialog />
			</Provider>,
		);

		act(() => {
			store.dispatch(bulkCompressionStarted({ total: 3 }));
		});
		expect(screen.getByRole('progressbar')).toBeInTheDocument();

		// Escape triggers onClose → during running that dispatches the cancel thunk.
		fireEvent.keyDown(window, { key: 'Escape' });

		// Still mounted (phase is still 'running'); overlay visible.
		expect(screen.getByText(/Cancelling/i)).toBeInTheDocument();
		expect((store.getState() as any).siquester.bulkCompression.cancelRequested).toBe(true);
	});

	test('renders the failed phase with the error message and a Close button', () => {
		// T17's bulkCompressionFailed reducer is not landed yet; set the failed
		// phase directly via preloadedState to exercise the failed UI branch.
		const store = makeStore({
			bulkCompression: {
				phase: 'failed',
				total: 0,
				completed: 0,
				cancelRequested: false,
				failedReason: 'disk full',
			},
		});
		render(
			<Provider store={store}>
				<CompressAllDialog />
			</Provider>,
		);

		expect(screen.getByText(/disk full/)).toBeInTheDocument();
		expect(screen.getAllByRole('button', { name: /close/i }).length).toBeGreaterThanOrEqual(1);
	});

	test('renders the history-impact disclosure in the confirm phase (T42)', () => {
		const store = makeStore({
			pack: makePackWithImageRef(),
			bulkCompression: { phase: 'confirm', total: 1, completed: 0, cancelRequested: false },
		});
		render(
			<Provider store={store}>
				<CompressAllDialog />
			</Provider>,
		);

		expect(screen.getByText(/clear your Redo history/i)).toBeInTheDocument();
	});
});

describe('CompressAllDialog unmount', () => {
	test('unmounting while running cancels the in-flight run and discards staged results', () => {
		const store = makeStore({});
		const { unmount } = render(
			<Provider store={store}>
				<CompressAllDialog />
			</Provider>,
		);

		act(() => {
			store.dispatch(bulkCompressionStarted({ total: 5 }));
		});
		expect((store.getState() as any).siquester.bulkCompression.cancelRequested).toBe(false);

		unmount();

		const bulk = (store.getState() as any).siquester.bulkCompression;
		expect(bulk.cancelRequested).toBe(true);
	});

	test('unmounting while NOT running does not spuriously cancel', () => {
		const store = makeStore({});
		const { unmount } = render(
			<Provider store={store}>
				<CompressAllDialog />
			</Provider>,
		);

		// confirm phase — no run started.
		unmount();

		// No bulk state was ever created; nothing to cancel.
		expect((store.getState() as any).siquester.bulkCompression).toBeUndefined();
	});
});
