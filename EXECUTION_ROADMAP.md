# CACC Appraisal OS - Technical Execution Roadmap

Snapshot date: 2026-03-12  
Repository state reviewed from live code + unit suite.

## Canonical Status Source

Phase acceptance is tracked in:
- `docs/PHASE_ACCEPTANCE_CHECKLIST.md`

This roadmap defines execution order and major delivery outcomes from the current state.

## Current Platform Baseline

Core layers now in place:
- Canonical case record and workflow scaffolding (`server/caseRecord/*`, `server/workflow/*`)
- Intake/extraction/fact integrity and pre-draft gate (`server/ingestion/*`, `server/factIntegrity/*`)
- 1004 workspace foundation (`server/workspace/*`, `workspace.js`, `index.html`)
- Comparable intelligence foundation (`server/comparableIntelligence/*`)
- Contradiction graph + QC integration (`server/contradictionGraph/*`, `server/qc/*`)
- Insertion reliability core (`server/insertion/*`, case-scoped insertion routes)
- Section factory hardening foundation (`server/sectionFactory/*`, generation policy + prompt pinning + audit/quality metadata)

Verification baseline:
- `npm run test:unit` passing (357/357)

## Remaining Critical Gaps

1. Workspace completeness
- Full blank-1004 field parity audit is not closed.
- Addendum micro-field coverage needs explicit completion pass.

2. Section factory visibility + stale-state control
- Prompt/policy/quality metadata exists in backend but is not fully surfaced in workspace/QC UI.
- Upstream-change staleness invalidation workflow is incomplete.

3. Valuation depth
- Comparable intelligence foundation is strong, but full production comp-grid + income + cost flows are not complete.

4. Contradiction operations
- Graph/checkers exist; full UI contradiction resolution lifecycle is incomplete.

5. Controlled learning loop
- Retrieval infrastructure exists; completed-assignment archive and ranking feedback loop are incomplete.

6. Security and commercialization
- RBAC/auth, encryption-at-rest, backup/restore DR, and optional tenant/billing layers are not complete.

## Delivery Sequence (Next Execution Windows)

## Window 1 - Complete Workspace + Section Factory Operating Surface

Objective:
- Finish field completeness and expose section governance metadata directly to appraisers.

Work:
- Close blank-1004 parity audit and mapping deltas.
- Surface section prompt version, policy state, dependency snapshot, and quality score in workspace/QC panels.
- Implement stale-section invalidation when upstream facts or dependencies change.
- Add deterministic downstream invalidation guidance for regenerate workflows.

Acceptance anchor:
- Phase D0 and D items in `docs/PHASE_ACCEPTANCE_CHECKLIST.md` move to accepted.

## Window 2 - Valuation Workspace Completion

Objective:
- Move from valuation foundation to full production valuation workflow.

Work:
- Complete comp-grid editing behavior and adjustment-line UX.
- Finalize burden/contradiction visibility in the sales comparison workflow.
- Implement income support workspace (rent comps, GRM, expense worksheet).
- Implement cost support workspace with structured support capture.
- Finalize reconciliation support UX while preserving manual appraiser control.

Acceptance anchor:
- Phase H items move from partial to accepted.

## Window 3 - Contradiction Resolution + QC Operating Loop

Objective:
- Turn contradiction detection into operational resolution workflow.

Work:
- Add contradiction-resolution actions and lifecycle states in workspace/QC UI.
- Improve lineage from contradiction -> field/value -> evidence source.
- Integrate contradiction closure into final review gating.

Acceptance anchor:
- Phase E items move to accepted.

## Window 4 - Controlled Learning and Assignment Memory

Objective:
- Complete retrieval-first learning loop without autonomous judgment.

Work:
- Implement completed-assignment archive schema and persistence.
- Capture draft-vs-final diffs, accepted/rejected suggestion outcomes, final comp/adjustment decisions.
- Build retrieval-ranking loop based on accepted historical patterns.
- Surface learned influence transparently in suggestion panels.

Acceptance anchor:
- Phase J items move from partial to accepted.

## Window 5 - Reliability, Security, and Productization

Objective:
- Harden for operational deployment.

Work:
- Complete production insertion operations tooling and replay UX for ACI/RealQuantum.
- Implement RBAC/authn/authz, encryption-at-rest, backup/restore and DR runbooks.
- Optional commercialization: tenant separation, feature flags, billing hooks.

Acceptance anchor:
- Phase F remaining items, Phase K, and optional Phase L complete.

## Working Rules for Future Changes

- Keep `case record + workspace` as source of truth.
- Do not bypass evidence provenance requirements.
- Do not add hidden scoring logic.
- Do not automate final comp/adjustment/reconciliation/value decisions.
- Extend existing modules; do not replace completed foundations.
