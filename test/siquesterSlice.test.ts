import reducer, {
	addComplexAnswer,
	resetQuestion,
	SIQuesterState,
	undo,
	redo,
	updatePackageProperty,
	updateRoundProperty,
	addRound,
	setContentItemMedia,
	bulkMediaCompressed,
	defaultMediaCompressionState,
} from '../src/state/siquesterSlice';
import { createDefaultPackage } from '../src/model/siquester/packageGenerator';
import { applyStagedFilesToZip } from '../src/utils/mediaCompression/compressPackageMedia';
import JSZip from 'jszip';

describe('siquesterSlice', () => {
	test('addComplexAnswer initializes answer content with waitForFinish enabled', () => {
		const state: SIQuesterState = {
			pack: createDefaultPackage({
				packageName: '',
				authorName: '',
				roundCount: 1,
				themeCount: 1,
				questionCount: 1,
				includeFinalRound: false,
				finalThemeCount: 0,
			}),
			mediaCompression: defaultMediaCompressionState,
		};

		const nextState = reducer(state, addComplexAnswer({
			roundIndex: 0,
			themeIndex: 0,
			questionIndex: 0,
		}));

		expect(nextState.pack?.rounds[0].themes[0].questions[0].params.answer?.items).toEqual([
			{
				type: 'text',
				value: '',
				isRef: false,
				placement: 'screen',
				waitForFinish: true,
			},
		]);
	});

	test('resetQuestion voids and unvoids a question back to default state', () => {
		const state: SIQuesterState = {
			pack: createDefaultPackage({
				packageName: '',
				authorName: '',
				roundCount: 1,
				themeCount: 1,
				questionCount: 1,
				includeFinalRound: false,
				finalThemeCount: 0,
			}),
			mediaCompression: defaultMediaCompressionState,
		};

		state.pack!.rounds[0].themes[0].questions[0] = {
			price: 100,
			type: 'secret',
			params: {
				question: {
					items: [{
						type: 'text',
						value: 'Filled',
						isRef: false,
						placement: 'screen',
					}]
				},
				answerType: 'number',
				answerDeviation: '2',
			},
			right: {
				answer: ['42']
			},
			wrong: {
				answer: ['41']
			},
		};

		const voidedState = reducer(state, resetQuestion({
			roundIndex: 0,
			themeIndex: 0,
			questionIndex: 0,
		}));

		expect(voidedState.pack?.rounds[0].themes[0].questions[0]).toEqual({
			price: -1,
			params: {
				question: {
					items: [{
						type: 'text',
						value: '',
						isRef: false,
						placement: 'screen',
					}]
				}
			},
			right: {
				answer: ['']
			}
		});

		const restoredState = reducer(voidedState, resetQuestion({
			roundIndex: 0,
			themeIndex: 0,
			questionIndex: 0,
		}));

		expect(restoredState.pack?.rounds[0].themes[0].questions[0]).toEqual({
			price: 0,
			params: {
				question: {
					items: [{
						type: 'text',
						value: '',
						isRef: false,
						placement: 'screen',
					}]
				}
			},
			right: {
				answer: ['']
			}
		});
	});

	test('setContentItemMedia replaces raw-named media files without leaving orphaned entries', () => {
		const mockZip = new JSZip();
		mockZip.file('Images/my image.png', 'old content');

		const state: SIQuesterState = {
			zip: mockZip,
			pack: createDefaultPackage({
				packageName: '',
				authorName: '',
				roundCount: 1,
				themeCount: 1,
				questionCount: 1,
				includeFinalRound: false,
				finalThemeCount: 0,
			}),
			mediaCompression: defaultMediaCompressionState,
		};

		state.pack!.rounds[0].themes[0].questions[0].params.question = {
			items: [{
				type: 'image',
				value: 'my image.png',
				isRef: true,
				placement: 'screen',
			}],
		};

		const nextState = reducer(state, setContentItemMedia({
			roundIndex: 0,
			themeIndex: 0,
			questionIndex: 0,
			paramName: 'question',
			itemIndex: 0,
			type: 'image',
			fileName: 'new image.png',
			fileData: 'bmV3IGNvbnRlbnQ=',
		}));

		expect(nextState.zip?.file('Images/my image.png')).toBeNull();
		expect(nextState.zip?.file('Images/new image.png')).not.toBeNull();
		expect(nextState.pack?.rounds[0].themes[0].questions[0].params.question).toEqual({
			items: [{
				type: 'image',
				value: 'new image.png',
				isRef: true,
				placement: 'screen',
			}],
		});
	});

	describe('undo/redo functionality', () => {
		let initialState: SIQuesterState;

		beforeEach(() => {
			initialState = {
				pack: createDefaultPackage({
					packageName: 'Initial Name',
					authorName: 'Author',
					roundCount: 1,
					themeCount: 1,
					questionCount: 1,
					includeFinalRound: false,
					finalThemeCount: 0,
				}),
				roundIndex: 0,
				themeIndex: 0,
				questionIndex: 0,
				isPackageSelected: false,
				mediaCompression: defaultMediaCompressionState,
			};
		});

		test('undo and redo revert and reapply state correctly', () => {
			// Perform edit
			const state1 = reducer(initialState, updatePackageProperty({
				property: 'name',
				value: 'Modified Name'
			}));

			expect(state1.pack?.name).toBe('Modified Name');
			expect(state1.history?.past.length).toBe(1);
			expect(state1.history?.past[0].pack.name).toBe('Initial Name');
			expect(state1.history?.future.length).toBe(0);

			// Perform second edit
			const state2 = reducer(state1, updatePackageProperty({
				property: 'name',
				value: 'Second Modification'
			}));

			expect(state2.pack?.name).toBe('Second Modification');
			expect(state2.history?.past.length).toBe(2);
			expect(state2.history?.past[1].pack.name).toBe('Modified Name');

			// Undo once
			const state3 = reducer(state2, undo());
			expect(state3.pack?.name).toBe('Modified Name');
			expect(state3.history?.past.length).toBe(1);
			expect(state3.history?.future.length).toBe(1);
			expect(state3.history?.future[0].pack.name).toBe('Second Modification');

			// Undo twice
			const state4 = reducer(state3, undo());
			expect(state4.pack?.name).toBe('Initial Name');
			expect(state4.history?.past.length).toBe(0);
			expect(state4.history?.future.length).toBe(2);
			expect(state4.history?.future[1].pack.name).toBe('Modified Name');

			// Redo once
			const state5 = reducer(state4, redo());
			expect(state5.pack?.name).toBe('Modified Name');
			expect(state5.history?.past.length).toBe(1);
			expect(state5.history?.future.length).toBe(1);

			// Redo twice
			const state6 = reducer(state5, redo());
			expect(state6.pack?.name).toBe('Second Modification');
			expect(state6.history?.past.length).toBe(2);
			expect(state6.history?.future.length).toBe(0);
		});

		test('undo/redo limits past history to 100 entries', () => {
			let state = initialState;
			for (let i = 1; i <= 105; i++) {
				state = reducer(state, updatePackageProperty({
					property: 'name',
					value: `Edit ${i}`
				}));
			}

			expect(state.pack?.name).toBe('Edit 105');
			expect(state.history?.past.length).toBe(100);
			// The oldest item remaining should be Edit 5 (since Edit 105 is current, past has Edit 5 to Edit 104)
			expect(state.history?.past[0].pack.name).toBe('Edit 5');
		});

		test('undo/redo restores selection state', () => {
			// Initially roundIndex is 0
			// Add a round
			const state1 = reducer(initialState, addRound());
			
			// Select round 1, then edit its name
			const stateWithSelection = {
				...state1,
				roundIndex: 1
			};
			const state2 = reducer(stateWithSelection, updateRoundProperty({
				roundIndex: 1,
				property: 'name',
				value: 'Round Two'
			}));

			// Change selection back to round 0
			const stateWithSelection2 = {
				...state2,
				roundIndex: 0
			};

			// Undo editing round 1's name
			const state3 = reducer(stateWithSelection2, undo());

			// The selection should be restored to roundIndex: 1 (where the edit happened)
			expect(state3.roundIndex).toBe(1);
			expect(state3.pack?.rounds[1].name).toBe('');
		});

		test('undo/redo restores zip files state', () => {
			const mockZip = new JSZip();
			mockZip.file('Images/test.png', 'test content');

			const stateWithZip = {
				...initialState,
				zip: mockZip
			};

			// Perform edit
			const state1 = reducer(stateWithZip, updatePackageProperty({
				property: 'name',
				value: 'New Name'
			}));

			// Simulate baseReducer's mutation of zip.files (adding a new file)
			mockZip.file('Audio/sound.mp3', 'sound content');

			// Perform second edit to snapshot the state with the added file
			const state2 = reducer(state1, updatePackageProperty({
				property: 'name',
				value: 'Another Name'
			}));

			expect(mockZip.file('Audio/sound.mp3')).not.toBeNull();

			// Undo the name change that happened after adding the file
			const state3 = reducer(state2, undo());

			// The zip files should still have 'Audio/sound.mp3'
			expect(mockZip.file('Audio/sound.mp3')).not.toBeNull();

			// Undo the name change that happened before adding the file
			const state4 = reducer(state3, undo());

			// The zip files should be restored to the state before sound.mp3 was added
			expect(mockZip.file('Audio/sound.mp3')).toBeNull();
			expect(mockZip.file('Images/test.png')).not.toBeNull();
		});
	});

	function makeBulkState(): SIQuesterState {
		const zip = new JSZip();
		zip.file('Images/pic.png', new Uint8Array([1, 2, 3]));
		zip.file('Images/my%20photo.png', new Uint8Array([4, 5, 6]));
		zip.file('Video/clip.mp4', new Uint8Array([7, 8, 9]));
		// Stored URI-encoded; referenced raw — exercises identity-rename cleanup.
		zip.file('Video/my%20clip.mp4', new Uint8Array([13, 14]));

		const pack = createDefaultPackage({
			packageName: '',
			authorName: '',
			roundCount: 1,
			themeCount: 1,
			questionCount: 1,
			includeFinalRound: false,
			finalThemeCount: 0,
		});

		pack.rounds[0].themes[0].questions[0].params.question = {
			items: [
				{ type: 'image', value: 'pic.png', isRef: true, placement: 'screen' },
				{ type: 'image', value: 'my photo.png', isRef: true, placement: 'screen' },
				{ type: 'video', value: 'clip.mp4', isRef: true, placement: 'screen' },
				{ type: 'video', value: 'my clip.mp4', isRef: true, placement: 'screen' },
			],
		};

		return { mediaCompression: defaultMediaCompressionState, pack, zip, zipRevision: 0, history: { past: [], future: [] } };
	}

	test('bulkMediaCompressed replaces zip entries, rewrites refs, bumps zipRevision, pushes one undo entry', async () => {
		const state = makeBulkState();
		// Pre-existing edit history must be APPENDED to, not wiped.
		state.history = { past: [{ pack: state.pack! }], future: [] };

		const files = [
			{ type: 'image' as const, oldValue: 'pic.png', newValue: 'pic.jpg', data: new Uint8Array([10]) },
			{ type: 'image' as const, oldValue: 'my photo.png', newValue: 'my photo.jpg', data: new Uint8Array([11]) },
			{ type: 'video' as const, oldValue: 'clip.mp4', newValue: 'clip.mp4', data: new Uint8Array([12]) },
			{ type: 'video' as const, oldValue: 'my clip.mp4', newValue: 'my clip.mp4', data: new Uint8Array([15]) },
		];

		const nextState = reducer(state, bulkMediaCompressed({ files }));

		expect(nextState.zip?.file('Images/pic.jpg')).not.toBeNull();
		expect(nextState.zip?.file('Images/pic.png')).toBeNull();
		expect(nextState.zip?.file('Images/my photo.jpg')).not.toBeNull();
		expect(nextState.zip?.file('Images/my%20photo.png')).toBeNull();
		expect(nextState.zipRevision).toBe(1);

		// Identity renames: new bytes are written under the raw name, and the
		// URI-encoded original entry is removed (no duplicate left behind).
		expect(await nextState.zip!.file('Video/clip.mp4')!.async('uint8array')).toEqual(new Uint8Array([12]));
		expect(await nextState.zip!.file('Video/my clip.mp4')!.async('uint8array')).toEqual(new Uint8Array([15]));
		expect(nextState.zip?.file('Video/my%20clip.mp4')).toBeNull();

		const items = nextState.pack!.rounds[0].themes[0].questions[0].params.question!.items;
		expect(items[0].value).toBe('pic.jpg');
		expect(items[1].value).toBe('my photo.jpg');
		expect(items[2].value).toBe('clip.mp4');
		expect(items[3].value).toBe('my clip.mp4');

		expect(nextState.history?.past).toHaveLength(2);
		expect(nextState.history?.past[0].pack).toBe(state.pack!);
		expect(nextState.history?.future).toHaveLength(0);
	});

	test('bulkMediaCompressed rewrites a package logo reference when its file is renamed', () => {
		const state = makeBulkState();
		state.pack!.logo = '@pic.png';

		const nextState = reducer(state, bulkMediaCompressed({
			files: [{ type: 'image' as const, oldValue: 'pic.png', newValue: 'pic.jpg', data: new Uint8Array([10]) }],
		}));

		expect(nextState.pack!.logo).toBe('@pic.jpg');
		expect(nextState.zip?.file('Images/pic.jpg')).not.toBeNull();
		expect(nextState.zip?.file('Images/pic.png')).toBeNull();
	});

	describe('apply atomicity', () => {
		test('applyStagedFilesToZip restores zip.files on a mid-apply throw (all-or-nothing)', () => {
		const zip = new JSZip();
			zip.file('Images/my a.png', new Uint8Array([1, 2, 3]));
			zip.file('Images/b.png', new Uint8Array([4, 5, 6]));

			const filesBefore = { ...zip.files };
			// NOTE: file A uses a URI-special oldValue ('my a.png') so its raw and
			// URI-encoded remove paths differ ('Images/my a.png' vs
			// 'Images/my%20a.png'); this produces two genuinely distinct remove
			// calls for file A. File B ('b.png') has identical raw/encoded paths.
			const files = [
				{ type: 'image' as const, oldValue: 'my a.png', newValue: 'my a.jpg', data: new Uint8Array([10]) },
				{ type: 'image' as const, oldValue: 'b.png', newValue: 'b.jpg', data: new Uint8Array([11]) },
			];

			// Inject a throw on the THIRD remove call — file B's first remove
			// (file A's two removes at calls 1 and 2 have already succeeded, so
			// file A's original entry is genuinely deleted by then). Without
			// snapshot/restore the zip would be left half-applied (file A gone,
			// file B untouched). We capture the real `remove` before the spy
			// overrides it so calls 1 and 2 genuinely mutate — proving a real
			// mutation happened before the throw and was rolled back.
			const realRemove = zip.remove.bind(zip);
			let removeCalls = 0;
			jest.spyOn(zip, 'remove').mockImplementation((path: string) => {
				removeCalls += 1;
				if (removeCalls === 3) {
					throw new Error('injected mid-apply');
				}
				return realRemove(path);
			});

			expect(() => applyStagedFilesToZip(zip, files)).toThrow('injected mid-apply');

			// All-or-nothing: both original entries present, neither write survived.
			// file A's restoration is the real rollback proof — it was deleted by
			// call 1 and only the snapshot/restore brings it back.
			expect(zip.file('Images/my a.png')).not.toBeNull();
			expect(zip.file('Images/my a.jpg')).toBeNull();
			expect(zip.file('Images/b.png')).not.toBeNull();
			expect(zip.file('Images/b.jpg')).toBeNull();
		expect(Object.keys(zip.files).sort()).toEqual(Object.keys(filesBefore).sort());
		});

		test('bulkMediaCompressed rolls back zip.files when a mid-apply remove throws (all-or-nothing)', () => {
			// JSZip is a class instance Immer cannot draft, so mutations to
			// `zip.files` bypass Immer's rollback. The reducer must route the
			// apply through `applyStagedFilesToZip` so a mid-apply throw restores
			// the zip (otherwise it is left half-applied while the pack draft is
			// discarded — an inconsistent state).
			const zip = new JSZip();
			zip.file('Images/my a.png', new Uint8Array([1, 2, 3]));
			zip.file('Images/b.png', new Uint8Array([4, 5, 6]));

			const filesBefore = { ...zip.files };

			const pack = createDefaultPackage({
				packageName: '',
				authorName: '',
				roundCount: 1,
				themeCount: 1,
				questionCount: 1,
				includeFinalRound: false,
				finalThemeCount: 0,
			});

			pack.rounds[0].themes[0].questions[0].params.question = {
				items: [
					{ type: 'image', value: 'my a.png', isRef: true, placement: 'screen' },
					{ type: 'image', value: 'b.png', isRef: true, placement: 'screen' },
				],
			};

			const state: SIQuesterState = { mediaCompression: defaultMediaCompressionState, pack, zip, zipRevision: 0, history: { past: [], future: [] } };

			const files = [
				{ type: 'image' as const, oldValue: 'my a.png', newValue: 'my a.jpg', data: new Uint8Array([10]) },
				{ type: 'image' as const, oldValue: 'b.png', newValue: 'b.jpg', data: new Uint8Array([11]) },
			];

			// Inject a throw on the THIRD remove call — file A's original raw
			// entry ('Images/my a.png') is genuinely deleted by call 1 before the
			// throw, so a non-atomic apply leaves it gone while the new write
			// survives. Snapshot/restore brings it back.
			const realRemove = zip.remove.bind(zip);
			let removeCalls = 0;
			jest.spyOn(zip, 'remove').mockImplementation((path: string) => {
				removeCalls += 1;
				if (removeCalls === 3) {
					throw new Error('injected mid-apply');
				}
				return realRemove(path);
			});

			expect(() => reducer(state, bulkMediaCompressed({ files }))).toThrow('injected mid-apply');

			expect(zip.file('Images/my a.png')).not.toBeNull();
			expect(zip.file('Images/my a.jpg')).toBeNull();
			expect(zip.file('Images/b.png')).not.toBeNull();
			expect(zip.file('Images/b.jpg')).toBeNull();
			expect(Object.keys(zip.files).sort()).toEqual(Object.keys(filesBefore).sort());
		});
	});

	describe('composite undo', () => {
		test('bulkMediaCompressed pushes one composite undo entry (not a wipe)', () => {
			const state = makeBulkState();
		const preApplyPack = state.pack!;

		// Pre-existing edit history must be PRESERVED (appended to), not wiped.
			state.history = {
				past: [{ pack: preApplyPack, roundIndex: 0, themeIndex: 0, questionIndex: 0 }],
				future: [{ pack: preApplyPack }],
			};

			const files = [
				{ type: 'image' as const, oldValue: 'pic.png', newValue: 'pic.jpg', data: new Uint8Array([10]) },
			];

			const nextState = reducer(state, bulkMediaCompressed({ files }));

			expect(nextState.history?.past).toHaveLength(2);
			expect(nextState.history?.past[0].pack).toBe(preApplyPack);
			expect(nextState.history?.future).toHaveLength(0);

			// The composite entry captured the PRE-apply pack + zip map.
			const composite = nextState.history?.past[1];
			expect(composite?.pack).toBe(preApplyPack);
			expect(composite?.zipFiles).toBeDefined();
			expect(composite?.zipFiles!['Images/pic.png']).toBeDefined();
		});

		test('undo() reverts the whole bulk apply in one step (pack + zip)', () => {
			const state = makeBulkState();
			const preApplyPack = state.pack!;

			state.history = { past: [], future: [] };

			const applied = reducer(state, bulkMediaCompressed({
				files: [{ type: 'image' as const, oldValue: 'pic.png', newValue: 'pic.jpg', data: new Uint8Array([10]) }],
			}));

			expect(applied.zip?.file('Images/pic.jpg')).not.toBeNull();
			expect(applied.zip?.file('Images/pic.png')).toBeNull();
			expect(applied.pack!.rounds[0].themes[0].questions[0].params.question!.items[0].value).toBe('pic.jpg');

			const undone = reducer(applied, undo());

			expect(undone.pack).toBe(preApplyPack);
			expect(undone.pack!.rounds[0].themes[0].questions[0].params.question!.items[0].value).toBe('pic.png');
			expect(undone.zip?.file('Images/pic.png')).not.toBeNull();
			expect(undone.zip?.file('Images/pic.jpg')).toBeNull();
		expect(undone.history?.future).toHaveLength(1);
	});
	});

});
