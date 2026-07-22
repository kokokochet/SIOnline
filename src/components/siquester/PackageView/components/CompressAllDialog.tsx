import React from 'react';
import { useAppDispatch, useAppSelector } from '../../../../state/hooks';
import {
	bulkCompressionDialogClosed,
	cancelBulkCompression,
	compressAllPackageMedia,
	defaultMediaCompressionState,
} from '../../../../state/siquesterSlice';
import { selectReferencedMediaCounts, collectMediaReferences } from '../../../../utils/mediaCompression/compressPackageMedia';
import {
	isAudioCompressionSupported,
	isVideoCompressionSupported,
	probeMedia,
} from '../../../../utils/mediaCompression';
import { resolveCompressionOptions } from '../../../../utils/mediaCompression/compressionPresets';
import { CompressibleMediaType, CompressionPreset } from '../../../../utils/mediaCompression/compressionTypes';
import type { MediaProbeResult } from '../../../../utils/mediaCompression';
import localization from '../../../../model/resources/localization';
import { getCompressionDoneSummaryKey, formatSavedBytes } from '../../../../utils/mediaCompression/compressionI18n';
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

/**
 * Modal dialog for bulk media compression. Driven entirely by
 * `state.siquester.bulkCompression.phase`:
 * - confirm: referenced-file counts + selected presets + irreversibility warning;
 * - running: progress bar + current file + cancel (Escape and the × button
 *   also cancel via onClose);
 * - done / cancelled: result summary;
 * - failed: error message + close.
 *
 * Escape and the × button call `onClose`; while `phase === 'running'`, `onClose`
 * dispatches `cancelBulkCompression()` instead of closing, so the dialog cannot
 * close mid-run. Repeated Escape during the cancelling window re-requests
 * cancel (idempotent — the abort controller is already aborted, so it no-ops).
 * The Dialog has no backdrop, and the "Cancelling…" overlay is purely visual;
 * it absorbs no input.
 */
const CompressAllDialog: React.FC = () => {
	const appDispatch = useAppDispatch();
	const bulk = useAppSelector(state => state.siquester.bulkCompression);
	const pack = useAppSelector(state => state.siquester.pack);
	const mediaCompression = useAppSelector(state => state.siquester.mediaCompression ?? defaultMediaCompressionState);

	const counts = React.useMemo(() => selectReferencedMediaCounts(pack), [pack]);

	const [unsupported, setUnsupported] = React.useState<MediaProbeResult[]>([]);

	React.useEffect(() => {
		if (!bulk || bulk.phase !== 'confirm' || !pack) {
			setUnsupported([]);
			return;
		}
		const options = resolveCompressionOptions(mediaCompression.presets);
		const refs = collectMediaReferences(pack);
		let cancelled = false;
		// Result is per-type deterministic (output codec is fixed by the preset);
		// dedupe by type via a Set to avoid N redundant isConfigSupported calls.
		const types = new Set<CompressibleMediaType>();
		for (const ref of refs) {
			types.add(ref.type);
		}
		const all: Promise<MediaProbeResult>[] = [];
		for (const type of types) {
			all.push(probeMedia(type, options));
		}
		Promise.all(all).then(results => {
			if (cancelled) return;
			setUnsupported(results.filter(r => !r.supported));
		}).catch(() => {
			if (!cancelled) setUnsupported([]);
		});
		return () => { cancelled = true; };
	}, [bulk?.phase, pack, mediaCompression.presets]);

	const phaseRef = React.useRef(bulk?.phase);
	phaseRef.current = bulk?.phase;

	React.useEffect(() => () => {
		// Unmount while running → cancel so the orphaned thunk does not silently
		// apply staged results into state.zip (the same-package re-open race).
		// cancelBulkCompression aborts the in-flight file (T12) too.
		if (phaseRef.current === 'running') {
			appDispatch(cancelBulkCompression());
		}
	}, [appDispatch]);

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
		<Dialog
			id='compressAllDialog'
			title={localization.compressAllMedia}
			onClose={onClose}
			className='compressAllDialog'
			dismissable
			modal
		>
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
						{counts.audio > 0 && !isAudioCompressionSupported() ? (
							<div className='compressAllDialog__notice' role='note'>
								{localization.compressionAudioNotSupported}
							</div>
						) : null}
						{counts.video > 0 && !isVideoCompressionSupported() ? (
							<div className='compressAllDialog__notice' role='note'>
								{localization.compressionVideoNotSupported}
							</div>
						) : null}
						<div className='compressAllDialog__warning'>{localization.compressionIrreversible}</div>
						<div className='compressAllDialog__warning'>{localization.compressionHistoryNote}</div>
						{unsupported.length > 0 ? (
							<div className='compressAllDialog__unsupported'>
								<div className='compressAllDialog__unsupportedTitle'>
									{localization.compressionUnsupportedFiles}
								</div>
								<ul className='compressAllDialog__unsupportedList'>
									{unsupported.map(u => (
										<li key={`${u.type}:${u.codec}`}>
											{`${getMediaTypeLabel(u.type)} (${u.codec})`}
										</li>
									))}
								</ul>
							</div>
						) : null}
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
