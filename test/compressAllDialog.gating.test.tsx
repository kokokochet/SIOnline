/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithSiquester } from './utils/renderWithSiquester';
import CompressAllDialog from '../src/components/siquester/PackageView/components/CompressAllDialog';
import { createDefaultPackage } from '../src/model/siquester/packageGenerator';

jest.mock('../src/utils/mediaCompression', () => {
	const actual = jest.requireActual('../src/utils/mediaCompression');
	return {
		...actual,
		__esModule: true,
		isAudioCompressionSupported: jest.fn(() => true),
		isVideoCompressionSupported: jest.fn(() => true),
	};
});

import { isAudioCompressionSupported } from '../src/utils/mediaCompression';
const audioSupported = isAudioCompressionSupported as jest.Mock;

function makePackWithAudio() {
	const pack = createDefaultPackage({
		packageName: '', authorName: '', roundCount: 1, themeCount: 1, questionCount: 1,
		includeFinalRound: false, finalThemeCount: 0,
	});
	pack.rounds[0].themes[0].questions[0].params.question = {
		items: [{ type: 'audio', value: 'song.mp3', isRef: true, placement: 'screen' }],
	};
	return pack;
}

function renderDialog(pack: ReturnType<typeof createDefaultPackage>) {
	return renderWithSiquester(<CompressAllDialog />, {
		siquester: {
			pack,
			bulkCompression: { phase: 'confirm', total: 1, completed: 0, cancelRequested: false },
			mediaCompression: { enabled: true, presets: { image: 'medium', audio: 'low', video: 'low' } },
		},
	});
}

describe('CompressAllDialog does not warn on unsupported codec', () => {
	test('shows the audio-not-supported warning when AudioEncoder is missing and audio files exist', () => {
		audioSupported.mockReturnValue(false);
		renderDialog(makePackWithAudio());
		expect(screen.getByText(/Audio compression is not supported/i)).toBeInTheDocument();
	});

	test('shows no warning when audio is supported', () => {
		audioSupported.mockReturnValue(true);
		renderDialog(makePackWithAudio());
		expect(screen.queryByText(/is not supported in this browser/i)).toBeNull();
	});
});
