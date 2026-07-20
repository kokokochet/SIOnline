import React from 'react';
import { useAppDispatch, useAppSelector } from '../../../../state/hooks';
import {
	bulkCompressionDialogOpened,
	defaultMediaCompressionState,
	setMediaCompressionEnabled,
	setMediaCompressionPreset,
} from '../../../../state/siquesterSlice';
import localization from '../../../../model/resources/localization';
import { CompressibleMediaType, CompressionPreset } from '../../../../utils/mediaCompression/compressionTypes';
import Popup from '../../../common/Popup/Popup';

import './CompressionPanel.scss';

interface CompressionPanelProps {
	open: boolean;
	onClose: () => void;
	style?: React.CSSProperties;
}

/**
 * Popover panel for media compression settings. Renders a toggle (on/off) and
 * per-media-type Low/Medium/High preset radio groups. Mounted in the PackageView
 * toolbar; the trigger button lives in PackageView and toggles `open`.
 */
const CompressionPanel: React.FC<CompressionPanelProps> = ({ open, onClose, style }) => {
	const appDispatch = useAppDispatch();
	const mediaCompression = useAppSelector(state => state.siquester.mediaCompression ?? defaultMediaCompressionState);

	const presets: ReadonlyArray<{ value: CompressionPreset; label: string }> = [
		{ value: 'low', label: localization.compressionLow },
		{ value: 'medium', label: localization.compressionMedium },
		{ value: 'high', label: localization.compressionHigh },
	];

	const mediaTypes: ReadonlyArray<{ type: CompressibleMediaType; label: string }> = [
		{ type: 'image', label: localization.images },
		{ type: 'audio', label: localization.audio },
		{ type: 'video', label: localization.video },
	];

	if (!open) {
		return null;
	}

	return (
		<Popup className='compressionPanel' onClose={onClose} style={style}>
			<div className='compressionPanel__toggle'>
				<input
					id='compressMedia'
					type='checkbox'
					checked={mediaCompression.enabled}
					onChange={() => appDispatch(setMediaCompressionEnabled(!mediaCompression.enabled))}
				/>
				<label htmlFor='compressMedia'>{localization.compressMedia}</label>
			</div>

			{mediaTypes.map(({ type, label }) => (
				<div
					key={type}
					className={`compressionPanel__presets ${!mediaCompression.enabled ? 'compressionPanel__presets--disabled' : ''}`}
				>
					<div className='compressionPanel__title'>{label}</div>
					{presets.map(({ value, label: presetLabel }) => (
						<label key={value} className='compressionPanel__preset'>
							<input
								type='radio'
								name={`compressionPreset-${type}`}
								value={value}
								checked={mediaCompression.presets[type] === value}
								disabled={!mediaCompression.enabled}
								onChange={() => appDispatch(setMediaCompressionPreset({ type, preset: value }))}
							/>
							{presetLabel}
						</label>
					))}
				</div>
			))}

			<div className='compressionPanel__divider' />

			<button
				type='button'
				className='compressionPanel__compressAll'
				onClick={() => {
					appDispatch(bulkCompressionDialogOpened());
					onClose();
				}}
			>
				{localization.compressAllMedia}
			</button>
		</Popup>
	);
};

export default CompressionPanel;
