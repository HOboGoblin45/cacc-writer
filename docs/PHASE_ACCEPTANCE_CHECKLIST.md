# Phase Acceptance Checklist

This checklist is the live acceptance reference.

Important rule:

- A phase comment in code is not acceptance.
- A passing unit test for a subsystem is not acceptance.
- A phase is accepted only when the operator-facing workflow and the stated acceptance criteria are both true.

## Status legend

- `accepted` - phase criteria are met and verified
- `partial` - meaningful implementation exists but acceptance is not met
- `not_started` - no meaningful delivery yet
- `deferred` - intentionally not active

## Phase status baseline

| Phase | Name | Current status | Notes |
|---|---|---|---|
| 0 | Repo audit + truth alignment | accepted | Canonical docs created, scope claims aligned, and dead runtime reference removed |
| 1 | Golden path validation | not_started | No golden fixtures or harness in repo |
| 2 | 1004 production hardening | partial | Core generation/QC/insertion exist; governance/readiness trust not complete |
| 3 | Commercial production hardening | partial | Core lane exists; support capture and replay hardening incomplete |
| 4 | Unified valuation desk | not_started | No unified operator surface yet |
| 5 | Fact integrity + research completion | partial | Strong base exists; verifier-facing dashboards and web-review queues incomplete |
| 6 | Inspection workflow usability | not_started | No real field workflow yet |
| 7 | Learning transparency + memory health | partial | Memory exists; transparency and health tooling incomplete |
| 8 | Business loop closure | partial | Archive/timeline/export exist; due-date/risk/engagement loop incomplete |
| 9 | Reliability, restore, and auditability | partial | Audit/export exist; backup scheduler and restore drill incomplete |
| 10 | Deferred form expansion | deferred | Blocked until core trust exists |

## Phase 0 acceptance

Phase 0 is accepted when:

- one canonical definition of done exists
- all remaining work is categorized into core, post-100, or deferred
- README and scope docs match live code
- missing/stale phase-source docs are replaced or explicitly retired

## Release gate before Phase 1

Before Phase 1 work begins:

- this checklist must exist
- `README.md`, `docs/SCOPE.md`, and `EXECUTION_ROADMAP.md` must stop overstating production completion
- deferred scope claims must match `server/config/productionScope.js`
