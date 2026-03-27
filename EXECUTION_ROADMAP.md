# Appraisal Agent Execution Roadmap

Audit baseline date: March 13, 2026

This roadmap reflects live code, live tests, and the current business target: internal completion for one appraiser first.

## Current baseline

- Active production scope: `1004` and `commercial`
- Deferred scope: `1025`, `1073`, `1004C`
- Validation baseline:
  - `npm run typecheck`
  - `npm run test:unit` -> 287 passing
  - `npm run test:smoke` -> 49 passing
- Major realities:
  - backend foundations are broad and real
  - frontend operator surface is still concentrated in `index.html` and `app.js`
  - golden-path preflight is working for both active lanes
  - strict golden-path acceptance is still blocked by live destination readiness and verification
  - existing cases are not yet fully backfilled into canonical case records

## Delivery order

### Phase 0: truth alignment

- align README and scope docs with live code
- define done and scope categories
- remove dead runtime references

### Phase 1: golden-path validation

- create golden `1004` and `commercial` fixtures
- build an end-to-end harness covering intake through archive
- fail loudly on broken steps
- current state:
  - preflight passes for both fixtures
  - strict mode now fails early at `destination_probe` when agents cannot locate live fields
  - remaining work is destination reliability, not generation/planning drift

### Phase 2: `1004` production hardening

- workspace-level section governance
- readiness states
- residential missing-fact severity
- version compare and restore
- measurable ACI insertion reliability

### Phase 3: commercial production hardening

- stronger commercial variants
- structured support capture
- deterministic Real Quantum replay workflow
- exhibit/appendix packaging hooks

### Phase 4: unified valuation desk

- sales comparison, income, cost, reconciliation in one surface
- comp decision history
- adjustment support notebook
- reconciliation memo builder

### Phase 5: fact integrity and research completion

- verifier-facing fact cards
- research source presets
- duplicate detection and review queues
- conflict routing before drafting

### Phase 6: inspection workflow usability

- mobile-friendly inspection mode
- templates, tagged photos, voice-note capture
- auditable merge back into canonical case facts

### Phase 7: learning transparency and memory health

- why-this-suggestion visibility
- stale and duplicate memory management
- report-family-aware retrieval tuning
- phrase governance and metrics

### Phase 8: business loop closure

- engagement or quote into case creation
- due-date and risk visibility
- business state in case health

### Phase 9: reliability, restore, and auditability

- backup scheduler UI
- restore verification workflow
- clean-machine migration and recovery runbook

### Phase 10: deferred form expansion

- `1025`
- `1073`
- `1004C`

No deferred form should be activated before a full golden-path pass for that family.

## Current highest-risk gaps

- no strict end-to-end golden-path proof for live insertion
- no operationally complete canonical backfill for live cases
- no unified valuation surface
- no finished inspection workflow
- no restore drill confidence
- frontend maintainability risk

## Control rule

If a task does not improve the one-appraiser operating loop for the active `1004` or `commercial` lanes, it is not on the critical path to 100%.

