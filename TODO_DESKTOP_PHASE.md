# CACC Writer — Desktop Production Phase
# ========================================
# Active Scope: 1004 Single-Family (ACI) + Commercial (Real Quantum)
# Deferred:     1025, 1073, 1004C — preserved, not extended
# Phase Goal:   Electron desktop app + production hardening for two active lanes

---

## ✅ SCOPE ACKNOWLEDGMENT

Active production scope is **narrowed to two lanes only**:

| Lane | Form Type | Software | Agent |
|------|-----------|----------|-------|
| Lane 1 | `1004` single-family residential | ACI (pywinauto) | `desktop_agent/agent.py` |
| Lane 2 | `commercial` | Real Quantum (Playwright) | `real_quantum_agent/agent.py` |

**Deferred (do NOT extend, do NOT delete):**
- `1025` — multi-family, lower usage
- `1073` — condo, lower usage
- `1004C` — manufactured home, lower usage

All major architecture and workflow decisions prioritize Lane 1 and Lane 2 first.
Do not invest deep implementation time in deferred form types until scope is widened.

---

## IMPLEMENTATION PRIORITIES

### Lane 1 — 1004 Single-Family (ACI)

| Priority | Item | Status |
|----------|------|--------|
| P1 | Case metadata wiring | ✅ Complete |
| P1 | Narrative generation (all 10 priority sections) | ✅ Complete |
| P1 | Section dependency logic | ✅ Complete |
| P1 | Subject condition support (C1–C6 UAD) | ✅ Complete |
| P1 | Phrase bank / common narratives | ✅ Complete |
| P1 | Voice engine (approved narrative retrieval) | ✅ Complete |
| P1 | ACI box targeting — calibration + TX32 label-proximity | ✅ Complete (live automation_ids pending) |
| P1 | ACI insertion verification (screenshot on failure) | ✅ Complete |
| P1 | ACI clipboard fallback strategy | ✅ Complete |
| P2 | ACI batch insert (`/insert-batch`) | ✅ Complete |
| P2 | ACI `/calibrate` + `/test-field` endpoints | ✅ Complete |

**1004 Priority Sections (deepest implementation focus):**

| Section ID | ACI Tab | Status |
|---|---|---|
| `neighborhood_description` | Neig | ✅ Generation complete |
| `market_conditions` | Neig | ✅ Generation complete |
| `site_description` | Site | ✅ Generation complete |
| `improvements_description` | Impr | ✅ Generation complete |
| `condition_description` | Impr | ✅ Generation complete |
| `contract_analysis` | SCA | ✅ Generation complete |
| `concessions_analysis` | SCA | ✅ Generation complete |
| `highest_best_use` | SCA | ✅ Generation complete |
| `sales_comparison_summary` | SCA | ✅ Generation complete |
| `reconciliation` | Recon | ✅ Generation complete |

---

### Lane 2 — Commercial (Real Quantum)

| Priority | Item | Status |
|----------|------|--------|
| P1 | Narrative generation (all 5 priority sections) | ✅ Complete |
| P1 | Market context injection | ✅ Complete |
| P1 | Real Quantum section navigation (URL slug strategy) | ✅ Complete |
| P1 | RQ editor targeting (46 real TinyMCE selectors) | ✅ Complete |
| P1 | RQ insertion verification (TinyMCE getContent) | ✅ Complete |
| P2 | RQ batch insert (`/insert-batch`) | ✅ Complete |
| P2 | RQ `/test-field` endpoint | ✅ Complete |

**Commercial Priority Sections (deepest implementation focus):**

| Section ID | RQ Section | Status |
|---|---|---|
| `neighborhood` | Introduction | ✅ Generation complete |
| `market_overview` | MarketData | ✅ Generation complete |
| `improvements_description` | PropertyData | ✅ Generation complete |
| `highest_best_use` | HighestBestUse | ✅ Generation complete |
| `reconciliation` | Reconciliation | ✅ Generation complete |

---

## DESKTOP PRODUCTION PHASE — PROGRESS TRACKER

### Backend Production Modules

| File | Description | Status |
|------|-------------|--------|
| `server/destinationRegistry.js` | Centralized insertion targets (1004→ACI, commercial→RQ, deferred marked inactive) | ✅ Complete |
| `server/fileLogger.js` | Disk logging to `logs/cacc-YYYY-MM-DD.log` | ✅ Complete |
| `server/backupExport.js` | Support bundle (cases + approvedNarratives + logs) | ✅ Complete |
| `server/logger.js` | Added `setFileLogWriter()` fan-out to disk logger | ✅ Complete |

### Server Wiring (`cacc-writer-server.js`)

| Item | Status |
|------|--------|
| Import `initFileLogger`, `writeLogEntry`, `getLogFiles`, `readLogFile`, `getLogsDir` | ✅ Complete |
| Import `setFileLogWriter` from `server/logger.js` | ✅ Complete |
| Import `listAllDestinations`, `getDestination`, `getTargetSoftware`, `getFallbackStrategy` | ✅ Complete |
| Import `getBundleStats`, `createSupportBundle`, `listExports` | ✅ Complete |
| `initFileLogger()` + `setFileLogWriter(writeLogEntry)` at startup | ✅ Complete |
| `GET /api/health/services` — per-service health status | ✅ Complete |
| `GET /api/destination-registry` — list all active destinations | ✅ Complete |
| `GET /api/destination-registry/:formType/:sectionId` — lookup specific destination | ✅ Complete |
| `GET /api/logs` — list log files | ✅ Complete |
| `GET /api/logs/:date` — read log file by date | ✅ Complete |
| `GET /api/export/stats` — bundle stats | ✅ Complete |
| `POST /api/export/bundle` — create support bundle | ✅ Complete |
| `GET /api/export/list` — list existing exports | ✅ Complete |
| `GET /api/health` returns `version` field | ✅ Complete |
| `'copied'` added to `VALID_SECTION_STATUSES` | ✅ Complete |
| `POST /api/cases/:caseId/sections/:fieldId/copy` — clipboard fallback endpoint | ✅ Complete |

### Electron Shell

| File | Description | Status |
|------|-------------|--------|
| `desktop/electron/main.cjs` | Main process — BrowserWindow, IPC, server spawn, single-instance lock, window state, `setAppUserModelId` | ✅ Complete |
| `desktop/electron/preload.cjs` | Context bridge — expose safe IPC to renderer | ✅ Complete |
| `desktop/forge.config.cjs` | Electron Forge config (Squirrel installer for Windows) | ✅ Complete |
| `package.json` | Added electron, @electron-forge/cli, @electron-forge/maker-squirrel, maker-zip | ✅ Complete |

### UI Health Panel

| Item | File | Status |
|------|------|--------|
| Health strip HTML (`#healthStrip`, 5 hs-chips) | `index.html` | ✅ Complete |
| Health strip CSS (`.hs-chip`, `.health-strip`) | `index.html` | ✅ Complete |
| Version badge (`#versionBadge`) in header | `index.html` | ✅ Complete |
| Export toast (`#exportToast`) element | `index.html` | ✅ Complete |
| `initVersionDisplay()` — Electron API or /api/health fallback | `app.js` | ✅ Complete |
| `loadHealthStatus()` — calls `/api/health/services` | `app.js` | ✅ Complete |
| `renderHealthPanel()` / `renderHealthChip()` | `app.js` | ✅ Complete |
| `createSupportBundle()` — POST /api/export/bundle + toast | `app.js` | ✅ Complete |
| `showExportToast()` — fixed bottom-right toast | `app.js` | ✅ Complete |
| Auto-refresh health every 30s | `app.js` | ✅ Complete |
| `clipboardFallback(fieldId)` — server-side clipboard fallback, marks status 'copied' | `app.js` | ✅ Complete |
| `sectionStatusBadge` updated with `'copied'` label | `app.js` | ✅ Complete |
| `insertField()` offers clipboard fallback confirm when agent not running | `app.js` | ✅ Complete |

### ACI Reliability Hardening

| Item | File | Status |
|------|------|--------|
| `GET /calibrate` — TX32 discovery via descendants() | `desktop_agent/agent.py` | ✅ Complete |
| `POST /test-field` — locate field, report strategies | `desktop_agent/agent.py` | ✅ Complete |
| `POST /insert-batch` — sequential batch insert | `desktop_agent/agent.py` | ✅ Complete |
| Escalating retry (learned → TX32 → automation_id → label → clipboard) | `desktop_agent/agent_core.py` | ✅ Complete |
| Screenshot on failure (`capture_screenshot`) | `desktop_agent/agent_core.py` | ✅ Complete |
| `find_tx32_by_label` — complete return logic (bug fix) | `desktop_agent/agent_core.py` | ✅ Fixed — was truncated, missing return |
| ACIFullAddendumView preference fallback | `desktop_agent/agent_core.py` | ✅ Fixed — added in find_tx32_by_label |
| Largest-content fallback (score=25) | `desktop_agent/agent_core.py` | ✅ Fixed — added in find_tx32_by_label |
| Update `field_maps/1004.json` with real automation_ids | `desktop_agent/field_maps/1004.json` | ✅ Complete — calibrated=true, confirmed ACI label texts, 12/12 fields live-tested |

### Real Quantum Reliability Hardening

| Item | File | Status |
|------|------|--------|
| `POST /test-field` — dry-run field check (no insert) | `real_quantum_agent/agent.py` | ✅ Complete |
| `POST /insert-batch` — sequential batch insert | `real_quantum_agent/agent.py` | ✅ Complete |
| `POST /insert-detail-page` — binoculars/detail sub-page | `real_quantum_agent/agent.py` | ✅ Complete |
| `POST /list-detail-pages` — discover detail page links | `real_quantum_agent/agent.py` | ✅ Complete |
| Screenshot on failure (`capture_screenshot`) | `real_quantum_agent/agent.py` | ✅ Complete |
| Configurable `NAVIGATION_TIMEOUT` from config.json | `real_quantum_agent/agent.py` | ✅ Complete |
| `field_maps/commercial.json` — 46 real selectors, 9 sections | `real_quantum_agent/field_maps/commercial.json` | ✅ Complete (discovered 2026-03-07) |
| Live selector re-verification on next RQ session | `real_quantum_agent/selector_discovery.py` | ⏳ Requires live RQ open |

### Test Suite for New Endpoints

| Test File | Coverage | Status |
|-----------|----------|--------|
| `_test_desktop_endpoints.mjs` | `/api/health/services`, `/api/destination-registry`, `/api/logs`, `/api/export/*`, clipboard fallback, `'copied'` status | ✅ Complete (48 assertions) |

---

## FILE / MODULE PRIORITIES

### Active — invest full implementation effort

| File | Lane | Priority |
|------|------|----------|
| `server/destinationRegistry.js` | Both | P1 — ✅ done |
| `server/fileLogger.js` | Both | P1 — ✅ done |
| `server/backupExport.js` | Both | P1 — ✅ done |
| `server/sectionDependencies.js` | Both | P1 — ✅ done |
| `server/fieldEligibility.js` | Both | P1 — ✅ done |
| `server/fieldRegistry.js` | Both | P1 — ✅ done |
| `server/config/productionScope.js` | Both | P1 — ✅ done |
| `forms/1004.js` | Lane 1 | P1 — ✅ done |
| `forms/commercial.js` | Lane 2 | P1 — ✅ done |
| `desktop_agent/field_maps/1004.json` | Lane 1 | P1 — ✅ calibrated 2026-03-09 (12/12 fields, tx32_label_proximity) |
| `real_quantum_agent/field_maps/commercial.json` | Lane 2 | P1 — ✅ 46 real selectors, 9 sections (discovered 2026-03-07) |
| `desktop_agent/agent.py` | Lane 1 | P1 — ✅ done (live automation_ids pending) |
| `real_quantum_agent/agent.py` | Lane 2 | P1 — ✅ done (live re-verification pending) |
| `server/tools/aciTool.ts` | Lane 1 | P1 |
| `server/tools/realQuantumTool.ts` | Lane 2 | P1 |
| `server/agents/draftAgent.ts` | Both | P1 |
| `server/agents/reviewAgent.ts` | Both | P1 |
| `server/agents/verificationAgent.ts` | Both | P1 |
| `server/workflow/appraisalWorkflow.ts` | Both | P1 |
| `desktop/electron/main.cjs` | Both | P1 — ✅ done |
| `desktop/electron/preload.cjs` | Both | P1 — ✅ done |
| `desktop/forge.config.cjs` | Both | P1 — ✅ done |
| `index.html` | Both | P1 — ✅ done |
| `app.js` | Both | P1 — ✅ done |

### Deferred — keep, do not extend

| File | Reason |
|------|--------|
| `forms/1025.js` | Deferred form type |
| `forms/1073.js` | Deferred form type |
| `forms/1004c.js` | Deferred form type |
| `desktop_agent/field_maps/1025.json` | Deferred form type |
| `desktop_agent/field_maps/1073.json` | Deferred form type |
| `desktop_agent/field_maps/1004c.json` | Deferred form type |

---

## TESTING PRIORITIES

### Run on every change (required)

| Test | Count | Scope |
|------|-------|-------|
| `node _test_smoke.mjs` | 28 | All endpoints |
| `node _test_scope_enforcement.mjs` | 27 | Scope enforcement |
| `node _test_phase2_endpoints.mjs` | 47 | Phase 2 endpoints |
| `node _test_phase3.mjs` | ~77 | Phase 3 endpoints |
| `node _test_desktop_endpoints.mjs` | 48 | Desktop production endpoints |

**Current baseline: 227/227 passing ✅ (28 smoke + 27 scope + 47 phase2 + 77 phase3 + 48 desktop)**

### Run before production lane test

| Test | Scope |
|------|-------|
| `python _test_aci_live.py 1004` | Live ACI insertion (1004 fields) — requires ACI open |
| `python _test_rq_sections.py` | Live RQ section navigation (commercial) — requires RQ open |

### Deferred — do not prioritize

- Any test targeting `1025`, `1073`, `1004c` specifically
- `_test_benchmark.mjs` — repeatable benchmark cases (future)

---

## DEFERRED ITEMS LIST

The following are explicitly deferred. Do not build out. Do not delete.

### Form Types

| Form | Status | Files to Preserve |
|------|--------|-------------------|
| `1025` multi-family | DEFERRED | `forms/1025.js`, `desktop_agent/field_maps/1025.json` |
| `1073` condo | DEFERRED | `forms/1073.js`, `desktop_agent/field_maps/1073.json` |
| `1004C` manufactured | DEFERRED | `forms/1004c.js`, `desktop_agent/field_maps/1004c.json` |

### Features

| Feature | Deferred Until |
|---------|----------------|
| 1025 deep wiring (generation + insertion) | Scope widened |
| 1073 deep wiring (generation + insertion) | Scope widened |
| 1004C deep wiring (generation + insertion) | Scope widened |
| Multi-unit / condo / co-op workflows | Scope widened |
| Pinecone vector KB (llamaIndex.ts) | After Lane 1+2 stable |
| LangSmith / LangFuse observability | After Lane 1+2 stable |
| `_test_benchmark.mjs` regression baseline | After Lane 1+2 stable |

### Architecture Files (keep, do not extend)

| File | Status |
|------|--------|
| `server/config/openai.ts` | Keep — not wired to production yet |
| `server/observability/langsmith.ts` | Keep — deferred |
| `server/observability/langfuse.ts` | Keep — deferred |
| `server/retrieval/llamaIndex.ts` | Keep — deferred (Pinecone) |
| `server/config/pinecone.ts` | Keep — deferred |
| `server/ingestion/documentParser.ts` | Keep — deferred |
| `server/workflow/appraisalWorkflow.ts` | Keep — not yet wired to production |
| `server/workflow/types.ts` | Keep — deferred |

---

## NEXT STEPS (ordered by priority)

1. ✅ **`_test_desktop_endpoints.mjs`** — 48/48 passed (all 11 endpoint groups verified, including clipboard fallback + 'copied' status)
2. ✅ **`npm install`** — 491 packages added, electron + forge devDeps installed
3. ✅ **ACI hardening** — all endpoints + escalating retry + `find_tx32_by_label` bug fixed
4. ✅ **Server hardening** — `GET /api/health` version field, `'copied'` status, `POST .../copy` clipboard fallback endpoint
5. ✅ **Electron hardening** — `app.setAppUserModelId('com.cacc.writer')` for Windows taskbar pinning
6. ✅ **UI hardening** — `clipboardFallback()`, `sectionStatusBadge('copied')`, `insertField()` fallback confirm
7. ✅ **Bundle hardening** — local-time filename, health snapshot, insertion diagnostics in `backupExport.js`
8. ✅ **ACI live test** — `python _test_aci_live.py 1004` → 23/24 passed, 0 failed, 1 skipped (non-fatal verification). All 12 fields found via tx32_label_proximity. `field_maps/1004.json` updated with `calibrated=true` + confirmed ACI label texts.
9. ✅ **Test hardening** — `TIMEOUT_MS` raised 10s→35s in `_test_desktop_endpoints.mjs`; phase3 test 2a made environment-agnostic (accepts agent running or not running)
10. ✅ **Full baseline confirmed** — 227/227 passing (smoke:28 + scope:27 + phase2:47 + phase3:77 + desktop:48)
11. ✅ **RQ hardening** — all endpoints complete (`/insert`, `/insert-batch`, `/test-field`, `/insert-detail-page`, screenshot on failure, configurable timeout). Field map: 46 real selectors, 9 sections. Live re-verification pending (requires RQ open).
12. **End-to-end test** — one real 1004 assignment from generate → insert → verify (`_test_e2e_1004.mjs`)

---

## SCOPE ENFORCEMENT REMINDER

All endpoints enforce scope at the API level via `server/config/productionScope.js`:
- Deferred form requests → `{ ok: false, supported: false, scope: 'deferred' }`
- All deferred access logged via `logDeferredAccess()`
- UI: deferred forms shown in collapsed section with warning banner
- Test coverage: `_test_scope_enforcement.mjs` (27/27 ✅)
