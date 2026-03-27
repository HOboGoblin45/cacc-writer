# Appraisal Agent â€” Phase 2: Generate-Core + Metadata Wiring
# =========================================================
# Active Production Scope: 1004 (ACI) + Commercial (Real Quantum)
# Phase Goal: One-click Generate + Review + Queue for Insert

## STEP 1 â€” knowledge_base/narratives/1004Narratives.json (NEW)
- [x] UAD C1â€“C6 condition language templates
- [x] Market condition templates (stable, appreciating, declining)
- [x] Neighborhood description guidance templates

## STEP 2 â€” server/knowledgeBase.js
- [x] Add getNarrativeTemplate(formType, fieldId, condition) function
- [x] Load from knowledge_base/narratives/1004Narratives.json

## STEP 3 â€” server/promptBuilder.js
- [x] Wire subjectCondition C3/C4 UAD guidance into buildAssignmentContextBlock()
- [x] Import getNarrativeTemplate from knowledgeBase.js
- [x] Add condition-specific narrative guidance for C1â€“C6 (C3/C4 primary, others fallback)

## STEP 4 â€” cacc-writer-server.js
- [x] Fix 1: Wire buildAssignmentMetaBlock(meta) into /api/generate
      â†’ reads meta.json via resolveCaseDir(caseId), calls applyMetaDefaults + buildAssignmentMetaBlock
- [x] Fix 2: Wire buildAssignmentMetaBlock(meta) into /api/generate-batch
      â†’ destructures meta from getCaseFormConfig(); _batchAssignmentMeta declared outside if-block (scope fix applied)
- [x] Fix 3: Wire buildAssignmentMetaBlock(meta) into /api/cases/:caseId/generate-all
      â†’ destructures meta from getCaseFormConfig(); _genAllAssignmentMeta passed to all buildPromptMessages() calls
- [x] Fix 4: Add POST /api/cases/:caseId/generate-core endpoint
      â†’ CORE_SECTIONS map for 1004 (5 sections) and commercial (5 sections)
      â†’ scope enforcement: deferred forms blocked with 400 + message
      â†’ two-pass draft+review with CONCURRENCY=3
      â†’ saves to outputs.json with sectionStatus, advances pipelineStage
- [x] Fix 5: Add PATCH /api/cases/:caseId/sections/:fieldId/status endpoint
      â†’ validates against VALID_SECTION_STATUSES array
      â†’ creates stub entry if field doesn't exist yet
- [x] Fix 6: Add GET /api/cases/:caseId/sections/status endpoint
      â†’ returns per-section { title, sectionStatus, approved, insertedAt, statusUpdatedAt }
      â†’ infers sectionStatus from text presence if not explicitly set

## STEP 5 â€” index.html
- [x] Add "âš¡ Core Sections" button (id=genCoreBtn, onclick=generateCoreSections()) â€” first in btnrow
- [x] Add section status badge CSS (.ss-badge, .ss-not_started/.ss-drafted/.ss-reviewed/.ss-approved/.ss-inserted/.ss-verified/.ss-error)
- [x] Add core sections status panel CSS (.core-panel, .core-panel-head, .core-section-row, .core-section-name)
- [x] Add #coreSectionsPanel div with #coreSectionsList above btnrow in Generate tab

## STEP 6 â€” app.js
- [x] Add copyToClipboard(text) helper â€” navigator.clipboard.writeText with execCommand fallback
- [x] Add sectionStatusBadge(status) helper â€” returns HTML span with .ss-badge .ss-{status}
- [x] Update makeOutputCard() â€” accepts opts={sectionStatus}, shows badge in card header, uses copyToClipboard()
- [x] Add generateCoreSections() â€” POST /api/cases/:caseId/generate-core, 6-min timeout, scope guard, renders results
- [x] Add renderCoreSectionResults(data) â€” inserts cards in active field order, replaces existing cards for same fieldId
- [ ] Wire per-section approve + queue for insert (deferred to next phase)

## STOP-AND-VERIFY CHECKLIST

### Server âœ… ALL VERIFIED (_test_phase2_endpoints.mjs: 47/47)
- [x] POST /api/cases/:caseId/generate-core returns 5 sections for 1004
      â†’ coreSections: [neighborhood_description, market_conditions, improvements_condition, sca_summary, reconciliation]
      â†’ generated: 5 / failed: 0 (live AI test)
- [x] POST /api/cases/:caseId/generate-core returns 5 sections for commercial
      â†’ coreSections: [market_area, improvement_description, hbu_analysis, reconciliation, site_description]
- [x] POST /api/cases/:caseId/generate-core blocked for deferred forms (400 + scope=deferred + supported=false)
- [x] PATCH /api/cases/:caseId/sections/:fieldId/status updates outputs.json
      â†’ all 7 lifecycle values verified: not_startedâ†’draftedâ†’reviewedâ†’approvedâ†’insertedâ†’verifiedâ†’error
- [x] GET /api/cases/:caseId/sections/status returns per-section status map
      â†’ title, sectionStatus, approved, insertedAt, statusUpdatedAt per section
- [x] /api/generate passes assignmentMeta to buildPromptMessages()
- [x] /api/generate-batch passes assignmentMeta to buildPromptMessages() (_batchAssignmentMeta scope fix applied)
- [x] /api/cases/:caseId/generate-all passes assignmentMeta to buildPromptMessages()

### UI (wired in index.html + app.js)
- [x] "âš¡ Core Sections" button visible in Generate tab for all cases
- [x] Button shows alert for deferred form types (client-side guard)
- [x] Core sections panel shows per-section status badges after generation
- [x] Each output card shows sectionStatus badge in header (drafted/reviewed)
- [x] Copy button uses clipboard fallback (works on non-HTTPS)
- [x] Section status updates after generation completes

### Regression âœ… ALL PASSING (141/141 total)
- [x] _test_smoke.mjs: 28/28 âœ…
- [x] _test_scope_enforcement.mjs: 27/27 âœ…
- [x] _test_missing_facts.mjs: 22/22 âœ…
- [x] _test_ui_flow.mjs: 17/17 âœ…
- [x] _test_phase2_endpoints.mjs: 47/47 âœ… (NEW â€” Phase 2 endpoint suite)

## PATH TO 100% â€” Phase 3 Status

### âœ… COMPLETED (cacc-writer-server.js + _test_phase3.mjs)

1. **Destination Registry** âœ…
   - `GET /api/cases/:caseId/destination-registry`
   - Returns field map for form type (ACI: desktop_agent/field_maps/1004.json, RQ: real_quantum_agent/field_maps/commercial.json)
   - Enriched with current sectionStatus, approved, hasText, insertedAt from outputs.json
   - software=aci (1004) | software=real_quantum (commercial)

2. **Approval-to-Memory Loop** âœ…
   - `PATCH /api/cases/:caseId/sections/:fieldId/status` â€” wired addExample() on status=approved
   - Sets approved=true + approvedAt in outputs.json
   - Non-fatal KB save failure (logged, does not block status update)
   - Returns approved flag in response

3. **insert-all sectionStatus Lifecycle** âœ…
   - `POST /api/cases/:caseId/insert-all` â€” updates sectionStatus=inserted after successful insertion
   - Marks failed insertions as sectionStatus=error with statusNote
   - statusUpdatedAt written for all affected fields

4. **Single-Section Insert** âœ…
   - `POST /api/cases/:caseId/sections/:fieldId/insert`
   - Routes to ACI (1004) or Real Quantum (commercial) based on form type
   - Updates sectionStatus: approvedâ†’inserted (success) | error (failure)
   - Advances to verified if agent confirms verification
   - Returns 503 with clear message when agent not running

5. **Exception Queue** âœ…
   - `GET /api/cases/:caseId/exceptions`
   - Returns all sections with sectionStatus=error
   - Each exception: fieldId, title, sectionStatus, statusNote, statusUpdatedAt, hasText, approved
   - count field for quick UI badge

6. **Comparable Sales Commentary Engine** âœ…
   - `POST /api/cases/:caseId/generate-comp-commentary`
   - 1004-only (active production scope â€” commercial blocked with clear error)
   - Validates comps array in facts.json before calling AI
   - compFocus: 'selection' | 'adjustments' | 'concessions' | 'all'
   - Two-pass draft+review (twoPass: true default)
   - Saves to outputs.json as sca_summary with history preservation

### â³ REMAINING (requires live agents)

7. **Verified ACI Insertion** â€” runtime integration
   - Server routing: âœ… complete (single-section insert + insert-all both route correctly)
   - Agent-side: requires ACI open + desktop_agent running on port 5180
   - Test: `_test_aci_live.py` (live integration test)

8. **Verified Real Quantum Insertion** â€” runtime integration
   - Server routing: âœ… complete (single-section insert + insert-all both route correctly)
   - Agent-side: requires Real Quantum open + real_quantum_agent running on port 5181
   - Test: `_test_rq_sections.py` (live integration test)

9. **Benchmark Testing** â€” `_test_benchmark.mjs` (future)
   - Repeatable 1004 + commercial benchmark cases
   - Regression baseline for generation quality

### Phase 3 Test Results (_test_phase3.mjs)
- [x] [1] GET /api/cases/:caseId/destination-registry â€” 14/14 âœ…
- [x] [2] POST /api/cases/:caseId/sections/:fieldId/insert â€” 7/7 âœ…
- [x] [3] GET /api/cases/:caseId/exceptions â€” 14/14 âœ…
- [x] [4] PATCH status approval-to-memory â€” 11/11 âœ…
- [x] [5] POST /api/cases/:caseId/generate-comp-commentary â€” 15/15 âœ…
- [x] [6] insert-all sectionStatus lifecycle â€” verified âœ…
- [x] [7] Destination registry commercial enrichment â€” verified âœ…
- [x] [8] Exception queue error surfacing â€” verified âœ…

### Cumulative Test Count
- _test_smoke.mjs:            28/28  âœ…
- _test_scope_enforcement.mjs: 27/27 âœ…
- _test_missing_facts.mjs:     22/22 âœ…
- _test_ui_flow.mjs:           17/17 âœ…
- _test_phase2_endpoints.mjs:  47/47 âœ…
- _test_phase3.mjs:            ~61+  âœ… (sections [1]â€“[8] all passing)

