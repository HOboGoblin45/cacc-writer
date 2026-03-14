# CACC Writer Production Scope

Last audited: March 13, 2026

This file defines the active production scope. It must match live code.

## Active production lanes

### Lane 1: `1004`

- software target: ACI
- primary workflow: residential case intake -> fact review -> generation -> QC -> insertion -> archive
- status: active

### Lane 2: `commercial`

- software target: Real Quantum
- primary workflow: commercial case intake -> fact review -> generation -> QC -> insertion -> archive
- status: active

Live authority: [productionScope.js](/C:/Users/ccres/OneDrive/Desktop/cacc-writer/server/config/productionScope.js)

## Deferred forms

- `1025`
- `1073`
- `1004C`

Deferred means:

- files stay in the repository
- legacy cases may still load
- new active production workflows are blocked
- no README or roadmap may claim these are validated production lanes

## What is true today

- UI and API scope enforcement for active vs deferred forms exists.
- Backend foundations for case management, document intelligence, QC, insertion, memory, and operations exist.
- The app is not yet fully complete for the business mission because golden-path validation and several operator-trust workflows are still incomplete.

## What this file does not claim

- It does not claim all phases are accepted.
- It does not claim deferred forms are production-ready.
- It does not claim golden-path end-to-end validation exists yet.

## Scope boundaries

### In active investment now

- `1004` hardening
- `commercial` hardening
- fact integrity and provenance
- QC and contradiction handling
- insertion verification and replay
- archive, audit, restore, and business visibility

### Out of active investment now

- deep deferred-form wiring
- multi-user SaaS concerns
- expansion work that does not improve the one-appraiser operating loop

## Known dormant code

- `server/api/queueRoutes.js` exists but is not mounted in the active runtime
- deferred-form configs and field maps remain in place for future controlled expansion

## References

- Definition of done: [docs/DEFINITION_OF_DONE.md](/C:/Users/ccres/OneDrive/Desktop/cacc-writer/docs/DEFINITION_OF_DONE.md)
- Core vs post-100 split: [docs/CORE_VS_POST100_SCOPE.md](/C:/Users/ccres/OneDrive/Desktop/cacc-writer/docs/CORE_VS_POST100_SCOPE.md)
- Primary user flows: [docs/PRIMARY_USER_FLOWS.md](/C:/Users/ccres/OneDrive/Desktop/cacc-writer/docs/PRIMARY_USER_FLOWS.md)
- Execution roadmap: [EXECUTION_ROADMAP.md](/C:/Users/ccres/OneDrive/Desktop/cacc-writer/EXECUTION_ROADMAP.md)
