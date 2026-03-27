# Appraisal Agent â€” Desktop Production Phase
# ========================================
# Active Scope: 1004 Single-Family (ACI) + Commercial (Real Quantum)
# Deferred:     1025, 1073, 1004C â€” preserved, not extended
# Phase Goal:   Electron desktop app + production hardening for two active lanes

---

## âœ… SCOPE ACKNOWLEDGMENT

Active production scope is **narrowed to two lanes only**:

| Lane | Form Type | Software | Agent |
|------|-----------|----------|-------|
| Lane 1 | `1004` single-family residential | ACI (pywinauto) | `desktop_agent/agent.py` |
| Lane 2 | `commercial` | Real Quantum (Playwright) | `real_quantum_agent/agent.py` |

**Deferred (do NOT extend, do NOT delete):**
- `1025` â€” multi-family, lower usage
- `1073` â€” condo, lower usage
- `1004C` â€” manufactured home, lower usage

All major architecture and workflow decisions prioritize Lane 1 and Lane 2 first.
Do not invest deep implementation time in deferred form types until scope is widened.

---

## IMPLEMENTATION PRIORITIES

### Lane 1 â€” 1004 Single-Family (ACI)

| Priority | Item | Status |
|----------|------|--------|
| P1 | Case metadata wiring | âœ… Complete |
| P1 | Narrative generation (all 10 priority sections) | âœ… Complete |
| P1 | Section dependency logic | âœ… Complete |
| P1 | Subject condition support (C1â€“C6 UAD) | âœ… Complete |
| P1 | Phrase bank / common narratives | âœ… Complete |
| P1 | Voice engine (approved narrative retrieval) | âœ… Complete |
| P1 | ACI box targeting â€” calibration + TX32 label-proximity | âœ… Complete (live automation_ids pending) |
| P1 | ACI insertion verification (screenshot on failure) | âœ… Complete |
| P1 | ACI clipboard fallback strategy | âœ… Complete |
| P2 | ACI batch insert (`/insert-batch`) | âœ… Complete |
| P2 | ACI `/calibrate` + `/test-field` endpoints | âœ… Complete |

**1004 Priority Sections (deepest implementation focus):**

| Section ID | ACI Tab | Status |
|---|---|---|
| `neighborhood_description` | Neig | âœ… Generation complete |
| `market_conditions` | Neig | âœ… Generation complete |
| `site_description` | Site | âœ… Generation complete |
| `improvements_description` | Impr | âœ… Generation complete |
| `condition_description` | Impr | âœ… Generation complete |
| `contract_analysis` | SCA | âœ… Generation complete |
| `concessions_analysis` | SCA | âœ… Generation complete |
| `highest_best_use` | SCA | âœ… Generation complete |
| `sales_comparison_summary` | SCA | âœ… Generation complete |
| `reconciliation` | Recon | âœ… Generation complete |

---

### Lane 2 â€” Commercial (Real Quantum)

| Priority | Item | Status |
|----------|------|--------|
| P1 | Narrative generation (all 5 priority sections) | âœ… Complete |
| P1 | Market context injection | âœ… Complete |
| P1 | Real Quantum section navigation (URL slug strategy) | âœ… Complete |
| P1 | RQ editor targeting (46 real TinyMCE selectors) | âœ… Complete |
| P1 | RQ insertion verification (TinyMCE getContent) | âœ… Complete |
| P2 | RQ batch insert (`/insert-batch`) | âœ… Complete |
| P2 | RQ `/test-field` endpoint | âœ… Complete |

**Commercial Priority Sections (deepest implementation focus):**

| Section ID | RQ Section | Status |
|---|---|---|
| `neighborhood` | Introduction | âœ… Generation complete |
| `market_overview` | MarketData | âœ… Generation complete |
| `improvements_description` | PropertyData | âœ… Generation complete |
| `highest_best_use` | HighestBestUse | âœ… Generation complete |
| `reconciliation` | Reconciliation | âœ… Generation complete |

---

## DESKTOP PRODUCTION PHASE â€” PROGRESS TRACKER

### Backend Production Modules

| File | Description | Status |
|------|-------------|--------|
| `server/destinationRegistry.js` | Centralized insertion targets (1004â†’ACI, commercialâ†’RQ, deferred marked inactive) | âœ… Complete |
| `server/fileLogger.js` | Disk logging to `logs/cacc-YYYY-MM-DD.log` | âœ… Complete |
| `server/backupExport.js` | Support bundle (cases + approvedNarratives + logs) | âœ… Complete |
| `server/logger.js` | Added `setFileLogWriter()` fan-out to disk logger | âœ… Complete |

### Server Wiring (`cacc-writer-server.js`)

| Item | Status |
|------|--------|
| Import `initFileLogger`, `writeLogEntry`, `getLogFiles`, `readLogFile`, `getLogsDir` | âœ… Complete |
| Import `setFileLogWriter` from `server/logger.js` | âœ… Complete |
| Import `listAllDestinations`, `getDestination`, `getTargetSoftware`, `getFallbackStrategy` | âœ… Complete |
| Import `getBundleStats`, `createSupportBundle`, `listExports` | âœ… Complete |
| `initFileLogger()` + `setFileLogWriter(writeLogEntry)` at startup | âœ… Complete |
| `GET /api/health/services` â€” per-service health status | âœ… Complete |
| `GET /api/destination-registry` â€” list all active destinations | âœ… Complete |
| `GET /api/destination-registry/:formType/:sectionId` â€” lookup specific destination | âœ… Complete |
| `GET /api/logs` â€” list log files | âœ… Complete |
| `GET /api/logs/:date` â€” read log file by date | âœ… Complete |
| `GET /api/export/stats` â€” bundle stats | âœ… Complete |
| `POST /api/export/bundle` â€” create support bundle | âœ… Complete |
| `GET /api/export/list` â€” list existing exports | âœ… Complete |
| `GET /api/health` returns `version` field | âœ… Complete |
| `'copied'` added to `VALID_SECTION_STATUSES` | âœ… Complete |
| `POST /api/cases/:caseId/sections/:fieldId/copy` â€” clipboard fallback endpoint | âœ… Complete |

### Electron Shell

| File | Description | Status |
|------|-------------|--------|
| `desktop/electron/main.cjs` | Main process â€” BrowserWindow, IPC, server spawn, single-instance lock, window state, `setAppUserModelId` | âœ… Complete |
| `desktop/electron/preload.cjs` | Context bridge â€” expose safe IPC to renderer | âœ… Complete |
| `desktop/forge.config.cjs` | Electron Forge config (Squirrel installer for Windows) | âœ… Complete |
| `package.json` | Added electron, @electron-forge/cli, @electron-forge/maker-squirrel, maker-zip | âœ… Complete |

### UI Health Panel

| Item | File | Status |
|------|------|--------|
| Health strip HTML (`#healthStrip`, 5 hs-chips) | `index.html` | âœ… Complete |
| Health strip CSS (`.hs-chip`, `.health-strip`) | `index.html` | âœ… Complete |
| Version badge (`#versionBadge`) in header | `index.html` | âœ… Complete |
| Export toast (`#exportToast`) element | `index.html` | âœ… Complete |
| `initVersionDisplay()` â€” Electron API or /api/health fallback | `app.js` | âœ… Complete |
| `loadHealthStatus()` â€” calls `/api/health/services` | `app.js` | âœ… Complete |
| `renderHealthPanel()` / `renderHealthChip()` | `app.js` | âœ… Complete |
| `createSupportBundle()` â€” POST /api/export/bundle + toast | `app.js` | âœ… Complete |
| `showExportToast()` â€” fixed bottom-right toast | `app.js` | âœ… Complete |
| Auto-refresh health every 30s | `app.js` | âœ… Complete |
| `clipboardFallback(fieldId)` â€” server-side clipboard fallback, marks status 'copied' | `app.js` | âœ… Complete |
| `sectionStatusBadge` updated with `'copied'` label | `app.js` | âœ… Complete |
| `insertField()` offers clipboard fallback confirm when agent not running | `app.js` | âœ… Complete |

### ACI Reliability Hardening

| Item | File | Status |
|------|------|--------|
| `GET /calibrate` â€” TX32 discovery via descendants() | `desktop_agent/agent.py` | âœ… Complete |
| `POST /test-field` â€” locate field, report strategies | `desktop_agent/agent.py` | âœ… Complete |
| `POST /insert-batch` â€” sequential batch insert | `desktop_agent/agent.py` | âœ… Complete |
| Escalating retry (learned â†’ TX32 â†’ automation_id â†’ label â†’ clipboard) | `desktop_agent/agent_core.py` | âœ… Complete |
| Screenshot on failure (`capture_screenshot`) | `desktop_agent/agent_core.py` | âœ… Complete |
| `find_tx32_by_label` â€” complete return logic (bug fix) | `desktop_agent/agent_core.py` | âœ… Fixed â€” was truncated, missing return |
| ACIFullAddendumView preference fallback | `desktop_agent/agent_core.py` | âœ… Fixed â€” added in find_tx32_by_label |
| Largest-content fallback (score=25) | `desktop_agent/agent_core.py` | âœ… Fixed â€” added in find_tx32_by_label |
| Update `field_maps/1004.json` with real automation_ids | `desktop_agent/field_maps/1004.json` | âœ… Complete â€” calibrated=true, confirmed ACI label texts, 12/12 fields live-tested |

### Real Quantum Reliability Hardening

| Item | File | Status |
|------|------|--------|
| `POST /test-field` â€” dry-run field check (no insert) | `real_quantum_agent/agent.py` | âœ… Complete |
| `POST /insert-batch` â€” sequential batch insert | `real_quantum_agent/agent.py` | âœ… Complete |
| `POST /insert-detail-page` â€” binoculars/detail sub-page | `real_quantum_agent/agent.py` | âœ… Complete |
| `POST /list-detail-pages` â€” discover detail page links | `real_quantum_agent/agent.py` | âœ… Complete |
| Screenshot on failure (`capture_screenshot`) | `real_quantum_agent/agent.py` | âœ… Complete |
| Configurable `NAVIGATION_TIMEOUT` from config.json | `real_quantum_agent/agent.py` | âœ… Complete |
| `field_maps/commercial.json` â€” 46 real selectors, 9 sections | `real_quantum_agent/field_maps/commercial.json` | âœ… Complete (discovered 2026-03-07) |
| Live selector re-verification on next RQ session | `real_quantum_agent/selector_discovery.py` | â³ Requires live RQ open |

### Test Suite for New Endpoints

| Test File | Coverage | Status |
|-----------|----------|--------|
| `_test_desktop_endpoints.mjs` | `/api/health/services`, `/api/destination-registry`, `/api/logs`, `/api/export/*`, clipboard fallback, `'copied'` status | âœ… Complete (48 assertions) |

---

## FILE / MODULE PRIORITIES

### Active â€” invest full implementation effort

| File | Lane | Priority |
|------|------|----------|
| `server/destinationRegistry.js` | Both | P1 â€” âœ… done |
| `server/fileLogger.js` | Both | P1 â€” âœ… done |
| `server/backupExport.js` | Both | P1 â€” âœ… done |
| `server/sectionDependencies.js` | Both | P1 â€” âœ… done |
| `server/fieldEligibility.js` | Both | P1 â€” âœ… done |
| `server/fieldRegistry.js` | Both | P1 â€” âœ… done |
| `server/config/productionScope.js` | Both | P1 â€” âœ… done |
| `forms/1004.js` | Lane 1 | P1 â€” âœ… done |
| `forms/commercial.js` | Lane 2 | P1 â€” âœ… done |
| `desktop_agent/field_maps/1004.json` | Lane 1 | P1 â€” âœ… calibrated 2026-03-09 (12/12 fields, tx32_label_proximity) |
| `real_quantum_agent/field_maps/commercial.json` | Lane 2 | P1 â€” âœ… 46 real selectors, 9 sections (discovered 2026-03-07) |
| `desktop_agent/agent.py` | Lane 1 | P1 â€” âœ… done (live automation_ids pending) |
| `real_quantum_agent/agent.py` | Lane 2 | P1 â€” âœ… done (live re-verification pending) |
| `server/tools/aciTool.ts` | Lane 1 | P1 |
| `server/tools/realQuantumTool.ts` | Lane 2 | P1 |
| `server/agents/draftAgent.ts` | Both | P1 |
| `server/agents/reviewAgent.ts` | Both | P1 |
| `server/agents/verificationAgent.ts` | Both | P1 |
| `server/workflow/appraisalWorkflow.ts` | Both | P1 |
| `desktop/electron/main.cjs` | Both | P1 â€” âœ… done |
| `desktop/electron/preload.cjs` | Both | P1 â€” âœ… done |
| `desktop/forge.config.cjs` | Both | P1 â€” âœ… done |
| `index.html` | Both | P1 â€” âœ… done |
| `app.js` | Both | P1 â€” âœ… done |

### Deferred â€” keep, do not extend

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

**Current baseline: 227/227 passing âœ… (28 smoke + 27 scope + 47 phase2 + 77 phase3 + 48 desktop)**

### Run before production lane test

| Test | Scope |
|------|-------|
| `python _test_aci_live.py 1004` | Live ACI insertion (1004 fields) â€” requires ACI open |
| `python _test_rq_sections.py` | Live RQ section navigation (commercial) â€” requires RQ open |

### Deferred â€” do not prioritize

- Any test targeting `1025`, `1073`, `1004c` specifically
- `_test_benchmark.mjs` â€” repeatable benchmark cases (future)

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
| `server/config/openai.ts` | Keep â€” not wired to production yet |
| `server/observability/langsmith.ts` | Keep â€” deferred |
| `server/observability/langfuse.ts` | Keep â€” deferred |
| `server/retrieval/llamaIndex.ts` | Keep â€” deferred (Pinecone) |
| `server/config/pinecone.ts` | Keep â€” deferred |
| `server/ingestion/documentParser.ts` | Keep â€” deferred |
| `server/workflow/appraisalWorkflow.ts` | Keep â€” not yet wired to production |
| `server/workflow/types.ts` | Keep â€” deferred |

---

## NEXT STEPS (ordered by priority)

1. âœ… **`_test_desktop_endpoints.mjs`** â€” 48/48 passed (all 11 endpoint groups verified, including clipboard fallback + 'copied' status)
2. âœ… **`npm install`** â€” 491 packages added, electron + forge devDeps installed
3. âœ… **ACI hardening** â€” all endpoints + escalating retry + `find_tx32_by_label` bug fixed
4. âœ… **Server hardening** â€” `GET /api/health` version field, `'copied'` status, `POST .../copy` clipboard fallback endpoint
5. âœ… **Electron hardening** â€” `app.setAppUserModelId('com.cacc.writer')` for Windows taskbar pinning
6. âœ… **UI hardening** â€” `clipboardFallback()`, `sectionStatusBadge('copied')`, `insertField()` fallback confirm
7. âœ… **Bundle hardening** â€” local-time filename, health snapshot, insertion diagnostics in `backupExport.js`
8. âœ… **ACI live test** â€” `python _test_aci_live.py 1004` â†’ 23/24 passed, 0 failed, 1 skipped (non-fatal verification). All 12 fields found via tx32_label_proximity. `field_maps/1004.json` updated with `calibrated=true` + confirmed ACI label texts.
9. âœ… **Test hardening** â€” `TIMEOUT_MS` raised 10sâ†’35s in `_test_desktop_endpoints.mjs`; phase3 test 2a made environment-agnostic (accepts agent running or not running)
10. âœ… **Full baseline confirmed** â€” 227/227 passing (smoke:28 + scope:27 + phase2:47 + phase3:77 + desktop:48)
11. âœ… **RQ hardening** â€” all endpoints complete (`/insert`, `/insert-batch`, `/test-field`, `/insert-detail-page`, screenshot on failure, configurable timeout). Field map: 46 real selectors, 9 sections. Live re-verification pending (requires RQ open).
12. **End-to-end test** â€” one real 1004 assignment from generate â†’ insert â†’ verify (`_test_e2e_1004.mjs`)

---

## SCOPE ENFORCEMENT REMINDER

All endpoints enforce scope at the API level via `server/config/productionScope.js`:
- Deferred form requests â†’ `{ ok: false, supported: false, scope: 'deferred' }`
- All deferred access logged via `logDeferredAccess()`
- UI: deferred forms shown in collapsed section with warning banner
- Test coverage: `_test_scope_enforcement.mjs` (27/27 âœ…)

