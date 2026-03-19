# CACC Writer — Full Code Review & Project Status

**Date:** 2026-03-19
**Reviewer:** Claude Code (automated review)
**Branch:** `claude/code-review-project-status-XftfI`

---

## Executive Summary

CACC Writer v2.0 is a mature, AI-powered appraisal narrative generator for Charles Cresci's appraisal practice. It automates USPAP-compliant narrative writing for residential (1004) and commercial forms, with two desktop agents for inserting text into ACI and Real Quantum software.

**Overall Assessment: Production-ready for internal single-appraiser use, with known gaps in live insertion validation and frontend maintainability.**

---

## 1. Project Status by Phase

| Phase | Name | Status | Notes |
|-------|------|--------|-------|
| 1 | Generate Tab UI Redesign | COMPLETE | 29/29 checks passed |
| 2 | Cases Tab UI Redesign | COMPLETE | 52/52 checks passed |
| 3 | Workflow Authority (Orchestrator) | COMPLETE | Implementation done; pending live test |
| 4 | PDF Extraction & Scoring | COMPLETE | Market conditions 75%, reconciliation 76% |
| 5 | Voice Training Pipeline | COMPLETE | Multi-file drop, bulk import, ACI XML intake |
| 6 | Google Sheets + MRED Integration | COMPLETE | OAuth, photo scanner, comp learning |
| 7 | QC System | COMPLETE | 36 rules across 7 categories |
| 8 | UI Overhaul (4-tab nav) | COMPLETE | Intake wizard, case cards, pipeline status |
| 9 | Insertion Agents | COMPLETE | ACI (pywinauto) + Real Quantum (Playwright) |
| 10 | Business Operations Layer | COMPLETE | Audit trail, metrics, health diagnostics, dashboard |

**All 10 hardening phases are complete.** The main remaining work is on the Execution Roadmap (see below).

---

## 2. Execution Roadmap Status

Per `EXECUTION_ROADMAP.md` (audited 2026-03-13), the delivery order post-Phase 10:

| Roadmap Phase | Name | Status |
|---------------|------|--------|
| 0 | Truth Alignment | Partially done — README updated, scope defined |
| 1 | Golden-Path Validation | Preflight passes; **blocked on live destination readiness** |
| 2 | 1004 Production Hardening | Not started |
| 3 | Commercial Production Hardening | Not started |
| 4 | Unified Valuation Desk | Not started |
| 5 | Fact Integrity & Research Completion | Not started |
| 6 | Inspection Workflow Usability | Not started |
| 7 | Learning Transparency & Memory Health | Not started |
| 8 | Business Loop Closure | Not started |
| 9 | Reliability, Restore & Auditability | Not started |
| 10 | Deferred Form Expansion (1025, 1073, 1004C) | Not started |

**Critical blocker:** No strict end-to-end golden-path proof for live insertion yet.

---

## 3. Test Health

### Unit Tests
- **180 passed, 13 failed** (was 287 passing at last documented baseline)
- **12 of 13 failures** are environment-related (`Cannot find package` — `better-sqlite3`, `multer`, `dotenv`, `uuid`). These pass when `node_modules` is installed.
- **1 real assertion failure:** `fieldProfiles.test.mjs` — `offering_history` field marked as live but test expects `pending navigation fix`

### TypeScript
- **20 errors** — all in `.ts` files under `server/observability/`, `server/retrieval/`, `server/tools/`, `server/workflow/`
- Root cause: Missing `@types/node` and unresolved module declarations (`langsmith`, `@langchain/langgraph`, `uuid`)
- These TypeScript files appear to be secondary/optional integrations (LangSmith, LlamaIndex, LangGraph workflow)

### Smoke Tests
- 49 tests documented as passing (requires running server + dependencies to verify)

---

## 4. Architecture Assessment

### Backend: **B+**

**Strengths:**
- Clean modular structure: 41 server directories, 28 API route files
- Thin composition server (`cacc-writer-server.js` — 200 lines)
- Proper SQLite setup: WAL mode, FK constraints, 50+ tables across 19 migration phases
- Two-pass AI generation with hallucination detection
- Confidence-gated facts system (high/medium/low prevents unfounded claims)
- 4-pass knowledge base retrieval with auto-growth from approved edits
- Geospatial context injection (Nominatim + Overpass OSM)
- Structured JSON logging throughout (zero `console.log` in server code)
- Comprehensive QC engine with 36 rules and severity ranking

**Concerns:**
- `casesRoutes.js` at 2,040 lines could be split
- `generationRoutes.js` at 51KB is the largest API file
- Orchestrator allows partial completion without automatic retry
- No global Express error handler observed

### Frontend: **D+**

**Critical issue — monolithic files:**

| File | Lines | Size |
|------|-------|------|
| `app.js` | 8,523 | 400 KB |
| `index.html` | 5,277 | 280 KB |
| `workspace.js` | 2,706 | 120 KB |
| `dataPipeline.js` | 1,459 | 56 KB |

- No module system — all globals (`STATE`, `WORKSPACE_STATE`)
- `index.html` has 3,972 lines of inline CSS
- Implicit load-order dependencies between scripts
- No bundler (webpack/vite) — raw `<script>` tags
- 16 tabs all rendered as hidden divs in a single HTML file

### Database: **A**
- Well-versioned schema with 19 migration phases
- 50+ tables covering cases, generation, QC, insertion, operations, comparables, learning
- WAL mode, FK constraints, proper pragmas
- Repositories pattern for data access

### Knowledge Base: **B+**
- Three tiers: approved_edits (1.5×), curated (1.0×), imported (0.7×)
- 4-pass retrieval fallback (exact → relax → cross-form → empty)
- Auto-grows from appraiser-approved edits
- 297+ examples indexed
- **Gap:** In-memory string matching only; Pinecone vector search configured but optional

### Desktop Agents: **C+**
- ACI agent (Python/pywinauto) — brittle UI automation, requires manual calibration
- Real Quantum agent (Python/Playwright) — requires Chrome CDP setup
- Screenshot-on-failure aids debugging
- **Gap:** No automatic health probes during generation workflow

---

## 5. Security Findings

### High Priority

1. **Hardcoded API key in client-side code**
   - `app.js:24` — `const CACC_API_KEY = 'cacc-local-key-2026'`
   - Repeated at lines 8144, 8167, 8208, 8228, 8245, 8400, 8461
   - Also in test scripts (`_test_smoke.mjs:111`, `scripts/e2eWorkflowTest.mjs:75`)
   - **Risk:** Low (local-only app), but bad practice

2. **Auth disabled by default**
   - `server/middleware/authMiddleware.js` — `AUTH_ENABLED=false` allows all requests through
   - No key configured = pass through silently
   - **Risk:** Low for single-user local app, but should be enabled in any shared deployment

### Medium Priority

3. **Inconsistent header casing** — Mix of `X-API-Key` and `X-Api-Key` across codebase
4. **No secrets vault** — API keys stored in `.env` (standard for local apps, not for production)

---

## 6. Code Quality Issues

### Duplication
- API key headers scattered across 10+ locations instead of centralized
- MRED status check logic repeated in `app.js`
- Multiple `Promise.all()` patterns could share error handling

### Dead Code / Technical Debt
- `server/fieldRegistry.js:13` — `TODO Phase 2: populate automationId from ACI calibration`
- `server/integrations/photoScanner.js:7` — `Phase C (TODO): ACI pywinauto insertion`
- Root-level `_test_*.mjs` files (16 files) appear to be ad-hoc test scripts that could be consolidated

### Large Files in Repository
- `exports/` directory — potential for very large files in git history
- `voice_training.bak.json` — 200KB backup file committed to repo
- `server_restart.log`, `server_test_output.log` — log files in repo

---

## 7. Highest-Risk Gaps (from EXECUTION_ROADMAP.md)

1. **No strict end-to-end golden-path proof for live insertion** — generation works, but live ACI/RQ field insertion is not validated end-to-end
2. **No operationally complete canonical backfill for live cases** — existing real cases not fully migrated to new schema
3. **No unified valuation surface** — sales comparison, income, cost, reconciliation are separate
4. **No finished inspection workflow** — mobile-friendly inspection mode not built
5. **No restore drill confidence** — backup/restore not operationally verified
6. **Frontend maintainability risk** — 4 monolithic files totaling 18,000+ lines

---

## 8. Recommendations (Priority Order)

### Immediate (Pre-Production)
1. **Fix the 1 real test failure** in `fieldProfiles.test.mjs`
2. **Fix TypeScript errors** — add `@types/node` to devDependencies, add missing type declarations
3. **Complete golden-path live insertion test** (Roadmap Phase 1) — this is the critical blocker

### Short-Term
4. **Centralize API key handling** — single `apiClient.js` for frontend fetch calls
5. **Enable auth by default** or add clear production setup instructions
6. **Clean up repo** — gitignore log files, backup JSONs, and large exports

### Medium-Term
7. **Split frontend monoliths** — extract `app.js` into modules (case management, tab routing, API client, etc.)
8. **Add module bundler** (Vite recommended) for proper code splitting
9. **Move inline CSS** from `index.html` to `styles.css`

### Long-Term
10. **Implement Roadmap Phases 2-10** in delivery order
11. **Add vector search** (Pinecone) as KB grows past current scale
12. **Add automatic agent health probes** into generation workflow

---

## 9. Summary Scorecard

| Dimension | Score | Trend |
|-----------|-------|-------|
| Backend Architecture | B+ | Stable |
| Frontend Architecture | D+ | Needs attention |
| Database Design | A | Stable |
| Test Coverage | B- | 1 regression, env-dependent failures |
| Security Posture | C | Acceptable for local, not for shared |
| Documentation | A- | README, roadmap, phase docs all current |
| Production Readiness | B | Blocked on live insertion validation |
| Code Organization | B | Backend great, frontend poor |
| AI/Generation Quality | A- | Two-pass, confidence-gated, KB auto-growth |
| Overall | B | Solid foundation, clear path forward |
