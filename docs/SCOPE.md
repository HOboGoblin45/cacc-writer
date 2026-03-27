# Appraisal Agent â€” Active Production Scope
# =======================================
# Last updated: 2025
# Status: NARROWED â€” Two production lanes only

## ACTIVE PRODUCTION LANES

### Lane 1 â€” 1004 Single-Family Residential (ACI)
- Form type: `1004`
- Software: ACI (Windows desktop automation via pywinauto)
- Agent: `desktop_agent/agent.py` + `desktop_agent/agent_core.py`
- Tool: `server/tools/aciTool.ts`
- Field map: `desktop_agent/field_maps/1004.json`

**Priority sections (deepest implementation):**
| Field ID                    | ACI Tab | Priority |
|-----------------------------|---------|----------|
| neighborhood_description    | Neig    | P1       |
| market_conditions           | Neig    | P1       |
| site_description            | Site    | P1       |
| improvements_description    | Impr    | P1       |
| condition_description       | Impr    | P1       |
| contract_analysis           | SCA     | P1       |
| concessions_analysis        | SCA     | P1       |
| highest_best_use            | SCA     | P1       |
| sales_comparison_summary    | SCA     | P1       |
| reconciliation              | Recon   | P1       |

---

### Lane 2 â€” Commercial (Real Quantum)
- Form type: `commercial`
- Software: Real Quantum (browser automation via Playwright)
- Agent: `real_quantum_agent/agent.py`
- Tool: `server/tools/realQuantumTool.ts`
- Field map: `real_quantum_agent/field_maps/commercial.json`

**Priority sections (deepest implementation):**
| Field ID                    | RQ Section          | Priority |
|-----------------------------|---------------------|----------|
| neighborhood                | Introduction        | P1       |
| market_overview             | MarketData          | P1       |
| improvements_description    | PropertyData        | P1       |
| highest_best_use            | HighestBestUse      | P1       |
| reconciliation              | Reconciliation      | P1       |

---

## DEFERRED FORM TYPES

The following form types are **NOT** actively developed in the current production phase.
Files are preserved and must not be deleted. They may be activated in a future phase.

| Form Type | Status    | Reason                                      |
|-----------|-----------|---------------------------------------------|
| 1025      | DEFERRED  | Lower usage frequency; inherits 1004 fields |
| 1073      | DEFERRED  | Lower usage frequency; inherits 1004 fields |
| 1004C     | DEFERRED  | Lower usage frequency; inherits 1004 fields |

**Deferred files (do not extend, do not delete):**
- `forms/1025.js`
- `forms/1073.js`
- `forms/1004c.js`
- `desktop_agent/field_maps/1025.json`
- `desktop_agent/field_maps/1073.json`
- `desktop_agent/field_maps/1004c.json`

---

## IMPLEMENTATION PRIORITIES

### Highest Priority (build now)
1. **1004 narrative generation** â€” all 10 priority sections fully wired
2. **1004 section dependencies** â€” required/recommended facts per section
3. **1004 ACI insertion** â€” tab targeting, TX32 control resolution, verification
4. **Commercial narrative generation** â€” all 5 priority sections
5. **Commercial Real Quantum insertion** â€” section navigation, editor targeting, verification

### Medium Priority (build after lanes are stable)
6. **Evaluation dataset** â€” 25 cases for 1004 + commercial
7. **Production lane test** â€” one real 1004 assignment end-to-end
8. **Pinecone knowledge base** â€” ingest approved 1004 + commercial sections

### Deferred (do not build now)
- 1025 deep wiring
- 1073 deep wiring
- 1004C deep wiring
- Multi-unit / condo / co-op workflows

---

## FILE / MODULE PRIORITIES

### Active â€” invest full implementation effort
| File                                        | Lane        |
|---------------------------------------------|-------------|
| `server/sectionDependencies.js`             | 1004 + comm |
| `server/fieldEligibility.js`                | 1004 + comm |
| `server/fieldRegistry.js`                   | 1004 + comm |
| `forms/1004.js`                             | 1004        |
| `forms/commercial.js`                       | commercial  |
| `desktop_agent/field_maps/1004.json`        | 1004        |
| `real_quantum_agent/field_maps/commercial.json` | commercial |
| `server/tools/aciTool.ts`                   | 1004        |
| `server/tools/realQuantumTool.ts`           | commercial  |
| `server/agents/draftAgent.ts`               | both        |
| `server/agents/reviewAgent.ts`              | both        |
| `server/agents/verificationAgent.ts`        | both        |
| `server/workflow/appraisalWorkflow.ts`      | both        |
| `server/retrieval/llamaIndex.ts`            | both        |
| `server/ingestion/documentParser.ts`        | both        |

### Deferred â€” keep but do not extend
| File                                        | Reason      |
|---------------------------------------------|-------------|
| `forms/1025.js`                             | deferred    |
| `forms/1073.js`                             | deferred    |
| `forms/1004c.js`                            | deferred    |
| `desktop_agent/field_maps/1025.json`        | deferred    |
| `desktop_agent/field_maps/1073.json`        | deferred    |
| `desktop_agent/field_maps/1004c.json`       | deferred    |

---

## TESTING PRIORITIES

### Run on every change
- `npm test` â€” 28 smoke tests (all endpoints)
- `node _test_missing_facts.mjs` â€” 22 missing-facts tests
- `node _test_ui_flow.mjs` â€” 17 UI flow simulation tests

### Run before production lane test
- `python _test_aci_live.py 1004` â€” live ACI insertion test (1004 fields)
- `python _test_rq_sections.py` â€” live RQ section navigation test (commercial)

### Deferred tests (do not prioritize)
- Any test targeting 1025, 1073, 1004c specifically

---

## SCOPE ENFORCEMENT â€” IMPLEMENTED

The following scope enforcement has been implemented across the full stack:

### Central Config â€” `server/config/productionScope.js`
- `ACTIVE_FORMS = ['1004', 'commercial']`
- `DEFERRED_FORMS = ['1025', '1073', '1004c']`
- `PRIORITY_SECTIONS_1004` â€” 10 sections
- `PRIORITY_SECTIONS_COMMERCIAL` â€” 5 sections
- `isActiveForm(ft)` / `isDeferredForm(ft)` â€” scope guards
- `logDeferredAccess(ft, endpoint, log)` â€” logs all deferred access
- `getScopeMetaForForm(ft)` â€” returns `{ scope, supported, warning }`

### API Enforcement â€” `cacc-writer-server.js`
| Endpoint | Deferred behavior |
|---|---|
| `GET /api/forms` | Returns `activeForms`, `deferredForms`, `activeScope`, `deferredScope` |
| `POST /api/cases/create` | **BLOCKED** â€” returns `{supported:false, scope:'deferred'}` |
| `POST /api/generate` | **BLOCKED** â€” returns `{supported:false, scope:'deferred'}` |
| `POST /api/generate-batch` | **BLOCKED** â€” returns `{supported:false, scope:'deferred'}` |
| `POST /api/workflow/run` | **BLOCKED** â€” returns `{supported:false, scope:'deferred'}` |
| `POST /api/workflow/run-batch` | **BLOCKED** â€” returns `{supported:false, scope:'deferred'}` |
| `GET /api/cases/:caseId` | **ALLOWED** â€” returns `scopeStatus:'deferred'` + `scopeWarning` for legacy cases |

### Forms Registry â€” `forms/index.js`
- `listForms()` â€” includes `scope`, `supported` fields on each form
- `getActiveForms()` â€” returns only 1004 + commercial
- `getDeferredForms()` â€” returns 1025, 1073, 1004c

### UI Enforcement â€” `index.html` + `app.js`
- Two-section form picker: **Active Production** (prominent) + **Deferred / Future** (collapsed toggle)
- Deferred form banner: shown when a deferred form type is selected or loaded
- Generate buttons disabled for deferred form types
- Deferred badge on case list items with deferred form types
- Legacy deferred-form cases: load in limited mode (read-only, no generate)
- `voiceFormType` select uses `<optgroup>` for active vs. deferred

---

## SCOPE CHANGE LOG

| Date | Change |
|------|--------|
| 2025 | Initial scope: all 5 form types |
| 2025 | **NARROWED**: Active lanes = 1004 + commercial only. 1025/1073/1004c deferred. |
| 2025 | **ENFORCED**: Scope enforcement implemented across API + UI. Deferred forms blocked from new workflows. Legacy cases load in limited mode. |
| 2025 | **RE-AFFIRMED**: Scope correction re-confirmed. Desktop Production Phase begins. All architecture decisions prioritize Lane 1 (1004/ACI) and Lane 2 (commercial/RQ). Deferred forms (1025, 1073, 1004c) remain preserved but not extended. See `TODO_DESKTOP_PHASE.md` for full priority tracker. |
| 2025 | **DESKTOP PHASE COMPLETE (partial)**: Electron shell (`main.cjs`, `preload.cjs`, `forge.config.cjs`), UI health strip (5-chip panel, version badge, export toast), `app.js` health functions (`loadHealthStatus`, `renderHealthPanel`, `createSupportBundle`, `initVersionDisplay`) all complete. Scope re-affirmed: 1004 + commercial only. Next: `_test_desktop_endpoints.mjs`, ACI hardening, RQ hardening, end-to-end test. |

---

## DESKTOP PRODUCTION PHASE â€” ACTIVE PRIORITIES

> This section reflects the current active implementation phase.
> Full tracker: `TODO_DESKTOP_PHASE.md`

### What is complete (current state)
- Voice engine Phase 1 â€” `addApprovedNarrative()`, weighted retrieval, disk write âœ…
- Narrative generation â€” all 10 priority 1004 sections + all 5 commercial sections âœ…
- Section dependency logic, subject condition support (C1â€“C6), phrase bank âœ…
- Two-pass draft/review workflow âœ…
- Scope enforcement across API + UI âœ…
- `server/destinationRegistry.js` â€” centralized insertion targets âœ…
- `server/fileLogger.js` â€” disk logging âœ…
- `server/backupExport.js` â€” support bundle export âœ…
- `cacc-writer-server.js` â€” 7 new production endpoints wired âœ…
- Electron shell â€” `desktop/electron/main.cjs`, `preload.cjs`, `forge.config.cjs` âœ…
- `package.json` â€” electron + forge devDeps + scripts âœ…
- UI health strip â€” `index.html` (#healthStrip, 5 hs-chips, #versionBadge, #exportToast) âœ…
- `app.js` â€” `loadHealthStatus()`, `renderHealthPanel()`, `createSupportBundle()`, `initVersionDisplay()` âœ…

### What is pending (ordered by priority)
1. `_test_desktop_endpoints.mjs` â€” test suite for 8 new production endpoints
2. ACI hardening â€” `/calibrate`, `/test-field`, `automation_id` strategy, escalating retry
3. RQ hardening â€” real selector discovery, `/test-field`, screenshot on failure
4. End-to-end test â€” one real 1004 assignment from generate â†’ insert â†’ verify

### Decision rule
> When deciding where to invest implementation effort, always ask:
> **"Does this serve Lane 1 (1004/ACI) or Lane 2 (commercial/RQ)?"**
> If no, defer it.

