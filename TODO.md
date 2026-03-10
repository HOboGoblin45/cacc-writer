# Generate Tab UI Redesign — Phase 1 TODO

## Steps

- [x] Step 1: Add Google Fonts import to `index.html` `<head>`
- [x] Step 2: Add global `--gen-*` design tokens to `:root` in `index.html`
- [x] Step 3: Add new layout + component CSS scoped to `#tab-generate`
- [x] Step 4: Restructure `#tab-generate` HTML (command strip + workspace + inspector)
- [x] Step 5: Add `_updateGenStrip()` and `_updateInspector()` to `app.js`
- [x] Step 6: Wire up new JS calls in existing functions (`loadCase`, `renderFullDraftProgress`, `_fdOnComplete`)
- [x] Step 7: Verify all existing element IDs are intact and functional — 29/29 checks passed

## Status: COMPLETE ✓

## Backend Refactor Phase 1 (completed alongside UI work)

- [x] Extract `server/utils/caseUtils.js`, `fileUtils.js`, `textUtils.js`, `middleware.js`
- [x] Extract `server/ingestion/pdfExtractor.js`
- [x] Extract `server/api/casesRoutes.js` — mount fixed to `/api/cases`
- [x] Extract `server/api/generationRoutes.js`, `memoryRoutes.js`, `agentsRoutes.js`, `healthRoutes.js`
- [x] Mount all routers in `cacc-writer-server.js` (thin composition layer)
- [x] Verified 19/19 endpoints return 200 after server restart

---

# Cases Tab UI Redesign — Phase 2 TODO

## Steps

- [x] Step 1: Add Cases command strip inside `#tab-case` (scoped, no global shell changes)
- [x] Step 2: Refine `#tab-case` layout into workspace pattern (left queue panel ~37%, right detail panel ~63%)
- [x] Step 3: Keep all existing Cases controls/IDs intact while rearranging structure
- [x] Step 4: Add new CSS block scoped to `#tab-case` using `--gen-*` tokens
- [x] Step 5: Apply full light monochrome replacement inside `#tab-case` only (no mixed dark styles)
- [x] Step 6: Add denser queue/list treatment for scan efficiency (compact case rows, restrained badges)
- [x] Step 7: Preserve Generate tab and all other tabs unchanged in this phase
- [x] Step 8: Verify required Cases IDs and key layout classes are still present — 52/52 checks passed

## Status: COMPLETE ✓
