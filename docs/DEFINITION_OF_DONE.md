# Appraisal Agent Definition of Done

This is the canonical definition of "100% complete" for Appraisal Agent.

The target is internal business completion for one working appraiser first. It is not SaaS completion, team-scale completion, or "demo looks impressive" completion.

## Mission

Appraisal Agent is complete only when it functions as the central operating system for:

- intake
- document organization
- fact extraction and verification
- workspace-driven report development
- in-house narrative generation
- valuation support and reasoning capture
- QC and contradiction resolution
- reliable ACI and Real Quantum insertion
- assignment archive and controlled learning
- business workflow visibility
- backup, restore, and audit confidence

## Non-negotiables

- Case record plus workspace are the source of truth.
- Evidence provenance is never bypassed.
- No hidden scoring logic is used to make appraisal decisions.
- Final comp selection, adjustment judgment, reconciliation judgment, and final value conclusion remain manual.
- Operator controls remain visible.

## 100% complete means all of the following are true

### 1. Scope is truthful

- Active production scope is stated in one place and matches live code.
- README, roadmap, and scope docs do not overclaim validated capability.
- Deferred forms are preserved but clearly out of active production until validated.

### 2. Golden paths are proven

- One realistic `1004` assignment can run from case creation through archive without DB surgery.
- One realistic `commercial` assignment can run from case creation through archive without DB surgery.
- Those flows are scripted, repeatable, and part of regression checking.

### 3. Source of truth is operationally real

- Existing active cases are backfilled into canonical records.
- Generation, QC, insertion, and archive flows read from the canonical case record.
- Legacy filesystem artifacts are compatibility exports, not the controlling write path.

### 4. Facts are trustworthy before drafting

- Missing required facts, blocker conflicts, and pending extracted-fact reviews can block drafting.
- Every critical fact used in drafting can show provenance.
- Conflicts are reviewed explicitly instead of silently merged.

### 5. Workspace drafting is production-usable

- The operator can see section governance, freshness, dependencies, and readiness state.
- Upstream fact changes make stale sections visibly stale.
- Version compare and restore are available for generated sections.

### 6. Valuation support is inside the system

- Sales comparison, income, cost, and reconciliation support can be worked inside one valuation surface.
- Comp decisions and support reasoning are tracked.
- Unsupported items are visibly flagged.
- Final judgment remains manual.

### 7. Insertion is reliable and measurable

- ACI and Real Quantum insertion runs produce operator-visible status, verification, and failure details.
- Failed runs can be retried or replayed without guesswork.
- Readback/verification confidence is exposed to the operator.

### 8. Business workflow is closed for one appraiser

- A new assignment can move from intake to delivery inside the system.
- Due dates, assignment health, and risk are visible without external tracking.
- Archive/retention state is visible per case.

### 9. Inspection, learning, and recovery are trustworthy

- Inspection output feeds canonical case facts and report context.
- Memory/retrieval influences can be reviewed and managed.
- Backup/export, restore verification, and audit history are usable in practice.

### 10. Operator trust exists

- Ten realistic `1004` runs can be completed mainly inside the system.
- Five realistic `commercial` runs can be completed mainly inside the system.
- Restore drill and golden-path regressions pass on a clean machine.

## Not required for 100%

- Multi-user SaaS concerns such as auth, billing, seats, and tenant isolation.
- Deferred form families: `1025`, `1073`, `1004C`.
- Nice-to-have infrastructure that does not materially improve the one-appraiser operating loop.

## Post-100 rule

Do not expand deferred form scope until the active `1004` and `commercial` lanes satisfy this definition of done.

