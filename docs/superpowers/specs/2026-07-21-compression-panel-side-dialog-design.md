# Compression Panel — Side-Dialog Redesign

**Date:** 2026-07-21
**Status:** Approved (brainstorm)
**Supersedes:** popover behaviour introduced by `2026-07-18-compression-toggle-design.md`
**Branch:** `feat/media-compress`

## Problem

The current `CompressionPanel` is mounted as a `Popup` popover anchored to the toolbar button. The `Popup` component (`src/components/common/Popup/Popup.tsx:50-83`) registers **both** `mousedown` and `mouseup` listeners on `document`, and its outside-click handler closes the popup whenever `mouseup` fires and `hideOnClick !== false` — including `mouseup` events that follow a `mousedown` inside the popup (e.g. clicking a checkbox or radio). The result: **the panel closes the moment the user clicks any field inside it**, making the per-media-type Low/Medium/High selectors effectively unusable.

Secondary concern: the popover pattern is visually and behaviourally inconsistent with the rest of the app's settings surfaces, which all use the right-hand side panel pattern (see `SettingsDialog`).

## Goal

Fix the close-on-inside-click bug and unify the compression settings UI with the existing settings-dialog pattern used elsewhere in the app.

## Non-Goals (YAGNI)

- No background overlay / dim layer (the reference `SettingsDialog` does not have one).
- No slide-in animation (the reference does not animate either; `.dialog.animated` exists in CSS but is not applied).
- No `TabControl` / tabs — the panel's content is small enough to fit in one view.
- No new unit tests for the UI component (the project has no React component test infrastructure; slice/state tests are unaffected).

## Design

### Container: `Popup` → `Dialog`

Replace the `Popup` wrapper with `Dialog` (`src/components/common/Dialog/Dialog.tsx`). `Dialog` renders:

```tsx
<section id={…} className="dialog {className}">
  <header><h1>{title}</h1></header>
  <button className="dialog_closeButton" onClick={onClose}>…close.svg…</button>
  {children}
</section>
```

It gives us, for free, the title header, the close (×) button, and a `ref`-able root element. It does **not** register any document-level click listeners (unlike `Popup`), so the close-on-inside-click bug disappears by construction.

### Close behaviour

Implement the same `mousedown`-based outside-click handler that `SettingsDialog` uses (`src/components/settings/SettingsDialog/SettingsDialog.tsx:32-46`):

```ts
const layout = React.useRef<HTMLDivElement>(null);

const hide = React.useCallback((e: Event): void => {
    if (!layout.current || (e.target instanceof Node && layout.current.contains(e.target as Node))) {
        return;
    }
    onClose();
}, [onClose]);

React.useEffect(() => {
    if (!open) return;
    window.addEventListener('mousedown', hide);
    return () => window.removeEventListener('mousedown', hide);
}, [open, hide]);
```

Key points:
- Listens to `mousedown` only (not `mouseup`). `mousedown` fires once per press, before the click completes, so interacting with form controls inside the dialog never triggers close.
- `layout.contains(e.target)` keeps clicks **inside** the dialog open.
- Listener is registered only while `open === true`, and removed on close/unmount.
- Close paths: (a) × button → `Dialog.onClose`; (b) `mousedown` outside the `section` → `hide`.

### Position & sizing

Pure CSS, mirroring `#settingsDialog` (`src/components/settings/SettingsDialog/SettingsDialog.css:1-6, 122-140`):

```scss
#compressionPanel {
    background-color: #000451;
    color: white;
    z-index: 25;
    overflow-y: hidden;
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

Base `Dialog` CSS already sets `position: absolute; top:0; left:0; bottom:0; right:0;`, so on mobile the panel covers the full screen; the media queries snap it to the right edge with a fixed width on tablet/desktop. Width values are slightly narrower than `SettingsDialog`'s 300/400/550 because the content is simpler; tuned to fit the three radio groups comfortably.

### Body layout

```scss
.compressionPanelBody {
    padding: 15px;
    font-size: 20px;
    height: calc(100% - 59px);  /* leave room for the <header> */
    display: flex;
    flex-direction: column;
    gap: 14px;
    overflow-y: auto;
    scrollbar-width: thin;
}
```

The existing BEM child classes are kept: `compressionPanel__toggle`, `compressionPanel__presets`, `compressionPanel__presets--disabled`, `compressionPanel__preset`, `compressionPanel__title`, `compressionPanel__divider`, `compressionPanel__compressAll`. Their rules move from the `.compressionPanel { … }` root into the `.compressionPanelBody` scope (or plain top-level — they are already unique).

### Trigger button in `PackageView`

The toolbar button (`src/components/siquester/PackageView/PackageView.tsx:414-433`) currently:
1. Reads `compressionButtonRef.current.getBoundingClientRect()`,
2. Stores it in `compressionPopoverStyle`,
3. Passes `style={compressionPopoverStyle}` to `CompressionPanel`.

All of that is popover-specific and is removed. The button becomes a plain toggle:

```tsx
onClick={() => setIsCompressionPanelOpen(true)}
```

The `aria-expanded={isCompressionPanelOpen}` attribute is kept (already correct for a dialog trigger).

Removed state/refs:
- `compressionButtonRef: React.useRef<HTMLButtonElement>` (line 45)
- `compressionPopoverStyle: React.useState<React.CSSProperties>` (line 46)
- `ref={compressionButtonRef}` attribute on the button
- `style={compressionPopoverStyle}` prop on `<CompressionPanel>`

The `mediaCompression.enabled ? 'editActive' : ''` highlight class on the trigger button is kept — it reflects persistent compression state, independent of whether the panel is open.

### Props change on `CompressionPanel`

```diff
 interface CompressionPanelProps {
     open: boolean;
     onClose: () => void;
-    style?: React.CSSProperties;
 }
```

`style` is no longer needed — all positioning is CSS-driven via the dialog's `#compressionPanel` id.

## Files Touched

| File | Change |
|---|---|
| `src/components/siquester/PackageView/components/CompressionPanel.tsx` | Rewrite: drop `Popup`, use `Dialog`; add `layout` ref + `hide`/`useEffect`; drop `style` prop. |
| `src/components/siquester/PackageView/components/CompressionPanel.scss` | Rewrite: `#compressionPanel` + `.compressionPanelBody` selectors; keep BEM child classes. |
| `src/components/siquester/PackageView/PackageView.tsx` | Remove `compressionButtonRef`, `compressionPopoverStyle`, rect calculation, `style` prop. |

## Edge Cases

- **Click on the toolbar trigger while panel open:** trigger is outside `layout` → `mousedown` handler closes the panel. A subsequent click reopens it. Acceptable, matches user expectation.
- **"Сжать всё…" button:** dispatches `bulkCompressionDialogOpened()` and calls `onClose()`. `CompressAllDialog` (mounted separately in `PackageView.tsx:439`) opens next. No stacking conflict — only one is visible at a time.
- **Window resize while open:** neither `SettingsDialog` nor this design closes on resize. Acceptable.
- **Rapid open/close (toggle):** `useEffect` cleanup removes the listener before re-registering; no leak, no double-fire.

## Testing / Verification

- `npx jest test/siquesterSlice.test.ts` — must stay 16/16 (slice unchanged).
- `npm run build-dev` — must compile (TypeScript strict + webpack).
- `npm run lint` — no new errors beyond the pre-existing baseline (see `AGENTS.md`: ~75 pre-existing lint errors in `test/**`/`tauri/**`).
- **Manual smoke test:** open the panel; toggle the checkbox; switch each radio group; confirm the panel does **not** close on any inside interaction; click outside → closes; × button → closes; "Сжать всё…" opens the bulk dialog.

## Rollback

Single-commit change on `feat/media-compress`. `git revert <sha>` restores the popover behaviour.
