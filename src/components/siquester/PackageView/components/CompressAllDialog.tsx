import React from 'react';
import { useAppDispatch, useAppSelector } from '../../../../state/hooks';
import {
	bulkCompressionDialogClosed,
	cancelBulkCompression,
	compressAllPackageMedia,
} from '../../../../state/siquesterSlice';
import { selectReferencedMediaCounts } from '../../../../utils/mediaCompression/compressPackageMedia';
import localization from '../../../../model/resources/localization';
import { getCompressionDoneSummaryKey, formatSavedBytes } from '../../../../utils/mediaCompression/compressionI18n';
import Dialog from '../../../common/Dialog/Dialog';
import ProgressBar from '../../../common/ProgressBar/ProgressBar';

import './CompressAllDialog.scss';

// While phase === 'running', onClose cancels instead of closing, so × can't abort mid-run.
const CompressAllDialog: React.FC = () => {
	const appDispatch = useAppDispatch();
	const bulk = useAppSelector(state => state.siquester.bulkCompression);
	const pack = useAppSelector(state => state.siquester.pack);

	const counts = React.useMemo(() => selectReferencedMediaCounts(pack), [pack]);

	if (!bulk || bulk.phase === 'idle') {
		return null;
	}

	const total = counts.image + counts.audio + counts.video;
	const isCancelling = bulk.phase === 'running' && bulk.cancelRequested;

	const onClose = () => {
		if (bulk.phase === 'running') {
			appDispatch(cancelBulkCompression());
			return;
		}

		appDispatch(bulkCompressionDialogClosed());
	};

	return (
		<Dialog
			id='compressAllDialog'
			title={localization.compressAllMedia}
			onClose={onClose}
			className='compressAllDialog'
		>
			{bulk.phase === 'confirm' ? (
				<div className='compressAllDialog__confirm'>
				{total === 0 ? (
					<div className='compressAllDialog__empty'>{localization.compressionNoMedia}</div>
				) : (
					<div className='compressAllDialog__warning'>
						{localization.compressionIrreversible} {localization.compressionHistoryNote}
					</div>
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
				<ProgressBar
					value={bulk.total > 0 ? bulk.completed / bulk.total : 0}
					title={localization.compressing}
				/>
				<div className='compressAllDialog__currentFile'>{bulk.currentFile}</div>
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
				(localization as unknown as Record<string, string>)[getCompressionDoneSummaryKey(
					bulk.summary.compressedCount + bulk.summary.skippedCount,
				)],
				bulk.summary.compressedCount,
				bulk.summary.compressedCount + bulk.summary.skippedCount,
				formatSavedBytes(bulk.summary.savedBytes, localization.getLanguage(), localization.unitMB),
			)}
				{bulk.summary.errors.length > 0 ? (
					<div className='compressAllDialog__partial' role='note'>
						{localization.formatString(localization.compressionPartialWarning, bulk.summary.errors.length)}
					</div>
				) : null}
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
				{bulk.summary && bulk.summary.errors.length > 0
					? localization.formatString(
						localization.compressionFailedSummary,
						bulk.summary.errors.length,
						bulk.summary.compressedCount + bulk.summary.skippedCount,
					)
					: localization.compressionFailed}
				{bulk.failedReason ? (
					<div className='compressAllDialog__failedReason'>{bulk.failedReason}</div>
				) : null}
				{bulk.summary && bulk.summary.errors.length > 0 ? (
					<ul className='compressAllDialog__errorList'>
						{bulk.summary.errors.map((err, idx) => (
							<li key={`${err.type}:${err.fileName}:${idx}`}>{`${err.fileName} — ${err.name}`}</li>
						))}
					</ul>
				) : null}
				<div className='compressAllDialog__buttons'>
					<button type='button' className='standard' onClick={onClose}>{localization.close}</button>
				</div>
			</div>
		) : null}
		</Dialog>
	);
};

export default CompressAllDialog;
