import * as React from 'react';
import { useAppDispatch, useAppSelector } from '../../../../state/hooks';
import {
	bulkCompressionDialogOpened,
	defaultMediaCompressionState,
	setMediaCompressionEnabled,
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

/**
 * Side-dialog for media compression settings. Renders a toggle (on/off) and
 * per-media-type Low/Medium/High preset radio groups. Mounted in the PackageView
 * toolbar; the trigger button lives in PackageView and toggles `open`.
 *
 * Closing behaviour mirrors SettingsDialog: the × button (provided by Dialog)
 * and any `mousedown` outside the panel both call `onClose`. Listening on
 * `mousedown` (not `mouseup`) is what lets users interact with form controls
 * inside the panel without dismissing it.
 */
const CompressionPanel: React.FC<CompressionPanelProps> = ({ open, onClose }) => {
	const appDispatch = useAppDispatch();
	const mediaCompression = useAppSelector(state => state.siquester.mediaCompression ?? defaultMediaCompressionState);
	const bulk = useAppSelector(state => state.siquester.bulkCompression);
	const layout = React.useRef<HTMLDivElement>(null);

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

	const hide = React.useCallback((e: Event): void => {
		if (!layout.current || (e.target instanceof Node && layout.current.contains(e.target as Node))) {
			return;
		}

		onClose();
	}, [onClose]);

	React.useEffect(() => {
		if (!open) {
			return;
		}

		window.addEventListener('mousedown', hide);

		return () => {
			window.removeEventListener('mousedown', hide);
		};
	}, [open, hide]);

	if (!open) {
		return null;
	}

	return (
		<Dialog id='compressionPanel' ref={layout} title={localization.compressionSettings} onClose={onClose}>
			<div className='compressionPanelBody'>
				<div className='compressionPanel__toggle'>
					<input
						id='compressMedia'
						type='checkbox'
						checked={mediaCompression.enabled}
						onChange={() => appDispatch(setMediaCompressionEnabled(!mediaCompression.enabled))}
					/>
					<label htmlFor='compressMedia'>{localization.compressMedia}</label>
				</div>

			{mediaTypes.map(({ type, legend }) => {
				const typeUnsupported =
					(type === 'audio' && !isAudioCompressionSupported()) ||
					(type === 'video' && !isVideoCompressionSupported());
				const presetsDisabled = !mediaCompression.enabled || typeUnsupported;

				return (
					<fieldset
						key={type}
						className={`compressionPanel__presets ${presetsDisabled ? 'compressionPanel__presets--disabled' : ''}`}
						disabled={presetsDisabled}
					>
						<legend className='compressionPanel__title'>{legend}</legend>
						{type === 'audio' && typeUnsupported ? (
							<div className='compressionPanel__notice' role='note'>
								{localization.compressionAudioNotSupported}
							</div>
						) : null}
						{type === 'video' && typeUnsupported ? (
							<div className='compressionPanel__notice' role='note'>
								{localization.compressionVideoNotSupported}
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
					disabled={bulk?.phase === 'running' || !mediaCompression.enabled}
					title={!mediaCompression.enabled ? localization.compressionDisabledHint : undefined}
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
