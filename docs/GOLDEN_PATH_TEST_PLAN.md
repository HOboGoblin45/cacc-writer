# CACC Writer — Golden Path Test Plan

Last updated: 2026-03-13
Purpose: Prove the system works end-to-end on two real assignment lanes before claiming production readiness.

---

## Overview

Two golden-path cases exercise the full lifecycle:

| Case | Form Type | Fixture Path | Insertion Target |
|------|-----------|-------------|-----------------|
| GP-1004-001 | 1004 (single-family residential) | `fixtures/golden/1004-case/` | ACI (port 5180) |
| GP-COMM-001 | commercial (12-unit multifamily) | `fixtures/golden/commercial-case/` | Real Quantum (port 5181) |

Each case must complete every lifecycle stage without manual DB surgery, JSON file edits, or workarounds.

---

## Validation Command

```bash
node fixtures/golden/run-golden-path.mjs
```

Options:
- `--lane 1004` — run only the 1004 case
- `--lane commercial` — run only the commercial case
- `--skip-insertion` — skip the insertion stage (useful when ACI/RQ agents are not running)
- `--skip-generation` — skip AI generation (useful for testing pipeline without OpenAI calls)
- `--verbose` — print full response bodies

The harness exits `0` on all stages passing, `1` on any failure.

---

## Lifecycle Stages

Each golden-path case passes through these stages in order. Every stage is validated by the harness.

### Stage 1: Case Create
- **Endpoint:** `POST /api/cases/create`
- **Input:** `case-seed.json` → `formType`, `address`, `borrower`/`owner`, `assignment` metadata
- **Pass criteria:**
  - Response `ok: true`
  - Returns `caseId`
  - `GET /api/cases/:caseId` returns the case with correct form type and `status: active`

### Stage 2: Document Upload
- **Endpoint:** `POST /api/cases/:caseId/documents/upload`
- **Input:** Each file in `documents/` folder
- **Pass criteria:**
  - Each upload returns `ok: true` with `documentId`
  - `GET /api/cases/:caseId/documents` lists all uploaded documents
  - Document count matches fixture file count

### Stage 3: Extraction
- **Endpoint:** `POST /api/cases/:caseId/documents/:docId/extract`
- **Input:** Trigger extraction for each uploaded document
- **Pass criteria:**
  - Each extraction returns without server error (5xx)
  - `GET /api/cases/:caseId/extraction-summary` shows extraction attempted for each document
  - Note: Extraction quality is not gated here — the test validates the pipeline runs, not AI accuracy

### Stage 4: Fact Merge
- **Endpoint:** `PUT /api/cases/:caseId/facts`
- **Input:** Core facts from `case-seed.json` (subject, transaction, neighborhood, income for commercial)
- **Pass criteria:**
  - Response `ok: true`
  - `GET /api/cases/:caseId/record` returns the case with merged facts
  - Fact sources are persisted (`PUT /api/cases/:caseId/fact-sources`)
  - Pre-draft gate check (`GET /api/cases/:caseId/pre-draft-check`) returns a meaningful result (not a server error)

### Stage 5: Intelligence Build
- **Endpoint:** `POST /api/cases/:caseId/missing-facts` (batch check)
- **Endpoint:** `GET /api/cases/:caseId/workspace` (workspace projection with section requirements)
- **Pass criteria:**
  - Missing-facts response identifies which sections have sufficient facts
  - Workspace projection returns section list matching the form type
  - For 1004: at least 10 sections listed
  - For commercial: at least 5 sections listed

### Stage 6: Generation
- **Endpoint:** `POST /api/cases/:caseId/generate-all` or `POST /api/generate-batch`
- **Input:** Priority sections for the form type
- **Pass criteria:**
  - Generation returns without server error
  - Each priority section has a generated text result (may be placeholder if OpenAI is unavailable)
  - `GET /api/cases/:caseId/history` shows version entries for generated sections
  - If `--skip-generation` is set, this stage is skipped with a warning

### Stage 7: QC
- **Endpoint:** `GET /api/cases/:caseId/qc-approval-gate`
- **Pass criteria:**
  - QC gate returns a structured result with severity-graded findings
  - Response includes `ready` status field
  - No unhandled server errors

### Stage 8: Insertion / Export
- **Endpoint:** `GET /api/cases/:caseId/insertion-runs` (check insertion infrastructure)
- **Endpoint:** Export via `POST /api/export/bundle/:caseId` or equivalent
- **Pass criteria:**
  - Insertion route responds without error
  - Export bundle can be generated
  - If `--skip-insertion` is set, this stage validates the route exists but does not trigger actual insertion

### Stage 9: Archive
- **Endpoint:** `PATCH /api/cases/:caseId/status` with `{ status: 'archived' }`
- **Endpoint:** `POST /api/cases/:caseId/archive` (learning archive)
- **Pass criteria:**
  - Case status changes to `archived`
  - Archive endpoint responds without error
  - `GET /api/cases/:caseId` confirms archived status

---

## Fixture Files

### 1004 Case (`fixtures/golden/1004-case/`)

| File | Purpose |
|------|---------|
| `case-seed.json` | Subject property facts, assignment details, transaction info, neighborhood, comparables reference |
| `comparables.json` | Three comparable sales with adjustments and reconciliation |
| `documents/engagement-letter.txt` | Engagement letter from AMC |
| `documents/purchase-contract.txt` | Purchase and sale agreement |
| `documents/assessor-record.txt` | County assessor property record card |
| `documents/mls-listing.txt` | MLS listing detail sheet |
| `documents/market-conditions.txt` | Residential market conditions summary |

### Commercial Case (`fixtures/golden/commercial-case/`)

| File | Purpose |
|------|---------|
| `case-seed.json` | Subject property facts, assignment details, income data, neighborhood |
| `comparables.json` | Three sale comps, three rent comps, and reconciliation |
| `documents/engagement-letter.txt` | Commercial engagement letter |
| `documents/rent-roll.txt` | Current rent roll with unit-level detail |
| `documents/operating-statements.txt` | Three years of operating statements |
| `documents/assessor-record.txt` | County assessor record for commercial parcel |
| `documents/market-conditions.txt` | Multifamily market conditions summary |

---

## Pass/Fail Summary

The harness prints a checklist at the end:

```
GOLDEN PATH RESULTS — 1004 (GP-1004-001)
  [PASS] Case Create
  [PASS] Document Upload (5 documents)
  [PASS] Extraction
  [PASS] Fact Merge
  [PASS] Intelligence Build
  [PASS] Generation (10 sections)
  [PASS] QC Gate
  [PASS] Insertion/Export
  [PASS] Archive
  Result: 9/9 stages passed

GOLDEN PATH RESULTS — Commercial (GP-COMM-001)
  [PASS] Case Create
  [PASS] Document Upload (5 documents)
  [PASS] Extraction
  [PASS] Fact Merge
  [PASS] Intelligence Build
  [PASS] Generation (5 sections)
  [PASS] QC Gate
  [PASS] Insertion/Export
  [PASS] Archive
  Result: 9/9 stages passed
```

A failure at any stage prints the error response body and continues to subsequent stages (all stages are attempted even after a failure, to produce a complete diagnostic).

---

## Known Gaps That May Block a Green Run

| Gap | Impact | Workaround |
|-----|--------|-----------|
| OpenAI API key required for generation | Stage 6 fails without valid API key | Use `--skip-generation` flag |
| ACI agent must be running for 1004 insertion | Stage 8 incomplete without agent on port 5180 | Use `--skip-insertion` flag |
| Real Quantum agent must be running for commercial insertion | Stage 8 incomplete without agent on port 5181 | Use `--skip-insertion` flag |
| Document extraction depends on AI parsing quality | Stage 3 may produce partial results | Facts are manually seeded in Stage 4 to ensure downstream stages work |
| Export bundle endpoint may not exist yet | Stage 8 export step may fail | Harness treats export as optional within Stage 8 |

---

## Adding to CI

To run golden-path checks in CI without external dependencies:

```bash
node fixtures/golden/run-golden-path.mjs --skip-insertion --skip-generation
```

This validates the full API pipeline (create → upload → extract → merge → intelligence → QC → archive) without requiring OpenAI or desktop automation agents.
