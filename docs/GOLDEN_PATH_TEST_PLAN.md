# Golden Path Test Plan

## Goal

Validate that CACC Writer can move a real fixture-backed assignment from intake through archive using shipped APIs and canonical case records, without database surgery.

This plan is intentionally stricter than smoke tests:

- It uses fixture documents uploaded through the live document pipeline.
- It reviews and merges extracted facts through review endpoints.
- It loads the case workspace from the canonical case projection.
- It runs full-draft generation, QC, insertion/export, and archive.
- It fails loudly on missing capability, blocked readiness, or partial output.

## Fixtures

- `fixtures/golden/1004-case/`
- `fixtures/golden/commercial-case/`

Each fixture contains:

- `manifest.json`: case metadata, expected sections, review rules, manual operator facts, provenance expectations, and insertion target.
- `documents/*.txt`: source evidence rendered to deterministic text PDFs at runtime.

## Harness

Entry point:

- `node scripts/runGoldenPath.mjs`

Package scripts:

- `npm run test:golden`
- `npm run test:golden:1004`
- `npm run test:golden:commercial`

Runtime behavior:

- Starts a dedicated API server on `http://localhost:5192` by default.
- Uses an isolated temporary SQLite DB by default.
- Disables file logging and KB writes for regression safety.
- Uses live `cases/` directories, so optional cleanup is available via `--cleanup`.

## Validation Flow

Per fixture, the harness executes:

1. Case creation
2. Case metadata patch
3. Pipeline transition to `extracting`
4. Document upload through `/api/cases/:caseId/documents/upload`
5. Extraction summary load
6. Extracted fact review and explicit merge
7. Fact provenance writeback for accepted extracted facts
8. Extracted section review cleanup
9. Workspace load through `GET /api/cases/:caseId`
10. Explicit operator fact completion through `PUT /api/cases/:caseId/facts`
11. Explicit operator provenance writeback through `PUT /api/cases/:caseId/fact-sources`
12. Pipeline transition to `generating`
13. Pre-draft gate validation
14. Full-draft orchestration
15. Generation result validation against fixture-required sections
16. Pipeline transition to `review`
17. QC run and blocker check
18. Insertion run
19. Export manifest + export file write
20. Archive

## Modes

### Strict Mode

Default:

- `node scripts/runGoldenPath.mjs`

Rules:

- Requires live AI generation.
- Requires live insertion agents for the target lane.
- Fails if insertion does not complete cleanly.
- This is the mode that counts for production-lane acceptance.

### Preflight Mode

Command:

- `node scripts/runGoldenPath.mjs --allow-dry-run-insertion`

Rules:

- Uses the full pipeline but allows insertion dry-run execution.
- Still fails on extraction, merge, gate, generation, QC blockers, export, or archive problems.
- Does not count as production insertion validation.
- Intended for regression coverage on machines without live ACI / Real Quantum agents running.

## Failure Policy

The harness must fail for any of the following:

- fixture documents do not upload
- extracted facts are missing or below fixture minimums
- pending fact review is left unresolved
- pre-draft gate is blocked
- generation ends in `failed` or produces missing/thin required sections
- QC returns any blocker findings
- insertion cannot run in strict mode
- export file is not written
- archive does not persist

The harness reports:

- failing step
- case ID
- generation run ID
- QC run ID
- insertion run ID
- raw failure payload when available

## Honest Current Limitation

Workspace load currently maps to canonical case projection load (`GET /api/cases/:caseId`).

There is no separate dedicated workspace API contract in the shipped backend today. The test plan treats canonical case projection load as the workspace source-of-truth path.

## Regression Use

Phase 1 regression baseline:

- run `npm run test:golden -- --allow-dry-run-insertion` on machines without live agents
- run `npm run test:golden` on machines with live ACI and Real Quantum agents

Phase 1 is only fully accepted when strict mode passes for both fixtures.
