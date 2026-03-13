# CACC Writer Phase Acceptance Checklist

Snapshot date: 2026-03-13
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

Acceptance status: `Accepted`

## Phase D0 - CACC 1004 Workspace UI

- [x] Section-based workspace exists (`workspace.js`, `server/workspace/*`).
- [x] Canonical 1004 definition exists (`server/workspace/1004WorkspaceDefinition.js`).
- [x] Workspace payload/projection service exists (`server/workspace/workspaceService.js`).
- [x] Autosave/version-history behavior exists in workspace flow.
- [x] Assistant panel exists with field-level support data.
- [x] Full field-by-field blank-1004 parity audit is complete (20 sections, 5 addendum sections added).
- [x] Every addendum micro-field is explicitly mapped and verified (subject property, PUD/condo, cost, income, small residential income addenda).

Acceptance status: `Accepted`

## Phase D - Trusted Section Factory

- [x] Deterministic section policy module exists (`server/sectionFactory/sectionPolicyService.js`).
- [x] Section prompt version pinning exists and persists (`section_jobs.prompt_version`).
- [x] Section policy/dependency snapshots persist in DB (`section_policy_json`, `dependency_snapshot_json`).
- [x] Generated section audit metadata persists (`audit_metadata_json`).
- [x] Section quality score/metadata persists (`quality_score`, `quality_metadata_json`).
- [x] Regenerate route enforces dependency-aware policy (`POST /api/generation/regenerate-section`).
- [x] Unit coverage exists (`sectionPolicyService.test.mjs`, `generationRegenerateRoutes.test.mjs`).
- [x] Section governance service exposes prompt version, policy, quality score, freshness (`server/sectionFactory/sectionGovernanceService.js`).
- [x] Staleness invalidation on upstream fact changes is implemented end-to-end (`markSectionStale`, `invalidateDownstream`).
- [x] Deterministic downstream invalidation workflow exists with cascade (`GET/POST /api/governance/*`).

Acceptance status: `Accepted`

## Phase E - Contradiction Graph

- [x] Unified contradiction graph service exists (`server/contradictionGraph/*`).
- [x] Comparable contradiction signals are integrated.
- [x] QC checker integration exists (`server/qc/checkers/contradictionGraphChecker.js`).
- [x] Unit coverage exists (`contradictionGraphService.test.mjs`, `contradictionGraphChecker.test.mjs`).
- [x] Full contradiction-resolution workflow exposed via REST API (`server/api/contradictionLifecycleRoutes.js`).
- [x] Contradiction closure lifecycle with resolve/dismiss/acknowledge/reopen actions (`contradictionResolutionService.js`).
- [x] Contradiction gate check for final review gating (`server/contradictionGraph/contradictionGateService.js`).
- [x] Unit coverage for lifecycle (`contradictionLifecycle.test.mjs`).

Acceptance status: `Accepted`

## Phase F - Insertion Reliability

- [x] Field-level verification/readback logic exists (`server/insertion/verificationEngine.js`).
- [x] Retry classes and deterministic rollback logic exist (`server/insertion/insertionRunEngine.js`).
- [x] Replay package generation/persistence exists (`server/insertion/insertionRepo.js` + schema).
- [x] Case-scoped insertion reliability APIs exist (`server/api/casesRoutes.js`).
- [x] Workspace/QC surfaces insertion reliability summary.
- [x] Unit coverage exists (`insertionReliability.test.mjs`, `casesInsertionRoutes.test.mjs`).
- [x] Production-grade ACI/RealQuantum replay and operator tooling exists (`insertionReplay.test.mjs`).
- [x] End-to-end reliability benchmark infrastructure exists.

Acceptance status: `Accepted`

## Phase G - Inspection Workflow

- [x] Inspection capture module exists with full lifecycle (`server/inspection/inspectionService.js`).
- [x] Photo uploads, measurements, condition observations integrated (`server/inspection/photoService.js`, `measurementService.js`, `conditionService.js`).
- [x] Inspection artifacts flow into case record via audit events.
- [x] REST API exists (`server/api/inspectionRoutes.js`).
- [x] Unit coverage exists (`inspectionWorkflow.test.mjs`).

Acceptance status: `Accepted`

## Phase H - Valuation Modules

- [x] Comparable intelligence candidate scoring/tiering exists (`server/comparableIntelligence/*`).
- [x] Candidate accept/reject/hold decisions persist and are tested.
- [x] Adjustment support records and burden metrics exist.
- [x] Reconciliation support record generation exists.
- [x] Drag/drop candidate-to-grid loading exists in workspace.
- [x] Unit coverage exists (`comparableIntelligenceService.test.mjs`, `comparableQcChecker.test.mjs`).
- [x] Full comp-grid editor with slot management (`server/comparableIntelligence/compGridService.js`).
- [x] Income support workspace with rent comps, GRM, expense worksheet (`server/comparableIntelligence/incomeApproachService.js`).
- [x] Cost support workspace with land value, replacement cost, depreciation (`server/comparableIntelligence/costApproachService.js`).
- [x] Reconciliation service with weighted value calculation (`server/comparableIntelligence/reconciliationService.js`).
- [x] Valuation REST API (`server/api/valuationRoutes.js`).
- [x] Unit coverage (`valuationWorkspace.test.mjs` — 24 tests).

Acceptance status: `Accepted`

## Phase I - Business Operations

- [x] Operations/audit/timeline/dashboard foundations exist (`server/operations/*`, `operationsRoutes.js`).
- [x] Operational metrics and health diagnostics endpoints exist.
- [x] Quote/engagement/invoice/client communication operating flow is complete (`server/business/*`).
- [x] Pipeline tracking with stage management exists (`server/business/pipelineService.js`).
- [x] Due date alerting via `getEngagementsByDueDate` and `getOverdueEngagements`.
- [x] REST API exists (`server/api/businessRoutes.js`).
- [x] Unit coverage exists (`businessOps.test.mjs`).

Acceptance status: `Accepted`

## Phase J - Controlled Learning System

- [x] Memory/retrieval infrastructure exists (`server/memory/*`, `server/retrieval/*`).
- [x] Knowledge base and approved-example workflows exist (`server/knowledgeBase.js` + tests).
- [x] Full completed-assignment archival model exists (`server/learning/assignmentArchiveService.js`).
- [x] Revision-diff learning loop captures AI draft vs final text (`server/learning/revisionDiffService.js`).
- [x] Suggestion ranking loop driven by retrieval-based learning from finalized appraisals (`server/learning/suggestionRankingService.js`).
- [x] Appraiser-visible explanation of learned influence exists (`server/learning/learningExplanationService.js`).
- [x] REST API with revision diffs, suggestion outcomes, influence endpoints (`server/api/learningRoutes.js`).
- [x] Unit coverage (`learningLoop.test.mjs` — 21 tests).

Acceptance status: `Accepted`

## Phase K - Security

- [x] RBAC/authn/authz implemented (`server/security/accessControlService.js`, `server/security/userService.js`, `server/middleware/authMiddleware.js`).
- [x] Document encryption at rest implemented with AES-256-GCM (`server/security/encryptionService.js`).
- [x] Backup/restore and disaster recovery workflow implemented and tested (`server/security/backupRestoreService.js`).
- [x] Data retention rules and compliance records exist (`server/security/retentionService.js`, `complianceService.js`).
- [x] REST API (`server/api/securityRoutes.js`).
- [x] Unit coverage (`securityGovernance.test.mjs`, `securityComplete.test.mjs`, `authMiddleware.test.mjs`).

Acceptance status: `Accepted`

## Phase L - Commercialization

- [x] Tenant separation implemented (`server/business/tenantService.js`).
- [x] Feature flags implemented with tenant scoping (`server/business/featureFlagService.js`).
- [x] Billing hooks implemented (`server/business/billingService.js`).
- [x] REST API endpoints for tenants, feature flags, billing (`server/api/businessRoutes.js`).
- [x] Unit coverage (`securityComplete.test.mjs`).

Acceptance status: `Accepted`

## Desktop Production UI Phases

The following phases build production-grade UI on top of the accepted backend phases (A–L).

## Phase 11 — Learning Dashboard & Suggestion Explainability

- [x] Learning tab added to main navigation.
- [x] Suggestion acceptance metrics card (total/accepted/modified/rejected with rates).
- [x] Case learning report card (archive info, patterns applied, suggestion outcomes, revision stats).
- [x] Learned patterns explorer with confidence scoring, type filter, usage count, detail panel with success rate.
- [x] Suggestion history timeline with outcome badges (accepted/modified/rejected) and rejection reasons.
- [x] Revision diff stats visualization (sections edited, average change ratio, most-edited sections with bars).
- [x] Influence explainability card (per-section explanation, acceptance rate, influence factors, top patterns).
- [x] Ranked suggestions card (suggestions ranked by historical acceptance rate with bars).
- [x] Archive & feedback loop controls (one-click archive, close feedback loop with outcome propagation).
- [x] All API integration: acceptance-rate, case-report, patterns, suggestion-history, revision-diffs/stats, influence, ranked-suggestions, archive, feedback-loop/close.

Acceptance status: `Accepted`

## Phase 12 — Scope Doc Update & Migration Runbook

- [x] CORE_VS_POST100_SCOPE.md updated with Phase 11 Learning Dashboard completion status.
- [x] Phase Acceptance Checklist updated with Phase 11 UI acceptance.
- [x] EXECUTION_ROADMAP.md updated to reflect current platform state.
- [x] Machine migration runbook created (`docs/MIGRATION_RUNBOOK.md`).

Acceptance status: `Accepted`

## All Phases Complete

Total unit tests: 147 passing (API integration test suite)
All execution windows (W1-W5) delivered.
Desktop production UI phases (11-12) delivered.
