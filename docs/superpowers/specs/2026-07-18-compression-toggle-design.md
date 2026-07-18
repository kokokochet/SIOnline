# Compression Toggle & Quality Presets — Design Spec

**Date:** 2026-07-18
**Branch:** `feat/media-compress`
**Status:** Approved (pending spec review)

## Problem

Media compression in the SIQuestor package editor is currently always-on and
invisible. The pre-upload file size limits (image 1 MB, audio 5 MB, video 10 MB)
are checked **before** compression, so large files that would compress well are
rejected at selection time. Users cannot tell compression is happening (beyond a
brief spinner) and cannot disable or tune it.

## Goals

1. Make compression **explicit and controllable** — a visible toggle in the
   editor toolbar.
2. Allow **disabling** compression entirely (fall back to original file, subject
   to size limits).
3. When compression is **enabled**, remove the pre-upload size limit so large
   files can be compressed; enforce the size limit **after** compression.
4. Offer **quality presets** (Low / Medium / High) so users can trade file size
   against quality without editing individual parameters.
5. Guard against browser OOM on extremely large inputs with a hard safety cap.

## Non-Goals

- Per-parameter sliders (resolution, bitrate, etc.) — out of scope; presets only.
- Persisting compression preferences across sessions — state is per editing
  session (like `isEditMode`).
- Changing the compression engine (canvas / WebCodecs / OGG Opus muxer).

## Architecture

### State — `siquesterSlice.ts`

Add to `SIQuesterState`:

```typescript
mediaCompression: {
    enabled: boolean;          // default: true
    preset: CompressionPreset; // default: 'medium'
}
```

Where `CompressionPreset = 'low' | 'medium' | 'high'` (defined in
`compressionTypes.ts`).

New actions:
- `setMediaCompressionEnabled(payload: boolean)`
- `setMediaCompressionPreset(payload: CompressionPreset)`

State lives in `siquesterSlice` (per editing session, not persisted) — mirrors
`isEditMode` semantics. It is **not** added to `resetCommonSettings` or any
persisted settings slice.

### Presets — new file `src/utils/mediaCompression/compressionPresets.ts`

Three `CompressionOptions` objects plus a lookup map:

| Parameter            | Low        | Medium (current default) | High              |
| -------------------- | ---------- | ------------------------ | ----------------- |
| image maxDimension   | 480        | 800                      | 1280              |
| image quality        | 0.6        | 0.8                      | 0.92              |
| image mimeType       | image/jpeg | image/jpeg               | image/jpeg        |
| audio bitrate        | 64_000     | 128_000                  | 192_000           |
| audio codec          | opus       | opus                     | opus              |
| audio sampleRate     | 48000      | 48000                    | 48000             |
| audio channels       | 2          | 2                        | 2                 |
| video maxHeight      | 480        | 720                      | 1080              |
| video bitrate        | 500_000    | 1_000_000                | 2_500_000         |
| video codec          | avc1.64001F| avc1.64001F              | avc1.640028 (L4.0)|
| video framerate      | 30         | 30                       | 30                |

Exports:
- `lowPreset`, `mediumPreset`, `highPreset`
- `compressionPresets: Record<CompressionPreset, CompressionOptions>`
- `defaultCompressionOptions` re-exported as `mediumPreset` for backward compat.

High preset uses `avc1.640028` (H.264 High profile, Level 4.0) because Level 3.1
(`avc1.64001F`) maxes at 720p. The existing `isConfigSupported` check in the
video worker handles unsupported codecs — if High is unsupported on a device,
the worker returns `error` and the caller falls back per existing error path.

### `compressMedia` signature change

```typescript
// Before
compressMedia(file: File, type: CompressibleMediaType): Promise<CompressedMedia>

// After
compressMedia(
    file: File,
    type: CompressibleMediaType,
    options: CompressionOptions,
): Promise<CompressedMedia>
```

`options` flows through to `compressImage` / `compressVideo` / `compressAudio`
(which already accept options internally — they currently receive
`defaultCompressionOptions`). The `index.ts` barrel stops hiding the options
param; callers pass the selected preset.

### ScreensView — size-check flow

`handleContentFileChange(type, event)`:

1. **Extension check** — unchanged, always runs.
2. **Hard safety cap** (200 MB, all types) — always runs, even when compression
   is ON. Prevents OOM during decode of huge files. Error:
   `fileIsTooBig` with the 200 MB value.
3. Branch on `mediaCompression.enabled`:
   - **ON:**
     - Skip `maxFileSizeMbByType` pre-check.
     - `setIsCompressing(true)`.
     - `compressMedia(file, type, presetOptions)`.
     - On success: check `compressed.data.byteLength` against
       `maxFileSizeMbByType[type]`. If exceeds → `dispatch(userErrorChanged(fileTooBigAfterCompression))`,
       do **not** insert. Otherwise insert via `setContentItemMedia`.
     - On exception: `dispatch(userErrorChanged(compressionFailed))`, do not
       insert (current behavior).
     - `finally: setIsCompressing(false)`.
   - **OFF:**
     - Check `file.size` against `maxFileSizeMbByType[type]` (current pre-check).
       If exceeds → `fileIsTooBig` error, return.
     - Insert original file directly via `setContentItemMedia` with the raw
       `Uint8Array` (no `compressMedia` call).

Content-type buttons are disabled while `isCompressing` (unchanged). The
`isCompressing` indicator ("Сжатие...") only appears when compression is ON and
in progress.

### UI — `CompressionPanel.tsx`

New component in
`src/components/siquester/PackageView/components/CompressionPanel.tsx`,
exported via the `components/index.ts` barrel.

**Trigger button** — added to the `PackageView` toolbar header (next to the
Edit/Redo/Statistics buttons). Icon: a compression symbol (e.g. arrows-in).
Visual state indicator: subtly highlighted/active when compression is ON.

**Popover** — opens on trigger click, closes on outside click (portal +
`onClickOutside` handler, following existing popup patterns in the codebase).
Contents:
- Checkbox: "Сжимать медиа" (`compressMedia` localization key).
- Radio group: Low / Medium / High (`compressionLow` / `compressionMedium` /
  `compressionHigh`). Disabled (greyed) when compression is OFF.

The component reads `mediaCompression` from `siquesterSlice` via `useAppSelector`
and dispatches `setMediaCompressionEnabled` / `setMediaCompressionPreset`.

### Localization

New keys in `src/model/resources/localization.ts` (en + ru):

| Key                          | EN                                  | RU                                       |
| ---------------------------- | ----------------------------------- | ---------------------------------------- |
| `compressMedia`              | Compress media                      | Сжимать медиа                            |
| `compressionLow`             | Low                                 | Низкое                                   |
| `compressionMedium`          | Medium                              | Среднее                                  |
| `compressionHigh`            | High                                | Высокое                                 |
| `compressionSettings`        | Compression settings                | Настройки сжатия                         |
| `fileTooBigAfterCompression` | File too big after compression ({0} MB) | Файл слишком большой после сжатия ({0} МБ) |

`{0}` is the `maxFileSizeMbByType[type]` value, substituted at call site.

## Hard Safety Cap

A constant `MAX_UPLOAD_BYTES = 200 * 1024 * 1024` (200 MB) in `ScreensView.tsx`
(or a shared constants module). Checked for **all** media uploads regardless of
compression state, **before** any compression/decode work. Rationale: decoding a
multi-hundred-MB video/audio file into memory can crash the tab before the 60 s
video timeout fires. 200 MB covers reasonable source files while preventing OOM.

## Error Handling Summary

| Scenario                                  | Behavior                                                       |
| ----------------------------------------- | -------------------------------------------------------------- |
| Extension not allowed                     | `unsupportedMediaType` error, no insert (unchanged)           |
| File > 200 MB hard cap                    | `fileIsTooBig (200 MB)` error, no insert                       |
| Compression ON, compressed > type limit   | `fileTooBigAfterCompression` error, no insert                  |
| Compression ON, compressMedia throws      | `compressionFailed` error, no insert (unchanged)              |
| Compression ON, codec unsupported         | passthrough inside `compressMedia`; post-limit check applies   |
| Compression OFF, file > type limit        | `fileIsTooBig` error, no insert (current behavior)            |
| Compression OFF, file OK                  | insert original (no compression)                               |

## Testing

- **`compressionPresets.test.ts`** (new) — verify each preset object has correct
  shape and values; verify `compressionPresets` map keys; verify
  `defaultCompressionOptions === mediumPreset`.
- **`mediaCompression.test.ts`** (update) — `compressMedia` now requires
  `options` arg; add cases passing low/medium/high presets and assert the
  options reach `compressImage`/etc. (mock the sub-compressors).
- **`siquesterSlice.test.ts`** (update) — `setMediaCompressionEnabled`,
  `setMediaCompressionPreset` actions toggle/preset state correctly; default
  state is `{ enabled: true, preset: 'medium' }`.
- **ScreensView** — post-compression size guard: when compressed output exceeds
  `maxFileSizeMbByType`, no `setContentItemMedia` dispatch and
  `fileTooBigAfterCompression` error fires. Hard cap tested similarly. (Follow
  existing ScreensView test patterns; mock `compressMedia`.)

## Files Touched

**New:**
- `src/utils/mediaCompression/compressionPresets.ts`
- `src/components/siquester/PackageView/components/CompressionPanel.tsx`
- `src/components/siquester/PackageView/components/CompressionPanel.scss`
- `test/compressionPresets.test.ts`

**Modified:**
- `src/utils/mediaCompression/compressionTypes.ts` — add `CompressionPreset` type.
- `src/utils/mediaCompression/index.ts` — export presets; `compressMedia` takes options.
- `src/utils/mediaCompression/compressVideo.ts` / `compressAudio.ts` / `compressImage.ts` — accept options from caller (already do internally).
- `src/state/siquesterSlice.ts` — `mediaCompression` state + 2 actions.
- `src/components/siquester/ScreensView/ScreensView.tsx` — branch on enabled; post-compression size check; hard cap.
- `src/components/siquester/PackageView/PackageView.tsx` — add `CompressionPanel` trigger button to toolbar.
- `src/model/resources/localization.ts` — new keys (en + ru).

## Open Questions

None — all decisions confirmed:
- Toggle location: editor toolbar (per-session state in `siquesterSlice`).
- Scope: toggle + quality presets (no individual sliders).
- UX: popover from toolbar button.
- Size limits: `maxFileSizeMbByType` enforced post-compression when ON; pre-check when OFF.
- OOM protection: hard 200 MB cap always enforced.
