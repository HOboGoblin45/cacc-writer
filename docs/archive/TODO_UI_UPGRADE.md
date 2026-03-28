# Appraisal Agent â€” UI + Case Metadata + Workflow Upgrade
# =====================================================
# Phase: UI / Case Model / Workflow Status
# Status: IN PROGRESS
#
# â”€â”€ ACTIVE PRODUCTION SCOPE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Lane 1: 1004 single-family residential (ACI)   â† PRIMARY
# Lane 2: commercial (Real Quantum)               â† PRIMARY
# DEFERRED: 1025, 1073, 1004c â€” preserved, not actively extended
# See SCOPE.md for full scope definition.

## DECISIONS CONFIRMED
- Assignment Details: Always visible, grouped card, 2-column layout
- Missing Facts: Soft warnings (allow generation with confirmation)
- workflowStatus: Runs alongside pipelineStage (not replacing it)
- Forms: 1004 gets deep dependency logic; commercial gets full wiring; 1025/1073/1004c deferred

## STEP 1 â€” server/caseMetadata.js âœ… COMPLETE
- [x] Schema defaults for all new assignment metadata fields
- [x] ASSIGNMENT_PURPOSES, LOAN_PROGRAMS, PROPERTY_TYPES, OCCUPANCY_TYPES, REPORT_CONDITION_MODES
- [x] applyMetaDefaults() â€” backward-compat merge
- [x] extractMetaFields() â€” safe extraction from request body

## STEP 2 â€” server/workflowStatus.js âœ… COMPLETE
- [x] 9 workflow status values
- [x] Status labels and color codes
- [x] pipelineToWorkflowStatus() â€” maps legacy pipelineStage
- [x] computeWorkflowStatus() â€” derives status from case state

## STEP 3 â€” server/sectionDependencies.js âœ… COMPLETE
- [x] Required/recommended facts per 1004 field (all 11 fields)
- [x] Shared deps for cross-form fields
- [x] getMissingFacts(fieldId, facts) â€” returns missing required/recommended
- [x] resolvePath() â€” dotted path resolver for nested facts

## STEP 4 â€” server/fieldEligibility.js âœ… COMPLETE
- [x] AI eligibility classification: ai_draft, fact_autofill, manual_review, read_only
- [x] FIELD_ELIGIBILITY_1004 map
- [x] FIELD_ELIGIBILITY_SHARED map
- [x] getFieldEligibility(formType, fieldId)

## STEP 5 â€” forms/1004.js âœ… COMPLETE
- [x] Added aiEligibility to all 11 fields
- [x] Added requiredFacts to all 11 fields

## STEP 6 â€” forms/commercial.js âœ… COMPLETE (active)
- [x] Added aiEligibility to all commercial fields

## STEP 6b â€” forms/1025.js, 1073.js, 1004c.js âœ… STRUCTURAL ONLY (deferred)
- [x] Added aiEligibility stubs (lighter touch â€” structural compatibility only)
- [ ] Deep dependency logic â€” DEFERRED until 1025/1073/1004c lanes activated
- [ ] Section-level fact requirements â€” DEFERRED
- [ ] ACI field map enrichment for 1025/1073/1004c â€” DEFERRED
- NOTE: Files preserved. Do not delete. Do not extend until scope is widened.

## STEP 7 â€” cacc-writer-server.js âœ… COMPLETE
- [x] Import new server modules
- [x] Expand POST /api/cases/create
- [x] Expand PATCH /api/cases/:caseId
- [x] Expand GET /api/cases/:caseId (apply meta defaults)
- [x] Add GET /api/cases/:caseId/missing-facts/:fieldId
- [x] Add PATCH /api/cases/:caseId/workflow-status
- [x] Wire assignmentMeta into generate-batch and generate-all

## STEP 8 â€” server/promptBuilder.js âœ… COMPLETE
- [x] Add assignmentMeta parameter to buildPromptMessages()
- [x] Inject assignment context system block
- [x] Add loan program specific guidance (FHA, USDA, VA, Construction)
- [x] Add reportConditionMode guidance (Subject To Completion, Subject To Repairs)

## STEP 9 â€” index.html âœ… COMPLETE
- [x] New CSS for assignment chips, workflow status, missing-facts warning
- [x] Expanded case creation form with Assignment Details card
- [x] Case metadata summary section (shown when case loaded)
- [x] Missing-facts warning panel in Generate tab
- [x] Workflow status badge in header

## STEP 10 â€” app.js âœ… COMPLETE
- [x] Updated createCase() to collect and send new fields
- [x] Updated updateCase() to collect and send new fields
- [x] Updated loadCase() to populate new fields and show metadata
- [x] Updated renderCaseList() to show assignment purpose + loan program
- [x] Added checkMissingFacts() function
- [x] Added missing-facts check before runBatch()
- [x] Added renderCaseMetadata() function

## STEP 11 â€” Scope Enforcement UI âœ… COMPLETE
- [x] Two-section form picker: Active Production (prominent) + Deferred/Future (collapsed toggle)
- [x] `#activeFormOptions` â€” populated from `/api/forms` `activeForms` array
- [x] `#deferredFormOptions` â€” populated from `/api/forms` `deferredForms` array, collapsed by default
- [x] `#deferredToggleBtn` â€” show/hide deferred section
- [x] `#deferredFormBanner` â€” warning banner shown when deferred form type is active
- [x] `#deferredFormBannerText` â€” message from server `scopeWarning.message` or local fallback
- [x] `.form-badge.deferred` â€” amber badge style for deferred-form cases in case list
- [x] `setScopeGenerateEnabled(false)` â€” generate buttons disabled for deferred form types
- [x] `selectFormFromPicker()` â€” syncs hidden `#newFormType` select + calls `setActiveFormConfig()`
- [x] `toggleDeferredSection()` â€” open/close deferred section body
- [x] `showDeferredFormBanner()` / `hideDeferredFormBanner()` â€” banner helpers
- [x] `isActiveFormId()` / `isDeferredFormId()` â€” client-side scope guards (seeded from server)
- [x] `voiceFormType` select uses `<optgroup>` for Active Production vs. Deferred/Future
- [x] Legacy deferred-form cases: load in limited mode (read-only, no generate, banner shown, deferred section opened)
- NOTE: UI still renders deferred forms in picker for visibility. They are not hidden â€” just clearly marked.
- NOTE: Active production forms (1004, commercial) are always shown prominently at top.

## STOP-AND-VERIFY CHECKLIST

### Lane 1 â€” 1004 (priority)
- [ ] Create a new 1004 Sale + Conventional case â€” confirm all fields save
- [ ] Create a new 1004 Refinance + FHA case â€” confirm all fields save
- [ ] Create a new 1004 Construction case â€” confirm reportConditionMode works
- [ ] Load an older 1004 case â€” confirm backward compatibility (no missing field errors)
- [ ] Open a 1004 case â€” confirm metadata displays in header/dashboard
- [ ] Attempt to generate a 1004 section with missing required facts â€” confirm warning panel
- [ ] Confirm prompts receive assignmentPurpose and loanProgram for 1004
- [ ] Confirm workflowStatus updates correctly for 1004 pipeline

### Lane 2 â€” commercial (priority)
- [ ] Create a new commercial case â€” confirm all fields save
- [ ] Attempt to generate a commercial section with missing required facts â€” confirm warning panel
- [ ] Confirm prompts receive assignmentPurpose for commercial
- [ ] Confirm workflowStatus updates correctly for commercial pipeline

### Scope Enforcement (Step 11)
- [ ] Open the UI â€” confirm form picker shows Active Production section with 1004 + commercial
- [ ] Confirm Deferred/Future section is collapsed by default
- [ ] Click "Show" â€” confirm 1025, 1073, 1004c appear with amber "Deferred" badge
- [ ] Select a deferred form type â€” confirm amber banner appears, generate buttons disabled
- [ ] Select 1004 â€” confirm banner disappears, generate buttons re-enabled
- [ ] Load a legacy deferred-form case â€” confirm banner shown, deferred section opened, generate disabled
- [ ] Confirm case list shows âš  badge on deferred-form cases
- [ ] Confirm voiceFormType select has Active Production / Deferred optgroups
- [ ] POST /api/cases/create with formType=1025 â€” confirm 400 + {supported:false, scope:'deferred'}
- [ ] POST /api/generate with formType=1073 â€” confirm 400 + {supported:false, scope:'deferred'}
- [ ] GET /api/forms â€” confirm activeForms, deferredForms, activeScope, deferredScope present

### Deferred â€” do not verify until scope is widened
- [ ] ~~1025 case creation and generation~~ â€” DEFERRED
- [ ] ~~1073 case creation and generation~~ â€” DEFERRED
- [ ] ~~1004c case creation and generation~~ â€” DEFERRED

