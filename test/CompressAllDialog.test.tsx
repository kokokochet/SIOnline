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
import { createDefaultPackage } from '../src/model/siquester/packageGenerator';
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

/** One image ref so the confirm-screen warning block renders. */
function makePackWithImageRef(): Package {
	const pack = createDefaultPackage({ packageName: '', authorName: '', roundCount: 1, themeCount: 1, questionCount: 1, includeFinalRound: false, finalThemeCount: 0 });
	pack.rounds[0].themes[0].questions[0].params.question = {
		items: [{ type: 'image', value: 'foo.png', isRef: true, placement: 'screen' }],
	};
	return pack;
}

describe('CompressAllDialog', () => {
	test('Cancel button during running requests cancel and shows a Cancelling overlay (no immediate close)', () => {
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

		fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

		expect(screen.getByText(/Cancelling/i)).toBeInTheDocument();
		expect((store.getState() as any).siquester.bulkCompression.cancelRequested).toBe(true);
	});

	test('renders the failed phase with the error message and a Close button', () => {
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

	test('renders the history-impact disclosure in the confirm phase', () => {
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

