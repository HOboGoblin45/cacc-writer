# Core vs Post-100 Scope

This file separates what must be completed for internal business completion from what should wait until after core trust exists.

## Core to 100

- Phase 1: golden-path fixtures and end-to-end validation harness for `1004` and `commercial`
- Phase 2: `1004` workspace hardening, readiness, stale-state visibility, version restore, and insertion reliability visibility
- Phase 3: commercial workflow hardening, support capture, deterministic insertion replay, and exhibit packaging hooks
- Phase 4: unified valuation desk with manual-decision safeguards
- Phase 5: fact integrity and verifier-facing research pipeline completion
- Phase 6: inspection workflow usable enough for one working appraiser in the field
- Phase 7: learning transparency, memory health, and operator-visible influence controls
- Phase 8: business loop closure for intake, due dates, health, risk, and archive visibility
- Phase 9: backup, restore verification, auditability, and clean-machine recovery confidence

## Post-100

- Pinecone or other external retrieval infrastructure as a primary dependency
- Batch queue UX for multi-case throughput beyond what one appraiser actually needs
- Expanded analytics beyond operator-facing health and risk visibility
- Broader packaging/polish work that does not materially improve assignment completion
- Multi-user permissions, team workflows, and SaaS concerns

## Deferred / do not build now

- `1025`
- `1073`
- `1004C`

For deferred forms, the allowed work is:

- preserve files
- audit mapping gaps
- document what is missing

The disallowed work before core trust is:

- new production claims
- deep workflow investment
- activation in the form picker as supported production

## Dormant but present in repo

These items exist in code but are not part of the current committed production surface:

- report queue API in `server/api/queueRoutes.js`
- broader deferred-form assets and mappings
- historical plan documents that describe older architecture states

If a dormant item becomes necessary for the one-appraiser core loop, it should be reclassified explicitly before expansion.
