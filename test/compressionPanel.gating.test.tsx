/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import React from 'react';
import { screen, within } from '@testing-library/react';
import { renderWithSiquester } from './utils/renderWithSiquester';
import CompressionPanel from '../src/components/siquester/PackageView/components/CompressionPanel';
import localization from '../src/model/resources/localization';

// Mock the barrel to flip feature detection per test.
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

describe('UI does not gate on WebCodecs support (CompressionPanel)', () => {
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
		// Scope per fieldset: exact audio-radio disabled set (old getAllByRole over all 9 only proved >=1 disabled).
		const audioRadios = within(screen.getByRole('group', { name: localization.compressionPresetAudio })).getAllByRole('radio');
		expect(audioRadios).toHaveLength(3);
		expect(audioRadios.every(r => (r as HTMLInputElement).disabled)).toBe(true);
		const imageRadios = within(screen.getByRole('group', { name: localization.compressionPresetImages })).getAllByRole('radio');
		const videoRadios = within(screen.getByRole('group', { name: localization.compressionPresetVideo })).getAllByRole('radio');
		expect(imageRadios.every(r => !(r as HTMLInputElement).disabled)).toBe(true);
		expect(videoRadios.every(r => !(r as HTMLInputElement).disabled)).toBe(true);
		expect(screen.getAllByRole('note').length).toBeGreaterThan(0);
	});
});
