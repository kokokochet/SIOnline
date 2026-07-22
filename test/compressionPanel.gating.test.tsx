/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithSiquester } from './utils/renderWithSiquester';
import CompressionPanel from '../src/components/siquester/PackageView/components/CompressionPanel';
import localization from '../src/model/resources/localization';

// Mock the barrel so we can flip feature detection per test without touching globals.
jest.mock('../src/utils/mediaCompression', () => {
	const actual = jest.requireActual('../src/utils/mediaCompression');
	return {
		...actual,
		__esModule: true,
		isAudioCompressionSupported: jest.fn(() => true),
		isVideoCompressionSupported: jest.fn(() => true),
	};
});

import { isAudioCompressionSupported, isVideoCompressionSupported } from '../src/utils/mediaCompression';
const audioSupported = isAudioCompressionSupported as jest.Mock;
const videoSupported = isVideoCompressionSupported as jest.Mock;

function renderPanel() {
	return renderWithSiquester(<CompressionPanel open={true} onClose={() => {}} />, {
		siquester: { mediaCompression: { enabled: true, presets: { image: 'medium', audio: 'low', video: 'low' } } },
	});
}

describe('media-compression-review MAJOR: UI does not gate on WebCodecs support (CompressionPanel)', () => {
	beforeEach(() => {
		audioSupported.mockReturnValue(true);
		videoSupported.mockReturnValue(true);
	});

	test('renders the audio-not-supported notice when AudioEncoder is unavailable', () => {
		audioSupported.mockReturnValue(false);
		renderPanel();
		expect(screen.getByText(/Audio compression is not supported/i)).toBeInTheDocument();
	});

	test('renders the video-not-supported notice when VideoEncoder is unavailable', () => {
		videoSupported.mockReturnValue(false);
		renderPanel();
		expect(screen.getByText(/Video compression is not supported/i)).toBeInTheDocument();
	});

	test('renders no support notice when both encoders are available', () => {
		renderPanel();
		expect(screen.queryByText(/is not supported in this browser/i)).toBeNull();
	});

	test('disables the audio preset radios when audio is unsupported', () => {
		audioSupported.mockReturnValue(false);
		renderPanel();
		const audioRadios = screen.getAllByRole('radio', { name: /Low|Medium|High/i });
		// All radios live in one group per type; we assert at least one radio is
		// disabled and that the notice carries role=note.
		expect(audioRadios.some(r => (r as HTMLInputElement).disabled)).toBe(true);
		expect(screen.getAllByRole('note').length).toBeGreaterThan(0);
	});
});
