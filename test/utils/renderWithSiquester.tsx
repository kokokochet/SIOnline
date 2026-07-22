import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { render, RenderResult } from '@testing-library/react';
import { siquesterSlice, SIQuesterState } from '../../src/state/siquesterSlice';

export interface RenderWithSiquesterOptions {
	/** Partial override applied on top of the slice's initial state. */
	siquester?: Partial<SIQuesterState>;
}

export interface RenderWithSiquesterResult extends RenderResult {
	store: ReturnType<typeof createStore>;
}

function createStore(siquesterOverride: Partial<SIQuesterState> | undefined) {
	const preloadedState = {
		siquester: {
			...siquesterSlice.getInitialState(),
			...siquesterOverride,
		} as SIQuesterState,
	};
	return configureStore({
		reducer: { siquester: siquesterSlice.reducer },
		preloadedState,
	});
}

/**
 * Renders a component inside a Redux <Provider> whose store carries ONLY the
 * siquester slice. Use for components that call useAppSelector(state =>
 * state.siquester.*) — the real rootReducer is intentionally avoided because
 * store.ts constructs browser/network clients at import time.
 */
export function renderWithSiquester(
	ui: React.ReactElement,
	options: RenderWithSiquesterOptions = {},
): RenderWithSiquesterResult {
	const store = createStore(options.siquester);
	const utils = render(<Provider store={store}>{ui}</Provider>);
	return { ...utils, store };
}
