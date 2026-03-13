# CACC Writer — Definition of Done

Last updated: 2026-03-13
Authority: This document is the canonical product definition for what "100% complete" means for CACC Writer as a personal appraisal operating system.

---

## The Finish Line (One Sentence)

**CACC Writer is 100% complete when a working appraiser can receive an assignment, complete the entire appraisal lifecycle — from intake through final archived report — inside the system, with less friction than their current workflow, while retaining full appraiser judgment and report defensibility.**

---

## Operational Definition of 100%

Each of these conditions must be true simultaneously for the product to be considered complete:

### 1. Case Created from an Order
- An assignment arrives (email, phone, AMC portal, direct client).
- The appraiser creates a case record inside CACC Writer with assignment details, property identification, client/lender info, engagement terms, and due dates.
- The case record becomes the single source of truth for the entire assignment lifecycle.
- Business operations (quote, engagement, invoice) are linked to the case.

### 2. Documents Uploaded and Organized
- The appraiser uploads all supporting documents: engagement letters, contracts, MLS sheets, assessor records, prior appraisals, photos, market data, flood maps, zoning documents.
- Documents are classified by type and associated with the correct case.
- The system can extract structured data from uploaded documents without requiring manual transcription for common document types.

### 3. Facts Extracted and Verified
- Extracted facts populate the case record with source attribution and confidence levels.
- Conflicting facts from multiple sources are surfaced for appraiser review — never silently merged.
- The appraiser reviews, approves, corrects, or rejects every extracted fact before it influences generation.
- A pre-draft gate prevents narrative generation until required facts are reviewed.
- Every fact in the case record has visible provenance (source document, extraction method, appraiser disposition).

### 4. Report Family Selected Correctly
- The correct form type (1004, commercial) is selected and enforced throughout the workflow.
- The workspace, section plan, field registry, and insertion targets reflect the selected form family.
- Deferred form types (1025, 1073, 1004C) are blocked from active workflows until explicitly promoted.

### 5. Narrative Sections Generated in the Appraiser's Voice
- All priority sections for the selected form family can be generated from verified facts, retrieved knowledge, and the appraiser's trained voice profile.
- Generated sections cite the evidence they rely on.
- The appraiser can review, edit, approve, or regenerate any section.
- Section governance metadata is visible: prompt version, policy state, dependency snapshot, freshness, quality score.
- When upstream facts change, affected sections are deterministically marked stale and require re-review.
- The learning system uses only finalized, appraiser-approved material to improve future drafts.

### 6. Valuation Support Reviewed in One Place
- The sales comparison, income, and cost approaches are developed inside the system.
- Comparable candidates are queued with accept/reject/hold decisions and reason history.
- Adjustments are supported with visible evidence and burden metrics.
- Contradictions between valuation support and case facts are surfaced, not hidden.
- Reconciliation notes summarize approach strengths and weaknesses.
- **The system never makes final comp selection, adjustment magnitude, reconciliation weighting, or value opinion decisions.** These remain appraiser-only.

### 7. QC Blockers Resolved Visibly
- QC runs produce findings with severity levels (blocker, high, medium, low, advisory).
- Blockers must be resolved or acknowledged before finalization.
- Contradiction gate checks prevent finalization when unresolved contradictions exist.
- QC findings link to the specific facts, sections, or valuation elements they reference.
- Readiness signals (ready / review recommended / needs review / not ready) are visible in the workspace.

### 8. Insertion and Export Work Reliably
- Generated and approved narrative sections can be inserted into the target form software (ACI for 1004, Real Quantum for commercial).
- Insertion includes field-level verification/readback to confirm successful writes.
- Failed insertions can be replayed deterministically without re-generating content.
- The system can export case data, reports, and support bundles in standard formats.

### 9. Final Report Archived and Used for Controlled Learning
- Completed assignments are archived with full provenance: original facts, generated drafts, appraiser edits, final text, QC dispositions, valuation support, insertion records.
- Archived assignments feed the learning system: revision diffs capture what the appraiser changed, and accepted patterns improve future retrieval and ranking.
- Learned influence is always explainable — the appraiser can see what prior material influenced any suggestion.
- No learning artifact can silently override explicit case facts or QC rules.

### 10. All of This Happens Mainly Inside One System
- The appraiser's primary workflow — from receiving an assignment to delivering a defensible report — happens inside CACC Writer.
- Outside tools (spreadsheets, word processors, separate databases) are not required for ordinary assignments.
- The system runs as a desktop application (Electron) with local data sovereignty.
- Backup, restore, and machine migration are supported and tested.

---

## What 100% Is Not

- **Not SaaS readiness.** Multi-tenant, billing, and feature-flag infrastructure exists but is post-100 scope. The product is complete when it works for one appraiser's daily business.
- **Not every form type.** 1004 and commercial are the 100% lanes. 1025, 1073, and 1004C are post-100 expansion.
- **Not full automation.** The system assists and accelerates. It does not replace appraiser judgment on any final valuation decision.
- **Not perfection.** 100% means the system is the primary tool for real assignments, not that every possible feature has been built.

---

## Working Rules (Preserved from EXECUTION_ROADMAP.md)

These rules apply to all work toward 100% and beyond:

1. **Case record + workspace are source of truth.** No shadow stores, no external state that the system doesn't know about.
2. **Do not bypass evidence provenance.** Every fact, every generated section, every valuation element traces back to its source.
3. **Do not add hidden scoring logic.** All quality, confidence, and compliance signals must be visible to the appraiser.
4. **Do not automate final comp/adjustment/reconciliation/value decisions.** The system supports the analysis. The appraiser makes the call.
5. **Extend existing modules; do not replace completed foundations.** Accepted phases (A–L) are built. Build on them.

---

## Acceptance Test for This Document

- [ ] Every feature in the backlog is tagged as `core-to-100`, `post-100`, or `defer/do-not-build-now` (see `docs/CORE_VS_POST100_SCOPE.md`).
- [ ] The finish line sentence above can be pointed to as the single standard for product completeness.
- [ ] No new work is approved unless it maps to one of the ten conditions above or is explicitly classified as `post-100`.
