# CACC Writer Execution Roadmap

Audit baseline date: March 13, 2026

This roadmap reflects live code, live tests, and the current business target: internal completion for one appraiser first.

## Current baseline

- Active production scope: `1004` and `commercial`
- Deferred scope: `1025`, `1073`, `1004C`
- Validation baseline:
  - `npm run typecheck`
  - `npm run test:unit` -> 237 passing
  - `npm run test:smoke` -> 49 passing
- Major realities:
  - backend foundations are broad and real
  - frontend operator surface is still concentrated in `index.html` and `app.js`
  - golden-path validation is missing
  - existing cases are not yet fully backfilled into canonical case records

## Delivery order

## Skill utilization protocol

These skills are now part of the delivery method, not optional side tools.

- `playwright`: use for browser-driven regression of intake, workspace, generation, QC, archive, and packaged app flows when the behavior is exposed through the web UI.
- `playwright-interactive`: use for persistent iterative UI debugging when a flow needs repeated inspection without relaunch overhead.
- `screenshot`: use for desktop-level evidence capture during ACI and Real Quantum debugging, insertion verification, and operator-visible failure documentation.
- `pdf`: use to inspect exported appraisal PDFs and packaged support output when layout, pagination, or exhibit fidelity matters.
- `doc`: use when `.docx` support packs, checklists, or generated operator documents need formatting-aware validation.
- `spreadsheet`: use for comp-support fixtures, structured valuation support tables, and QA of exported tabular data.
- `gh-fix-ci`: use if GitHub Actions begins failing so CI issues are investigated from logs rather than guessed at locally.
- `openai-docs`: use whenever OpenAI model, API, or platform guidance affects implementation choices and current official behavior matters.
- `yeet`: use only when explicitly asked to stage, commit, push, and open a PR.

## Phase-by-phase skill plan

### Phase 0: truth alignment

- align README and scope docs with live code
- define done and scope categories
- remove dead runtime references
- use no specialty skill by default unless documentation output or CI evidence requires one

### Phase 1: golden-path validation

- create golden `1004` and `commercial` fixtures
- build an end-to-end harness covering intake through archive
- fail loudly on broken steps
- use `playwright` for browser regression of the golden path where UI state must be confirmed
- use `screenshot` for desktop capture of ACI or Real Quantum failures and proof of insertion behavior
- use `pdf`, `doc`, and `spreadsheet` as needed to validate fixture inputs and exported artifacts

### Phase 2: `1004` production hardening

- workspace-level section governance
- readiness states
- residential missing-fact severity
- version compare and restore
- measurable ACI insertion reliability
- use `playwright` or `playwright-interactive` to validate workspace readiness, section governance, and stale-state UX
- use `screenshot` for every ACI placement or read-back defect that needs desktop evidence
- use `pdf` to verify exported `1004` output and support-pack fidelity

### Phase 3: commercial production hardening

- stronger commercial variants
- structured support capture
- deterministic Real Quantum replay workflow
- exhibit/appendix packaging hooks
- use `playwright` or `playwright-interactive` for commercial workspace and replay workflow validation
- use `screenshot` for Real Quantum desktop/browser insertion evidence
- use `spreadsheet` and `pdf` to validate rent-comp, expense, cap-rate, and exhibit outputs

### Phase 4: unified valuation desk

- sales comparison, income, cost, reconciliation in one surface
- comp decision history
- adjustment support notebook
- reconciliation memo builder
- use `playwright` to validate desk workflows, reason capture, and contradiction visibility
- use `spreadsheet` for comp-grid and support-table fixture design and QA
- use `pdf` or `doc` for value-support pack validation

### Phase 5: fact integrity and research completion

- verifier-facing fact cards
- research source presets
- duplicate detection and review queues
- conflict routing before drafting
- use `playwright` for extracted-fact review queues and operator-approval UX
- use `openai-docs` only if OpenAI extraction or prompting behavior must be aligned with current official platform guidance

### Phase 6: inspection workflow usability

- mobile-friendly inspection mode
- templates, tagged photos, voice-note capture
- auditable merge back into canonical case facts
- use `playwright` for responsive/mobile browser validation when the inspection surface is web-exposed
- use `screenshot` for mobile-layout and media-tagging evidence if desktop browser simulation is insufficient
- use `doc` or `pdf` if inspection summaries generate operator-facing documents

### Phase 7: learning transparency and memory health

- why-this-suggestion visibility
- stale and duplicate memory management
- report-family-aware retrieval tuning
- phrase governance and metrics
- use `playwright` for suggestion transparency and memory-management UX validation
- use `openai-docs` if retrieval or model-behavior changes depend on current OpenAI guidance

### Phase 8: business loop closure

- engagement or quote into case creation
- due-date and risk visibility
- business state in case health
- use `playwright` for intake-to-dashboard-to-case workflow validation
- use `spreadsheet` if imported assignment tracking or tabular business exports are added

### Phase 9: reliability, restore, and auditability

- backup scheduler UI
- restore verification workflow
- clean-machine migration and recovery runbook
- use `playwright` for backup and restore UI validation where browser-surfaced
- use `screenshot` for packaged desktop recovery evidence
- use `pdf` or `doc` for recovery runbook deliverables if formatted operator documentation is required

### Phase 10: deferred form expansion

- `1025`
- `1073`
- `1004C`
- use the same skill pattern as Phases 1 through 3 for each newly activated form family
- no deferred form activates without fixture validation, UI validation, and insertion evidence

No deferred form should be activated before a full golden-path pass for that family.

## Current highest-risk gaps

- no end-to-end golden-path proof
- no operationally complete canonical backfill for live cases
- no unified valuation surface
- no finished inspection workflow
- no restore drill confidence
- frontend maintainability risk

## Control rule

If a task does not improve the one-appraiser operating loop for the active `1004` or `commercial` lanes, it is not on the critical path to 100%.
