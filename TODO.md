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
