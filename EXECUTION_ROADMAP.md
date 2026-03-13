# CACC Appraisal OS - Technical Execution Roadmap

Snapshot date: 2026-03-13
Repository state reviewed from live code + unit suite.

## Canonical Status Source

Phase acceptance is tracked in:
- `docs/PHASE_ACCEPTANCE_CHECKLIST.md`

This roadmap defines execution order and major delivery outcomes from the current state.

## Current Platform Baseline

Core layers now in place:
- Canonical case record and workflow scaffolding (`server/caseRecord/*`, `server/workflow/*`)
- Intake/extraction/fact integrity and pre-draft gate (`server/ingestion/*`, `server/factIntegrity/*`)
- 1004 workspace foundation with full blank-1004 parity (`server/workspace/*`, `workspace.js`, `index.html`)
- Section factory with policy, prompt pinning, governance, and staleness invalidation (`server/sectionFactory/*`)
- Comparable intelligence with comp-grid, income, cost, reconciliation (`server/comparableIntelligence/*`)
- Contradiction graph + resolution lifecycle + gate (`server/contradictionGraph/*`, `server/qc/*`)
- Insertion reliability with verification/readback and replay (`server/insertion/*`)
- Inspection workflow with photo/measurement/condition capture (`server/inspection/*`)
- Business operations with quote/engagement/invoice/pipeline (`server/business/*`)
- Controlled learning loop with archive, revision-diff, suggestion ranking, explainability (`server/learning/*`)
- Security with RBAC/auth/encryption/backup-restore/retention (`server/security/*`)
- Commercialization with tenant/feature-flag/billing infrastructure (`server/business/*`)

Desktop production UI:
- 14 tabs: Case, Workspace, Facts, Generate, QC Grade, Voice, Intel, Valuation, Docs, Memory, Pipeline, Inspect, Governance, Learning, System
- Learning dashboard with pattern explorer, suggestion history, influence explainability, ranked suggestions, revision diffs, archive controls

Verification baseline:
- `npm test` passing (147 API integration tests)

## Completed Execution Windows

### Window 1 — Complete Workspace + Section Factory Operating Surface ✅
- Full blank-1004 parity audit completed (20 sections + 5 addendum sections).
- Section governance metadata surfaced (prompt version, policy state, quality score, freshness).
- Staleness invalidation on upstream fact changes implemented end-to-end.
- Phases D0 and D accepted.

### Window 2 — Valuation Workspace Completion ✅
- Comp-grid editor with slot management.
- Income support workspace (rent comps, GRM, expense worksheet).
- Cost support workspace (land value, replacement cost, depreciation).
- Reconciliation service with weighted value calculation.
- Phase H accepted.

### Window 3 — Contradiction Resolution + QC Operating Loop ✅
- Full contradiction-resolution lifecycle (resolve/dismiss/acknowledge/reopen).
- Contradiction gate check for finalization gating.
- QC readiness signals in UI.
- Phase E accepted.

### Window 4 — Controlled Learning and Assignment Memory ✅
- Completed-assignment archive schema and persistence.
- Draft-vs-final revision diffs capture.
- Suggestion ranking loop from accepted historical patterns.
- Appraiser-visible influence explanation per section.
- Phase J accepted.

### Window 5 — Reliability, Security, and Productization ✅
- RBAC/authn/authz, encryption-at-rest, backup/restore.
- Data retention and compliance records.
- Tenant separation, feature flags, billing hooks.
- Phases F, K, L accepted.

### Desktop Production UI Phases (11-12) ✅
- Phase 11: Learning dashboard with acceptance metrics, pattern explorer, suggestion history, influence explainability, ranked suggestions, revision diff stats, archive & feedback loop controls.
- Phase 12: Scope documentation update and machine migration runbook.

## Remaining Work (Core-to-100 Gaps)

Items from `docs/CORE_VS_POST100_SCOPE.md` still marked **Needed**:

### Case & Workflow (DoD #1, #10)
- Quote/engagement → case creation UI linkage
- Due-date dashboard tied to case status
- Case-header business status summary
- Overdue/risk queue for upcoming deadlines

### Fact Integrity (DoD #3)
- Missing-facts severity dashboard (1004 and commercial)

### Section Generation (DoD #5)
- Section governance cards in workspace UI
- "Ready to generate" / "ready to finalize" checklists
- Section version compare / restore UX

### Valuation Support (DoD #6)
- Unified valuation desk UX
- Comp candidate queue with reason history UI
- Adjustment support notebook
- Contradiction/burden visibility per comp
- Reconciliation memo builder
- Exportable value support pack

### Insertion (DoD #8)
- ACI insertion reliability summary panel
- Real Quantum insertion replay/operator UX

### Archive & Learning (DoD #9)
- "Why this suggestion" drawer in workspace
- Memory health tools (stale/duplicate/weak pruning)

### System Reliability (DoD #10)
- Backup scheduler UI
- Restore verification workflow
- Audit-log viewer for critical events

### Inspection (DoD #2, #3, #10)
- Mobile-friendly inspection mode
- Room/exterior checklist templates
- Photo tagging by room/component
- Voice note to observation flow
- Post-inspection summary into prompt context

### Data Pipeline (DoD #3, #6)
- Crawl preset library for appraisal sources
- Extracted fact cards with provenance/conflict
- Duplicate detection
- Verification queues for extracted web data

### Golden-Path Validation
- 1004 end-to-end case fixture
- Commercial end-to-end case fixture
- Automated validation harness
- Golden path test plan

## Working Rules for Future Changes

- Keep `case record + workspace` as source of truth.
- Do not bypass evidence provenance requirements.
- Do not add hidden scoring logic.
- Do not automate final comp/adjustment/reconciliation/value decisions.
- Extend existing modules; do not replace completed foundations.
