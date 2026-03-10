# Phase 7 — Quality Control and Review Automation

## Implementation Progress

- [x] **Step 1**: Schema — `server/migration/phase7Schema.js` + wire into `schema.js`
- [x] **Step 2**: Types — `server/qc/types.js` (JSDoc typedefs)
- [x] **Step 3**: QC Rule Registry — `server/qc/qcRuleRegistry.js`
- [x] **Step 4a**: Checker — Required Coverage — `server/qc/checkers/requiredCoverageChecker.js`
- [x] **Step 4b**: Checker — Cross-Section Consistency — `server/qc/checkers/crossSectionConsistencyChecker.js`
- [x] **Step 4c**: Checker — Placeholder/Genericity — `server/qc/checkers/placeholderGenericityChecker.js`
- [x] **Step 4d**: Checker — Compliance Signal — `server/qc/checkers/complianceSignalChecker.js`
- [x] **Step 5**: Severity Model — `server/qc/severityModel.js`
- [x] **Step 6**: Summary Builder — `server/qc/summaryBuilder.js`
- [x] **Step 7**: QC Repository — `server/qc/qcRepo.js`
- [x] **Step 8**: QC Run Engine — `server/qc/qcRunEngine.js`
- [x] **Step 9**: API Routes — `server/api/qcRoutes.js`
- [x] **Step 10**: Server Wiring — modify `cacc-writer-server.js`
- [x] **Step 11**: Basic QC UI — `index.html` (HTML + CSS) + `app.js` (JS functions + tab hook)

## Files Created
- `server/migration/phase7Schema.js` — qc_runs + qc_findings SQLite tables
- `server/qc/types.js` — JSDoc typedefs for QC domain objects
- `server/qc/qcRuleRegistry.js` — Rule registry (registerRule, getApplicableRules, getRegistryStats)
- `server/qc/checkers/requiredCoverageChecker.js` — 6 rules (REQ-001–REQ-006)
- `server/qc/checkers/crossSectionConsistencyChecker.js` — 10 rules (CON-001–CON-010)
- `server/qc/checkers/placeholderGenericityChecker.js` — 7 rules (PLH-001–PLH-007)
- `server/qc/checkers/complianceSignalChecker.js` — 13 rules (CMP-001–CMP-013)
- `server/qc/severityModel.js` — Priority scoring, draft readiness, noise filtering
- `server/qc/summaryBuilder.js` — buildQCSummary() for draft package QC summary
- `server/qc/qcRepo.js` — Full CRUD for qc_runs and qc_findings
- `server/qc/qcRunEngine.js` — runQC() orchestrator
- `server/api/qcRoutes.js` — Express Router with 11 QC endpoints

## Files Modified
- `server/db/schema.js` — Added initPhase7Schema import and call
- `cacc-writer-server.js` — Added qcRouter import + app.use('/api', qcRouter)
- `index.html` — Phase 7 QC CSS styles + replaced #tab-qc HTML with new QC panel layout
- `app.js` — Added showTab('qc') hook + 15 QC functions (qcRunQC, qcLoadLatestRun, qcLoadSummary, qcLoadFindings, qcApplyFilters, qcLoadHistory, qcSwitchRun, qcLoadRegistryStats, qcRenderSummary, qcRenderFindings, qcDismissFinding, qcResolveFinding, qcReopenFinding, qcOnTabOpen) + QC_STATE object
