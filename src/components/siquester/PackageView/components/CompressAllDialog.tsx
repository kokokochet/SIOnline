import React from 'react';
import { useAppDispatch, useAppSelector } from '../../../../state/hooks';
import {
	bulkCompressionCancelRequested,
	bulkCompressionDialogClosed,
	compressAllPackageMedia,
	defaultMediaCompressionState,
} from '../../../../state/siquesterSlice';
import { selectReferencedMediaCounts } from '../../../../utils/mediaCompression/compressPackageMedia';
import { CompressibleMediaType, CompressionPreset } from '../../../../utils/mediaCompression/compressionTypes';
import localization from '../../../../model/resources/localization';
import Dialog from '../../../common/Dialog/Dialog';

import './CompressAllDialog.scss';

const mediaTypes: ReadonlyArray<CompressibleMediaType> = ['image', 'audio', 'video'];

function getMediaTypeLabel(type: CompressibleMediaType): string {
	switch (type) {
		case 'image':
			return localization.images;
		case 'audio':
			return localization.audio;
		case 'video':
			return localization.video;
		default:
			return type;
	}
}

function getPresetLabel(preset: CompressionPreset): string {
	switch (preset) {
		case 'low':
			return localization.compressionLow;
		case 'medium':
			return localization.compressionMedium;
		case 'high':
			return localization.compressionHigh;
		default:
			return preset;
	}
}

function formatSaved(bytes: number): string {
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Modal dialog for bulk media compression. Driven entirely by
 * `state.siquester.bulkCompression.phase`:
 * - confirm: referenced-file counts + selected presets + irreversibility warning;
 * - running: progress bar + current file + cancel;
 * - done / cancelled: result summary.
 * Closing the dialog while running is treated as a cancel request.
 */
const CompressAllDialog: React.FC = () => {
	const appDispatch = useAppDispatch();
	const bulk = useAppSelector(state => state.siquester.bulkCompression);
	const pack = useAppSelector(state => state.siquester.pack);
	const mediaCompression = useAppSelector(state => state.siquester.mediaCompression ?? defaultMediaCompressionState);

	const counts = React.useMemo(() => selectReferencedMediaCounts(pack), [pack]);

	if (!bulk || bulk.phase === 'idle') {
		return null;
	}

	const total = counts.image + counts.audio + counts.video;

	const onClose = () => {
		if (bulk.phase === 'running') {
			appDispatch(bulkCompressionCancelRequested());
			return;
		}

		appDispatch(bulkCompressionDialogClosed());
	};

	return (
		<Dialog title={localization.compressAllMedia} onClose={onClose} className='compressAllDialog'>
			{bulk.phase === 'confirm' ? (
				<div className='compressAllDialog__confirm'>
					{total === 0 ? (
						<div className='compressAllDialog__empty'>{localization.compressionNoMedia}</div>
					) : (
						<>
							<ul className='compressAllDialog__counts'>
								{mediaTypes.map(type => (
									<li key={type}>
										{`${getMediaTypeLabel(type)}: ${counts[type]} — ${getPresetLabel(mediaCompression.presets[type])}`}
									</li>
								))}
							</ul>
							<div className='compressAllDialog__warning'>{localization.compressionIrreversible}</div>
						</>
					)}
					<div className='compressAllDialog__buttons'>
						{total > 0 ? (
							<button
								type='button'
								className='standard'
								onClick={() => appDispatch(compressAllPackageMedia())}
							>
								{localization.compressionStart}
							</button>
						) : null}
						<button type='button' className='standard' onClick={onClose}>{localization.cancel}</button>
					</div>
				</div>
			) : null}

			{bulk.phase === 'running' ? (
				<div className='compressAllDialog__running'>
					<div className='compressAllDialog__progressLabel'>
						{`${localization.compressing} ${localization.formatString(localization.compressionProgress, bulk.completed, bulk.total)}`}
					</div>
					<div className='compressAllDialog__progressBar'>
						<div
							className='compressAllDialog__progressFill'
							style={{ width: `${bulk.total > 0 ? (bulk.completed / bulk.total) * 100 : 0}%` }}
						/>
					</div>
					<div className='compressAllDialog__currentFile' title={bulk.currentFile}>{bulk.currentFile}</div>
					<div className='compressAllDialog__buttons'>
						<button
							type='button'
							className='standard'
							onClick={() => appDispatch(bulkCompressionCancelRequested())}
						>
							{localization.cancel}
						</button>
					</div>
				</div>
			) : null}

			{bulk.phase === 'done' && bulk.summary ? (
				<div className='compressAllDialog__done'>
					{localization.formatString(
						localization.compressionDoneSummary,
						bulk.summary.compressedCount,
						bulk.summary.compressedCount + bulk.summary.skippedCount,
						formatSaved(bulk.summary.savedBytes),
					)}
					<div className='compressAllDialog__buttons'>
						<button type='button' className='standard' onClick={onClose}>{localization.close}</button>
					</div>
				</div>
			) : null}

			{bulk.phase === 'cancelled' ? (
				<div className='compressAllDialog__cancelled'>
					{localization.compressionCancelled}
					<div className='compressAllDialog__buttons'>
						<button type='button' className='standard' onClick={onClose}>{localization.close}</button>
					</div>
				</div>
			) : null}
		</Dialog>
	);
};

export default CompressAllDialog;
