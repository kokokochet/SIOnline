/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import React from 'react';
import { renderWithSiquester } from './renderWithSiquester';
import { screen } from '@testing-library/react';
import { defaultMediaCompressionState } from '../../src/state/siquesterSlice';

const Probe: React.FC = () => {
	return <div data-testid='probe'>enabled={String(defaultMediaCompressionState.enabled)}</div>;
};

describe('renderWithSiquester harness', () => {
	test('renders a component wrapped in the siquester-only store', () => {
		renderWithSiquester(<Probe />, { siquester: { mediaCompression: { enabled: true, presets: { image: 'low', audio: 'low', video: 'low' } } } });
		expect(screen.getByTestId('probe')).toBeInTheDocument();
		expect(screen.getByTestId('probe').textContent).toBe('enabled=false');
	});
});
