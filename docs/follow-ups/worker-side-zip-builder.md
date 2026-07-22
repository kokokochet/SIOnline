# Follow-up: worker-side zip builder (loop-time peak reduction)

**Status:** Open. **Origin:** `docs/superpowers/plans/00-unified-change-plan.md` Section G (Vector 2 residual risk). **Owner:** unassigned (tracked here, not blocking merge).

## Why

Plan 06's `applyStagedFilesToZip` (T38/T39) halves the apply-time peak by eliminating the brief JSZip doubling, but the **loop-time** peak is unchanged: staging N compressed files in memory before the atomic apply means a pathological 30×200 MB package peaks at ~6 GB during the staging loop. The worker-isolation model means an OOM crashes the worker → graceful passthrough (not a tab crash), so this does not block merge, but it is the largest unaddressed memory risk.

## What

Move the zip-construction (`JSZip` load + `generateAsync`) off the main thread into a Web Worker so the staged-file heap lives in the worker's isolated heap, not the main thread's. The compression workers (`videoCompression.worker.ts`, `audioCompression.worker.ts`) already run isolated; a zip-builder worker would receive staged files via `postMessage` (transferables) and emit the final blob.

## Acceptance criteria

- [ ] A `zipBuilder.worker.ts` exists and owns the JSZip load + generate path.
- [ ] The main thread's loop-time peak for a 30×200 MB synthetic package is reduced by ≥50% vs the Phase 6 baseline (measure via DevTools Memory timeline).
- [ ] `npm run typecheck:all && npm run build-dev && npm run test && npm run lint` green.
- [ ] The atomic-apply all-or-nothing contract (T38) is preserved — a mid-apply throw still rolls back.

## Out of scope

- Streaming apply (chunk-by-chunk generate) — explicitly dropped in Resolution 4 (conflicts with the all-or-nothing contract).
- Replacing JSZip with a streaming zip library — separate decision, evaluate after the worker-isolation baseline is measured.
