/**
 * @jest-environment jsdom
 */
import * as React from 'react';
import { render, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import CompressionPanel from '../src/components/siquester/PackageView/components/CompressionPanel';
import localization from '../src/model/resources/localization';

function renderPanel(open: boolean) {
	// Lazy-require to avoid importing the whole reducer graph at module load.
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const reducer = require('../src/state/siquesterSlice').default;
	const store = configureStore({
		reducer: { siquester: reducer },
	});
	return render(
		<Provider store={store}>
			<CompressionPanel open={open} onClose={jest.fn()} />
		</Provider>,
	);
}

afterEach(cleanup);

describe('CompressionPanel preset groups', () => {
	it('renders nothing when closed', () => {
		const { container } = renderPanel(false);
		expect(container.querySelector('fieldset')).toBeNull();
	});

	it('renders three fieldset groups, one per media type, each with a unique legend', () => {
		renderPanel(true);
		const groups = document.querySelectorAll('fieldset');
		expect(groups.length).toBe(3);

		const legends = Array.from(groups).map((g) => g.querySelector('legend')?.textContent ?? '');
		expect(legends).toContain(localization.compressionPresetImages);
		expect(legends).toContain(localization.compressionPresetAudio);
		expect(legends).toContain(localization.compressionPresetVideo);
		// Unique accessible names -> SR can tell the groups apart.
		expect(new Set(legends).size).toBe(3);
	});

	it('associates each legend with its radio group via the fieldset', () => {
		renderPanel(true);
		const groups = document.querySelectorAll('fieldset');
		expect(groups.length).toBe(3);
		groups.forEach((group) => {
			expect(group.querySelector('legend')).not.toBeNull();
			expect(group.querySelectorAll('input[type="radio"]').length).toBe(3);
		});
	});

	it('uses within() to address one specific group by its legend', () => {
		const { getByRole } = renderPanel(true);
		const imageGroup = getByRole('group', { name: localization.compressionPresetImages });
		expect(within(imageGroup).getByLabelText(localization.compressionLow)).toBeInTheDocument();
	});
});
