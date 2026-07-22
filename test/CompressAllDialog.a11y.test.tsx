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

describe('media-compression-review MAJOR a11y — CompressAllDialog live regions', () => {
	it('announces the plural-aware done summary from a live region', () => {
		renderDialogWithBulk({
			phase: 'done',
			total: 2,
			completed: 2,
			currentFile: null,
			cancelRequested: false,
			// `errors` is required by BulkCompressionSummary and read by the
			// post-T49/T50 partial-warning block; the plan's verbatim fixture omits
			// it, which would crash the render before the T55 plural/localized
			// summary is reached. Adding [] is the minimal reconciliation so the
			// test exercises the T55 logic (all plan assertions unchanged).
			summary: { compressedCount: 2, skippedCount: 0, savedBytes: 1572864, errors: [] },
		});
		// Phase 2 already wraps the summary in role=status / aria-live=polite, so
		// the live region is a regression guard. The genuine red->green here is
		// the plural form: compressedCount=2 must render the FEW form -> plural
		// "files" (en). Phase 2's code hardcodes the base key (singular "file"
		// after T51), so it renders "file" -> this assertion fails until Step 5.
		const statuses = document.querySelectorAll('[role="status"][aria-live="polite"]');
		expect(statuses.length).toBeGreaterThan(0);
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

	it('renders as a modal dialog (role=dialog, aria-modal)', () => {
		renderDialogWithBulk({
			phase: 'confirm',
			total: 3,
			completed: 0,
			currentFile: null,
			cancelRequested: false,
			summary: null,
		});
		const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
		expect(dialog).not.toBeNull();
	});
});
