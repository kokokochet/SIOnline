import React from 'react';
import { useAppDispatch, useAppSelector } from '../../../../state/hooks';
import {
	bulkCompressionDialogClosed,
	cancelBulkCompression,
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
 * - running: progress bar + current file + cancel (Escape/backdrop also cancels);
 * - done / cancelled: result summary;
 * - failed: error message + close.
 *
 * Closing while running requests cancel and stays open with a "Cancelling…"
 * overlay until the thunk acknowledges (phase → cancelled). The Dialog is
 * `dismissable` so Escape fires onClose; during the cancelling window the
 * overlay absorbs further Escape presses (the cancel is already in flight).
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
	const isCancelling = bulk.phase === 'running' && bulk.cancelRequested;

	const onClose = () => {
		if (bulk.phase === 'running') {
			// cancelBulkCompression sets the flag AND aborts the in-flight file (T12).
			appDispatch(cancelBulkCompression());
			return;
		}

		appDispatch(bulkCompressionDialogClosed());
	};

	return (
		<Dialog id='compressAllDialog' title={localization.compressAllMedia} onClose={onClose} className='compressAllDialog' dismissable>
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
					<div
						className='compressAllDialog__progressBar'
						role='progressbar'
						aria-label={localization.compressing}
						aria-valuenow={bulk.total > 0 ? Math.round((bulk.completed / bulk.total) * 100) : 0}
						aria-valuemin={0}
						aria-valuemax={100}
					>
						<div
							className='compressAllDialog__progressFill'
							style={{ width: `${bulk.total > 0 ? (bulk.completed / bulk.total) * 100 : 0}%` }}
						/>
					</div>
					<div className='compressAllDialog__currentFile' title={bulk.currentFile}>{bulk.currentFile}</div>
					{isCancelling ? (
						<div className='compressAllDialog__cancelling' role='status' aria-live='polite'>
							{localization.compressionCancelling}
						</div>
					) : (
						<div className='compressAllDialog__buttons'>
							<button
								type='button'
								className='standard'
								onClick={() => appDispatch(cancelBulkCompression())}
							>
								{localization.cancel}
							</button>
						</div>
					)}
				</div>
			) : null}

			{bulk.phase === 'done' && bulk.summary ? (
				<div className='compressAllDialog__done' role='status' aria-live='polite'>
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
				<div className='compressAllDialog__cancelled' role='status' aria-live='polite'>
					{localization.compressionCancelled}
					<div className='compressAllDialog__buttons'>
						<button type='button' className='standard' onClick={onClose}>{localization.close}</button>
					</div>
				</div>
			) : null}

			{bulk.phase === 'failed' ? (
				<div className='compressAllDialog__failed' role='alert'>
					{localization.compressionFailed}
					{bulk.failedReason ? <div className='compressAllDialog__errorDetail'>{bulk.failedReason}</div> : null}
					<div className='compressAllDialog__buttons'>
						<button type='button' className='standard' onClick={onClose}>{localization.close}</button>
					</div>
				</div>
			) : null}
		</Dialog>
	);
};

export default CompressAllDialog;
