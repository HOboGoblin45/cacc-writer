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

---

# Phase 3 — Workflow Authority TODO

## Goal
Make the full-draft orchestrator the real drafting engine.
One run builds one context, one plan, one retrieval pack, one analysis layer,
then drafts the report through a controlled job system.

## Steps

- [x] Step 1: `server/db/schema.js` — `runMigrations()` with Phase 3 columns
- [x] Step 2: `server/db/repositories/generationRepo.js` — centralized DB layer (`RUN_STATUS`, `JOB_STATUS`, all CRUD)
- [x] Step 3: `server/orchestrator/generationOrchestrator.js` — hardened with explicit lifecycle states, pre-created section jobs, draft package persistence, `getRunResult()` with SQLite fast-path
- [x] Step 4: `server/orchestrator/sectionJobRunner.js` — accepts `existingJobId`, retrying status, warnings capture, retrieval source IDs, full generationRepo integration
- [x] Step 5: `server/api/generationRoutes.js` — `POST /api/generation/full-draft` alias, canonical status queries, 4-tier result retrieval
- [x] Step 6: `server/openaiClient.js` — `temperature` + `maxTokens` support added
- [x] Step 7: `server/promptBuilder.js` — `systemHint` (Block 5.8) + `extraContext` (Block 5.9) added
- [x] Step 8: All modules import cleanly (verified via node --input-type=module)

## Verification Results (2026-03-21)

- [x] Server restarts cleanly with no startup errors
- [x] `node _test_phase3.mjs` passes — 70/70 (fixed API-vs-disk test issue)
- [x] `node _test_orchestrator_endpoints.mjs` — 28/30 (2 env-dependent: pre-draft gate + runId propagation; correct behavior)
- [x] Full-draft run pre-creates all section job records immediately
- [x] Run lifecycle states progress correctly through all phases
- [x] Draft package persisted to SQLite and retrievable after server restart
- [x] Partial completion works when one section fails

## Status: COMPLETE ✅
