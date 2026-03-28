# Appraisal Agent â€” Scope Correction Implementation Tracker
# ========================================================
# Scope: 1004 Single-Family (ACI) + Commercial (Real Quantum) ONLY
# Deferred: 1025, 1073, 1004C â€” preserved, not extended
# Status: âœ… COMPLETE

## Steps

- [x] Step 1 â€” CREATE server/config/productionScope.js
      ACTIVE_FORMS=['1004','commercial'], DEFERRED_FORMS=['1025','1073','1004c']
      isActiveForm(), isDeferredForm(), logDeferredAccess(), getScopeMetaForForm()
      PRIORITY_SECTIONS_1004 (10), PRIORITY_SECTIONS_COMMERCIAL (5)

- [x] Step 2 â€” UPDATE forms/index.js (add scope metadata)
      listForms() includes scope/supported fields
      getActiveForms() / getDeferredForms() exported

- [x] Step 3 â€” UPDATE cacc-writer-server.js (API scope enforcement + logging)
      GET /api/forms â€” returns activeForms, deferredForms, activeScope, deferredScope
      POST /api/cases/create â€” BLOCKED for deferred forms â†’ {supported:false, scope:'deferred'}
      POST /api/generate â€” BLOCKED for deferred forms
      POST /api/generate-batch â€” BLOCKED for deferred forms
      POST /api/workflow/run â€” BLOCKED for deferred forms
      POST /api/workflow/run-batch â€” BLOCKED for deferred forms
      GET /api/cases/:caseId â€” ALLOWED, returns scopeStatus:'deferred' + scopeWarning for legacy cases
      All deferred access logged via logDeferredAccess()

- [x] Step 4 â€” UPDATE index.html (CSS for form picker, deferred banner, deferred badge)
      .form-picker, .form-picker-option, .form-picker-badge CSS added
      .deferred-banner, .deferred-banner-head, .deferred-banner-body CSS added
      .form-badge.deferred CSS added
      Two-section form picker HTML: #activeFormOptions + #deferredFormOptions
      #deferredFormBanner + #deferredFormBannerText elements added
      #deferredToggleBtn for show/hide deferred section
      Hidden #newFormType select kept for backward compat

- [x] Step 5 â€” UPDATE app.js (two-section form picker, deferred banner, legacy case limited mode)
      _activeFormIds / _deferredFormIds populated from /api/forms response
      isActiveFormId() / isDeferredFormId() helpers
      selectFormFromPicker() â€” handles form picker clicks, syncs hidden select
      toggleDeferredSection() â€” show/hide deferred section
      showDeferredFormBanner() / hideDeferredFormBanner() â€” banner helpers
      setScopeGenerateEnabled() â€” enable/disable generate buttons
      initFormRegistry() â€” populates two-section picker + voiceFormType optgroups
      setActiveFormConfig() â€” shows/hides banner, enables/disables generate
      loadCase() â€” shows deferred banner for legacy deferred-form cases, opens deferred section
      renderCaseList() â€” deferred badge (âš ) on deferred-form case items

- [x] Step 6 â€” UPDATE SCOPE.md
      Added SCOPE ENFORCEMENT â€” IMPLEMENTED section
      Central config, API enforcement table, forms registry, UI enforcement documented
      Scope change log updated with enforcement entry

- [x] Step 7 â€” UPDATE TODO_SCOPE_CORRECTION.md (this file)

- [x] Step 8 â€” UPDATE TODO_UI_UPGRADE.md (Step 11 scope enforcement UI)

- [x] Step 9 â€” UPDATE PRODUCTION_PLAN.md (scope enforcement note)

---

## Scope Enforcement Summary

### What is BLOCKED for deferred forms (1025, 1073, 1004c)
- Creating new cases
- Generating narratives (single or batch)
- Running workflow (single or batch)
- All blocked endpoints return: `{ ok: false, supported: false, formType, scope: 'deferred', message }`

### What is ALLOWED for deferred forms
- Loading existing (legacy) cases â€” returns `scopeStatus: 'deferred'` + `scopeWarning`
- Viewing case facts and outputs (read-only)
- Accessing form config via GET /api/forms/:formType

### Logging
- Every deferred form access is logged via `logDeferredAccess(formType, endpoint, log)`
- Log format: `[SCOPE] Deferred form access â€” formType="X" endpoint="Y"`

### Files changed
| File | Change |
|---|---|
| `server/config/productionScope.js` | NEW â€” central scope config |
| `forms/index.js` | UPDATED â€” scope metadata, getActiveForms/getDeferredForms |
| `cacc-writer-server.js` | UPDATED â€” API scope enforcement on 6 endpoints |
| `index.html` | UPDATED â€” form picker CSS + HTML, deferred banner |
| `app.js` | UPDATED â€” form picker logic, deferred banner, limited mode |
| `SCOPE.md` | UPDATED â€” enforcement section + changelog |
| `TODO_UI_UPGRADE.md` | UPDATED â€” Step 11 added |
| `PRODUCTION_PLAN.md` | UPDATED â€” scope enforcement note |
| `_test_scope_enforcement.mjs` | NEW â€” 10-group / 27-assertion scope enforcement test suite |

---

## Post-Implementation Fix (2026-03-09)

### Problem
`POST /api/workflow/run` had validation order bug:
- `caseId is required` check fired **before** the scope check
- Deferred form requests (1025/1073/1004c) without a `caseId` returned generic
  `{ error: 'caseId is required' }` instead of the structured scope error

### Fix applied to `cacc-writer-server.js`
Reordered `/api/workflow/run` validation:
1. Extract `formType` from body
2. `normalizeFormType()` â†’ `_ftEarly`
3. **Scope check fires here** â†’ returns `{supported:false, scope:'deferred'}` for deferred forms
4. `caseId is required` check (only reached for active forms)
5. `fieldId is required` check
6. `const ft = _ftEarly` (reuses already-normalized value, no duplicate scope check)

Also fixed `_test_scope_enforcement.mjs` Test 10: assertion used `d.id` but endpoint
returns `{ ok, config: { id } }` â€” corrected to `d.config?.id ?? d.id`.

### Final test results
```
_test_scope_enforcement.mjs  â†’  27 passed, 0 failed  âœ…
_test_smoke.mjs              â†’  28 passed, 0 failed  âœ…
```

