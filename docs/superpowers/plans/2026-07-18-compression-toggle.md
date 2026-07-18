# Compression Toggle & Quality Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make media compression in the SIQuestor package editor explicit (visible toggle in the toolbar), disable-able, and tunable via Low/Medium/High quality presets — with the per-type file size limit enforced *after* compression (not before) when compression is ON.

**Architecture:** New `CompressionPreset` type + `compressionPresets.ts` module (Low/Medium/High `CompressionOptions` objects). `siquesterSlice` gains a per-session `mediaCompression: { enabled, preset }` state with two actions. `compressMedia` accepts an `options` argument. `ScreensView` branches on `enabled`: ON skips the pre-size-check, compresses, then enforces the limit post-compression; OFF does the current pre-check. A new `CompressionPanel` popover component (reusing the existing `Popup`) is wired into the `PackageView` toolbar. A 200 MB hard cap is always enforced to prevent OOM.

**Tech Stack:** TypeScript, React 17, Redux Toolkit, existing `Popup` portal component, existing `.imageButton` SCSS class, Jest.

**Spec:** `docs/superpowers/specs/2026-07-18-compression-toggle-design.md`

**Base commit:** `fa9d275` on branch `feat/media-compress`

---

## File Structure

**New:**
- `src/utils/mediaCompression/compressionPresets.ts` — Low/Medium/High `CompressionOptions` objects + `compressionPresets` map.
- `src/components/siquester/PackageView/components/CompressionPanel.tsx` — toolbar trigger button + popover.
- `src/components/siquester/PackageView/components/CompressionPanel.scss` — popover styling.
- `test/compressionPresets.test.ts` — preset values/shape tests.

**Modified:**
- `src/utils/mediaCompression/compressionTypes.ts` — add `CompressionPreset` type.
- `src/utils/mediaCompression/defaultOptions.ts` — re-export `mediumPreset` as `defaultCompressionOptions` for backward compat.
- `src/utils/mediaCompression/index.ts` — `compressMedia` takes `options`; export presets + type.
- `src/state/siquesterSlice.ts` — `mediaCompression` state field + 2 actions.
- `src/components/siquester/ScreensView/ScreensView.tsx` — branch on `enabled`; hard cap; post-compression size check; pass preset.
- `src/components/siquester/PackageView/PackageView.tsx` — render `CompressionPanel` in toolbar.
- `src/model/resources/localization.ts` — 6 new keys (en + ru).
- `test/mediaCompression.test.ts` — update `compressMedia` calls to pass options.
- `test/siquesterSlice.test.ts` — new action tests.

---

### Task 1: Add `CompressionPreset` type and presets module (TDD)

**Files:**
- Create: `src/utils/mediaCompression/compressionPresets.ts`
- Modify: `src/utils/mediaCompression/compressionTypes.ts`
- Test: `test/compressionPresets.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/compressionPresets.test.ts`:

```typescript
import {
    lowPreset,
    mediumPreset,
    highPreset,
    compressionPresets,
} from '../src/utils/mediaCompression/compressionPresets';
import { CompressionOptions, CompressionPreset } from '../src/utils/mediaCompression/compressionTypes';

describe('compressionPresets', () => {
    test('lowPreset has aggressive compression values', () => {
        expect(lowPreset.image.maxDimension).toBe(480);
        expect(lowPreset.image.quality).toBe(0.6);
        expect(lowPreset.audio.bitrate).toBe(64_000);
        expect(lowPreset.video.maxHeight).toBe(480);
        expect(lowPreset.video.bitrate).toBe(500_000);
    });

    test('mediumPreset matches the previous defaults (backward compat)', () => {
        expect(mediumPreset.image.maxDimension).toBe(800);
        expect(mediumPreset.image.quality).toBe(0.8);
        expect(mediumPreset.image.mimeType).toBe('image/jpeg');
        expect(mediumPreset.audio.bitrate).toBe(128_000);
        expect(mediumPreset.audio.codec).toBe('opus');
        expect(mediumPreset.audio.sampleRate).toBe(48000);
        expect(mediumPreset.audio.channels).toBe(2);
        expect(mediumPreset.video.maxHeight).toBe(720);
        expect(mediumPreset.video.bitrate).toBe(1_000_000);
        expect(mediumPreset.video.codec).toBe('avc1.64001F');
        expect(mediumPreset.video.framerate).toBe(30);
    });

    test('highPreset favors quality', () => {
        expect(highPreset.image.maxDimension).toBe(1280);
        expect(highPreset.image.quality).toBe(0.92);
        expect(highPreset.audio.bitrate).toBe(192_000);
        expect(highPreset.video.maxHeight).toBe(1080);
        expect(highPreset.video.bitrate).toBe(2_500_000);
        // Level 4.0 required for 1080p
        expect(highPreset.video.codec).toBe('avc1.640028');
    });

    test('compressionPresets map has all three keys', () => {
        const keys = Object.keys(compressionPresets).sort();
        expect(keys).toEqual(['high', 'low', 'medium']);
    });

    test('compressionPresets map values match the individual exports', () => {
        expect(compressionPresets.low).toBe(lowPreset);
        expect(compressionPresets.medium).toBe(mediumPreset);
        expect(compressionPresets.high).toBe(highPreset);
    });

    test('all presets satisfy the CompressionOptions shape', () => {
        const presets: CompressionPreset[] = ['low', 'medium', 'high'];
        for (const key of presets) {
            const opts: CompressionOptions = compressionPresets[key];
            expect(typeof opts.image.maxDimension).toBe('number');
            expect(typeof opts.image.quality).toBe('number');
            expect(typeof opts.image.mimeType).toBe('string');
            expect(typeof opts.audio.bitrate).toBe('number');
            expect(typeof opts.video.maxHeight).toBe('number');
            expect(typeof opts.video.bitrate).toBe('number');
            expect(opts.audio.channels === 1 || opts.audio.channels === 2).toBe(true);
        }
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/compressionPresets.test.ts --no-coverage`
Expected: FAIL with "Cannot find module '../src/utils/mediaCompression/compressionPresets'" and "CompressionPreset is not exported".

- [ ] **Step 3: Add `CompressionPreset` type to `compressionTypes.ts`**

In `src/utils/mediaCompression/compressionTypes.ts`, append after the `CompressibleMediaType` definition (line 2):

```typescript
/** Quality preset for media compression. */
export type CompressionPreset = 'low' | 'medium' | 'high';
```

- [ ] **Step 4: Create the presets module**

Create `src/utils/mediaCompression/compressionPresets.ts`:

```typescript
import { CompressionOptions, CompressionPreset } from './compressionTypes';

/**
 * Low quality preset — aggressive compression for smallest file size.
 * Images: 480px, quality 0.6. Audio: 64 kbps. Video: 480p, 500 kbps.
 */
export const lowPreset: CompressionOptions = {
    image: {
        maxDimension: 480,
        quality: 0.6,
        mimeType: 'image/jpeg',
    },
    audio: {
        bitrate: 64_000,
        codec: 'opus',
        sampleRate: 48000,
        channels: 2,
    },
    video: {
        maxHeight: 480,
        bitrate: 500_000,
        codec: 'avc1.64001F',
        framerate: 30,
    },
};

/**
 * Medium quality preset — balanced. Matches the previous hardcoded defaults.
 * Images: 800px, quality 0.8. Audio: 128 kbps. Video: 720p, 1000 kbps.
 */
export const mediumPreset: CompressionOptions = {
    image: {
        maxDimension: 800,
        quality: 0.8,
        mimeType: 'image/jpeg',
    },
    audio: {
        bitrate: 128_000,
        codec: 'opus',
        sampleRate: 48000,
        channels: 2,
    },
    video: {
        maxHeight: 720,
        bitrate: 1_000_000,
        codec: 'avc1.64001F',
        framerate: 30,
    },
};

/**
 * High quality preset — favors quality over file size.
 * Images: 1280px, quality 0.92. Audio: 192 kbps. Video: 1080p, 2500 kbps.
 * Uses H.264 Level 4.0 (avc1.640028) which is required for 1080p.
 */
export const highPreset: CompressionOptions = {
    image: {
        maxDimension: 1280,
        quality: 0.92,
        mimeType: 'image/jpeg',
    },
    audio: {
        bitrate: 192_000,
        codec: 'opus',
        sampleRate: 48000,
        channels: 2,
    },
    video: {
        maxHeight: 1080,
        bitrate: 2_500_000,
        codec: 'avc1.640028',
        framerate: 30,
    },
};

/** Lookup map from preset key to options. Used by the UI to resolve the active preset. */
export const compressionPresets: Record<CompressionPreset, CompressionOptions> = {
    low: lowPreset,
    medium: mediumPreset,
    high: highPreset,
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest test/compressionPresets.test.ts --no-coverage`
Expected: PASS — 6 tests.

- [ ] **Step 6: Commit**

```bash
git add src/utils/mediaCompression/compressionTypes.ts src/utils/mediaCompression/compressionPresets.ts test/compressionPresets.test.ts
git commit -m "feat: add CompressionPreset type and low/medium/high preset options"
```

---

### Task 2: Update `compressMedia` to accept options; re-export presets

**Files:**
- Modify: `src/utils/mediaCompression/index.ts`
- Modify: `src/utils/mediaCompression/defaultOptions.ts`
- Modify: `test/mediaCompression.test.ts`

- [ ] **Step 1: Update `defaultOptions.ts` to re-export `mediumPreset` for backward compat**

Replace the entire contents of `src/utils/mediaCompression/defaultOptions.ts` with:

```typescript
import { CompressionOptions } from './compressionTypes';
import { mediumPreset } from './compressionPresets';

/**
 * Default compression options. Kept for backward compatibility with existing
 * callers and tests. New callers should pass an explicit preset from
 * `compressionPresets` to `compressMedia`.
 *
 * Re-exports mediumPreset so existing `defaultCompressionOptions` imports keep
 * working without duplication.
 */
export const defaultCompressionOptions: CompressionOptions = mediumPreset;
```

- [ ] **Step 2: Update `index.ts` — `compressMedia` signature + preset re-exports**

Replace the entire contents of `src/utils/mediaCompression/index.ts` with:

```typescript
import { CompressibleMediaType, CompressedMedia, CompressionOptions } from './compressionTypes';
import { compressImage } from './compressImage';
import { compressVideo } from './compressVideo';
import { compressAudio } from './compressAudio';

export { defaultCompressionOptions } from './defaultOptions';
export {
    lowPreset,
    mediumPreset,
    highPreset,
    compressionPresets,
} from './compressionPresets';
export {
    isVideoCompressionSupported,
    isAudioCompressionSupported,
} from './featureDetection';
export type {
    CompressibleMediaType,
    CompressedMedia,
    CompressionOptions,
    CompressionPreset,
    ImageCompressionOptions,
    AudioCompressionOptions,
    VideoCompressionOptions,
} from './compressionTypes';

/**
 * Creates a passthrough result — the original file returned unchanged.
 * Used for unknown media types or as a fallback.
 */
async function passthrough(file: File): Promise<CompressedMedia> {
    const data = new Uint8Array(await file.arrayBuffer());
    return {
        data,
        fileName: file.name,
        originalSize: data.length,
        compressedSize: data.length,
        wasCompressed: false,
    };
}

/**
 * Compresses a media file with lossy compression.
 *
 * - Images: canvas + toBlob → JPEG — works everywhere
 * - Video: WebCodecs VideoEncoder → H.264 MP4 — Chrome/Edge only
 * - Audio: WebCodecs AudioEncoder → Opus in OGG — Chrome/Edge only
 *
 * Progressive enhancement: when WebCodecs is unavailable (Safari, Tauri-macOS),
 * the file is returned as-is. The editor remains fully functional.
 *
 * Safety check: if the compressed output is larger than the original,
 * the original file is returned unchanged.
 *
 * @param file - The media file to compress
 * @param type - The media type ('image', 'audio', 'video', 'html')
 * @param options - Compression options (typically from `compressionPresets[preset]`)
 * @returns Compressed media data with metadata
 */
export async function compressMedia(
    file: File,
    type: CompressibleMediaType | 'html',
    options: CompressionOptions,
): Promise<CompressedMedia> {
    // HTML is text-only, no compression
    if (type === 'html') {
        const text = await file.text();
        return {
            data: new TextEncoder().encode(text),
            fileName: file.name,
            originalSize: file.size,
            compressedSize: file.size,
            wasCompressed: false,
        };
    }

    switch (type) {
        case 'image':
            return compressImage(file, options.image);

        case 'audio':
            return compressAudio(file, options.audio);

        case 'video':
            return compressVideo(file, options.video);

        default:
            return passthrough(file);
    }
}
```

- [ ] **Step 3: Update `mediaCompression.test.ts` to pass options**

In `test/mediaCompression.test.ts`, make three edits.

First, update the imports at the top (line 1-9). Replace:

```typescript
import { defaultCompressionOptions } from '../src/utils/mediaCompression/defaultOptions';
import {
    isVideoCompressionSupported,
    isAudioCompressionSupported,
} from '../src/utils/mediaCompression/featureDetection';
import { calculateTargetDimensions } from '../src/utils/mediaCompression/compressImage';
import { compressVideo } from '../src/utils/mediaCompression/compressVideo';
import { compressAudio } from '../src/utils/mediaCompression/compressAudio';
import { compressMedia } from '../src/utils/mediaCompression';
```

with:

```typescript
import { defaultCompressionOptions } from '../src/utils/mediaCompression/defaultOptions';
import { compressionPresets } from '../src/utils/mediaCompression/compressionPresets';
import {
    isVideoCompressionSupported,
    isAudioCompressionSupported,
} from '../src/utils/mediaCompression/featureDetection';
import { calculateTargetDimensions } from '../src/utils/mediaCompression/compressImage';
import { compressVideo } from '../src/utils/mediaCompression/compressVideo';
import { compressAudio } from '../src/utils/mediaCompression/compressAudio';
import { compressMedia } from '../src/utils/mediaCompression';
```

Second, update the `compressMedia (public API)` describe block (lines 145-169). Replace:

```typescript
describe('compressMedia (public API)', () => {
    test('returns passthrough for HTML type', async () => {
        const file = new File(['<p>hello</p>'], 'test.html', { type: 'text/html' });
        const result = await compressMedia(file, 'html');

        expect(result.wasCompressed).toBe(false);
        expect(result.fileName).toBe('test.html');
    });

    test('returns passthrough for image when image compression not available', async () => {
        const originalDoc = globalThis.document;
        delete (globalThis as Record<string, unknown>).document;

        try {
            const file = new File([new Uint8Array([1, 2, 3])], 'test.png', { type: 'image/png' });
            const result = await compressMedia(file, 'image');

            expect(result.wasCompressed).toBe(false);
        } finally {
            if (originalDoc) {
                globalThis.document = originalDoc;
            }
        }
    });
});
```

with:

```typescript
describe('compressMedia (public API)', () => {
    test('returns passthrough for HTML type', async () => {
        const file = new File(['<p>hello</p>'], 'test.html', { type: 'text/html' });
        const result = await compressMedia(file, 'html', compressionPresets.medium);

        expect(result.wasCompressed).toBe(false);
        expect(result.fileName).toBe('test.html');
    });

    test('returns passthrough for image when image compression not available', async () => {
        const originalDoc = globalThis.document;
        delete (globalThis as Record<string, unknown>).document;

        try {
            const file = new File([new Uint8Array([1, 2, 3])], 'test.png', { type: 'image/png' });
            const result = await compressMedia(file, 'image', compressionPresets.medium);

            expect(result.wasCompressed).toBe(false);
        } finally {
            if (originalDoc) {
                globalThis.document = originalDoc;
            }
        }
    });

    test('accepts low preset options', async () => {
        const originalDoc = globalThis.document;
        delete (globalThis as Record<string, unknown>).document;

        try {
            const file = new File([new Uint8Array([1, 2, 3])], 'test.png', { type: 'image/png' });
            const result = await compressMedia(file, 'image', compressionPresets.low);

            expect(result.wasCompressed).toBe(false);
        } finally {
            if (originalDoc) {
                globalThis.document = originalDoc;
            }
        }
    });

    test('accepts high preset options', async () => {
        const originalDoc = globalThis.document;
        delete (globalThis as Record<string, unknown>).document;

        try {
            const file = new File([new Uint8Array([1, 2, 3])], 'test.png', { type: 'image/png' });
            const result = await compressMedia(file, 'image', compressionPresets.high);

            expect(result.wasCompressed).toBe(false);
        } finally {
            if (originalDoc) {
                globalThis.document = originalDoc;
            }
        }
    });
});
```

- [ ] **Step 4: Run the updated tests**

Run: `npx jest test/mediaCompression.test.ts test/compressionPresets.test.ts --no-coverage`
Expected: PASS — all tests.

- [ ] **Step 5: Run tsc to verify no type errors elsewhere**

Run: `npx tsc --noEmit --strict`
Expected: 0 errors. If `ScreensView.tsx` reports an error about `compressMedia` missing the 3rd argument, that's expected — Task 5 fixes it. If so, proceed; the error will be resolved in Task 5. Any other errors must be fixed before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/utils/mediaCompression/index.ts src/utils/mediaCompression/defaultOptions.ts test/mediaCompression.test.ts
git commit -m "feat: compressMedia accepts options arg; re-export presets from barrel"
```

---

### Task 3: Add `mediaCompression` state and actions to `siquesterSlice` (TDD)

**Files:**
- Modify: `src/state/siquesterSlice.ts`
- Modify: `test/siquesterSlice.test.ts`

- [ ] **Step 1: Write the failing tests**

Append the following to `test/siquesterSlice.test.ts` (after the last test, before the closing `});` of the top-level `describe`):

```typescript
	test('setMediaCompressionEnabled toggles the enabled flag', () => {
		const state: SIQuesterState = {};
		const nextState = reducer(state, setMediaCompressionEnabled(false));
		expect(nextState.mediaCompression?.enabled).toBe(false);
		expect(nextState.mediaCompression?.preset).toBe('medium');

		const reenabled = reducer(nextState, setMediaCompressionEnabled(true));
		expect(renabled.mediaCompression?.enabled).toBe(true);
	});

	test('setMediaCompressionPreset changes the preset', () => {
		const state: SIQuesterState = {};
		const nextState = reducer(state, setMediaCompressionPreset('high'));
		expect(nextState.mediaCompression?.preset).toBe('high');
		expect(nextState.mediaCompression?.enabled).toBe(true);
	});

	test('setMediaCompressionPreset preserves the enabled flag', () => {
		const disabled: SIQuesterState = {
			mediaCompression: { enabled: false, preset: 'medium' },
		};
		const nextState = reducer(disabled, setMediaCompressionPreset('low'));
		expect(nextState.mediaCompression?.preset).toBe('low');
		expect(nextState.mediaCompression?.enabled).toBe(false);
	});

	test('setMediaCompressionEnabled preserves the preset', () => {
		const high: SIQuesterState = {
			mediaCompression: { enabled: true, preset: 'high' },
		};
		const nextState = reducer(high, setMediaCompressionEnabled(false));
		expect(nextState.mediaCompression?.enabled).toBe(false);
		expect(nextState.mediaCompression?.preset).toBe('high');
	});
```

Also update the import at the top of `test/siquesterSlice.test.ts` (line 1). Replace:

```typescript
import reducer, { addComplexAnswer, resetQuestion, SIQuesterState, undo, redo, updatePackageProperty, updateRoundProperty, addRound, setContentItemMedia } from '../src/state/siquesterSlice';
```

with:

```typescript
import reducer, { addComplexAnswer, resetQuestion, SIQuesterState, undo, redo, updatePackageProperty, updateRoundProperty, addRound, setContentItemMedia, setMediaCompressionEnabled, setMediaCompressionPreset } from '../src/state/siquesterSlice';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/siquesterSlice.test.ts -t "setMediaCompression" --no-coverage`
Expected: FAIL with "setMediaCompressionEnabled is not exported" or similar.

- [ ] **Step 3: Add the state field and actions to `siquesterSlice.ts`**

First, add the `CompressionPreset` import. In `src/state/siquesterSlice.ts`, after line 14 (`import { parseXMLtoPackage } from '../model/siquester/packageLoader';`), add:

```typescript
import { CompressionPreset } from '../utils/mediaCompression/compressionTypes';
```

Second, extend `SIQuesterState`. Find the interface (line 17-47) and add a new field before the closing brace:

```typescript
	/** Per-session media compression settings. Not persisted across sessions. */
	mediaCompression?: {
		enabled: boolean;
		preset: CompressionPreset;
	};
```

So the end of the interface (lines 29-47) becomes:

```typescript
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
		preset: CompressionPreset;
	};
}
```

Third, update `initialState` (line 49). Replace:

```typescript
const initialState: SIQuesterState = {};
```

with:

```typescript
const initialState: SIQuesterState = {
	mediaCompression: {
		enabled: true,
		preset: 'medium',
	},
};
```

Fourth, add the two reducer actions. Find the `togglePackageStats` reducer (line 1106-1108):

```typescript
		togglePackageStats: (state) => {
			state.showPackageStats = !state.showPackageStats;
		},
	},
```

Replace with:

```typescript
		togglePackageStats: (state) => {
			state.showPackageStats = !state.showPackageStats;
		},
		setMediaCompressionEnabled: (state, action: PayloadAction<boolean>) => {
			if (!state.mediaCompression) {
				state.mediaCompression = { enabled: true, preset: 'medium' };
			}
			state.mediaCompression.enabled = action.payload;
		},
		setMediaCompressionPreset: (state, action: PayloadAction<CompressionPreset>) => {
			if (!state.mediaCompression) {
				state.mediaCompression = { enabled: true, preset: 'medium' };
			}
			state.mediaCompression.preset = action.payload;
		},
	},
```

Fifth, export the new actions. Find the action export block (line 1150-1188). After `resetQuestion,` (line 1187), add the two new exports. Replace:

```typescript
	togglePackageStats,
	addComplexAnswer,
	resetQuestion,
} = siquesterSlice.actions;
```

with:

```typescript
	togglePackageStats,
	addComplexAnswer,
	resetQuestion,
	setMediaCompressionEnabled,
	setMediaCompressionPreset,
} = siquesterSlice.actions;
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `npx jest test/siquesterSlice.test.ts -t "setMediaCompression" --no-coverage`
Expected: PASS — 4 tests.

- [ ] **Step 5: Run the full siquesterSlice test suite to verify no regressions**

Run: `npx jest test/siquesterSlice.test.ts --no-coverage`
Expected: PASS — all existing + 4 new tests.

- [ ] **Step 6: Commit**

```bash
git add src/state/siquesterSlice.ts test/siquesterSlice.test.ts
git commit -m "feat: add mediaCompression state and enabled/preset actions to siquesterSlice"
```

---

### Task 4: Add localization keys (en + ru)

**Files:**
- Modify: `src/model/resources/localization.ts`

- [ ] **Step 1: Add English keys**

In `src/model/resources/localization.ts`, find the English block (starts at line 6 `en: {`). Find the `compressionFailed` key (line 104):

```typescript
		compressionFailed: 'Compression failed',
```

After it, add the 6 new English keys:

```typescript
		compressionFailed: 'Compression failed',
		compressMedia: 'Compress media',
		compressionLow: 'Low',
		compressionMedium: 'Medium',
		compressionHigh: 'High',
		compressionSettings: 'Compression settings',
		fileTooBigAfterCompression: 'File too big after compression ({0} MB)',
```

- [ ] **Step 2: Add Russian keys**

Find the Russian block (starts at line 730 `ru: {`). Find the `compressionFailed` key (line 823):

```typescript
		compressionFailed: 'Ошибка сжатия',
```

After it, add the 6 new Russian keys:

```typescript
		compressionFailed: 'Ошибка сжатия',
		compressMedia: 'Сжимать медиа',
		compressionLow: 'Низкое',
		compressionMedium: 'Среднее',
		compressionHigh: 'Высокое',
		compressionSettings: 'Настройки сжатия',
		fileTooBigAfterCompression: 'Файл слишком большой после сжатия ({0} МБ)',
```

- [ ] **Step 3: Verify tsc compiles**

Run: `npx tsc --noEmit --strict`
Expected: 0 errors (or only the expected `compressMedia` arg-count error in ScreensView.tsx, to be fixed in Task 5).

- [ ] **Step 4: Commit**

```bash
git add src/model/resources/localization.ts
git commit -m "feat: add compression toggle and preset localization keys (en, ru)"
```

---

### Task 5: Update ScreensView — hard cap, post-compression size check, preset passthrough

**Files:**
- Modify: `src/components/siquester/ScreensView/ScreensView.tsx`

- [ ] **Step 1: Add the hard cap constant and preset import**

In `src/components/siquester/ScreensView/ScreensView.tsx`, the imports currently look like this (lines 1-19):

```typescript
import React from 'react';
import { ContentItem, ContentParam, ContentType } from '../../../model/siquester/package';
import MediaItem from '../MediaItem/MediaItem';
import AutoSizedText from '../../common/AutoSizedText/AutoSizedText';
import localization from '../../../model/resources/localization';
import Constants from '../../../model/enums/Constants';
import { useAppDispatch } from '../../../state/hooks';
import getExtension from '../../../utils/FileHelper';
import { userErrorChanged } from '../../../state/commonSlice';
import { compressMedia } from '../../../utils/mediaCompression';
import {
	updateContentItem,
	setContentItemType,
	setContentItemMedia,
	addContentScreen,
	removeContentScreen,
	addScreenContentItem,
	removeScreenContentItem,
} from '../../../state/siquesterSlice';
```

`useAppSelector` is NOT currently imported. Make two edits:

First, on line 7, change `useAppDispatch` to import both hooks:

```typescript
import { useAppDispatch, useAppSelector } from '../../../state/hooks';
```

Second, after line 10 (`import { compressMedia } from '../../../utils/mediaCompression';`), add:

```typescript
import { compressionPresets } from '../../../utils/mediaCompression/compressionPresets';
```

Do NOT import `setMediaCompressionEnabled` / `setMediaCompressionPreset` here — those are used by `CompressionPanel` (Task 6), not ScreensView.

- [ ] **Step 2: Add the hard cap constant**

Find the `maxFileSizeMbByType` definition (lines 65-70):

```typescript
const maxFileSizeMbByType: Record<MediaContentType, number> = {
	image: 1,
	audio: 5,
	video: 10,
	html: 1,
};
```

After it, add:

```typescript
/**
 * Hard safety cap applied to ALL uploads regardless of compression state.
 * Prevents browser OOM when decoding multi-hundred-MB files into memory
 * (the 60s video timeout guards against hangs but not OOM).
 */
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MB
```

- [ ] **Step 3: Read the `mediaCompression` state inside the component**

Find the component body. Locate where `isCompressing` is declared (around line 171):

```typescript
	const [isCompressing, setIsCompressing] = React.useState(false);
```

After it, add a selector for the compression state:

```typescript
	const [isCompressing, setIsCompressing] = React.useState(false);
	const mediaCompression = useAppSelector(state => state.siquester.mediaCompression ?? { enabled: true, preset: 'medium' as const });
	const compressionEnabled = mediaCompression.enabled;
	const compressionOptions = compressionPresets[mediaCompression.preset];
```

If `useAppSelector` was not imported in Step 1, this step will fail tsc — fix by adding the import.

- [ ] **Step 4: Rewrite `handleContentFileChange` with the new flow**

Find `handleContentFileChange` (lines 569-615). Replace the entire function:

```typescript
	const handleContentFileChange = async (type: MediaContentType, event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		const target = pendingFileTargetRef.current;
		event.target.value = '';
		pendingFileTargetRef.current = null;

		if (!file || !target || target.type !== type || !canAddScreen || isCompressing) {
			return;
		}

		const extension = getExtension(file.name);
		const normalizedExtension = extension ? `.${extension.toLowerCase()}` : '';

		if (!allowedExtensionsByType[type].includes(normalizedExtension)) {
			dispatch(userErrorChanged(`${localization.unsupportedMediaType}: ${normalizedExtension || file.name}`));
			return;
		}

		// Hard safety cap — always enforced, even with compression ON, to prevent OOM.
		if (file.size > MAX_UPLOAD_BYTES) {
			const maxMb = Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024));
			dispatch(userErrorChanged(`${localization.fileIsTooBig} (${maxMb} MB)`));
			return;
		}

		const maxFileSizeMb = maxFileSizeMbByType[type];

		if (compressionEnabled) {
			// Compression ON: skip the pre-size-check; enforce limit AFTER compression.
			setIsCompressing(true);
			try {
				const compressed = await compressMedia(file, type, compressionOptions);

				if (compressed.data.byteLength > maxFileSizeMb * 1024 * 1024) {
					dispatch(userErrorChanged(localization.formatString(localization.fileTooBigAfterCompression, maxFileSizeMb) as string));
					return;
				}

				dispatch(setContentItemMedia({
					roundIndex: roundIndex as number,
					themeIndex: themeIndex as number,
					questionIndex: questionIndex as number,
					paramName: paramName as string,
					itemIndex: target.itemIndex,
					type,
					fileName: compressed.fileName,
					fileData: compressed.data,
				}));
			} catch (err) {
				console.warn('Media compression failed:', err);
				dispatch(userErrorChanged(localization.compressionFailed));
			} finally {
				setIsCompressing(false);
			}
		} else {
			// Compression OFF: enforce the pre-upload size limit on the original file.
			if (file.size > maxFileSizeMb * 1024 * 1024) {
				dispatch(userErrorChanged(`${localization.fileIsTooBig} (${maxFileSizeMb} MB)`));
				return;
			}

			const data = new Uint8Array(await file.arrayBuffer());
			dispatch(setContentItemMedia({
				roundIndex: roundIndex as number,
				themeIndex: themeIndex as number,
				questionIndex: questionIndex as number,
				paramName: paramName as string,
				itemIndex: target.itemIndex,
				type,
				fileName: file.name,
				fileData: data,
			}));
		}
	};
```

Note: `localization.formatString(str, ...values)` is the `localized-strings` library's placeholder substitution method (see existing usage in `src/client/GameServerLocator.ts`). It substitutes `{0}`, `{1}`, etc. in the provided string and returns `string | any[]`, hence the `as string` cast. We pass the already-resolved `localization.fileTooBigAfterCompression` string (which the library resolves to the active language) as the first argument, and `maxFileSizeMb` as the substitution value.

- [ ] **Step 5: Update the `isCompressing` indicator gating**

Find the `isCompressing` indicator (lines 665-670):

```typescript
				{isCompressing ? (
					<div className='screensView__compressing' role='status' aria-live='polite'>
						<span className='screensView__compressing__spinner' aria-hidden='true' />
						{localization.compressing}
					</div>
				) : null}
```

This is already correct — only shows when `isCompressing` is true, which only happens when `compressionEnabled` is true. No change needed.

- [ ] **Step 6: Run tsc to verify no type errors**

Run: `npx tsc --noEmit --strict`
Expected: 0 errors.

- [ ] **Step 7: Run build to verify webpack compiles**

Run: `npm run build-dev`
Expected: 0 errors.

- [ ] **Step 8: Run lint**

Run: `npm run lint`
Expected: 0 errors (warnings acceptable). If lint complains about unused imports, remove them — ScreensView should only use `compressionPresets` and `useAppSelector` from the new imports added in Step 1.

- [ ] **Step 9: Run the full test suite**

Run: `npx jest test/mediaCompression.test.ts test/compressionPresets.test.ts test/siquesterSlice.test.ts --no-coverage`
Expected: PASS — all tests.

- [ ] **Step 10: Commit**

```bash
git add src/components/siquester/ScreensView/ScreensView.tsx
git commit -m "feat: ScreensView branches on compression toggle; hard 200MB cap; post-compression size check"
```

---

### Task 6: Create the `CompressionPanel` component

**Files:**
- Create: `src/components/siquester/PackageView/components/CompressionPanel.tsx`
- Create: `src/components/siquester/PackageView/components/CompressionPanel.scss`

- [ ] **Step 1: Create the SCSS file**

Create `src/components/siquester/PackageView/components/CompressionPanel.scss`:

```scss
.compressionPanel {
	min-width: 220px;
	padding: 12px 16px;
	display: flex;
	flex-direction: column;
	gap: 12px;

	&__toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		cursor: pointer;
		user-select: none;

		input {
			cursor: pointer;
		}
	}

	&__presets {
		display: flex;
		flex-direction: column;
		gap: 6px;

		&--disabled {
			opacity: 0.5;
			pointer-events: none;
		}
	}

	&__preset {
		display: flex;
		align-items: center;
		gap: 6px;
		cursor: pointer;
		user-select: none;

		input {
			cursor: pointer;
		}
	}

	&__title {
		font-weight: 600;
		font-size: 0.95em;
		margin: 0;
	}
}
```

- [ ] **Step 2: Create the component**

Create `src/components/siquester/PackageView/components/CompressionPanel.tsx`:

```tsx
import React from 'react';
import { useAppDispatch, useAppSelector } from '../../../../state/hooks';
import {
	setMediaCompressionEnabled,
	setMediaCompressionPreset,
} from '../../../../state/siquesterSlice';
import localization from '../../../../model/resources/localization';
import { CompressionPreset } from '../../../../utils/mediaCompression/compressionTypes';
import Popup from '../../../common/Popup/Popup';

import './CompressionPanel.scss';

const PRESETS: ReadonlyArray<{ value: CompressionPreset; label: string }> = [
	{ value: 'low', label: localization.compressionLow },
	{ value: 'medium', label: localization.compressionMedium },
	{ value: 'high', label: localization.compressionHigh },
];

interface CompressionPanelProps {
	open: boolean;
	onClose: () => void;
}

/**
 * Popover panel for media compression settings. Renders a toggle (on/off) and
 * a Low/Medium/High quality preset radio group. Mounted in the PackageView
 * toolbar; the trigger button lives in PackageView and toggles `open`.
 */
const CompressionPanel: React.FC<CompressionPanelProps> = ({ open, onClose }) => {
	const appDispatch = useAppDispatch();
	const mediaCompression = useAppSelector(
		state => state.siquester.mediaCompression ?? { enabled: true, preset: 'medium' as CompressionPreset }
	);

	if (!open) {
		return null;
	}

	return (
		<Popup className='compressionPanel' onClose={onClose}>
			<div className='compressionPanel__toggle'>
				<input
					id='compressMedia'
					type='checkbox'
					checked={mediaCompression.enabled}
					onChange={() => appDispatch(setMediaCompressionEnabled(!mediaCompression.enabled))}
				/>
				<label htmlFor='compressMedia'>{localization.compressMedia}</label>
			</div>

			<div className={`compressionPanel__presets ${!mediaCompression.enabled ? 'compressionPanel__presets--disabled' : ''}`}>
				<div className='compressionPanel__title'>{localization.compressionSettings}</div>
				{PRESETS.map(({ value, label }) => (
					<label key={value} className='compressionPanel__preset'>
						<input
							type='radio'
							name='compressionPreset'
							value={value}
							checked={mediaCompression.preset === value}
							onChange={() => appDispatch(setMediaCompressionPreset(value))}
						/>
						{label}
					</label>
				))}
			</div>
		</Popup>
	);
};

export default CompressionPanel;
```

- [ ] **Step 3: Run tsc to verify no type errors**

Run: `npx tsc --noEmit --strict`
Expected: 0 errors.

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: 0 errors for the new file.

- [ ] **Step 5: Commit**

```bash
git add src/components/siquester/PackageView/components/CompressionPanel.tsx src/components/siquester/PackageView/components/CompressionPanel.scss
git commit -m "feat: add CompressionPanel popover component (toggle + preset radio)"
```

---

### Task 7: Wire `CompressionPanel` into the `PackageView` toolbar

**Files:**
- Modify: `src/components/siquester/PackageView/PackageView.tsx`

- [ ] **Step 1: Add imports and state**

In `src/components/siquester/PackageView/PackageView.tsx`, add the import for `CompressionPanel`. After line 23 (`import MediaView from './components/MediaView/MediaView';`), add:

```typescript
import CompressionPanel from './components/CompressionPanel';
```

Add state for the popover. Find the component body's state declarations (around lines 36-40):

```typescript
	const [roundIndex, setRoundIndex] = React.useState(0);
	const [mode, setMode] = React.useState(Mode.Questions);
	const [isEditMode, setIsEditMode] = React.useState(isNewPackage ?? false);
	const roundsContainerRef = React.useRef<HTMLDivElement>(null);
	const [isScrollable, setIsScrollable] = React.useState(false);
```

After `const [isScrollable, setIsScrollable] = React.useState(false);`, add:

```typescript
	const [isCompressionPanelOpen, setIsCompressionPanelOpen] = React.useState(false);
	const mediaCompression = useAppSelector(state => state.siquester.mediaCompression ?? { enabled: true, preset: 'medium' as const });
```

- [ ] **Step 2: Add the trigger button to the toolbar**

Find the Edit button in the toolbar (lines 399-405):

```tsx
					<button
						type='button'
						className={`standard imageButton ${isEditMode ? 'editActive' : ''}`}
						onClick={toggleEditMode}
						title={localization.enableEditMode}>
						<img src={editImg} alt='Edit' />
					</button>
```

After it (before the statistics button at line 407), insert the compression trigger button:

```tsx
					<button
						type='button'
						className={`standard imageButton ${mediaCompression.enabled ? 'editActive' : ''}`}
						onClick={() => setIsCompressionPanelOpen(!isCompressionPanelOpen)}
						title={localization.compressionSettings}
						aria-expanded={isCompressionPanelOpen}
					>
						<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
							<path d="M3 9V7H10V9H7V15H10V17H3V15H6V9H3Z" fill="currentColor"/>
							<path d="M21 9V7H14V9H17V15H14V17H21V15H18V9H21Z" fill="currentColor"/>
							<path d="M10 11H14V13H10V11Z" fill="currentColor"/>
						</svg>
					</button>
					<CompressionPanel
						open={isCompressionPanelOpen}
						onClose={() => setIsCompressionPanelOpen(false)}
					/>
```

- [ ] **Step 3: Run tsc to verify no type errors**

Run: `npx tsc --noEmit --strict`
Expected: 0 errors.

- [ ] **Step 4: Run build to verify webpack compiles**

Run: `npm run build-dev`
Expected: 0 errors.

- [ ] **Step 5: Run lint**

Run: `npm run lint`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/siquester/PackageView/PackageView.tsx
git commit -m "feat: wire CompressionPanel trigger button into PackageView toolbar"
```

---

### Task 8: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx jest test/mediaCompression.test.ts test/compressionPresets.test.ts test/siquesterSlice.test.ts test/oggOpusMuxer.test.ts --no-coverage`
Expected: PASS — all tests.

- [ ] **Step 2: Run tsc**

Run: `npx tsc --noEmit --strict`
Expected: 0 errors.

- [ ] **Step 3: Run the production-ish build**

Run: `npm run build-dev`
Expected: 0 errors.

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: 0 errors.

- [ ] **Step 5: Manual browser smoke test**

Run `npm run start`, open `http://localhost:8080/`, navigate to Question Editor → create or open a package → expand to a question. Verify:

1. A new compression icon button appears in the toolbar (between Edit and Statistics). It is highlighted (active style) when compression is ON (default).
2. Clicking it opens a popover with a "Compress media" checkbox (checked) and a Low/Medium/High radio group (Medium selected).
3. Unchecking the checkbox disables (greys out) the radio group.
4. Loading a large image (>1 MB, e.g. a 5 MB PNG) with compression ON succeeds (no "file too big" error) and the compressed result is inserted.
5. Loading a large image with compression OFF shows the "file too big (1 MB)" error.
6. Switching presets changes compression behavior (a Low-preset image is smaller than a High-preset image of the same source).
7. The "Сжатие..." / "Compressing..." indicator appears during compression only when compression is ON.
8. Clicking outside the popover closes it.

If all checks pass, the feature is complete.

- [ ] **Step 6: Final commit (if any cleanup was needed)**

Only commit if steps 1-4 surfaced issues that required fixes. Otherwise skip.

```bash
git status
# If clean, nothing to commit. If fixes were applied:
git add -A
git commit -m "chore: final verification fixes for compression toggle feature"
```

---

## Summary

| Task | Description                                          | Tests |
| ---- | ---------------------------------------------------- | ----- |
| 1    | `CompressionPreset` type + presets module            | 6 new |
| 2    | `compressMedia` accepts options; barrel re-exports   | 2 new |
| 3    | `siquesterSlice` mediaCompression state + actions    | 4 new |
| 4    | Localization keys (en + ru)                          | -     |
| 5    | ScreensView branch on enabled; hard cap; post-check  | -     |
| 6    | `CompressionPanel` popover component                 | -     |
| 7    | Wire trigger button into PackageView toolbar         | -     |
| 8    | Final verification (build, tests, lint, manual)      | -     |

Total new tests: 12. Total commits: 7-8.
