/**
 * @jest-environment jsdom
 */
import * as React from 'react';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import CompressAllDialog from '../src/components/siquester/PackageView/components/CompressAllDialog';
import localization from '../src/model/resources/localization';

function renderDialogWithBulk(bulk: unknown) {
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const reducer = require('../src/state/siquesterSlice').default;
	const store = configureStore({
		reducer: { siquester: reducer },
		preloadedState: {
			siquester: {
				...(reducer(undefined, { type: '@@INIT' }) as object),
				bulkCompression: bulk,
			},
		},
	});
	return render(
		<Provider store={store}>
			<CompressAllDialog />
		</Provider>,
	);
}

afterEach(cleanup);

describe('CompressAllDialog live regions', () => {
	it('announces the plural-aware done summary from a live region', () => {
		renderDialogWithBulk({
			phase: 'done',
			total: 2,
			completed: 2,
			currentFile: null,
			cancelRequested: false,
			// errors is required by BulkCompressionSummary; omitting it would crash before the summary renders.
			summary: { compressedCount: 2, skippedCount: 0, savedBytes: 1572864, errors: [] },
		});
		// compressedCount=2 must pick the plural FEW form.
		const statuses = document.querySelectorAll('[role="status"][aria-live="polite"]');
		const doneStatus = Array.from(statuses).find((s) => /files?/i.test(s.textContent ?? ''));
		expect(doneStatus).toBeDefined();
		expect(doneStatus!.textContent).toContain('files');
	});

	it('announces cancellation from a live region', () => {
		renderDialogWithBulk({
			phase: 'cancelled',
			total: 5,
			completed: 2,
			currentFile: null,
			cancelRequested: true,
			summary: null,
		});
		const status = document.querySelector('[role="status"][aria-live="polite"]');
		expect(status).not.toBeNull();
		expect(status!.textContent).toContain(localization.compressionCancelled);
	});
});
