# CACC Writer Phase Acceptance Checklist

Snapshot date: 2026-03-12  
Source of truth for this checklist: current repository contents (`server/*`, `workspace.js`, `index.html`, `tests/unit/*`).

Legend:
- `[x]` = accepted/completed
- `[ ]` = not yet accepted

## Phase A - Core Runtime Stabilization

- [x] Modular API routing exists (`server/api/*` mounted from `cacc-writer-server.js`).
- [x] Deterministic error contracts and gate error codes are present in core routes.
- [x] Unit test harness is stable and repeatable (`tests/unit/run.mjs`).
- [x] Server acts as composition layer with domain modules under `server/*`.
- [x] CI-style local quality gate is available (`npm run ci:check` script).

Acceptance status: `Accepted`

## Phase B - Canonical Case Record Foundation

- [x] Canonical case aggregate persistence exists (case record/facts/outputs/history repo path).
- [x] Case projection service exists and is DB-backed (`server/caseRecord/caseRecordService.js`).
- [x] Backfill/integrity utilities exist and are tested (`caseRecordService.test.mjs`).
- [x] Workflow state machine exists and is tested (`workflowStateMachine.test.mjs`).
- [x] Case APIs read/write through canonical services (`server/api/casesRoutes.js`).

Acceptance status: `Accepted`

## Phase C - Intake and Fact Integrity

- [x] Document intake routes and classification pipelines exist (`documentRoutes.js`, `server/ingestion/*`).
- [x] Extraction persistence exists (`document_extractions`, `extracted_facts`, `extracted_sections` schema).
- [x] Fact conflict engine exists (`server/factIntegrity/factConflictEngine.js`).
- [x] Fact decision queue and review workflows exist (`server/factIntegrity/factDecisionQueue.js` + case routes).
- [x] Pre-draft gate enforcement exists (`server/factIntegrity/preDraftGate.js`).
- [x] Section requirement matrix/compliance checks are implemented (`server/intelligence/*`).
- [x] Coverage exists in unit suite (`factIntegrity.test.mjs`, `documentIntake.test.mjs`, `documentExtractors.test.mjs`).

Acceptance status: `Accepted (foundation)`

## Phase D0 - CACC 1004 Workspace UI

- [x] Section-based workspace exists (`workspace.js`, `server/workspace/*`).
- [x] Canonical 1004 definition exists (`server/workspace/1004WorkspaceDefinition.js`).
- [x] Workspace payload/projection service exists (`server/workspace/workspaceService.js`).
- [x] Autosave/version-history behavior exists in workspace flow.
- [x] Assistant panel exists with field-level support data.
- [ ] Full field-by-field blank-1004 parity audit is complete.
- [ ] Every addendum micro-field is explicitly mapped and verified.

Acceptance status: `Partial - foundation complete, mapping completion pending`

## Phase D - Trusted Section Factory

- [x] Deterministic section policy module exists (`server/sectionFactory/sectionPolicyService.js`).
- [x] Section prompt version pinning exists and persists (`section_jobs.prompt_version`).
- [x] Section policy/dependency snapshots persist in DB (`section_policy_json`, `dependency_snapshot_json`).
- [x] Generated section audit metadata persists (`audit_metadata_json`).
- [x] Section quality score/metadata persists (`quality_score`, `quality_metadata_json`).
- [x] Regenerate route enforces dependency-aware policy (`POST /api/generation/regenerate-section`).
- [x] Unit coverage exists (`sectionPolicyService.test.mjs`, `generationRegenerateRoutes.test.mjs`).
- [ ] Workspace/QC UI exposes section prompt version, policy, and quality score.
- [ ] Staleness invalidation on upstream fact changes is implemented end-to-end.
- [ ] Deterministic regenerate policy includes downstream invalidation workflow.

Acceptance status: `Partial - hardening foundation complete`

## Phase E - Contradiction Graph

- [x] Unified contradiction graph service exists (`server/contradictionGraph/*`).
- [x] Comparable contradiction signals are integrated.
- [x] QC checker integration exists (`server/qc/checkers/contradictionGraphChecker.js`).
- [x] Unit coverage exists (`contradictionGraphService.test.mjs`, `contradictionGraphChecker.test.mjs`).
- [ ] Full contradiction-resolution workflow is exposed in UI.
- [ ] Contradiction closure lifecycle and assignment workflow are complete.

Acceptance status: `Partial - graph + QC integration complete`

## Phase F - Insertion Reliability

- [x] Field-level verification/readback logic exists (`server/insertion/verificationEngine.js`).
- [x] Retry classes and deterministic rollback logic exist (`server/insertion/insertionRunEngine.js`).
- [x] Replay package generation/persistence exists (`server/insertion/insertionRepo.js` + schema).
- [x] Case-scoped insertion reliability APIs exist (`server/api/casesRoutes.js`).
- [x] Workspace/QC surfaces insertion reliability summary.
- [x] Unit coverage exists (`insertionReliability.test.mjs`, `casesInsertionRoutes.test.mjs`).
- [ ] Production-grade ACI/RealQuantum replay UX and operator tooling are complete.
- [ ] End-to-end live reliability benchmark suite is formalized.

Acceptance status: `Partial - reliability core complete`

## Phase G - Inspection Workflow

- [ ] Mobile-first inspection capture module exists.
- [ ] Photo uploads, voice notes, deferred items, condition observations are integrated.
- [ ] Inspection artifacts flow into evidence/case record automatically.

Acceptance status: `Not accepted`

## Phase H - Valuation Modules

- [x] Comparable intelligence candidate scoring/tiering exists (`server/comparableIntelligence/*`).
- [x] Candidate accept/reject/hold decisions persist and are tested.
- [x] Adjustment support records and burden metrics exist.
- [x] Reconciliation support record generation exists.
- [x] Drag/drop candidate-to-grid loading exists in workspace.
- [x] Unit coverage exists (`comparableIntelligenceService.test.mjs`, `comparableQcChecker.test.mjs`).
- [ ] Full comp-grid editor behavior is complete for production appraisal workflow.
- [ ] Income support workspace (rent comps, GRM, expense worksheet) is complete.
- [ ] Cost support workspace is complete.
- [ ] Reconciliation assistant UX is fully integrated and appraiser-review optimized.

Acceptance status: `Partial - strong foundation complete`

## Phase I - Business Operations

- [x] Operations/audit/timeline/dashboard foundations exist (`server/operations/*`, `operationsRoutes.js`).
- [x] Operational metrics and health diagnostics endpoints exist.
- [ ] Quote/engagement/invoice/client communication operating flow is complete.
- [ ] Due date alerting and end-to-end pipeline business workflow are complete.

Acceptance status: `Partial - telemetry and ops substrate complete`

## Phase J - Controlled Learning System

- [x] Memory/retrieval infrastructure exists (`server/memory/*`, `server/retrieval/*`).
- [x] Knowledge base and approved-example workflows exist (`server/knowledgeBase.js` + tests).
- [ ] Full completed-assignment archival model is finalized.
- [ ] Revision-diff learning loop is complete for accepted/rejected suggestions and final edits.
- [ ] Suggestion ranking loop is fully driven by retrieval-based learning from finalized appraisals.
- [ ] Appraiser-visible explanation of learned influence is complete.

Acceptance status: `Partial - infrastructure exists, controlled loop incomplete`

## Phase K - Security

- [ ] RBAC/authn/authz is implemented.
- [ ] Document encryption at rest is implemented.
- [ ] Backup/restore and disaster recovery workflow is fully implemented and tested.

Acceptance status: `Not accepted`

## Phase L - Commercialization (Optional)

- [ ] Tenant separation is implemented.
- [ ] Feature flags + billing hooks are implemented.
- [ ] Template scoping by tenant is implemented.

Acceptance status: `Not accepted`

## Current Priority Queue (Execution Order)

- [ ] Complete 1004 field-by-field parity audit and close remaining unmapped fields.
- [ ] Surface section policy/prompt-version/quality metadata in workspace and QC UI.
- [ ] Complete downstream invalidation/staleness workflow for regenerate + dependency changes.
- [ ] Expand valuation workspace to full comp-grid + income + cost production behavior.
- [ ] Complete contradiction resolution workflow in UI with operator actions.
- [ ] Finalize controlled learning loop with completed-assignment archives and ranking feedback.

