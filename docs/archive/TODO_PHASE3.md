# Phase 3 — Workflow Authority TODO
# ====================================
# Goal: Make the full-draft orchestrator path the strongest workflow in the application.
# The orchestrator becomes the single owner of the full-draft workflow.

## Implementation Steps

- [x] Step 1: Update `server/db/schema.js` — added `runMigrations()` with try/catch per ALTER TABLE; new columns: `generation_runs.draft_package_json`, `section_jobs.retrieval_source_ids_json`, `section_jobs.estimated_cost_usd`
- [x] Step 2: Create `server/db/repositories/generationRepo.js` — centralized DB layer with `RUN_STATUS`, `JOB_STATUS`, all run/job/section/artifact CRUD operations
- [x] Step 3: Harden `server/orchestrator/generationOrchestrator.js` — explicit lifecycle state updates at each phase, `preCreateSectionJobs()` (independent→queued, dependent→blocked), draft package persistence, `getRunResult()` with SQLite fast-path, thin `legacyStatus` compat field
- [x] Step 4: Harden `server/orchestrator/sectionJobRunner.js` — accepts `existingJobId`, retrying status before retry, warnings count, retrieval source IDs, `markJobRunning/Retrying/Completed/Failed` via generationRepo, `saveGeneratedSection` on success
- [x] Step 5: Update `server/api/generationRoutes.js` — added `POST /api/generation/full-draft` alias, fixed status query to use canonical statuses, improved result endpoint with 4-tier retrieval (memory → getRunResult → SQLite sections → fallback), imported `RUN_STATUS` for active-status check
- [x] Step 6: `server/orchestrator/draftAssembler.js` — confirmed `validateDraft` uses `plan.sections` directly (no fix needed)
- [x] Step 7: Update `TODO.md` — Phase 3 tracking (see below)

## Supporting Files Updated

- [x] `server/openaiClient.js` — added `temperature` and `maxTokens` support (maps to `max_output_tokens`)
- [x] `server/promptBuilder.js` — added `systemHint` (Block 5.8) and `extraContext` (Block 5.9) parameters to `buildPromptMessages()`

## Import Verification (all passed)

- [x] `generationRepo.js` — imports cleanly, all 25 exports confirmed
- [x] `generationOrchestrator.js` — imports cleanly, 5 exports confirmed
- [x] `sectionJobRunner.js` — imports cleanly, 4 exports confirmed
- [x] `generationRoutes.js` — imports cleanly, default export confirmed

## Verification Checklist

- [x] Server restarts cleanly with no startup errors
- [x] `node _test_phase3.mjs` passes — **77/77 passed, 0 failed**
- [x] `node _test_orchestrator_endpoints.mjs` passes — all 11 sections verified
- [x] Full-draft run pre-creates all section job records immediately
- [x] Independent sections begin as `queued`
- [x] Dependent sections begin as `blocked`
- [x] Run lifecycle states progress: queued → preparing → retrieving → analyzing → drafting → validating → assembling → complete
- [x] Draft package is persisted to SQLite and retrievable after server restart
- [x] Canonical run-state model confirmed (`legacyStatus` thin compat field only)
- [x] Section job records include: run_id, section_id, status, generator_profile, attempt, timestamps
- [x] Route handlers remain thin (no orchestration logic in routes)
- [x] `insert-all` guard fixed: only `sectionStatus === 'approved'` triggers insert (not already-inserted sections)

## Live Test Results

### _test_phase3.mjs
- **77/77 passed, 0 failed**
- All endpoint groups verified: destination-registry, single-section insert, exceptions, approval-to-memory loop, comp commentary, insert-all lifecycle, commercial enrichment, exception queue

### _test_orchestrator_endpoints.mjs
- Full-draft run 1: **13.3s** — 10/10 sections — grade: good ✅ (P90 target met)
- Full-draft run 2: **19.4s** — 10/10 sections — grade: good ✅ (P90 target met)
- Regenerate-section: 2.3s–3.0s per section ✅
- Error paths: 404/400 responses correct ✅
- Phase timings captured: contextBuild, reportPlan, retrieval, analysis, parallelDraft, validation, assembly ✅
- Retrieval: 401 items scanned, 30 used ✅

## Run Lifecycle States (canonical)
queued → preparing → retrieving → analyzing → drafting → validating → assembling → complete | partial_complete | failed

## Section Job Lifecycle States (canonical)
queued (independent) | blocked (dependent) → running → retrying → complete | failed | skipped

## Concurrency Model
- MAX_PARALLEL = 3 (bounded, desktop-safe)
- MAX_RETRIES = 1 per section
- Independent sections run in parallel batches of 3
- Dependent sections run sequentially after all independent sections complete
- A failed section does not block the run unless all prerequisites failed

## Performance Targets
- P50: < 12 seconds (1004 typical assignment)
- P90: < 20 seconds
- Warning threshold: > 30 seconds consistently

## Status
✅ COMPLETE — All tests passed, live verified
