import { createAsyncThunk, createSlice, createAction, PayloadAction } from '@reduxjs/toolkit';
import JSZip from 'jszip';
import SIStatisticsClient from 'sistatistics-client';
import QuestionStats from 'sistatistics-client/dist/models/QuestionStats';
import PackageTopLevelStats from 'sistatistics-client/dist/models/PackageTopLevelStats';
import localization from '../model/resources/localization';
import { Package, Round, Theme, Question, ContentParam, ContentItem, ContentType, ContentPlacements } from '../model/siquester/package';
import { navigate } from '../utils/Navigator';
import Path from '../model/enums/Path';
import DataContext from '../model/DataContext';
import { createDefaultPackage, createDefaultZip, NewPackageOptions } from '../model/siquester/packageGenerator';

export type { NewPackageOptions };
import { downloadPackageAsSIQ } from '../model/siquester/packageExporter';
import { parseXMLtoPackage } from '../model/siquester/packageLoader';
import { CompressibleMediaType, CompressionPreset, MediaCompressionPresets } from '../utils/mediaCompression/compressionTypes';
import { compressMedia, MAX_MEDIA_BYTES, resolveCompressionOptions } from '../utils/mediaCompression';
import {
	collectExistingMediaNames,
	collectMediaReferences,
	getMediaFolderName as getCompressibleMediaFolderName,
	planRenames,
	renameMediaReferences,
	resolveZipEntry,
	StagedMediaFile,
} from '../utils/mediaCompression/compressPackageMedia';

/** Summary of a finished bulk compression run. */
export interface BulkCompressionSummary {
	/** Files actually re-encoded and replaced. */
	compressedCount: number;
	/** Files kept as-is (passthrough, skipped, or failed). */
	skippedCount: number;
	/** Total bytes saved across compressed files. */
	savedBytes: number;
}

export type BulkCompressionPhase = 'idle' | 'confirm' | 'running' | 'done' | 'cancelled';

/** Bulk compression dialog/progress state machine. Per-session, never persisted. */
export interface BulkCompressionState {
	phase: BulkCompressionPhase;
	total: number;
	completed: number;
	currentFile?: string;
	cancelRequested: boolean;
	summary?: BulkCompressionSummary;
}

export interface SIQuesterState {
	zip?: JSZip;
	pack?: Package;
	roundIndex?: number;
	themeIndex?: number;
	questionIndex?: number;
	isPackageSelected?: boolean;
	isNewPackage?: boolean;
	packageStats?: Record<string, QuestionStats>;
	packageTopLevelStats?: PackageTopLevelStats;
	packageStatsLoading?: boolean;
	showPackageStats?: boolean;
	history?: {
		past: {
			pack: Package;
			zipFiles?: Record<string, any>;
			roundIndex?: number;
			themeIndex?: number;
			questionIndex?: number;
			isPackageSelected?: boolean;
		}[];
		future: {
			pack: Package;
			zipFiles?: Record<string, any>;
			roundIndex?: number;
			themeIndex?: number;
			questionIndex?: number;
			isPackageSelected?: boolean;
		}[];
	};
	/** Per-session media compression settings. Not persisted across sessions. */
	mediaCompression?: {
		enabled: boolean;
		presets: MediaCompressionPresets;
	};
	/** Bulk compression dialog/progress state machine. */
	bulkCompression?: BulkCompressionState;
	/** Monotonic counter bumped when zip entries are replaced in bulk.
	 * Lets MediaView re-scan the zip (the JSZip instance identity never changes). */
	zipRevision?: number;
}

/** Default compression settings: enabled, all media types at Medium. */
export const defaultMediaCompressionState: { enabled: boolean; presets: MediaCompressionPresets } = {
	enabled: true,
	presets: { image: 'medium', audio: 'medium', video: 'medium' },
};

const initialState: SIQuesterState = {
	mediaCompression: {
		...defaultMediaCompressionState,
		presets: { ...defaultMediaCompressionState.presets },
	},
};

function createDefaultQuestion(price = 0): Question {
	return {
		price,
		params: {
			question: {
				items: [{
					type: 'text',
					value: '',
					isRef: false,
					placement: ContentPlacements.Screen
				}]
			}
		},
		right: {
			answer: ['']
		}
	};
}

function getMediaFolderName(type: ContentType): string | undefined {
	switch (type) {
		case 'image':
			return 'Images';
		case 'audio':
			return 'Audio';
		case 'video':
			return 'Video';
		case 'html':
			return 'Html';
		default:
			return undefined;
	}
}

function isMediaReferenceItem(item: ContentItem): item is ContentItem & { type: Exclude<ContentType, 'text'> } {
	return item.isRef && item.type !== 'text' && item.value.length > 0;
}

function containsMediaReference(
	value: unknown,
	targetType: Exclude<ContentType, 'text'>,
	targetValue: string,
	excludedItem?: ContentItem,
): boolean {
	if (!value || typeof value !== 'object') {
		return false;
	}

	if (Array.isArray(value)) {
		return value.some(item => containsMediaReference(item, targetType, targetValue, excludedItem));
	}

	if ('type' in value && 'value' in value && 'isRef' in value) {
		const contentItem = value as ContentItem;
		return contentItem !== excludedItem &&
			contentItem.isRef &&
			contentItem.type === targetType &&
			contentItem.value === targetValue;
	}

	return Object.values(value).some(item => containsMediaReference(item, targetType, targetValue, excludedItem));
}

function packageContainsMediaReference(
	pack: Package | undefined,
	targetType: Exclude<ContentType, 'text'>,
	targetValue: string,
	excludedItem?: ContentItem,
): boolean {
	if (!pack) {
		return false;
	}

	const questionContainsReference = (question: Question) => containsMediaReference(question.params, targetType, targetValue, excludedItem);

	return pack.rounds.some(round => round.themes.some(theme => theme.questions.some(questionContainsReference)));
}

function removeOrphanedMediaFile(state: SIQuesterState, item: ContentItem, excludedItem?: ContentItem): boolean {
	if (!state.zip || !isMediaReferenceItem(item)) {
		return false;
	}

	if (packageContainsMediaReference(state.pack, item.type, item.value, excludedItem)) {
		return false;
	}

	const folderName = getMediaFolderName(item.type);

	if (!folderName) {
		return false;
	}

	state.zip.remove(`${folderName}/${item.value}`);
	state.zip.remove(`${folderName}/${encodeURIComponent(item.value)}`);
	return true;
}

export const openFile = createAsyncThunk(
	'siquester/openFile',
	async (arg: File, thunkAPI) => {
		const dataContext = thunkAPI.extra as DataContext;
		dataContext.file = arg;
		const zip = new JSZip();
		await zip.loadAsync(arg);
		const contentFile = zip.file('content.xml');

		if (!contentFile) {
			throw new Error(localization.corruptedPackage + ' (!contentFile)');
		}

		const content = await contentFile.async('text');
		const parser = new DOMParser();
		const xmlDoc = parser.parseFromString(content, 'application/xml');
		const pack = parseXMLtoPackage(xmlDoc);

		const qualityMarkerFile = zip.file('quality.marker');

		if (qualityMarkerFile) {
			pack.isQualityMarked = true;
		}

		thunkAPI.dispatch(navigate({ navigation: { path: Path.SIQuesterPackage }, saveState: true }));
		return { zip, pack };
	},
);

export const createNewPackage = createAsyncThunk(
	'siquester/createNewPackage',
	async (options: NewPackageOptions, thunkAPI) => {
		const pack = createDefaultPackage(options);
		const zip = await createDefaultZip();

		thunkAPI.dispatch(navigate({ navigation: { path: Path.SIQuesterPackage }, saveState: true }));
		return { zip, pack };
	},
);

export const savePackage = createAsyncThunk(
	'siquester/savePackage',
	async (_, thunkAPI) => {
		const state = thunkAPI.getState() as { siquester: SIQuesterState };
		const { pack, zip } = state.siquester;

		if (!pack) {
			throw new Error('No package to save');
		}

		await downloadPackageAsSIQ(pack, zip);
	},
);

export const loadPackageStatistics = createAsyncThunk(
	'siquester/loadPackageStatistics',
	async (_, thunkAPI) => {
		const dataContext = thunkAPI.extra as DataContext;
		const state = thunkAPI.getState() as { siquester: SIQuesterState };
		const { pack } = state.siquester;

		if (!pack) {
			throw new Error('No package to load statistics for');
		}

		const siStatisticsClient = new SIStatisticsClient({ serviceUri: dataContext.config.siStatisticsServiceUri });

		const authors = pack.info?.authors?.map(a => a.name) || [];

		try {
			const packageStats = await siStatisticsClient.getPackageStats({
				name: pack.name,
				hash: '',
				authors
			});

			return packageStats;
		} catch (error: unknown) {
			// Return empty stats on 404 or other errors
			return {
				topLevelStats: { startedGameCount: 0, completedGameCount: 0 },
				questionStats: {}
			};
		}
	},
);

/**
 * Compresses every referenced media file in the open package using the
 * per-type presets from `state.siquester.mediaCompression.presets`.
 *
 * Safety contract — the package is never left in a broken state:
 * - each file is processed in isolation; any failure skips that file;
 * - results are staged in memory and applied by a single
 *   `bulkMediaCompressed` dispatch (all-or-nothing);
 * - cancelling discards staged results, leaving the package untouched;
 * - a mid-run package swap aborts the apply (the dialog is not modal, and
 *   staged results must never be written into a different zip).
 *
 * Files are processed sequentially to bound peak memory, but staged results
 * accumulate until the apply: the bound is (staged file count × the per-file
 * MAX_MEDIA_BYTES cap). Video/audio encoding runs in Web Workers per file.
 */
export const compressAllPackageMedia = createAsyncThunk(
	'siquester/compressAllPackageMedia',
	async (_, thunkAPI) => {
		const getSiqState = () => (thunkAPI.getState() as { siquester: SIQuesterState }).siquester;
		const { zip, pack } = getSiqState();

		if (!zip || !pack) {
			throw new Error('No package loaded');
		}

		const presets = getSiqState().mediaCompression?.presets ?? defaultMediaCompressionState.presets;
		const options = resolveCompressionOptions(presets);
		const refs = collectMediaReferences(pack);

		thunkAPI.dispatch(bulkCompressionStarted({ total: refs.length }));

		const staged: StagedMediaFile[] = [];
		let skippedCount = 0;
		let savedBytes = 0;

		const isCancelRequested = () => getSiqState().bulkCompression?.cancelRequested === true;

		for (let i = 0; i < refs.length; i += 1) {
			if (isCancelRequested()) {
				thunkAPI.dispatch(bulkCompressionCancelled());
				return { applied: false };
			}

			const ref = refs[i];
			thunkAPI.dispatch(bulkCompressionProgress({ completed: i, currentFile: ref.value }));

			try {
				const folder = getCompressibleMediaFolderName(ref.type);
				const entry = resolveZipEntry(zip, folder, ref.value);

				if (!entry) {
					// Referenced but missing — a pre-existing inconsistency; keep as-is.
					skippedCount += 1;
					continue;
				}

				// eslint-disable-next-line no-await-in-loop
				const data = await entry.async('uint8array');

				if (data.byteLength > MAX_MEDIA_BYTES) {
					// OOM guard — same hard cap as the upload flow.
					skippedCount += 1;
					continue;
				}

				// Copy into a fresh Uint8Array: entry.async() returns Uint8Array<ArrayBufferLike>, not a BlobPart.
				// eslint-disable-next-line no-await-in-loop
				const compressed = await compressMedia(new File([new Uint8Array(data)], ref.value), ref.type, options);

				if (compressed.wasCompressed) {
					staged.push({
						type: ref.type,
						oldValue: ref.value,
						newValue: compressed.fileName,
						data: compressed.data,
					});
					savedBytes += compressed.originalSize - compressed.compressedSize;
				} else {
					skippedCount += 1;
				}
			} catch (err) {
				console.warn(`Bulk compression skipped ${ref.type}:${ref.value}:`, err);
				skippedCount += 1;
			}
		}

		if (isCancelRequested()) {
			thunkAPI.dispatch(bulkCompressionCancelled());
			return { applied: false };
		}

		// The dialog is not modal: the user may have opened another package
		// mid-run. Never apply staged results into a different zip.
		if (getSiqState().zip !== zip) {
			thunkAPI.dispatch(bulkCompressionCancelled());
			return { applied: false };
		}

		const renames = planRenames(staged, collectExistingMediaNames(zip));
		const files = staged.map(file => ({
			...file,
			newValue: renames.get(`${file.type}:${file.oldValue}`) ?? file.newValue,
		}));

		if (files.length > 0) {
			thunkAPI.dispatch(bulkMediaCompressed({ files }));
		}

		thunkAPI.dispatch(bulkCompressionFinished({
			summary: { compressedCount: files.length, skippedCount, savedBytes },
		}));

		return { applied: files.length > 0 };
	},
);

export const siquesterSlice = createSlice({
	name: 'siquester',
	initialState,
	reducers: {
		updatePackageProperty: (state, action: { 
			payload: { 
				property: 'name' | 'version' | 'id' | 'restriction' | 'date' | 'publisher' | 'difficulty' 
					| 'language' | 'contactUri' | 'isQualityMarked'; 
				value: string | number | boolean 
			} 
		}) => {
			if (state.pack) {
				switch (action.payload.property) {
					case 'name':
						state.pack.name = action.payload.value as string;
						break;
					case 'version':
						state.pack.version = action.payload.value as string;
						break;
					case 'id':
						state.pack.id = action.payload.value as string;
						break;
					case 'restriction':
						state.pack.restriction = action.payload.value as string;
						break;
					case 'date':
						state.pack.date = action.payload.value as string;
						break;
					case 'publisher':
						state.pack.publisher = action.payload.value as string;
						break;
					case 'difficulty':
						state.pack.difficulty = action.payload.value as number;
						break;
					case 'language':
						state.pack.language = action.payload.value as string;
						break;
					case 'contactUri':
						state.pack.contactUri = action.payload.value as string;
						break;
					case 'isQualityMarked':
						state.pack.isQualityMarked = action.payload.value as boolean;
						break;
					default:
						break;
				}
			}
		},
		updateRoundProperty: (state, action: { 
			payload: { roundIndex: number; property: 'name' | 'type'; value: string } 
		}) => {
			if (state.pack && state.pack.rounds[action.payload.roundIndex]) {
				const round = state.pack.rounds[action.payload.roundIndex];
				switch (action.payload.property) {
					case 'name':
						round.name = action.payload.value;
						break;
					case 'type':
						round.type = action.payload.value;
						break;
					default:
						break;
				}
			}
		},
		updateThemeProperty: (state, action: { 
			payload: { roundIndex: number; themeIndex: number; property: 'name'; value: string } 
		}) => {
			const theme = state.pack?.rounds[action.payload.roundIndex]?.themes[action.payload.themeIndex];
			if (theme) {
				theme.name = action.payload.value;
			}
		},
		updateQuestionProperty: (state, action: { 
			payload: { 
				roundIndex: number; 
				themeIndex: number; 
				questionIndex: number; 
				property: 'price' | 'type'; 
				value: string | number 
			} 
		}) => {
			const question = state.pack?.rounds[action.payload.roundIndex]
				?.themes[action.payload.themeIndex]?.questions[action.payload.questionIndex];
			if (question) {
				switch (action.payload.property) {
					case 'price':
						question.price = action.payload.value as number;
						break;
					case 'type':
						question.type = action.payload.value as string;
						break;
					default:
						break;
				}
			}
		},
		updateQuestionParam: (state, action: { 
			payload: { 
				roundIndex: number; 
				themeIndex: number; 
				questionIndex: number; 
				param: string; 
				value: string 
			} 
		}) => {
			const question = state.pack?.rounds[action.payload.roundIndex]
				?.themes[action.payload.themeIndex]?.questions[action.payload.questionIndex];
			if (question) {
				question.params[action.payload.param] = action.payload.value;

				// Clear answer options when switching away from select
				if (action.payload.param === 'answerType' &&
					action.payload.value !== 'select') {
					delete question.params.answerOptions;
				}

				// Clear answer deviation when switching away from number/point
				if (action.payload.param === 'answerType' &&
					action.payload.value !== 'number' && action.payload.value !== 'point') {
					delete question.params.answerDeviation;
				}
			}
		},
		updateQuestionRightAnswer: (state, action: { 
			payload: { 
				roundIndex: number; 
				themeIndex: number; 
				questionIndex: number; 
				answerIndex: number; 
				value: string 
			} 
		}) => {
			const question = state.pack?.rounds[action.payload.roundIndex]
				?.themes[action.payload.themeIndex]?.questions[action.payload.questionIndex];
			if (question) {
				question.right.answer[action.payload.answerIndex] = action.payload.value;
			}
		},
		updateQuestionWrongAnswer: (state, action: { 
			payload: { 
				roundIndex: number; 
				themeIndex: number; 
				questionIndex: number; 
				answerIndex: number; 
				value: string 
			} 
		}) => {
			const question = state.pack?.rounds[action.payload.roundIndex]
				?.themes[action.payload.themeIndex]?.questions[action.payload.questionIndex];
			if (question?.wrong) {
				question.wrong.answer[action.payload.answerIndex] = action.payload.value;
			}
		},
		addQuestionRightAnswer: (state, action: { 
			payload: { 
				roundIndex: number; 
				themeIndex: number; 
				questionIndex: number; 
			} 
		}) => {
			const question = state.pack?.rounds[action.payload.roundIndex]
				?.themes[action.payload.themeIndex]?.questions[action.payload.questionIndex];
			if (question) {
				question.right.answer.push('');
			}
		},
		removeQuestionRightAnswer: (state, action: { 
			payload: { 
				roundIndex: number; 
				themeIndex: number; 
				questionIndex: number; 
				answerIndex: number; 
			} 
		}) => {
			const question = state.pack?.rounds[action.payload.roundIndex]
				?.themes[action.payload.themeIndex]?.questions[action.payload.questionIndex];
			if (question && question.right.answer[action.payload.answerIndex] !== undefined) {
				question.right.answer.splice(action.payload.answerIndex, 1);
			}
		},
		addQuestionWrongAnswer: (state, action: { 
			payload: { 
				roundIndex: number; 
				themeIndex: number; 
				questionIndex: number; 
			} 
		}) => {
			const question = state.pack?.rounds[action.payload.roundIndex]
				?.themes[action.payload.themeIndex]?.questions[action.payload.questionIndex];
			if (question) {
				if (!question.wrong) {
					question.wrong = { answer: [] };
				}
				question.wrong.answer.push('');
			}
		},
		removeQuestionWrongAnswer: (state, action: { 
			payload: { 
				roundIndex: number; 
				themeIndex: number; 
				questionIndex: number; 
				answerIndex: number; 
			} 
		}) => {
			const question = state.pack?.rounds[action.payload.roundIndex]
				?.themes[action.payload.themeIndex]?.questions[action.payload.questionIndex];
			if (question?.wrong && question.wrong.answer[action.payload.answerIndex] !== undefined) {
				question.wrong.answer.splice(action.payload.answerIndex, 1);
			}
		},
		addRound: (state) => {
			if (state.pack) {
				const newRound: Round = {
					name: '',
					type: '',
					themes: []
				};
				state.pack.rounds.push(newRound);
			}
		},
		removeRound: (state, action: { payload: { roundIndex: number } }) => {
			if (state.pack && state.pack.rounds[action.payload.roundIndex]) {
				state.pack.rounds.splice(action.payload.roundIndex, 1);
				// Clear current item if it was in the deleted round
				if (state.roundIndex === action.payload.roundIndex) {
					state.roundIndex = undefined;
					state.themeIndex = undefined;
					state.questionIndex = undefined;
				}
			}
		},
		addTheme: (state, action: { payload: { roundIndex: number } }) => {
			const round = state.pack?.rounds[action.payload.roundIndex];
			if (round) {
				const newTheme: Theme = {
					name: '',
					questions: []
				};
				round.themes.push(newTheme);
			}
		},
		removeTheme: (state, action: { 
			payload: { 
				roundIndex: number; 
				themeIndex: number; 
			} 
		}) => {
			const round = state.pack?.rounds[action.payload.roundIndex];
			if (round && round.themes[action.payload.themeIndex]) {
				round.themes.splice(action.payload.themeIndex, 1);
				// Clear current item if it was in the deleted theme
				if (state.roundIndex === action.payload.roundIndex && state.themeIndex === action.payload.themeIndex) {
					state.themeIndex = undefined;
					state.questionIndex = undefined;
				}
			}
		},
		addQuestion: (state, action: { 
			payload: { 
				roundIndex: number; 
				themeIndex: number; 
				price?: number;
			} 
		}) => {
			const theme = state.pack?.rounds[action.payload.roundIndex]?.themes[action.payload.themeIndex];
			if (theme) {
				theme.questions.push(createDefaultQuestion(action.payload.price ?? 0));
			}
		},
		removeQuestion: (state, action: { 
			payload: { 
				roundIndex: number; 
				themeIndex: number; 
				questionIndex: number; 
			} 
		}) => {
			const theme = state.pack?.rounds[action.payload.roundIndex]?.themes[action.payload.themeIndex];
			if (theme && theme.questions[action.payload.questionIndex]) {
				theme.questions.splice(action.payload.questionIndex, 1);
				// Clear current item if it was the deleted question
				if (state.roundIndex === action.payload.roundIndex && 
					state.themeIndex === action.payload.themeIndex && 
					state.questionIndex === action.payload.questionIndex) {
					state.questionIndex = undefined;
				}
			}
		},
		resetQuestion: (state, action: {
			payload: {
				roundIndex: number;
				themeIndex: number;
				questionIndex: number;
			}
		}) => {
			const theme = state.pack?.rounds[action.payload.roundIndex]?.themes[action.payload.themeIndex];
			const existingQuestion = theme?.questions[action.payload.questionIndex];

			if (!theme || !existingQuestion) {
				return;
			}

			theme.questions[action.payload.questionIndex] = createDefaultQuestion(existingQuestion.price > -1 ? -1 : 0);
		},
		updateInfoProperty: (state, action: { 
			payload: { 
				targetType: 'package' | 'round' | 'theme' | 'question'; 
				roundIndex?: number; 
				themeIndex?: number; 
				questionIndex?: number; 
				property: 'authors' | 'sources' | 'comments'; 
				index?: number; 
				value: string 
			} 
		}) => {
			let target: Package | Round | Theme | Question | null = null;
			
			if (action.payload.targetType === 'package') {
				target = state.pack || null;
			} else if (action.payload.targetType === 'round' && typeof action.payload.roundIndex === 'number') {
				target = state.pack?.rounds[action.payload.roundIndex] || null;
			} else if (action.payload.targetType === 'theme' && 
				typeof action.payload.roundIndex === 'number' && 
				typeof action.payload.themeIndex === 'number') {
				target = state.pack?.rounds[action.payload.roundIndex]?.themes[action.payload.themeIndex] || null;
			} else if (action.payload.targetType === 'question' && 
				typeof action.payload.roundIndex === 'number' && 
				typeof action.payload.themeIndex === 'number' && 
				typeof action.payload.questionIndex === 'number') {
				target = state.pack?.rounds[action.payload.roundIndex]
					?.themes[action.payload.themeIndex]?.questions[action.payload.questionIndex] || null;
			}
			
			if (target) {
				if (!target.info) {
					target.info = {};
				}
				
				if (action.payload.property === 'comments') {
					target.info.comments = action.payload.value;
				} else if (action.payload.property === 'authors' && typeof action.payload.index === 'number') {
					if (!target.info.authors) {
						target.info.authors = [];
					}
					if (target.info.authors[action.payload.index]) {
						target.info.authors[action.payload.index].name = action.payload.value;
					}
				} else if (action.payload.property === 'sources' && typeof action.payload.index === 'number') {
					if (!target.info.sources) {
						target.info.sources = [];
					}
					if (target.info.sources[action.payload.index]) {
						target.info.sources[action.payload.index].value = action.payload.value;
					}
				}
			}
		},
		updateTag: (state, action: { payload: { tagIndex: number; value: string } }) => {
			if (state.pack && state.pack.tags[action.payload.tagIndex]) {
				state.pack.tags[action.payload.tagIndex].value = action.payload.value;
			}
		},
		addTag: (state) => {
			if (state.pack) {
				state.pack.tags.push({ value: '' });
			}
		},
		removeTag: (state, action: { payload: { tagIndex: number } }) => {
			if (state.pack && state.pack.tags[action.payload.tagIndex] !== undefined) {
				state.pack.tags.splice(action.payload.tagIndex, 1);
			}
		},
		addInfoItem: (state, action: { 
			payload: { 
				targetType: 'package' | 'round' | 'theme' | 'question'; 
				roundIndex?: number; 
				themeIndex?: number; 
				questionIndex?: number; 
				property: 'authors' | 'sources'; 
			} 
		}) => {
			let target: Package | Round | Theme | Question | null = null;
			
			if (action.payload.targetType === 'package') {
				target = state.pack || null;
			} else if (action.payload.targetType === 'round' && typeof action.payload.roundIndex === 'number') {
				target = state.pack?.rounds[action.payload.roundIndex] || null;
			} else if (action.payload.targetType === 'theme' && 
				typeof action.payload.roundIndex === 'number' && 
				typeof action.payload.themeIndex === 'number') {
				target = state.pack?.rounds[action.payload.roundIndex]?.themes[action.payload.themeIndex] || null;
			} else if (action.payload.targetType === 'question' && 
				typeof action.payload.roundIndex === 'number' && 
				typeof action.payload.themeIndex === 'number' && 
				typeof action.payload.questionIndex === 'number') {
				target = state.pack?.rounds[action.payload.roundIndex]
					?.themes[action.payload.themeIndex]?.questions[action.payload.questionIndex] || null;
			}
			
			if (target) {
				if (!target.info) {
					target.info = {};
				}
				
				if (action.payload.property === 'authors') {
					if (!target.info.authors) {
						target.info.authors = [];
					}
					target.info.authors.push({ name: '' });
				} else if (action.payload.property === 'sources') {
					if (!target.info.sources) {
						target.info.sources = [];
					}
					target.info.sources.push({ value: '' });
				}
			}
		},
		removeInfoItem: (state, action: { 
			payload: { 
				targetType: 'package' | 'round' | 'theme' | 'question'; 
				roundIndex?: number; 
				themeIndex?: number; 
				questionIndex?: number; 
				property: 'authors' | 'sources'; 
				index: number; 
			} 
		}) => {
			let target: Package | Round | Theme | Question | null = null;
			
			if (action.payload.targetType === 'package') {
				target = state.pack || null;
			} else if (action.payload.targetType === 'round' && typeof action.payload.roundIndex === 'number') {
				target = state.pack?.rounds[action.payload.roundIndex] || null;
			} else if (action.payload.targetType === 'theme' && 
				typeof action.payload.roundIndex === 'number' && 
				typeof action.payload.themeIndex === 'number') {
				target = state.pack?.rounds[action.payload.roundIndex]?.themes[action.payload.themeIndex] || null;
			} else if (action.payload.targetType === 'question' && 
				typeof action.payload.roundIndex === 'number' && 
				typeof action.payload.themeIndex === 'number' && 
				typeof action.payload.questionIndex === 'number') {
				target = state.pack?.rounds[action.payload.roundIndex]
					?.themes[action.payload.themeIndex]?.questions[action.payload.questionIndex] || null;
			}
			
			if (target && target.info) {
				if (action.payload.property === 'authors' && target.info.authors && target.info.authors[action.payload.index] !== undefined) {
					target.info.authors.splice(action.payload.index, 1);
				} else if (action.payload.property === 'sources' && target.info.sources && target.info.sources[action.payload.index] !== undefined) {
					target.info.sources.splice(action.payload.index, 1);
				}
			}
		},
		updateContentItem: (state, action: { 
			payload: { 
				roundIndex: number; 
				themeIndex: number; 
				questionIndex: number; 
				paramName: string; 
				itemIndex: number; 
				property: 'value' | 'type' | 'duration' | 'placement' | 'isRef' | 'waitForFinish'; 
				value: string | boolean 
			} 
		}) => {
			const question = state.pack?.rounds[action.payload.roundIndex]
				?.themes[action.payload.themeIndex]?.questions[action.payload.questionIndex];
			if (question?.params[action.payload.paramName] && 'items' in question.params[action.payload.paramName]) {
				const param = question.params[action.payload.paramName] as ContentParam;
				if (param.items[action.payload.itemIndex]) {
					const item = param.items[action.payload.itemIndex];
					switch (action.payload.property) {
						case 'value':
							item.value = action.payload.value as string;
							break;
						case 'type':
							item.type = action.payload.value as ContentItem['type'];
							break;
						case 'duration':
							item.duration = action.payload.value as string;
							break;
						case 'placement':
							item.placement = action.payload.value as ContentItem['placement'];
							break;
						case 'isRef':
							item.isRef = action.payload.value as boolean;
							break;
						case 'waitForFinish':
							item.waitForFinish = action.payload.value as boolean;
							break;
						default:
							break;
					}
				}
			}
		},
		setContentItemType: (state, action: {
			payload: {
				roundIndex: number;
				themeIndex: number;
				questionIndex: number;
				paramName: string;
				itemIndex: number;
				type: ContentType;
			}
		}) => {
			const question = state.pack?.rounds[action.payload.roundIndex]
				?.themes[action.payload.themeIndex]?.questions[action.payload.questionIndex];

			if (question?.params[action.payload.paramName] && 'items' in question.params[action.payload.paramName]) {
				const param = question.params[action.payload.paramName] as ContentParam;
				const item = param.items[action.payload.itemIndex];

				if (!item) {
					return;
				}

				removeOrphanedMediaFile(state, item, item);

				item.type = action.payload.type;

				if (action.payload.type === 'text') {
					item.value = '';
					item.isRef = false;
				}
			}
		},
		setContentItemMedia: (state, action: {
			payload: {
				roundIndex: number;
				themeIndex: number;
				questionIndex: number;
				paramName: string;
				itemIndex: number;
				type: Exclude<ContentType, 'text'>;
				fileName: string;
				fileData: Uint8Array;
			}
		}) => {
			const question = state.pack?.rounds[action.payload.roundIndex]
				?.themes[action.payload.themeIndex]?.questions[action.payload.questionIndex];

			if (question?.params[action.payload.paramName] && 'items' in question.params[action.payload.paramName]) {
				const param = question.params[action.payload.paramName] as ContentParam;
				const item = param.items[action.payload.itemIndex];

				if (!item) {
					return;
				}

				removeOrphanedMediaFile(state, item, item);
				const targetFolder = getMediaFolderName(action.payload.type);

				if (!targetFolder) {
					return;
				}

				const { fileName } = action.payload;

				if (state.zip) {
					state.zip.file(`${targetFolder}/${fileName}`, action.payload.fileData);
				}

				item.type = action.payload.type;
				item.value = action.payload.fileName;
				item.isRef = true;
			}
		},
		setCurrentItem: (state, action: {
			payload: {
				roundIndex?: number;
				themeIndex?: number;
				questionIndex?: number;
				isPackageSelected?: boolean;
			}
		}) => {
			state.roundIndex = action.payload.roundIndex;
			state.themeIndex = action.payload.themeIndex;
			state.questionIndex = action.payload.questionIndex;
			state.isPackageSelected = action.payload.isPackageSelected;
		},
		addContentScreen: (state, action: {
			payload: {
				roundIndex: number;
				themeIndex: number;
				questionIndex: number;
				paramName: string;
				afterScreenIndex: number;
			}
		}) => {
			const question = state.pack?.rounds[action.payload.roundIndex]
				?.themes[action.payload.themeIndex]?.questions[action.payload.questionIndex];

			if (question?.params[action.payload.paramName] && 'items' in question.params[action.payload.paramName]) {
				const param = question.params[action.payload.paramName] as ContentParam;
				// Find insertion point: count screen boundaries (waitForFinish items)
				let screenCount = 0;
				let insertIndex = param.items.length;

				for (let i = 0; i < param.items.length; i += 1) {
					if (param.items[i].waitForFinish) {
						screenCount += 1;

						if (screenCount === action.payload.afterScreenIndex + 1) {
							insertIndex = i + 1;
							break;
						}
					}
				}

				// If previous last item doesn't have waitForFinish, set it
				if (insertIndex > 0 && !param.items[insertIndex - 1].waitForFinish) {
					param.items[insertIndex - 1].waitForFinish = true;
				}

				// Insert a new text content item for the new screen
				const newItem: ContentItem = {
					type: 'text',
					value: '',
					isRef: false,
					placement: 'screen',
					waitForFinish: true,
				};

				param.items.splice(insertIndex, 0, newItem);
			}
		},
		removeContentScreen: (state, action: {
			payload: {
				roundIndex: number;
				themeIndex: number;
				questionIndex: number;
				paramName: string;
				screenIndex: number;
			}
		}) => {
			const question = state.pack?.rounds[action.payload.roundIndex]
				?.themes[action.payload.themeIndex]?.questions[action.payload.questionIndex];

			if (question?.params[action.payload.paramName] && 'items' in question.params[action.payload.paramName]) {
				const param = question.params[action.payload.paramName] as ContentParam;

				// Find the start and end indices of items belonging to the target screen
				let screenCount = 0;
				let screenStart = 0;
				let screenEnd = -1;

				for (let i = 0; i < param.items.length; i += 1) {
					if (param.items[i].waitForFinish) {
						if (screenCount === action.payload.screenIndex) {
							screenEnd = i;
							break;
						}

						screenCount += 1;
						screenStart = i + 1;
					}
				}

				// If we didn't find a waitForFinish for the last screen
				if (screenEnd === -1 && screenCount === action.payload.screenIndex) {
					screenEnd = param.items.length - 1;
				}

				if (screenEnd >= screenStart) {
					param.items.splice(screenStart, screenEnd - screenStart + 1);
				}

				if (param.items.length === 0) {
					delete question.params[action.payload.paramName];
				}
			}
		},
		addComplexAnswer: (state, action: {
			payload: {
				roundIndex: number;
				themeIndex: number;
				questionIndex: number;
			}
		}) => {
			const question = state.pack?.rounds[action.payload.roundIndex]
				?.themes[action.payload.themeIndex]?.questions[action.payload.questionIndex];

			if (question) {
				question.params.answer = {
					items: [{
						type: 'text',
						value: '',
						isRef: false,
						placement: 'screen',
						waitForFinish: true,
					}]
				};
			}
		},
		addScreenContentItem: (state, action: {
			payload: {
				roundIndex: number;
				themeIndex: number;
				questionIndex: number;
				paramName: string;
				screenIndex: number;
			}
		}) => {
			const question = state.pack?.rounds[action.payload.roundIndex]
				?.themes[action.payload.themeIndex]?.questions[action.payload.questionIndex];

			if (question?.params[action.payload.paramName] && 'items' in question.params[action.payload.paramName]) {
				const param = question.params[action.payload.paramName] as ContentParam;
				// Find the last item index of the target screen
				let screenCount = 0;
				let insertIndex = param.items.length;

				for (let i = 0; i < param.items.length; i += 1) {
					if (param.items[i].waitForFinish) {
						if (screenCount === action.payload.screenIndex) {
							insertIndex = i;
							// Remove waitForFinish from this item since a new item will follow
							param.items[i].waitForFinish = false;
							break;
						}

						screenCount += 1;
					}
				}

				const newItem: ContentItem = {
					type: 'text',
					value: '',
					isRef: false,
					placement: 'screen',
					waitForFinish: true,
				};

				param.items.splice(insertIndex + 1, 0, newItem);
			}
		},
		removeScreenContentItem: (state, action: {
			payload: {
				roundIndex: number;
				themeIndex: number;
				questionIndex: number;
				paramName: string;
				itemIndex: number;
			}
		}) => {
			const question = state.pack?.rounds[action.payload.roundIndex]
				?.themes[action.payload.themeIndex]?.questions[action.payload.questionIndex];

			if (question?.params[action.payload.paramName] && 'items' in question.params[action.payload.paramName]) {
				const param = question.params[action.payload.paramName] as ContentParam;
				const idx = action.payload.itemIndex;

				if (idx >= 0 && idx < param.items.length && param.items.length > 1) {
					const removedItem = param.items[idx];
					removeOrphanedMediaFile(state, removedItem, removedItem);

					// If the removed item had waitForFinish, transfer it to the previous item in the same screen
					if (removedItem.waitForFinish && idx > 0 && !param.items[idx - 1].waitForFinish) {
						param.items[idx - 1].waitForFinish = true;
					}

					param.items.splice(idx, 1);
				}
			}
		},
		addAnswerOption: (state, action: {
			payload: {
				roundIndex: number;
				themeIndex: number;
				questionIndex: number;
			}
		}) => {
			const question = state.pack?.rounds[action.payload.roundIndex]
				?.themes[action.payload.themeIndex]?.questions[action.payload.questionIndex];

			if (question) {
				if (!question.params.answerOptions) {
					question.params.answerOptions = {};
				}

				// Find the next available key (A, B, C, ...)
				const existingKeys = Object.keys(question.params.answerOptions);
				let nextKey = 'A';

				for (let i = 0; i < 26; i += 1) {
					const candidate = String.fromCharCode(65 + i);

					if (!existingKeys.includes(candidate)) {
						nextKey = candidate;
						break;
					}
				}

				question.params.answerOptions[nextKey] = {
					items: [{ type: 'text', value: '', isRef: false, placement: 'screen' }]
				};
			}
		},
		removeAnswerOption: (state, action: {
			payload: {
				roundIndex: number;
				themeIndex: number;
				questionIndex: number;
				key: string;
			}
		}) => {
			const question = state.pack?.rounds[action.payload.roundIndex]
				?.themes[action.payload.themeIndex]?.questions[action.payload.questionIndex];

			if (question?.params.answerOptions) {
				const { answerOptions } = question.params;
				const removedKey = action.payload.key;
				delete answerOptions[removedKey];

				const remainingKeys = Object.keys(answerOptions);

				if (remainingKeys.length === 0) {
					delete question.params.answerOptions;
				} else {
					// Rebuild options with sequential labels (A, B, C, ...)
					const oldToNewKeyMap: Record<string, string> = {};
					const values = remainingKeys.sort().map((oldKey, i) => {
						const newKey = String.fromCharCode(65 + i);
						oldToNewKeyMap[oldKey] = newKey;
						return answerOptions[oldKey];
					});

					// Clear all existing keys and reassign with new sequential labels
					for (const key of remainingKeys) {
						delete answerOptions[key];
					}

					values.forEach((value, i) => {
						const newKey = String.fromCharCode(65 + i);
						answerOptions[newKey] = value;
					});

					// Update right answer references to match new keys
					if (question.right?.answer) {
						for (let i = 0; i < question.right.answer.length; i += 1) {
							const mapped = oldToNewKeyMap[question.right.answer[i]];

							if (mapped !== undefined) {
								question.right.answer[i] = mapped;
							}
						}
					}
				}
			}
		},
		updateAnswerOptionValue: (state, action: {
			payload: {
				roundIndex: number;
				themeIndex: number;
				questionIndex: number;
				key: string;
				value: string;
			}
		}) => {
			const question = state.pack?.rounds[action.payload.roundIndex]
				?.themes[action.payload.themeIndex]?.questions[action.payload.questionIndex];

			if (question?.params.answerOptions?.[action.payload.key]) {
				const option = question.params.answerOptions[action.payload.key];

				if (option.items.length > 0) {
					option.items[0].value = action.payload.value;
				}
			}
		},
		togglePackageStats: (state) => {
			state.showPackageStats = !state.showPackageStats;
		},
		setMediaCompressionEnabled: (state, action: PayloadAction<boolean>) => {
			if (!state.mediaCompression) {
				state.mediaCompression = {
					...defaultMediaCompressionState,
					presets: { ...defaultMediaCompressionState.presets },
				};
			}
			state.mediaCompression.enabled = action.payload;
		},
		setMediaCompressionPreset: (state, action: PayloadAction<{ type: CompressibleMediaType; preset: CompressionPreset }>) => {
			if (!state.mediaCompression) {
				state.mediaCompression = {
					...defaultMediaCompressionState,
					presets: { ...defaultMediaCompressionState.presets },
				};
			}
			state.mediaCompression.presets[action.payload.type] = action.payload.preset;
		},
		bulkCompressionDialogOpened: (state) => {
			state.bulkCompression = { phase: 'confirm', total: 0, completed: 0, cancelRequested: false };
		},
		bulkCompressionDialogClosed: (state) => {
			state.bulkCompression = { phase: 'idle', total: 0, completed: 0, cancelRequested: false };
		},
		bulkCompressionCancelRequested: (state) => {
			if (!state.bulkCompression) {
				return;
			}
			if (state.bulkCompression.phase === 'running') {
				state.bulkCompression.cancelRequested = true;
			} else if (state.bulkCompression.phase === 'confirm') {
				state.bulkCompression.phase = 'idle';
			}
		},
		bulkCompressionStarted: (state, action: PayloadAction<{ total: number }>) => {
			state.bulkCompression = {
				phase: 'running',
				total: action.payload.total,
				completed: 0,
				cancelRequested: false,
			};
		},
		bulkCompressionProgress: (state, action: PayloadAction<{ completed: number; currentFile: string }>) => {
			if (state.bulkCompression?.phase === 'running') {
				state.bulkCompression.completed = action.payload.completed;
				state.bulkCompression.currentFile = action.payload.currentFile;
			}
		},
		bulkCompressionFinished: (state, action: PayloadAction<{ summary: BulkCompressionSummary }>) => {
			if (state.bulkCompression) {
				state.bulkCompression.phase = 'done';
				state.bulkCompression.completed = state.bulkCompression.total;
				state.bulkCompression.summary = action.payload.summary;
			}
		},
		bulkCompressionCancelled: (state) => {
			if (state.bulkCompression) {
				state.bulkCompression.phase = 'cancelled';
			}
		},
		bulkMediaCompressed: (state, action: PayloadAction<{ files: StagedMediaFile[] }>) => {
			if (!state.zip || !state.pack) {
				return;
			}

			// Write all new entries first, then remove replaced ones.
			for (const file of action.payload.files) {
				const folder = getMediaFolderName(file.type);

				if (folder) {
					state.zip.file(`${folder}/${file.newValue}`, file.data);
				}
			}

			const renames = new Map<string, string>();

			for (const file of action.payload.files) {
				const folder = getMediaFolderName(file.type);

				if (!folder) {
					continue;
				}

				// Remove the superseded original entry, including a URI-encoded
				// variant (a file referenced as 'my clip.mp4' may be stored as
				// 'Video/my%20clip.mp4'). This applies to identity renames too —
				// the compressed bytes are written under the raw name. Never
				// remove the just-written target.
				const writeTarget = `${folder}/${file.newValue}`;

				for (const oldPath of [`${folder}/${file.oldValue}`, `${folder}/${encodeURIComponent(file.oldValue)}`]) {
					if (oldPath !== writeTarget) {
						state.zip.remove(oldPath);
					}
				}

				if (file.newValue !== file.oldValue) {
					renames.set(`${file.type}:${file.oldValue}`, file.newValue);
				}
			}

			if (renames.size > 0) {
				renameMediaReferences(state.pack, renames);
			}

			// The package logo is a media reference outside question params;
			// keep it in sync when its file is renamed ('@' prefix preserved).
			if (state.pack.logo?.startsWith('@')) {
				const newLogoName = renames.get(`image:${state.pack.logo.substring(1)}`);

				if (newLogoName) {
					state.pack.logo = `@${newLogoName}`;
				}
			}

			// Bulk compression is intentionally not undoable: drop prior edit
			// history so undo cannot silently revert the apply.
			state.history = { past: [], future: [] };

			state.zipRevision = (state.zipRevision ?? 0) + 1;
		},
	},
	extraReducers: builder => {
		builder.addCase(openFile.fulfilled, (state, action) => {
			state.zip = action.payload.zip;
			state.pack = action.payload.pack;
			state.roundIndex = undefined;
			state.themeIndex = undefined;
			state.questionIndex = undefined;
			state.isPackageSelected = false;
			state.isNewPackage = false;
			state.packageStats = undefined;
			state.packageTopLevelStats = undefined;
			state.showPackageStats = false;
			state.bulkCompression = undefined;
			state.zipRevision = 0;
		});
		builder.addCase(createNewPackage.fulfilled, (state, action) => {
			state.zip = action.payload.zip;
			state.pack = action.payload.pack;
			state.roundIndex = undefined;
			state.themeIndex = undefined;
			state.questionIndex = undefined;
			state.isPackageSelected = false;
			state.isNewPackage = true;
			state.packageStats = undefined;
			state.packageTopLevelStats = undefined;
			state.showPackageStats = false;
			state.bulkCompression = undefined;
			state.zipRevision = 0;
		});
		builder.addCase(loadPackageStatistics.pending, (state) => {
			state.packageStatsLoading = true;
		});
		builder.addCase(loadPackageStatistics.fulfilled, (state, action) => {
			state.packageStats = action.payload.questionStats;
			state.packageTopLevelStats = action.payload.topLevelStats;
			state.packageStatsLoading = false;
			state.showPackageStats = true;
		});
		builder.addCase(loadPackageStatistics.rejected, (state) => {
			state.packageStatsLoading = false;
		});
		builder.addCase(compressAllPackageMedia.rejected, (state) => {
			// Defensive: an unexpected throw after bulkCompressionStarted would
			// otherwise leave phase='running' forever. bulkMediaCompressed never
			// dispatched, so the package is untouched (all-or-nothing contract).
			if (state.bulkCompression?.phase === 'running') {
				state.bulkCompression.phase = 'cancelled';
			}
		});
	},
});

export const {
	updatePackageProperty,
	updateRoundProperty,
	updateThemeProperty,
	updateQuestionProperty,
	updateQuestionParam,
	updateQuestionRightAnswer,
	updateQuestionWrongAnswer,
	addQuestionRightAnswer,
	removeQuestionRightAnswer,
	addQuestionWrongAnswer,
	removeQuestionWrongAnswer,
	addRound,
	removeRound,
	addTheme,
	removeTheme,
	addQuestion,
	removeQuestion,
	updateInfoProperty,
	updateTag,
	addTag,
	removeTag,
	addInfoItem,
	removeInfoItem,
	updateContentItem,
	setContentItemType,
	setContentItemMedia,
	addContentScreen,
	removeContentScreen,
	addScreenContentItem,
	removeScreenContentItem,
	addAnswerOption,
	removeAnswerOption,
	updateAnswerOptionValue,
	setCurrentItem,
	togglePackageStats,
	addComplexAnswer,
	resetQuestion,
	setMediaCompressionEnabled,
	setMediaCompressionPreset,
	bulkCompressionDialogOpened,
	bulkCompressionDialogClosed,
	bulkCompressionCancelRequested,
	bulkCompressionStarted,
	bulkCompressionProgress,
	bulkCompressionFinished,
	bulkCompressionCancelled,
	bulkMediaCompressed,
} = siquesterSlice.actions;

// Selector to get the current item based on the indices
export const selectCurrentItem = (state: { siquester: SIQuesterState }): Package | Round | Theme | Question | null => {
	const { pack, roundIndex, themeIndex, questionIndex, isPackageSelected } = state.siquester;

	if (!pack) {
		return null;
	}

	// If no indices are set, check if package is explicitly selected
	if (roundIndex === undefined) {
		return isPackageSelected ? pack : null;
	}

	const round = pack.rounds[roundIndex];
	if (!round) {
		return null;
	}

	// If only roundIndex is set, return the round
	if (themeIndex === undefined) {
		return round;
	}

	const theme = round.themes[themeIndex];
	if (!theme) {
		return null;
	}

	// If roundIndex and themeIndex are set, return the theme
	if (questionIndex === undefined) {
		return theme;
	}

	const question = theme.questions[questionIndex];
	return question || null;
};

// Helper function to find indices of an item in the package structure
export const findItemIndices = (pack: Package | null, targetItem: Package | Round | Theme | Question | null): { 
	roundIndex?: number;
	themeIndex?: number;
	questionIndex?: number;
} => {
	if (!targetItem || !pack) {
		return {};
	}

	if ('rounds' in targetItem) {
		// Package
		return {};
	}

	// Find the item in the package structure
	for (const [rIndex, currentRound] of pack.rounds.entries()) {
		if (currentRound === targetItem) {
			// Round
			return { roundIndex: rIndex };
		}

		for (const [tIndex, currentTheme] of currentRound.themes.entries()) {
			if (currentTheme === targetItem) {
				// Theme
				return { roundIndex: rIndex, themeIndex: tIndex };
			}

			for (const [qIndex, currentQuestion] of currentTheme.questions.entries()) {
				if (currentQuestion === targetItem) {
					// Question
					return { roundIndex: rIndex, themeIndex: tIndex, questionIndex: qIndex };
				}
			}
		}
	}

	return {};
};

export const undo = createAction('siquester/undo');
export const redo = createAction('siquester/redo');

const ignoreActions = new Set([
	'siquester/setCurrentItem',
	'siquester/togglePackageStats',
	'siquester/openFile/pending',
	'siquester/openFile/fulfilled',
	'siquester/openFile/rejected',
	'siquester/createNewPackage/pending',
	'siquester/createNewPackage/fulfilled',
	'siquester/createNewPackage/rejected',
	'siquester/bulkCompressionDialogOpened',
	'siquester/bulkCompressionDialogClosed',
	'siquester/bulkCompressionCancelRequested',
	'siquester/bulkCompressionStarted',
	'siquester/bulkCompressionProgress',
	'siquester/bulkCompressionFinished',
	'siquester/bulkCompressionCancelled',
	'siquester/bulkMediaCompressed',
	'siquester/compressAllPackageMedia/pending',
	'siquester/compressAllPackageMedia/fulfilled',
	'siquester/compressAllPackageMedia/rejected',
	'siquester/loadPackageStatistics/pending',
	'siquester/loadPackageStatistics/fulfilled',
	'siquester/loadPackageStatistics/rejected',
	'siquester/savePackage/pending',
	'siquester/savePackage/fulfilled',
	'siquester/savePackage/rejected',
	'siquester/undo',
	'siquester/redo',
]);

const baseReducer = siquesterSlice.reducer;

const siquesterReducer = (state: SIQuesterState | undefined, action: any): SIQuesterState => {
	const currentState = state || siquesterSlice.getInitialState();

	if (action.type === 'siquester/undo') {
		if (!currentState.history || currentState.history.past.length === 0) {
			return currentState;
		}
		const past = [...currentState.history.past];
		const future = [...currentState.history.future];
		const prevState = past.pop()!;
		
		const currentSnapshot = {
			pack: currentState.pack!,
			zipFiles: currentState.zip ? { ...currentState.zip.files } : undefined,
			roundIndex: currentState.roundIndex,
			themeIndex: currentState.themeIndex,
			questionIndex: currentState.questionIndex,
			isPackageSelected: currentState.isPackageSelected
		};
		future.push(currentSnapshot);

		if (currentState.zip && prevState.zipFiles) {
			(currentState.zip as any).files = prevState.zipFiles;
		}

		return {
			...currentState,
			pack: prevState.pack,
			roundIndex: prevState.roundIndex,
			themeIndex: prevState.themeIndex,
			questionIndex: prevState.questionIndex,
			isPackageSelected: prevState.isPackageSelected,
			history: {
				past,
				future
			}
		};
	}

	if (action.type === 'siquester/redo') {
		if (!currentState.history || currentState.history.future.length === 0) {
			return currentState;
		}
		const past = [...currentState.history.past];
		const future = [...currentState.history.future];
		const nextState = future.pop()!;

		const currentSnapshot = {
			pack: currentState.pack!,
			zipFiles: currentState.zip ? { ...currentState.zip.files } : undefined,
			roundIndex: currentState.roundIndex,
			themeIndex: currentState.themeIndex,
			questionIndex: currentState.questionIndex,
			isPackageSelected: currentState.isPackageSelected
		};
		past.push(currentSnapshot);

		if (currentState.zip && nextState.zipFiles) {
			(currentState.zip as any).files = nextState.zipFiles;
		}

		return {
			...currentState,
			pack: nextState.pack,
			roundIndex: nextState.roundIndex,
			themeIndex: nextState.themeIndex,
			questionIndex: nextState.questionIndex,
			isPackageSelected: nextState.isPackageSelected,
			history: {
				past,
				future
			}
		};
	}

	const shouldPushHistory = action.type.startsWith('siquester/') && !ignoreActions.has(action.type) && currentState.pack;
	
	let snapshotBefore: any = null;
	if (shouldPushHistory) {
		snapshotBefore = {
			pack: currentState.pack,
			zipFiles: currentState.zip ? { ...currentState.zip.files } : undefined,
			roundIndex: currentState.roundIndex,
			themeIndex: currentState.themeIndex,
			questionIndex: currentState.questionIndex,
			isPackageSelected: currentState.isPackageSelected
		};
	}

	const nextState = baseReducer(state, action);

	if (action.type === 'siquester/openFile/fulfilled' || action.type === 'siquester/createNewPackage/fulfilled') {
		return {
			...nextState,
			history: { past: [], future: [] }
		};
	}

	if (shouldPushHistory && nextState && nextState.pack && nextState.pack !== currentState.pack) {
		const past = currentState.history ? [...currentState.history.past] : [];
		past.push(snapshotBefore);
		if (past.length > 100) {
			past.shift();
		}
		return {
			...nextState,
			history: {
				past,
				future: []
			}
		};
	}

	return nextState;
};

export default siquesterReducer;