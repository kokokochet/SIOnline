# Compression Toggle Split — Design Spec

Date: 2026-07-25
Branch: `feat/media-compress`

## Goal

Split the single compression toggle into three independent concerns:

1. A dedicated **"compress on upload"** checkbox (gates only upload-time compression in `ScreensView`).
2. **Always-active preset settings** (low/medium/high per media type), ungated by the checkbox.
3. A **per-media "Compress" button** in `MediaView` that compresses a single referenced file in place.

Constraint: minimal diff vs master; correctness for in-package operations.

## Background

Today `mediaCompression.enabled` does double duty: it gates upload compression (`ScreensView.tsx:608`) AND disables the presets UI + "Compress All" button (`CompressionPanel.tsx`). The bulk thunk `compressAllPackageMedia` itself ignores `enabled`; only the UI gates it. `mediaCompression` is **not persisted** across sessions (no migration needed).

## Design (chosen via 5 critic subagents + aggregator)

### Strategy: plain thunk, reusing existing `bulkMediaCompressed`

A plain (non-`createAsyncThunk`) thunk `compressSinglePackageMedia({ type, value })` performs all guards and dispatches the existing `bulkMediaCompressed({ files: [staged] })` reducer — which already handles atomic zip apply (`applyStagedFilesToZip`), reference renames, logo sync, composite undo, and `zipRevision` bump, and is already in the `actionTypes` allowlist.

Rationale: the shared serialization gate must live in the slice (it must also gate "Compress All" from `CompressionPanel`), so a component-local handler gains nothing. Guards are substantial and belong in a testable thunk (no `MediaView` component test exists).

### State changes (`src/state/siquesterSlice.ts`)

- Rename `mediaCompression.enabled` → `mediaCompression.compressOnUpload` (type, `defaultMediaCompressionState`, reducer). Rename action `setMediaCompressionEnabled` → `setCompressOnUpload`.
- Add `mediaCompressionBusy: boolean` to state + default + a toggle used by the single thunk (set true at start, false in finally). Read by both `MediaView` (per-item button) and `CompressionPanel` ("Compress All") to serialize.
- New thunk `compressSinglePackageMedia({ type, value })`:

  1. Snapshot `const { zip, pack } = getState().siquester` once; bail if missing.
  2. Reject `type === 'html'`.
  3. `resolveZipEntry`; if missing → return `{ kind: 'missing' }` (NO dispatch — otherwise `zip.file(path, undefined)` creates a 0-byte file + ref rewrite = corruption).
  4. Read uint8; if `> MAX_MEDIA_BYTES` → `{ kind: 'skipped' }`.
  5. `compressMedia(...)`; if `!wasCompressed` → `{ kind: 'skipped' }` (NO dispatch — reducer would push a phantom undo entry + needless `zipRevision` bump).
  6. Build single-item staged with **decoded-normalized `oldValue`** (mirror bulk's `ref.value` — NOT raw URI-encoded `file.path`, else `renameMediaReferences` misses → broken ref).
  7. `planRenames(staged, collectExistingMediaNames(zip))`; set `busy` true; dispatch `bulkMediaCompressed({ files: [stagedWithNewValue] })`; `busy` false in finally.
  8. Return `{ kind: 'applied' }`. On throw → `{ kind: 'error', message }`.

  **Concurrency:** `mediaCompressionBusy` is checked-and-set at thunk start; if already busy, bail (`{ kind: 'busy' }`). This strictly serializes single+single and single+bulk, defusing stale-`existingNames` collisions and content substitution.

  **Deliberately omitted:** identity re-check of `state.zip` against a captured ref before dispatch. Rationale: client-only app; the only way to reach it is the user deliberately opening a different package mid-compress; worst case is a harmless orphan file in the newly-opened package that is undoable — not data loss.

### CompressionPanel

- Checkbox binds to `compressOnUpload` with new label `compressOnUpload` ("Compress on upload" / "Сжимать при загрузке").
- Presets disabled only by codec support (`presetsDisabled = typeUnsupported`); remove the `!enabled` gate.
- "Compress All" disabled only while `mediaCompressionBusy` / bulk running; remove the `!enabled` gate and the `compressionDisabledHint` title.

### ScreensView

- `compressionEnabled` → `compressOnUpload` (rename local var + field; `if (compressionEnabled)` logic unchanged).

### PackageView

- Drop the `editActive` toolbar highlight tied to the flag (line 429) — it now misrepresents the panel's relevance.

### MediaView

- Per-item "Compress" button (reuse `compressionStart` label) under each image/audio/video item; not html; audio/video gated by `isAudioCompressionSupported()`/`isVideoCompressionSupported()`.
- Real `<button>` with `aria-label={formatString(compressionStart) + ': ' + file.name}`.
- Local `Set<string>` of in-flight file names → spinner/disabled on that button; disable all while `mediaCompressionBusy` is true.
- Handler dispatches `compressSinglePackageMedia`; on `{kind:'error'}` show an inline error badge on the item (global toast does not attribute the file).

### i18n (`src/model/resources/localization.ts`)

- Add `compressOnUpload` (EN + RU) and add to `COMPRESSION_KEYS` in `test/localization.compression.test.ts`.
- **Delete** `compressionDisabledHint` from both locales and from `COMPRESSION_KEYS` (it hard-quotes the old label «Сжимать медиа» and its premise — gating Compress All — is now false).
- Reuse `compressionStart` ("Сжать"/"Compress") for the per-media button — no new key.

## Tests

- Update rename sites: `test/siquesterSlice.test.ts` (import + lines 351-365), `test/compressAllPackageMedia.test.ts` (line 33).
- New `test/compressSinglePackageMedia.test.ts` reusing the existing `compressMedia` mock harness: passthrough no-op (no dispatch), entry-missing no dispatch, `MAX_MEDIA_BYTES` skip, error path, rename-collision wiring, logo sync, exactly-one `bulkMediaCompressed` dispatch with a 1-element array.

## Deferred (known limitations)

- Per-item cancel/abort (bulk lacks it too).
- Redo-history-clearing disclosure for per-item (asymmetry with bulk).
- Per-item compress parity in `ScreensView`.
- Unsupported-codec notices in `MediaView` tabs.
- `MediaView` `key={index}` → `key={type:path}` (cosmetic re-sort state leak).

## Estimated diff

~90-100 production lines vs master + ~60-80 test lines.
