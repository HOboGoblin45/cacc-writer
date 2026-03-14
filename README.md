# CACC Writer

Internal appraisal operating system for one working appraiser at Cresci Appraisal & Consulting Company.

Status audited from live code on March 13, 2026.

## Truthful current status

- Active production scope is `1004` plus `commercial`.
- Deferred form families are `1025`, `1073`, and `1004C`. Their files are preserved, but new production workflows are blocked for them.
- Backend foundations are broad and real: case management, document intake, extraction staging, pre-draft gate, generation orchestration, QC, insertion runs, memory, audit, timeline, archive, export, and Electron packaging all exist in code.
- The product is not yet "100% complete" for the business mission. Golden-path validation, valuation workflow closure, inspection usability, business due-date/risk management, and backup/restore confidence are still incomplete.
- Existing validation baseline:
  - `npm run typecheck`
  - `npm run test:unit` -> 237 passing
  - `npm run test:smoke` -> 49 passing

## What works now

- Create and manage cases with canonical projection support.
- Upload documents, classify them, detect duplicates, extract fact candidates, and merge reviewed facts.
- Run deterministic pre-draft integrity checks and compliance/requirements checks.
- Generate report sections for active scope forms with assignment context, retrieval, and review support.
- Run QC and surface readiness plus findings.
- Prepare and execute insertion runs for ACI and Real Quantum with verification and fallback handling.
- Store approved and imported narrative memory locally.
- View case timeline, archive/restore cases, export case manifests, and generate support bundles.

## What is still not done

- No golden-path fixtures or regression harness prove full 1004 and commercial assignments end-to-end.
- Existing filesystem cases are not yet fully backfilled into canonical `case_records`.
- There is no unified valuation desk for comp queueing, adjustment support, reconciliation memoing, and support-pack export.
- Inspection workflow is not yet a real mobile-first field tool.
- Business operations are partial: no due-date dashboard, overdue/risk queue, or engagement-to-case flow.
- Backup/recovery is partial: support bundle export exists, but backup scheduling and restore verification workflow do not.
- Frontend maintainability is a real issue: `index.html` and `app.js` still carry most operator UI logic.

## Scope

### Active production lanes

- `1004` -> ACI desktop insertion
- `commercial` -> Real Quantum insertion

### Deferred, preserved, not active

- `1025`
- `1073`
- `1004C`

Scope authority lives in [productionScope.js](/C:/Users/ccres/OneDrive/Desktop/cacc-writer/server/config/productionScope.js).

## Architecture

- Runtime entrypoint: [cacc-writer-server.js](/C:/Users/ccres/OneDrive/Desktop/cacc-writer/cacc-writer-server.js)
- Frontend entrypoints: [index.html](/C:/Users/ccres/OneDrive/Desktop/cacc-writer/index.html) and [app.js](/C:/Users/ccres/OneDrive/Desktop/cacc-writer/app.js)
- Forms registry: [forms/index.js](/C:/Users/ccres/OneDrive/Desktop/cacc-writer/forms/index.js)
- Case record and workflow state: [server/caseRecord/caseRecordService.js](/C:/Users/ccres/OneDrive/Desktop/cacc-writer/server/caseRecord/caseRecordService.js)
- Generation orchestration: [server/api/generationRoutes.js](/C:/Users/ccres/OneDrive/Desktop/cacc-writer/server/api/generationRoutes.js) and [server/orchestrator/generationOrchestrator.js](/C:/Users/ccres/OneDrive/Desktop/cacc-writer/server/orchestrator/generationOrchestrator.js)
- Fact integrity gate: [server/factIntegrity/preDraftGate.js](/C:/Users/ccres/OneDrive/Desktop/cacc-writer/server/factIntegrity/preDraftGate.js)
- Document intelligence: [server/api/documentRoutes.js](/C:/Users/ccres/OneDrive/Desktop/cacc-writer/server/api/documentRoutes.js)
- QC engine: [server/api/qcRoutes.js](/C:/Users/ccres/OneDrive/Desktop/cacc-writer/server/api/qcRoutes.js)
- Insertion runs: [server/api/insertionRoutes.js](/C:/Users/ccres/OneDrive/Desktop/cacc-writer/server/api/insertionRoutes.js)
- Operations/audit/archive/export: [server/api/operationsRoutes.js](/C:/Users/ccres/OneDrive/Desktop/cacc-writer/server/api/operationsRoutes.js)
- Desktop shell: [desktop/electron/main.cjs](/C:/Users/ccres/OneDrive/Desktop/cacc-writer/desktop/electron/main.cjs)

## Non-negotiable product rules

- The case record and workspace stay the source of truth.
- Evidence provenance must remain visible.
- No hidden scoring logic.
- Final comp selection, adjustment judgment, reconciliation judgment, and value conclusion remain manual.
- Operator-visible controls are preferred over silent automation.

## Repo guidance

- Current definition of done: [docs/DEFINITION_OF_DONE.md](/C:/Users/ccres/OneDrive/Desktop/cacc-writer/docs/DEFINITION_OF_DONE.md)
- Core vs post-100 scope split: [docs/CORE_VS_POST100_SCOPE.md](/C:/Users/ccres/OneDrive/Desktop/cacc-writer/docs/CORE_VS_POST100_SCOPE.md)
- Primary user flows: [docs/PRIMARY_USER_FLOWS.md](/C:/Users/ccres/OneDrive/Desktop/cacc-writer/docs/PRIMARY_USER_FLOWS.md)
- Phase acceptance checklist: [docs/PHASE_ACCEPTANCE_CHECKLIST.md](/C:/Users/ccres/OneDrive/Desktop/cacc-writer/docs/PHASE_ACCEPTANCE_CHECKLIST.md)
- Execution roadmap: [EXECUTION_ROADMAP.md](/C:/Users/ccres/OneDrive/Desktop/cacc-writer/EXECUTION_ROADMAP.md)
- Production scope statement: [docs/SCOPE.md](/C:/Users/ccres/OneDrive/Desktop/cacc-writer/docs/SCOPE.md)

## Running locally

```bash
npm install
npm run typecheck
npm run test:unit
npm run test:smoke
npm start
```

Optional desktop shell:

```bash
npm run start:electron
```

## Current cautions

- `queueRoutes.js` exists but is not mounted in the runtime. Treat report queueing as dormant, not shipped.
- Existing live cases still need canonical backfill before "one source of truth" is operationally true.
- The presence of phase-labeled code or docs does not mean that phase is accepted.
