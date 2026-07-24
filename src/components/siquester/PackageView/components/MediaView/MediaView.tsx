import React from 'react';
import JSZip from 'jszip';
import MediaItem from '../../../MediaItem/MediaItem';
import localization from '../../../../../model/resources/localization';
import { useAppDispatch, useAppSelector } from '../../../../../state/hooks';
import { compressSinglePackageMedia } from '../../../../../state/siquesterSlice';
import {
	isAudioCompressionSupported,
	isVideoCompressionSupported,
} from '../../../../../utils/mediaCompression';

import './MediaView.scss';

interface MediaViewProps {
	zip: JSZip;
}

interface MediaFile {
	name: string;
	type: 'image' | 'audio' | 'video' | 'html';
	path: string;
}

function decodeMediaFileName(fileName: string): string {
	try {
		return decodeURIComponent(fileName);
	} catch {
		return fileName;
	}
}

type MediaTab = 'images' | 'audio' | 'video' | 'html';

function isCompressible(type: MediaFile['type']): boolean {
	if (type === 'image') {
		return true;
	}

	if (type === 'audio') {
		return isAudioCompressionSupported();
	}

	if (type === 'video') {
		return isVideoCompressionSupported();
	}

	return false;
}

const MediaView: React.FC<MediaViewProps> = ({ zip }) => {
	const dispatch = useAppDispatch();
	const [activeTab, setActiveTab] = React.useState<MediaTab>('images');
	const [mediaFiles, setMediaFiles] = React.useState<Record<MediaTab, MediaFile[]>>({
		images: [],
		audio: [],
		video: [],
		html: []
	});
	const [loading, setLoading] = React.useState(true);
	/** In-flight single-file compress keys `${type}:${name}`, for per-button spinner state. */
	const [compressing, setCompressing] = React.useState<Set<string>>(new Set());
	const [errors, setErrors] = React.useState<Record<string, string>>({});
	const zipRevision = useAppSelector(state => state.siquester.zipRevision);
	const busy = useAppSelector(state => state.siquester.mediaCompression.busy);
	const bulkRunning = useAppSelector(state => state.siquester.bulkCompression?.phase === 'running');

	async function handleCompress(file: MediaFile) {
		// html is not a compressible media type; the button is hidden for it, but this guards the type too.
		if (file.type === 'html') {
			return;
		}

		const key = `${file.type}:${file.name}`;

		setCompressing(prev => new Set(prev).add(key));
		setErrors(prev => {
			const next = { ...prev };
			delete next[key];
			return next;
		});

		try {
			const resultAction = await dispatch(compressSinglePackageMedia({ type: file.type, value: file.name }));

			if (compressSinglePackageMedia.fulfilled.match(resultAction)) {
				const payload = resultAction.payload;

				if (payload.kind === 'error') {
					setErrors(prev => ({ ...prev, [key]: payload.message }));
				}
			}
		} finally {
			setCompressing(prev => {
				const next = new Set(prev);
				next.delete(key);
				return next;
			});
		}
	}

	const loadMediaFiles = async () => {
		setLoading(true);
		
		const files: Record<MediaTab, MediaFile[]> = {
			images: [],
			audio: [],
			video: [],
			html: []
		};

		// Scan all files in the zip
		zip.forEach((relativePath, file) => {
			if (file.dir) return; // Skip directories

			// Check if file is in one of the media folders
			if (relativePath.startsWith('Images/')) {
				const fileName = relativePath.substring('Images/'.length);
				if (fileName) {
					files.images.push({
						name: decodeMediaFileName(fileName),
						type: 'image',
						path: fileName
					});
				}
			} else if (relativePath.startsWith('Audio/')) {
				const fileName = relativePath.substring('Audio/'.length);
				if (fileName) {
					files.audio.push({
						name: decodeMediaFileName(fileName),
						type: 'audio',
						path: fileName
					});
				}
			} else if (relativePath.startsWith('Video/')) {
				const fileName = relativePath.substring('Video/'.length);
				if (fileName) {
					files.video.push({
						name: decodeMediaFileName(fileName),
						type: 'video',
						path: fileName
					});
				}
			} else if (relativePath.startsWith('Html/')) {
				const fileName = relativePath.substring('Html/'.length);
				if (fileName) {
					files.html.push({
						name: decodeMediaFileName(fileName),
						type: 'html',
						path: fileName
					});
				}
			}
		});

		// Sort files by name
		Object.keys(files).forEach(key => {
			files[key as MediaTab].sort((a, b) => a.name.localeCompare(b.name));
		});

		setMediaFiles(files);
		setLoading(false);
	};

	React.useEffect(() => {
		loadMediaFiles();
	}, [zip, zipRevision]);

	const getTabLabel = (tab: MediaTab, count: number): string => {
		switch (tab) {
			case 'images':
				return `${localization.images} (${count})`;
			case 'audio':
				return `${localization.audio} (${count})`;
			case 'video':
				return `${localization.video} (${count})`;
			case 'html':
				return `HTML (${count})`;
			default:
				return `${tab} (${count})`;
		}
	};

	// Derived to avoid flashing "No files found" for a frame on each zip rescan (old setTimeout(0) did new→[]→new).
	const displayedFiles = mediaFiles[activeTab];

	if (loading) {
		return <div className="mediaView__loading">Loading media files...</div>;
	}

	return (
		<div className="mediaView">
			<div className="packageView__rounds">
				<div
					className={`packageView__round ${activeTab === 'images' ? 'selected' : ''}`}
					onClick={() => setActiveTab('images')}
				>
					{getTabLabel('images', mediaFiles.images.length)}
				</div>
				<div
					className={`packageView__round ${activeTab === 'audio' ? 'selected' : ''}`}
					onClick={() => setActiveTab('audio')}
				>
					{getTabLabel('audio', mediaFiles.audio.length)}
				</div>
				<div
					className={`packageView__round ${activeTab === 'video' ? 'selected' : ''}`}
					onClick={() => setActiveTab('video')}
				>
					{getTabLabel('video', mediaFiles.video.length)}
				</div>
				<div
					className={`packageView__round ${activeTab === 'html' ? 'selected' : ''}`}
					onClick={() => setActiveTab('html')}
				>
					{getTabLabel('html', mediaFiles.html.length)}
				</div>
			</div>

			<div className="mediaView__content">
				{displayedFiles.length === 0 ? (
					<div className="mediaView__empty">
						No {activeTab} files found in package
					</div>
				) : (
					<div className={`mediaView__grid mediaView__grid--${activeTab}`}>
					{displayedFiles.map((file, index) => {
						const fileKey = `${file.type}:${file.name}`;
						const canCompress = isCompressible(file.type);
						const isThisCompressing = compressing.has(fileKey);

						return (
							<div key={index} className="mediaView__item">
								<div className="mediaView__item__name" title={file.name}>
									{file.name}
								</div>
								<div className="mediaView__item__content">
									<MediaItem
										src={file.path}
										type={file.type}
										isRef={true}
									/>
								</div>
								{canCompress ? (
									<div className="mediaView__item__actions">
										<button
											type="button"
											className="mediaView__item__compress standard"
											disabled={busy || bulkRunning}
											aria-label={`${localization.compressionStart}: ${file.name}`}
											onClick={() => handleCompress(file)}
										>
											{isThisCompressing ? localization.compressing : localization.compressionStart}
										</button>
										{errors[fileKey] ? (
											<span className="mediaView__item__error" role="alert">{errors[fileKey]}</span>
										) : null}
									</div>
								) : null}
							</div>
						);
					})}
					</div>
				)}
			</div>
		</div>
	);
};

export default MediaView;