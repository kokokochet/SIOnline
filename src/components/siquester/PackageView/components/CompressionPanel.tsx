import * as React from 'react';
import { useAppDispatch, useAppSelector } from '../../../../state/hooks';
import {
	bulkCompressionDialogOpened,
	setCompressOnUpload,
	setMediaCompressionPreset,
} from '../../../../state/siquesterSlice';
import localization from '../../../../model/resources/localization';
import { CompressibleMediaType, CompressionPreset } from '../../../../utils/mediaCompression/compressionTypes';
import {
	isAudioCompressionSupported,
	isVideoCompressionSupported,
} from '../../../../utils/mediaCompression';
import Dialog from '../../../common/Dialog/Dialog';

import './CompressionPanel.scss';

interface CompressionPanelProps {
	open: boolean;
	onClose: () => void;
}

const CompressionPanel: React.FC<CompressionPanelProps> = ({ open, onClose }) => {
	const appDispatch = useAppDispatch();
	const mediaCompression = useAppSelector(state => state.siquester.mediaCompression);
	const bulk = useAppSelector(state => state.siquester.bulkCompression);

	const presets: ReadonlyArray<{ value: CompressionPreset; label: string }> = [
		{ value: 'low', label: localization.compressionLow },
		{ value: 'medium', label: localization.compressionMedium },
		{ value: 'high', label: localization.compressionHigh },
	];

	const mediaTypes: ReadonlyArray<{ type: CompressibleMediaType; legend: string }> = [
		{ type: 'image', legend: localization.compressionPresetImages },
		{ type: 'audio', legend: localization.compressionPresetAudio },
		{ type: 'video', legend: localization.compressionPresetVideo },
	];

	if (!open) {
		return null;
	}

	return (
		<Dialog id='compressionPanel' title={localization.compressionSettings} onClose={onClose}>
			<div className='compressionPanelBody'>
				<div className='compressionPanel__toggle'>
					<input
						id='compressMedia'
						type='checkbox'
						checked={mediaCompression.compressOnUpload}
						onChange={() => appDispatch(setCompressOnUpload(!mediaCompression.compressOnUpload))}
					/>
					<label htmlFor='compressMedia'>{localization.compressMedia}</label>
				</div>

			{mediaTypes.map(({ type, legend }) => {
				const typeUnsupported =
					(type === 'audio' && !isAudioCompressionSupported()) ||
					(type === 'video' && !isVideoCompressionSupported());
				const presetsDisabled = typeUnsupported;

				return (
					<fieldset
						key={type}
						className={`compressionPanel__presets ${presetsDisabled ? 'compressionPanel__presets--disabled' : ''}`}
						disabled={presetsDisabled}
					>
						<legend className='compressionPanel__title'>{legend}</legend>
						{typeUnsupported ? (
							<div className='compressionPanel__notice' role='note'>
								{type === 'audio' ? localization.compressionAudioNotSupported : localization.compressionVideoNotSupported}
							</div>
						) : null}
						{presets.map(({ value, label: presetLabel }) => (
							<label key={value} className='compressionPanel__preset'>
								<input
									type='radio'
									name={`compressionPreset-${type}`}
									value={value}
									checked={mediaCompression.presets[type] === value}
									disabled={presetsDisabled}
									onChange={() => appDispatch(setMediaCompressionPreset({ type, preset: value }))}
								/>
								{presetLabel}
							</label>
						))}
					</fieldset>
				);
			})}

				<div className='compressionPanel__divider' />

				<button
					type='button'
					className='compressionPanel__compressAll standard'
					disabled={mediaCompression.busy || bulk?.phase === 'running'}
					onClick={() => {
						appDispatch(bulkCompressionDialogOpened());
						onClose();
					}}
				>
					{localization.compressAllMedia}
				</button>
			</div>
		</Dialog>
	);
};

export default CompressionPanel;
