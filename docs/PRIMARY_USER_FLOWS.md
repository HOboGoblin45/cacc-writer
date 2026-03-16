# Primary User Flows

These are the primary operating flows CACC Writer must support for one working appraiser.

## Flow 1: Intake to case creation

1. Create a case with form type, address, borrower, and assignment context.
2. Confirm active production lane.
3. Capture initial assignment metadata and visible workflow state.

Current state:

- Case creation works.
- Active/deferred scope enforcement works.
- Business metadata is still shallow; due-date and risk tracking are not yet closed.

## Flow 2: Document intake and organization

1. Upload source documents into the case.
2. Auto-classify, hash-check duplicates, and extract text.
3. Show document quality and extraction status.

Current state:

- Upload, classification, duplicate detection, and extraction staging exist.
- Operator trust still needs stronger golden-path validation and clearer failure surfacing in the UI.

## Flow 3: Fact extraction, verification, and merge

1. Review extracted fact candidates and extracted sections.
2. Accept, reject, or merge facts into the canonical case.
3. Preserve provenance and surface conflicts.

Current state:

- Review/merge flow exists.
- Pre-draft gate and conflict detection exist.
- Missing-fact severity and research verification workflows still need completion.

## Flow 4: Residential workspace development (`1004`)

1. Load the case workspace.
2. Review missing facts and readiness.
3. Generate, review, revise, and approve sections.
4. Run QC and resolve contradictions.
5. Insert into ACI.
6. Archive the assignment.

Current state:

- Generation, review, QC, and insertion infrastructure exist.
- Section governance, freshness, and end-to-end repeated-run trust are still incomplete.

## Flow 5: Commercial workspace development

1. Load the commercial case workspace.
2. Review assignment intelligence, missing facts, and support inputs.
3. Generate, review, revise, and approve sections.
4. Run QC.
5. Insert into Real Quantum.
6. Archive the assignment.

Current state:

- Commercial generation and insertion infrastructure exist.
- Commercial support capture, deterministic replay, and exhibit packaging still need hardening.

## Flow 6: Valuation support and reconciliation

1. Work comp candidates and support evidence.
2. Capture adjustment support and contradiction notes.
3. Build reconciliation memo support.
4. Keep final value judgment manual.

Current state:

- Pieces exist in intelligence and commentary modules.
- There is no unified valuation desk yet.

## Flow 7: Archive, restore, and learning

1. Archive the delivered assignment without deleting its history.
2. Restore it if needed.
3. Preserve approved narrative learning with operator control.
4. Export support data for backup or support.

Current state:

- Archive, restore, export, support bundle, and memory storage exist.
- Restore verification workflow and memory-health tooling do not.

## Flow 8: Recovery drill

1. Restore the system or a case on a clean machine.
2. Verify active workflows still run.
3. Prove golden-path assignments still complete.

Current state:

- Not yet complete.
- This remains a core requirement for business completion.
