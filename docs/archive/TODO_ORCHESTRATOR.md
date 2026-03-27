# Appraisal Agent â€” Full-Draft Orchestrator Implementation
# ======================================================
# Architecture upgrade: section-by-section â†’ context-driven full-draft generation
# Rollout: DUAL-PATH â€” legacy path preserved, new orchestrator path added alongside
# Active scope: 1004 (ACI) + commercial (Real Quantum) ONLY
# Started: 2025

## CORE PRINCIPLE
# Build context once â†’ Retrieve memory once â†’ Analyze once â†’
# Draft sections in parallel â†’ Validate once â†’ Insert cleanly

## PERFORMANCE TARGETS
# P50 full-draft latency: < 12 seconds
# P90 full-draft latency: < 20 seconds
# Warning threshold:       > 30 seconds consistently
# Context build:           < 300ms
# Report planning:         < 150ms
# Retrieval pack:          < 500ms
# Comp analysis:           < 1.5s
# Parallel drafting:       ~4â€“8s
# Validation + assembly:   < 1s
# Max parallel jobs:       3
# Retry per section:       1

---

## PHASE 1 â€” SQLite Database Layer

- [x] Install `better-sqlite3` dependency
- [x] Create `server/db/database.js` â€” connection, WAL mode, helpers
- [x] Create `server/db/schema.js` â€” all 10 tables

### Tables
- [x] assignments
- [x] report_plans
- [x] generation_runs
- [x] section_jobs
- [x] generated_sections
- [x] memory_items
- [x] retrieval_cache
- [x] analysis_artifacts
- [x] ingest_jobs
- [x] staged_memory_reviews

---

## PHASE 2 â€” Assignment Context + Report Planner + Retrieval Pack

- [x] Create `server/context/assignmentContextBuilder.js`
  - [x] Read case meta.json + facts.json
  - [x] Normalize into AssignmentContext
  - [x] Derive flags (isFHA, isConstruction, hasComps, etc.)
  - [x] Store in assignments table
  - [x] Target: < 300ms
- [x] Create `server/context/reportPlanner.js`
  - [x] Section definitions for 1004 (10 sections)
  - [x] Section definitions for commercial (5 sections)
  - [x] Generator profile assignment per section
  - [x] Parallel vs dependent section classification
  - [x] Analysis job requirements
  - [x] Store in report_plans table
  - [x] Target: < 150ms
- [x] Create `server/context/retrievalPackBuilder.js`
  - [x] Load approved narrative index once
  - [x] Load phrase bank once
  - [x] Build per-section memory map
  - [x] Cache in retrieval_cache table (1hr TTL)
  - [x] Target: < 500ms

---

## PHASE 3 â€” Generator Profiles + Section Job Runner + Draft Assembler

- [x] Create `server/generators/generatorProfiles.js`
  - [x] template-heavy profile
  - [x] retrieval-guided profile
  - [x] data-driven profile
  - [x] logic-template profile
  - [x] analysis-narrative profile
  - [x] synthesis profile
- [x] Create `server/orchestrator/sectionJobRunner.js`
  - [x] Create section_jobs record
  - [x] Execute via callAI() + buildPromptMessages()
  - [x] Capture per-section metrics
  - [x] 1-retry policy
  - [x] Update job status in SQLite
- [x] Create `server/orchestrator/draftAssembler.js`
  - [x] Validate completeness
  - [x] Check consistency
  - [x] Generate warnings
  - [x] Compute run metrics summary
  - [x] Return structured DraftPackage

---

## PHASE 4 â€” Generation Orchestrator (Core)

- [x] Create `server/orchestrator/generationOrchestrator.js`
  - [x] Create generation_runs record
  - [x] Build assignment context (timed)
  - [x] Build report plan (timed)
  - [x] Build retrieval pack (timed, cached)
  - [x] Run analysis jobs (timed)
  - [x] Execute parallel section jobs (max 3 concurrent, timed)
  - [x] Execute dependent synthesis sections (timed)
  - [x] Validate combined draft (timed)
  - [x] Assemble final draft package
  - [x] Update run record with all metrics
  - [x] Structured logging for all phases

### Run-level metrics captured
- [x] context_build_duration_ms
- [x] report_plan_duration_ms
- [x] retrieval_duration_ms
- [x] analysis_duration_ms
- [x] parallel_drafting_duration_ms
- [x] validation_duration_ms
- [x] assembly_duration_ms
- [x] sections_total / sections_completed / sections_failed / sections_retried
- [x] partial_complete flag
- [x] error_text on failure

### Section-level metrics captured
- [x] duration_ms
- [x] attempt_count
- [x] input_chars / output_chars
- [x] warnings_count
- [x] error_text on failure

---

## PHASE 5 â€” Legacy KB Migration

- [x] Create `server/migration/legacyKbImport.js`
  - [x] Import from knowledge_base/approvedNarratives/ (approved=1, score=95)
  - [x] Import from knowledge_base/approved_edits/ (approved=1, score=85)
  - [x] Import from knowledge_base/index.json imported entries (approved=0, score=70)
  - [x] SHA-256 text hash deduplication
  - [x] approvedNarratives wins on conflict
  - [x] Idempotent (safe to re-run)

---

## PHASE 6 â€” New API Endpoints

- [x] POST /api/cases/:caseId/generate-full-draft
- [x] GET  /api/generation/runs/:runId/status
- [x] GET  /api/generation/runs/:runId/result
- [x] GET  /api/cases/:caseId/generation-runs
- [x] POST /api/generation/regenerate-section
- [x] POST /api/db/migrate-legacy-kb
- [x] GET  /api/db/status

---

## PHASE 7 â€” UI Updates

- [x] index.html â€” "Generate Full Draft" button (iOS-style, prominent)
- [x] index.html â€” Full-draft progress panel (phase indicator, section chips, timer)
- [x] index.html â€” Draft package result panel
- [x] index.html â€” Run metrics summary (collapsible)
- [x] app.js â€” generateFullDraft(caseId)
- [x] app.js â€” pollRunStatus(runId)
- [x] app.js â€” renderDraftPackage(pkg)
- [x] app.js â€” renderRunMetrics(metrics)

---

## BUG FIXES (post-implementation)

### Fix 1 â€” Status normalization (2026-03-10)
- **File:** `server/orchestrator/generationOrchestrator.js` â†’ `getRunStatus()`
- **Problem:** SQLite stores `'completed'`; polling contract expected `'complete'`
- **Fix:** Normalize `run.status === 'completed' ? 'complete' : run.status` before returning

### Fix 2 â€” Cached result missing `sections` field (2026-03-10)
- **File:** `cacc-writer-server.js` â†’ cached result branch of `GET /api/generation/runs/:runId/result`
- **Problem:** Cache hit branch returned `draftPackage` but not the top-level `sections` key the test checked
- **Fix:** Added `sections: cached.draftPackage?.sections || {}` to the cached response JSON

### Fix 3 â€” Non-existent case test used invalid caseId format (2026-03-10)
- **File:** `_test_orchestrator_endpoints.mjs` â†’ `testErrorPaths()`
- **Problem:** `NONEXISTENT_CASE_XYZ` fails `CASE_ID_RE = /^[a-f0-9]{8}$/i` â†’ 400 (not 404)
- **Fix:** Changed to `ffffffff` â€” valid 8-char hex format that passes regex but has no case directory

---

## TEST RESULTS (2026-03-10)

### _test_orchestrator_imports.mjs
- **Result:** 29/29 âœ…

### _test_orchestrator_endpoints.mjs
- **Result:** 44 passed, 0 failed, 1 warning âœ…
- **Warning:** P90 latency 20.1s (target < 20s) â€” borderline, not a failure
- **Full-draft run:** 10 sections, 0 retries, grade=good
- **Retrieval:** 391 memory items scanned, 30 examples used (cache hit)
- **Phase timings (typical):**
  - contextBuildMs: 1ms âœ“
  - reportPlanMs: 0ms âœ“
  - retrievalMs: 0ms (cache hit) âœ“
  - analysisMs: 2ms âœ“
  - parallelDraftMs: ~14s (3 batches Ã— 3 sections)
  - validationMs: 0ms âœ“
  - assemblyMs: 1ms âœ“

---

## REMOVAL RULE (do not phase out legacy until ALL are true)
- [ ] Full-draft generation is stable
- [ ] Section quality is at least as good as current workflow
- [ ] Per-section regeneration works reliably
- [ ] Insertion mapping is validated
- [ ] Run tracking and validation are solid
- [ ] Performance targets being met consistently (P90 < 20s)

---

## API REFERENCE

```
# Trigger full-draft generation
POST /api/cases/:caseId/generate-full-draft
Body: { formType?, options? }
Returns: { ok, runId, status, estimatedDurationMs }

# Poll run status
GET /api/generation/runs/:runId/status
Returns: { ok, runId, status, phase, sectionsCompleted, sectionsTotal, elapsedMs, sectionStatuses }

# Get final result
GET /api/generation/runs/:runId/result
Returns: { ok, runId, draftPackage, metrics, warnings }

# List runs for a case
GET /api/cases/:caseId/generation-runs
Returns: { ok, runs[] }

# Regenerate one section
POST /api/generation/regenerate-section
Body: { runId, sectionId, caseId }
Returns: { ok, sectionId, text, metrics }

# Migrate legacy KB to SQLite
POST /api/db/migrate-legacy-kb
Returns: { ok, imported, skipped, errors }

# SQLite health
GET /api/db/status
Returns: { ok, tables, counts, dbPath, dbSizeBytes }

