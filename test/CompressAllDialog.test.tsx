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
});
