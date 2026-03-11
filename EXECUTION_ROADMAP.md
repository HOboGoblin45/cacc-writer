# CACC Appraisal OS - Technical Execution Roadmap

Snapshot date: 2026-03-11  
Repository state reviewed from live code and test runs.

## 1. Current-State Assessment (What Exists vs Target OS)

Status scale:
- Production-ready: usable now with acceptable reliability
- Partial: meaningful implementation exists but has architectural/coverage gaps
- Missing/Rebuild: not implemented or current shape cannot support OS target cleanly

### Layer-by-layer map

| Target Layer | Status | Evidence in Repo | Key Gaps |
|---|---|---|---|
| Production core stability | Partial | `cacc-writer-server.js`, modular routes in `server/api/*`, tests in `tests/unit/*`, `_test_smoke.mjs` | Hybrid runtime still has duplicated legacy inline endpoints + modular routes; behavior drift risk across duplicate surfaces |
| Authoritative case record | Partial | SQLite schema in `server/db/schema.js` + file-based case state in `cases/<id>/*.json` | No single authoritative case model; DB + JSON files both active; workflow truth is split |
| Evidence intake + classification | Partial | `server/api/documentRoutes.js`, `server/ingestion/documentClassifier.js`, `server/ingestion/stagingService.js` | PDF-first pipeline only; intake quality controls, duplicate handling policy, and operational retries are not fully hardened |
| Fact extraction + normalization | Partial | `server/ingestion/documentExtractors.js`, extracted facts tables + merge flow | Good extraction base, but conflict-resolution and mandatory-review gates are not enforced end-to-end before drafting |
| Rules/compliance engine | Partial | `server/intelligence/*`, `server/intelligence/complianceProfile.js`, QC rules in `server/qc/*` | Compliance profile is explicitly a skeleton; required-section determinism and jurisdiction-specific hard rules are incomplete |
| Knowledge + precedent retrieval | Partial | legacy KB + Phase 6 memory/retrieval (`server/memory/*`, `server/db/repositories/memoryRepo.js`) | Needs stricter approved-only governance, stronger curation workflows, and tighter orchestration integration defaults |
| Section-based drafting engine | Production-ready (core path) | Orchestrator + section jobs in `server/orchestrator/*`, generation routes in `server/api/generationRoutes.js` | Needs full migration away from legacy generation routes to avoid conflicting behavior |
| QC and contradiction review | Partial-to-strong | `server/qc/*`, `server/api/qcRoutes.js` | Good rule framework, but not yet a hard gate across all finalize/insert flows |
| ACI/RealQuantum insertion | Partial-to-strong | `server/insertion/*`, `server/api/insertionRoutes.js`, agents in `desktop_agent/`, `real_quantum_agent/` | Field-level verification and retry are present, but live-environment reliability and fallback analytics still need hard benchmarks |
| Audit/workfile/archive ops | Strong | `server/operations/*`, `server/api/operationsRoutes.js` | Broadly good; still depends on split source-of-truth data model |
| Security/business continuity | Missing/Rebuild | basic local controls only | No RBAC/auth layer, no encrypted-at-rest document model, no full disaster-recovery runbook |
| Business operations layer | Partial | Phase 10 operations dashboards/audit | Assignment intake/quote/invoice/client communication workflows not yet integrated into one operating stream |

## 2. What Must Be Rebuilt or Consolidated First

1. Runtime duplication:
- `cacc-writer-server.js` still contains many legacy inline `/api/*` handlers that overlap modular routes.
- This is the main source of unpredictability and regression risk.

2. Split data authority:
- Case truth is fragmented between filesystem JSON (`meta.json`, `facts.json`, `outputs.json`) and SQLite records.
- OS-level guarantees require one canonical data source and explicit projections.

3. Rules are present but not authoritative:
- Intelligence and QC exist, but required-section and compliance gating is not deterministic enough to be the final control plane.

## 3. Immediate Fixes Applied in This Pass

1. Test reliability hardening:
- Added shared test server harness: `tests/helpers/serverHarness.mjs`
- Smoke tests now auto-start server when needed: `_test_smoke.mjs`
- Middleware unit tests no longer rely on manually running server and now support both key/no-key guard responses: `tests/unit/middleware.test.mjs`

2. Verification:
- `npm run test:unit` -> passing (139 passed, 0 failed)
- `npm run test:smoke` -> passing (28 passed, 0 failed)

## 4. Next 3 Build Phases (Ticketed Execution Plan)

## Phase A - Core Runtime Consolidation (Now -> Milestone A Hardening)

Objective:
- Make one predictable runtime path and remove endpoint drift.

### Tickets

- `OS-A1` Route ownership map and de-duplication
  - Inventory every `/api/*` handler and designate one canonical owner (modular router only).
  - Mark legacy duplicates for removal or compatibility shim behavior.

- `OS-A2` Extract remaining inline endpoints into modules
  - Move legacy inline generation/insertion/case mutation handlers into `server/api/*`.
  - Keep backward-compatible paths as thin wrappers only.

- `OS-A3` Contract lock for core endpoints
  - Add request/response schema validation (Zod) for all core case/generation/insertion routes.
  - Return normalized error shapes with stable codes.

- `OS-A4` Deterministic test pipeline update
  - Keep auto-start harness across smoke/integration suites.
  - Add CI script that runs `typecheck -> unit -> smoke` in one command.

- `OS-A5` Startup and config guardrail pass
  - Validate required env/config at startup.
  - Fail fast on invalid config with actionable diagnostics.

### Acceptance Criteria

- No business logic remains in `cacc-writer-server.js` except startup + router mounting.
- No duplicated mutating endpoint handlers exist.
- Core routes have schema validation and stable error contracts.
- CI-local command consistently passes on clean checkout.

## Phase B - Authoritative Case Record (Milestone B)

Objective:
- Move to one authoritative case record and deterministic workflow state.

### Tickets

- `OS-B1` Canonical case schema v1
  - Define DB-level canonical entities for case header, facts, sections, statuses, unresolved issues, and provenance links.

- `OS-B2` Case projection service
  - Build read/write service that projects canonical DB state to UI payloads.
  - Keep filesystem JSON as read-only compatibility export during migration.

- `OS-B3` Migration + backfill
  - Backfill existing `cases/<id>` JSON files into canonical DB schema.
  - Add migration integrity checks and idempotent rerun support.

- `OS-B4` Workflow state machine
  - Enforce valid transitions (`intake -> extracting -> generating -> review -> approved -> inserting -> complete`).
  - Reject invalid transitions with explicit reason codes.

- `OS-B5` Source-of-truth gating
  - Drafting, QC, insertion must read canonical case record only.
  - Disable direct mutation of legacy JSON by API routes.

### Acceptance Criteria

- For live cases, DB is the only mutable source of truth.
- API read models are served from canonical case projection.
- Invalid workflow transitions are blocked by server rules.
- Legacy JSON files become derived artifacts, not control data.

## Phase C - Intake, Fact Integrity, and Rules Gate (Milestone C foundation)

Objective:
- Ensure facts are trustworthy before drafting; enforce required-section and missing-data gates.

### Tickets

- `OS-C1` Ingestion job orchestration
  - Add robust job states/retries for upload -> OCR -> classify -> extract -> stage.
  - Persist per-step failures with recoverable actions.

- `OS-C2` Fact conflict engine
  - Detect conflicts across extracted facts (address, parcel, GLA, site size, dates, rents, values).
  - Compute confidence + conflict severity with provenance links.

- `OS-C3` Mandatory fact review gate
  - Block draft generation when blocker-level fact conflicts or critical missing fields exist.
  - Provide explicit queue of unresolved fact decisions.

- `OS-C4` Required-section rule matrix v1
  - Deterministic matrix keyed by form type, property type, assignment conditions, and jurisdiction profile.
  - Output: required/optional/prohibited sections with reasons.

- `OS-C5` Compliance profile hard-rules expansion
  - Upgrade from skeleton profile to enforceable checks for required disclosures/conditions.

- `OS-C6` Accuracy benchmark fixtures
  - Build fixture cases across 1004 + commercial lanes.
  - Track extraction precision/recall and pre-draft gate pass rates.

### Acceptance Criteria

- Generation cannot start when blocker-level fact conflicts are unresolved.
- Every key fact used in drafting has provenance.
- Required section list is deterministic and explainable for each case.
- Extraction + gating metrics are measurable and tracked per release.

## 5. Recommended Delivery Order from Here

1. Complete Phase A first (runtime consolidation).  
2. Start Phase B immediately after A1/A2 land (schema and projection can begin in parallel).  
3. Begin Phase C after B1/B2 are stable enough to enforce pre-draft data gates.

This sequence preserves momentum while moving the platform from "advanced writer system" to true appraisal operating system control.
