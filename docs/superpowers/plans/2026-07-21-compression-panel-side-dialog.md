# Compression Panel Side-Dialog Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `Popup`-based compression popover with a `Dialog`-based right-hand side panel (mirroring `SettingsDialog`), fixing the bug where any inside click closes the panel.

**Architecture:** Switch the container from `Popup` (which closes on inside `mouseup`) to `Dialog` (no document-level listeners). Add a `window.mousedown` outside-click handler identical to `SettingsDialog.tsx:32-46` so the panel closes only on outside clicks or the × button. Position/sizing is pure CSS via `#compressionPanel`, mirroring `#settingsDialog`. The toolbar trigger button loses its popover-anchoring machinery (`compressionButtonRef`, `compressionPopoverStyle`, rect calc, `style` prop).

**Tech Stack:** React 17 + TypeScript, SCSS, existing `Dialog` component (`src/components/common/Dialog/`).

**Spec:** `docs/superpowers/specs/2026-07-21-compression-panel-side-dialog-design.md`

**Branch:** `feat/media-compress`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/components/siquester/PackageView/components/CompressionPanel.tsx` | Rewrite | Render `Dialog`-based side panel; own its `open`/`onClose` contract; close on outside-`mousedown` and × button. |
| `src/components/siquester/PackageView/components/CompressionPanel.scss` | Rewrite | Side-panel chrome (background, right-anchored width via media queries) + body layout; keep BEM child classes for inner sections. |
| `src/components/siquester/PackageView/PackageView.tsx` | Modify (lines 44-47, 414-438) | Drop popover machinery; trigger button just opens the panel. |

No new files. Slice/state layer untouched.

---

### Task 1: Redesign `CompressionPanel` as a `Dialog`-based side panel

**Files:**
- Modify: `src/components/siquester/PackageView/components/CompressionPanel.tsx`
- Modify: `src/components/siquester/PackageView/components/CompressionPanel.scss`
- Modify: `src/components/siquester/PackageView/PackageView.tsx` (lines 44-47 state declarations, lines 414-438 button + `<CompressionPanel>` usage)

This is a single atomic change because the three files are coupled: removing the `style` prop from `CompressionPanelProps` requires the `PackageView` call site to drop `style={…}` in the same commit or TypeScript will fail to compile.

- [ ] **Step 1: Rewrite `CompressionPanel.tsx`**

Replace the entire file content with:

```tsx
import * as React from 'react';
import { useAppDispatch, useAppSelector } from '../../../../state/hooks';
import {
	bulkCompressionDialogOpened,
	defaultMediaCompressionState,
	setMediaCompressionEnabled,
	setMediaCompressionPreset,
} from '../../../../state/siquesterSlice';
import localization from '../../../../model/resources/localization';
import { CompressibleMediaType, CompressionPreset } from '../../../../utils/mediaCompression/compressionTypes';
import Dialog from '../../../common/Dialog/Dialog';

import './CompressionPanel.scss';

interface CompressionPanelProps {
	open: boolean;
	onClose: () => void;
}

/**
 * Side-dialog for media compression settings. Renders a toggle (on/off) and
 * per-media-type Low/Medium/High preset radio groups. Mounted in the PackageView
 * toolbar; the trigger button lives in PackageView and toggles `open`.
 *
 * Closing behaviour mirrors SettingsDialog: the × button (provided by Dialog)
 * and any `mousedown` outside the panel both call `onClose`. Listening on
 * `mousedown` (not `mouseup`) is what lets users interact with form controls
 * inside the panel without dismissing it.
 */
const CompressionPanel: React.FC<CompressionPanelProps> = ({ open, onClose }) => {
	const appDispatch = useAppDispatch();
	const mediaCompression = useAppSelector(state => state.siquester.mediaCompression ?? defaultMediaCompressionState);
	const layout = React.useRef<HTMLDivElement>(null);

	const presets: ReadonlyArray<{ value: CompressionPreset; label: string }> = [
		{ value: 'low', label: localization.compressionLow },
		{ value: 'medium', label: localization.compressionMedium },
		{ value: 'high', label: localization.compressionHigh },
	];

	const mediaTypes: ReadonlyArray<{ type: CompressibleMediaType; label: string }> = [
		{ type: 'image', label: localization.images },
		{ type: 'audio', label: localization.audio },
		{ type: 'video', label: localization.video },
	];

	const hide = React.useCallback((e: Event): void => {
		if (!layout.current || (e.target instanceof Node && layout.current.contains(e.target as Node))) {
			return;
		}

		onClose();
	}, [onClose]);

	React.useEffect(() => {
		if (!open) {
			return;
		}

		window.addEventListener('mousedown', hide);

		return () => {
			window.removeEventListener('mousedown', hide);
		};
	}, [open, hide]);

	if (!open) {
		return null;
	}

	return (
		<Dialog id='compressionPanel' ref={layout} title={localization.compressionSettings} onClose={onClose}>
			<div className='compressionPanelBody'>
				<div className='compressionPanel__toggle'>
					<input
						id='compressMedia'
						type='checkbox'
						checked={mediaCompression.enabled}
						onChange={() => appDispatch(setMediaCompressionEnabled(!mediaCompression.enabled))}
					/>
					<label htmlFor='compressMedia'>{localization.compressMedia}</label>
				</div>

				{mediaTypes.map(({ type, label }) => (
					<div
						key={type}
						className={`compressionPanel__presets ${!mediaCompression.enabled ? 'compressionPanel__presets--disabled' : ''}`}
					>
						<div className='compressionPanel__title'>{label}</div>
						{presets.map(({ value, label: presetLabel }) => (
							<label key={value} className='compressionPanel__preset'>
								<input
									type='radio'
									name={`compressionPreset-${type}`}
									value={value}
									checked={mediaCompression.presets[type] === value}
									disabled={!mediaCompression.enabled}
									onChange={() => appDispatch(setMediaCompressionPreset({ type, preset: value }))}
								/>
								{presetLabel}
							</label>
						))}
					</div>
				))}

				<div className='compressionPanel__divider' />

				<button
					type='button'
					className='compressionPanel__compressAll standard'
					onClick={() => {
						appDispatch(bulkCompressionDialogOpened());
						onClose();
					}}
				>
					{localization.compressAllMedia}
				</button>
			</div>
		</Dialog>
	);
};

export default CompressionPanel;
```

Notes for the implementer:
- `Dialog` is `React.forwardRef` typed `ForwardedRef<HTMLElement>`; passing a `React.useRef<HTMLDivElement>(null)` matches what `SettingsDialog.tsx:23` already does and compiles cleanly.
- Keep the `id='compressionPanel'` literal exactly — SCSS in Step 2 keys off `#compressionPanel`.
- Do not import `Popup` anymore.

- [ ] **Step 2: Rewrite `CompressionPanel.scss`**

Replace the entire file content with:

```scss
#compressionPanel {
	background-color: #000451;
	color: white;
	z-index: 25;
	overflow-y: hidden;
}

.compressionPanelBody {
	padding: 15px;
	font-size: 20px;
	height: calc(100% - 59px);
	display: flex;
	flex-direction: column;
	gap: 14px;
	overflow-y: auto;
	scrollbar-width: thin;

	.compressionPanel__toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		cursor: pointer;
		user-select: none;

		input {
			cursor: pointer;
		}
	}

	.compressionPanel__presets {
		display: flex;
		flex-direction: column;
		gap: 6px;

		&--disabled {
			opacity: 0.5;
			pointer-events: none;
		}
	}

	.compressionPanel__preset {
		display: flex;
		align-items: center;
		gap: 6px;
		cursor: pointer;
		user-select: none;

		input {
			cursor: pointer;
		}
	}

	.compressionPanel__title {
		font-weight: 600;
		font-size: 0.95em;
		margin: 0;
	}

	.compressionPanel__divider {
		border-top: 1px solid rgba(128, 128, 128, 0.3);
	}

	.compressionPanel__compressAll {
		padding: 6px 10px;
		cursor: pointer;
	}
}

@media screen and (min-width: 800px) {
	#compressionPanel {
		width: 320px;
		left: initial;
		border-left: 1px solid #FFFFFF;
	}
}

@media screen and (min-width: 1100px) {
	#compressionPanel {
		width: 380px;
	}
}
```

Notes:
- Base `Dialog` CSS (`src/components/common/Dialog/Dialog.css:1-10`) sets `position: absolute; top:0; left:0; bottom:0; right:0;` — so on mobile the panel fills the viewport; the media queries snap it to the right edge on tablet/desktop.
- Width values (320 / 380) are slightly narrower than `SettingsDialog` (300 / 400 / 550) because the content is simpler; tuned to fit the three radio groups.
- `height: calc(100% - 59px)` leaves room for the `<header><h1></h1></header>` from `Dialog` (matches `SettingsDialog.css:11`).

- [ ] **Step 3: Simplify the trigger button in `PackageView.tsx`**

Three edits inside `src/components/siquester/PackageView/PackageView.tsx`:

(a) Remove the popover state declarations (currently around lines 44-46). Delete these two lines:

```tsx
	const compressionButtonRef = React.useRef<HTMLButtonElement>(null);
	const [compressionPopoverStyle, setCompressionPopoverStyle] = React.useState<React.CSSProperties>({});
```

Keep `const [isCompressionPanelOpen, setIsCompressionPanelOpen] = React.useState(false);` (line 44).

(b) Simplify the trigger button (currently around lines 414-433). Remove `ref={compressionButtonRef}` and replace the `onClick` body. The button should become:

```tsx
				<button
					type='button'
					className={`standard imageButton ${mediaCompression.enabled ? 'editActive' : ''}`}
					onClick={() => setIsCompressionPanelOpen(true)}
					title={localization.compressionSettings}
					aria-expanded={isCompressionPanelOpen}
				>
					<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
						<path d="M3 9V7H10V9H7V15H10V17H3V15H6V9H3Z" fill="currentColor"/>
						<path d="M21 9V7H14V9H17V15H14V17H21V15H18V9H21Z" fill="currentColor"/>
						<path d="M10 11H14V13H10V11Z" fill="currentColor"/>
					</svg>
				</button>
```

(c) Drop the `style` prop on `<CompressionPanel>` (currently around lines 434-438). It should become:

```tsx
				<CompressionPanel
					open={isCompressionPanelOpen}
					onClose={() => setIsCompressionPanelOpen(false)}
				/>
```

Notes:
- The `mediaCompression.enabled ? 'editActive' : ''` highlight is kept — it reflects persistent compression state.
- `aria-expanded={isCompressionPanelOpen}` is kept — semantically correct for a dialog trigger.

- [ ] **Step 4: Verify the slice tests still pass (regression check)**

Run:

```bash
npx jest test/siquesterSlice.test.ts
```

Expected: `Tests: 16 passed, 16 total`. The slice is untouched by this change, so all 16 tests must remain green. If anything fails, the change leaked into state — revert and re-check.

- [ ] **Step 5: Verify the project builds**

Run:

```bash
npm run build-dev
```

Expected: webpack build completes without TypeScript errors. Common failure modes if this step fails:
- `Property 'style' does not exist on type 'CompressionPanelProps'` — Step 3(c) didn't drop the `style` prop from the call site.
- `Cannot find name 'compressionButtonRef'` — Step 3(a) removed the declaration but a reference remains in Step 3(b); re-check the button block.
- `compressionPopoverStyle is not defined` — same, leftover reference.

- [ ] **Step 6: Verify lint introduces no new errors**

Run:

```bash
npm run lint
```

Expected: no new errors compared to the pre-existing baseline (~75 errors in `test/**`/`tauri/**` per `AGENTS.md`). In particular:
- No `@typescript-eslint/no-unused-vars` for the removed `compressionButtonRef` / `compressionPopoverStyle` (they should be gone entirely, not just suppressed).
- No `react-hooks/exhaustive-deps` warning for the new `useEffect` in `CompressionPanel.tsx` — deps are `[open, hide]` and `hide` is wrapped in `useCallback` with `[onClose]`, which satisfies the rule.

If the baseline lint count changed, investigate before committing.

- [ ] **Step 7: Commit**

```bash
git add src/components/siquester/PackageView/components/CompressionPanel.tsx \
        src/components/siquester/PackageView/components/CompressionPanel.scss \
        src/components/siquester/PackageView/PackageView.tsx
git commit -m "refactor(compression): replace popover with side dialog (fix close-on-inside-click)"
```

---

### Task 2: Manual smoke test

UI changes are not covered by automated tests in this project. The implementer (or reviewer) must perform this manually before considering the work done.

**Files:** none (manual verification).

- [ ] **Step 1: Start the dev server**

```bash
npm run start
```

- [ ] **Step 2: Open the editor and load any `.siq` package with media**

Navigate to the PackageView (the siquester editor).

- [ ] **Step 3: Open the compression panel**

Click the compression (brackets) icon in the toolbar. Confirm:
- A right-hand side panel appears with the title "Настройки сжатия" (or the localized equivalent).
- A × button is visible in the top-right of the panel.
- The panel is anchored to the right edge on desktop widths; full-screen on narrow viewports.

- [ ] **Step 4: Verify inside clicks do NOT close the panel**

Without clicking outside, perform each of these and confirm the panel stays open:
- Toggle the "Сжать медиа" checkbox on, then off.
- Click each radio in the **Изображения** row (Низкое / Среднее / Высокое).
- Repeat for **Аудио** and **Видео** rows.
- Confirm the radios are disabled (greyed, not clickable) when "Сжать медиа" is off.

If the panel closes on any of these, the bug is not fixed — re-check Step 1 of Task 1 (the `mousedown`-only listener).

- [ ] **Step 5: Verify close paths work**

- Click the × button → panel closes.
- Reopen, then click anywhere outside the panel (e.g. on the rounds list) → panel closes.
- Reopen, then click the toolbar compression icon again → panel closes (the icon is outside `layout`). A further click reopens it.

- [ ] **Step 6: Verify "Сжать всё…" still works**

Reopen the panel, click "Сжать всё…". Confirm:
- The compression panel closes.
- The `CompressAllDialog` opens (the bulk-compression summary dialog).

No commit — this task is verification only.

---

## Self-Review

**Spec coverage:**
- ✅ Container: `Popup` → `Dialog` — Task 1, Step 1.
- ✅ Close behaviour (`mousedown` outside + × button, no `mouseup`) — Task 1, Step 1 (`hide` + `useEffect`).
- ✅ Position & sizing (`#compressionPanel` + media queries 320/380) — Task 1, Step 2.
- ✅ Body layout (`.compressionPanelBody`, BEM children preserved) — Task 1, Steps 1 & 2.
- ✅ Trigger button simplification (drop ref/state/rect/style prop) — Task 1, Step 3.
- ✅ Props change (`style` removed) — Task 1, Steps 1 & 3(c).
- ✅ Edge cases (toolbar trigger outside-click, "Сжать всё…", no resize-close) — covered by design, verified in Task 2.
- ✅ Testing (`jest`, `build-dev`, `lint`, manual smoke) — Task 1 Steps 4-6, Task 2.
- ✅ Rollback note — single-commit, trivially revertible (implicit from Task 1 Step 7).

**Placeholder scan:** No "TBD"/"TODO"/"implement later". Every step that changes code shows the full code. Every verification step shows the exact command and expected output.

**Type consistency:**
- `CompressionPanelProps` is `{ open: boolean; onClose: () => void }` in both Step 1 (definition) and Step 3(c) (call site) — `style` removed from both.
- `hide` callback signature `(e: Event): void` matches the `addEventListener('mousedown', …)` registration.
- `layout` ref type `HTMLDivElement` matches what `SettingsDialog.tsx:23` already uses with the same `Dialog` component.
- Localization keys used (`compressionSettings`, `compressMedia`, `compressAllMedia`, `compressionLow/Medium/High`, `images`, `audio`, `video`) are all already referenced in the current codebase, so no missing-key risk.

No issues found. Plan is ready for execution.
