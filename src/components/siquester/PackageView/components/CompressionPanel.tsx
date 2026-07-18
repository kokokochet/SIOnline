import React from 'react';
import { useAppDispatch, useAppSelector } from '../../../../state/hooks';
import {
	setMediaCompressionEnabled,
	setMediaCompressionPreset,
} from '../../../../state/siquesterSlice';
import localization from '../../../../model/resources/localization';
import { CompressionPreset } from '../../../../utils/mediaCompression/compressionTypes';
import Popup from '../../../common/Popup/Popup';

import './CompressionPanel.scss';

interface CompressionPanelProps {
	open: boolean;
	onClose: () => void;
}

/**
 * Popover panel for media compression settings. Renders a toggle (on/off) and
 * a Low/Medium/High quality preset radio group. Mounted in the PackageView
 * toolbar; the trigger button lives in PackageView and toggles `open`.
 */
const CompressionPanel: React.FC<CompressionPanelProps> = ({ open, onClose }) => {
	const appDispatch = useAppDispatch();
	const mediaCompression = useAppSelector(state => state.siquester.mediaCompression ?? { enabled: true, preset: 'medium' as CompressionPreset });

	const presets: ReadonlyArray<{ value: CompressionPreset; label: string }> = [
		{ value: 'low', label: localization.compressionLow },
		{ value: 'medium', label: localization.compressionMedium },
		{ value: 'high', label: localization.compressionHigh },
	];

	if (!open) {
		return null;
	}

	return (
		<Popup className='compressionPanel' onClose={onClose}>
			<div className='compressionPanel__toggle'>
				<input
					id='compressMedia'
					type='checkbox'
					checked={mediaCompression.enabled}
					onChange={() => appDispatch(setMediaCompressionEnabled(!mediaCompression.enabled))}
				/>
				<label htmlFor='compressMedia'>{localization.compressMedia}</label>
			</div>

			<div className={`compressionPanel__presets ${!mediaCompression.enabled ? 'compressionPanel__presets--disabled' : ''}`}>
				<div className='compressionPanel__title'>{localization.compressionSettings}</div>
				{presets.map(({ value, label }) => (
					<label key={value} className='compressionPanel__preset'>
						<input
							type='radio'
							name='compressionPreset'
							value={value}
							checked={mediaCompression.preset === value}
							disabled={!mediaCompression.enabled}
							onChange={() => appDispatch(setMediaCompressionPreset(value))}
						/>
						{label}
					</label>
				))}
			</div>
		</Popup>
	);
};

export default CompressionPanel;
