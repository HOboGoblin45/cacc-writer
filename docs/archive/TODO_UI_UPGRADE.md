# CACC Writer — UI + Case Metadata + Workflow Upgrade
# =====================================================
# Phase: UI / Case Model / Workflow Status
# Status: IN PROGRESS
#
# ── ACTIVE PRODUCTION SCOPE ──────────────────────────────────────────────────
# Lane 1: 1004 single-family residential (ACI)   ← PRIMARY
# Lane 2: commercial (Real Quantum)               ← PRIMARY
# DEFERRED: 1025, 1073, 1004c — preserved, not actively extended
# See SCOPE.md for full scope definition.

## DECISIONS CONFIRMED
- Assignment Details: Always visible, grouped card, 2-column layout
- Missing Facts: Soft warnings (allow generation with confirmation)
- workflowStatus: Runs alongside pipelineStage (not replacing it)
- Forms: 1004 gets deep dependency logic; commercial gets full wiring; 1025/1073/1004c deferred

## STEP 1 — server/caseMetadata.js ✅ COMPLETE
- [x] Schema defaults for all new assignment metadata fields
- [x] ASSIGNMENT_PURPOSES, LOAN_PROGRAMS, PROPERTY_TYPES, OCCUPANCY_TYPES, REPORT_CONDITION_MODES
- [x] applyMetaDefaults() — backward-compat merge
- [x] extractMetaFields() — safe extraction from request body

## STEP 2 — server/workflowStatus.js ✅ COMPLETE
- [x] 9 workflow status values
- [x] Status labels and color codes
- [x] pipelineToWorkflowStatus() — maps legacy pipelineStage
- [x] computeWorkflowStatus() — derives status from case state

## STEP 3 — server/sectionDependencies.js ✅ COMPLETE
- [x] Required/recommended facts per 1004 field (all 11 fields)
- [x] Shared deps for cross-form fields
- [x] getMissingFacts(fieldId, facts) — returns missing required/recommended
- [x] resolvePath() — dotted path resolver for nested facts

## STEP 4 — server/fieldEligibility.js ✅ COMPLETE
- [x] AI eligibility classification: ai_draft, fact_autofill, manual_review, read_only
- [x] FIELD_ELIGIBILITY_1004 map
- [x] FIELD_ELIGIBILITY_SHARED map
- [x] getFieldEligibility(formType, fieldId)

## STEP 5 — forms/1004.js ✅ COMPLETE
- [x] Added aiEligibility to all 11 fields
- [x] Added requiredFacts to all 11 fields

## STEP 6 — forms/commercial.js ✅ COMPLETE (active)
- [x] Added aiEligibility to all commercial fields

## STEP 6b — forms/1025.js, 1073.js, 1004c.js ✅ STRUCTURAL ONLY (deferred)
- [x] Added aiEligibility stubs (lighter touch — structural compatibility only)
- [ ] Deep dependency logic — DEFERRED until 1025/1073/1004c lanes activated
- [ ] Section-level fact requirements — DEFERRED
- [ ] ACI field map enrichment for 1025/1073/1004c — DEFERRED
- NOTE: Files preserved. Do not delete. Do not extend until scope is widened.

## STEP 7 — cacc-writer-server.js ✅ COMPLETE
- [x] Import new server modules
- [x] Expand POST /api/cases/create
- [x] Expand PATCH /api/cases/:caseId
- [x] Expand GET /api/cases/:caseId (apply meta defaults)
- [x] Add GET /api/cases/:caseId/missing-facts/:fieldId
- [x] Add PATCH /api/cases/:caseId/workflow-status
- [x] Wire assignmentMeta into generate-batch and generate-all

## STEP 8 — server/promptBuilder.js ✅ COMPLETE
- [x] Add assignmentMeta parameter to buildPromptMessages()
- [x] Inject assignment context system block
- [x] Add loan program specific guidance (FHA, USDA, VA, Construction)
- [x] Add reportConditionMode guidance (Subject To Completion, Subject To Repairs)

## STEP 9 — index.html ✅ COMPLETE
- [x] New CSS for assignment chips, workflow status, missing-facts warning
- [x] Expanded case creation form with Assignment Details card
- [x] Case metadata summary section (shown when case loaded)
- [x] Missing-facts warning panel in Generate tab
- [x] Workflow status badge in header

## STEP 10 — app.js ✅ COMPLETE
- [x] Updated createCase() to collect and send new fields
- [x] Updated updateCase() to collect and send new fields
- [x] Updated loadCase() to populate new fields and show metadata
- [x] Updated renderCaseList() to show assignment purpose + loan program
- [x] Added checkMissingFacts() function
- [x] Added missing-facts check before runBatch()
- [x] Added renderCaseMetadata() function

## STEP 11 — Scope Enforcement UI ✅ COMPLETE
- [x] Two-section form picker: Active Production (prominent) + Deferred/Future (collapsed toggle)
- [x] `#activeFormOptions` — populated from `/api/forms` `activeForms` array
- [x] `#deferredFormOptions` — populated from `/api/forms` `deferredForms` array, collapsed by default
- [x] `#deferredToggleBtn` — show/hide deferred section
- [x] `#deferredFormBanner` — warning banner shown when deferred form type is active
- [x] `#deferredFormBannerText` — message from server `scopeWarning.message` or local fallback
- [x] `.form-badge.deferred` — amber badge style for deferred-form cases in case list
- [x] `setScopeGenerateEnabled(false)` — generate buttons disabled for deferred form types
- [x] `selectFormFromPicker()` — syncs hidden `#newFormType` select + calls `setActiveFormConfig()`
- [x] `toggleDeferredSection()` — open/close deferred section body
- [x] `showDeferredFormBanner()` / `hideDeferredFormBanner()` — banner helpers
- [x] `isActiveFormId()` / `isDeferredFormId()` — client-side scope guards (seeded from server)
- [x] `voiceFormType` select uses `<optgroup>` for Active Production vs. Deferred/Future
- [x] Legacy deferred-form cases: load in limited mode (read-only, no generate, banner shown, deferred section opened)
- NOTE: UI still renders deferred forms in picker for visibility. They are not hidden — just clearly marked.
- NOTE: Active production forms (1004, commercial) are always shown prominently at top.

## STOP-AND-VERIFY CHECKLIST

### Lane 1 — 1004 (priority)
- [ ] Create a new 1004 Sale + Conventional case — confirm all fields save
- [ ] Create a new 1004 Refinance + FHA case — confirm all fields save
- [ ] Create a new 1004 Construction case — confirm reportConditionMode works
- [ ] Load an older 1004 case — confirm backward compatibility (no missing field errors)
- [ ] Open a 1004 case — confirm metadata displays in header/dashboard
- [ ] Attempt to generate a 1004 section with missing required facts — confirm warning panel
- [ ] Confirm prompts receive assignmentPurpose and loanProgram for 1004
- [ ] Confirm workflowStatus updates correctly for 1004 pipeline

### Lane 2 — commercial (priority)
- [ ] Create a new commercial case — confirm all fields save
- [ ] Attempt to generate a commercial section with missing required facts — confirm warning panel
- [ ] Confirm prompts receive assignmentPurpose for commercial
- [ ] Confirm workflowStatus updates correctly for commercial pipeline

### Scope Enforcement (Step 11)
- [ ] Open the UI — confirm form picker shows Active Production section with 1004 + commercial
- [ ] Confirm Deferred/Future section is collapsed by default
- [ ] Click "Show" — confirm 1025, 1073, 1004c appear with amber "Deferred" badge
- [ ] Select a deferred form type — confirm amber banner appears, generate buttons disabled
- [ ] Select 1004 — confirm banner disappears, generate buttons re-enabled
- [ ] Load a legacy deferred-form case — confirm banner shown, deferred section opened, generate disabled
- [ ] Confirm case list shows ⚠ badge on deferred-form cases
- [ ] Confirm voiceFormType select has Active Production / Deferred optgroups
- [ ] POST /api/cases/create with formType=1025 — confirm 400 + {supported:false, scope:'deferred'}
- [ ] POST /api/generate with formType=1073 — confirm 400 + {supported:false, scope:'deferred'}
- [ ] GET /api/forms — confirm activeForms, deferredForms, activeScope, deferredScope present

### Deferred — do not verify until scope is widened
- [ ] ~~1025 case creation and generation~~ — DEFERRED
- [ ] ~~1073 case creation and generation~~ — DEFERRED
- [ ] ~~1004c case creation and generation~~ — DEFERRED
