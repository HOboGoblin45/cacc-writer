# Appraisal Agent â€” Production-Hardening Implementation Plan
# Generated after full codebase audit of all key files

---

## 1. EXECUTIVE SUMMARY

After reading every key file in the project, here is the honest current-state assessment:

### What works well
- `cacc-writer-server.js` is a solid, functional production server with case management, OCR, voice import, form registry, ACI/RQ forwarding, and generation endpoints all working.
- The modular server modules (`knowledgeBase.js`, `retrieval.js`, `promptBuilder.js`, `openaiClient.js`) are well-designed and production-quality code.
- The phrase bank has 12 real entries. The form configs (1004, 1025, 1073, 1004c, commercial) are detailed and correct.
- Both automation agents (ACI pywinauto, RQ Playwright) have solid architecture with retry, verification, and fallback logic.

### The core problem â€” the split brain
The production server (`cacc-writer-server.js`) and the modular server (`server/server.js`) are **completely disconnected**. The production server has its own inline `collectExamples()`, its own `genInput()`, its own OpenAI client â€” none of which use the modular KB, retrieval, or prompt pipeline. The modular server runs on port 5179 and is **never called by anything**. The knowledge base has **0 examples** because the feedback loop saves to `feedback.json` but never calls `addExample()`. The two-pass review, confidence gating, and queue workflow do not exist yet.

**The fix is surgical, not a rewrite.** The modular modules are good â€” they just need to be imported into the production server and wired up. Everything else builds on top of that.

---

## ACTIVE PRODUCTION SCOPE

> âš ï¸ **Scope is narrowed.** Active production lanes: **1004 single-family (ACI)** + **commercial (Real Quantum)** only.
> 1025, 1073, 1004c are **DEFERRED** â€” preserved, not actively extended. See `SCOPE.md` for full definition.
>
> **Scope enforcement is implemented** across API + UI:
> - New cases / generation / workflow for deferred forms â†’ **BLOCKED** (`{supported:false, scope:'deferred'}`)
> - Legacy deferred-form cases â†’ **load in limited mode** (read-only, no generate)
> - Central config: `server/config/productionScope.js`
> - All deferred access logged via `logDeferredAccess()`

All phases below should prioritize **Lane 1 (1004)** and **Lane 2 (commercial)** first.
Do not invest deep implementation time in 1025, 1073, or 1004c until scope is widened.

---

## 2. COMPLETION ROADMAP TABLE

| Phase | Title | Priority | Est. Effort | Depends On | Scope |
|-------|-------|----------|-------------|------------|-------|
| 1 | Runtime Architecture Consolidation | ðŸ”´ Critical | 1â€“2 days | None | Both lanes |
| 2 | Knowledge Base Activation | ðŸ”´ Critical | 1 day | Phase 1 | Both lanes |
| 3 | Retrieval & Prompt Pipeline Completion | ðŸ”´ Critical | 1 day | Phase 1, 2 | Both lanes |
| 4 | Two-Pass Draft / Review Workflow | ðŸŸ  Important | 1â€“2 days | Phase 3 | Both lanes |
| 5 | Fact Confidence Gating & Safety Rules | ðŸŸ  Important | 1 day | Phase 3 | Both lanes |
| 6 | ACI Automation Hardening | ðŸŸ  Important | 1â€“2 days | Phase 1 | **1004 only** |
| 7 | Real Quantum Automation Hardening | ðŸŸ¡ Important | 1â€“2 days | Phase 6 | **commercial only** |
| 8 | Throughput & Queue Workflow | ðŸŸ¡ Important | 2 days | Phase 4 | Both lanes |
| 9 | Testing, Logging, Error Handling | ðŸŸ  Important | 1â€“2 days | Phase 8 | Both lanes |
| 10 | Final Production Readiness Audit | ðŸŸ¡ Optional | 0.5 day | All | Both lanes |

**Total realistic timeline: 12â€“18 working days (2.5â€“3.5 weeks)**

> **Priority order within each phase:** 1004 sections first, then commercial sections.
> Do not build eval cases or deep wiring for 1025/1073/1004c until scope is widened.

---

## SCOPE RE-AFFIRMATION (Desktop Production Phase)

> **Active scope confirmed:** 1004 single-family (ACI) + commercial (Real Quantum) only.
> **Deferred:** 1025, 1073, 1004C â€” preserved, not extended.
> **Full tracker:** `TODO_DESKTOP_PHASE.md`
> **Scope reference:** `SCOPE.md`

All phases below are ordered with Lane 1 (1004/ACI) and Lane 2 (commercial/RQ) as the
exclusive implementation targets. Do not invest deep effort in deferred form types.

---

## 3. DETAILED PHASE-BY-PHASE IMPLEMENTATION PLAN

---

### PHASE 1 â€” Runtime Architecture Consolidation

**Objective:** Make `cacc-writer-server.js` the single canonical runtime by importing and using the modular server modules. Deprecate `server/server.js` as a standalone server (keep its modules).

**Why it matters:** Right now the KB, retrieval, and prompt pipeline are dead code. Nothing in production uses them. Every other phase depends on this being fixed first.

#### Current state (the exact problem)

`cacc-writer-server.js` has its own inline systems:
- `collectExamples()` â€” reads `voice_training.json` + case `feedback.json` (NOT the KB)
- `genInput()` â€” just prepends system prompt + style guide (NOT the full pipeline)
- `const client = new OpenAI(...)` â€” its own OpenAI client instance

`server/server.js` runs standalone on port 5179 and is never called by anything.

#### Tasks

**1.1 â€” CRITICAL: Import modular modules into cacc-writer-server.js**

Add at the top of `cacc-writer-server.js`:
```js
import { callAI } from './server/openaiClient.js';
import { addExample, getExamples, getPhrases, indexExamples } from './server/knowledgeBase.js';
import { getRelevantExamples } from './server/retrieval.js';
import { buildPromptMessages } from './server/promptBuilder.js';
```

**1.2 â€” CRITICAL: Replace `genInput()` with `buildPromptMessages()`**
- The current `genInput()` only prepends system + style guide.
- Replace all generation calls to use `buildPromptMessages()` which adds examples, phrase bank, and facts.
- Affected endpoints: `POST /api/generate`, `POST /api/generate-batch`

**1.3 â€” CRITICAL: Replace `collectExamples()` with `getRelevantExamples()`**
- `collectExamples()` reads from `voice_training.json` and case `feedback.json`.
- Replace with `getRelevantExamples()` from `retrieval.js` which reads from the KB index.
- Keep `voice_training.json` as a deprecated data source â€” add a migration path in Phase 2.
- Mark `collectExamples()` as `// DEPRECATED â€” use getRelevantExamples() instead`

**1.4 â€” IMPORTANT: Deprecate `server/server.js` as a standalone server**
- Add a comment at the top: `// DEPRECATED as standalone server. Modules are imported directly into cacc-writer-server.js.`
- Guard the `app.listen()` block so it only runs if explicitly invoked with a flag.
- Do NOT delete it â€” the modules it imports are still used.

**1.5 â€” IMPORTANT: Unify the OpenAI client**
- For generation calls: use `callAI()` from `openaiClient.js`.
- For OCR vision calls: keep the raw `client` in `cacc-writer-server.js` since `callAI()` doesn't support the vision input format.
- Add a comment: `// Raw client kept for OCR vision calls only. Use callAI() for all generation.`

#### Files to edit
- `cacc-writer-server.js` â€” primary target (add imports, replace genInput, replace collectExamples)
- `server/server.js` â€” add deprecation notice, guard the listen block

#### Definition of done
- `cacc-writer-server.js` imports and uses `callAI`, `buildPromptMessages`, `getRelevantExamples`, `addExample`
- `server/server.js` is clearly marked deprecated as a standalone server
- The app starts on port 5178 with no errors
- Generation calls go through the modular pipeline

#### âœ… Stop and verify checkpoint
```
1. npm start â€” server starts on port 5178 with no import errors
2. POST /api/generate with a simple prompt â€” returns text
3. POST /api/generate-batch with 2 fields â€” both return text
4. Console shows no duplicate client warnings
5. GET /api/health â€” returns { ok: true }
```

#### Risk notes
- The `callAI()` function uses `client.responses.create()` â€” same API as the inline client. Drop-in replacement.
- OCR vision calls use a different input format â€” keep the raw client for those specifically.
- `buildPromptMessages()` expects `fieldId` as a parameter â€” ensure all generation calls pass it.

---

### PHASE 2 â€” Knowledge Base Activation

**Objective:** Make the KB a real production subsystem. Wire the feedback/approval loop to save to the KB. Migrate voice training data into the KB.

**Why it matters:** The KB has 0 examples. Until it has examples, retrieval returns nothing and the prompt pipeline has no style memory. This is the most important data-layer fix.

#### Tasks

**2.1 â€” CRITICAL: Wire feedback endpoint to save approved edits to KB**

In `cacc-writer-server.js`, `POST /api/cases/:caseId/feedback` saves to `feedback.json` but never calls `addExample()`.

Add this logic after saving to feedback.json:
```js
// If user approved (rating up) or actually edited the text, save to KB
if (rating === 'up' || (editedText && editedText !== originalText && editedText.length > 50)) {
  const caseMeta = readJSON(path.join(cd, 'meta.json'), {});
  const caseFacts = readJSON(path.join(cd, 'facts.json'), {});
  addExample({
    fieldId: safeFieldId,
    formType: normalizeFormType(caseMeta.formType),
    propertyType: 'residential',
    marketType: 'suburban',
    marketArea: caseFacts?.subject?.city?.value || '',
    sourceType: 'approved_edit',
    qualityScore: rating === 'up' ? 90 : 80,
    tags: [],
    text: editedText,
  });
}
```

**2.2 â€” CRITICAL: Create voice training migration endpoint**

Add `POST /api/kb/migrate-voice` to `cacc-writer-server.js`:
- Reads all entries from `voice_training.json`
- Calls `addExample()` for each with `sourceType: 'imported'`, `qualityScore: 70`
- Returns count of migrated entries
- Idempotent â€” skip entries already in the KB

**2.3 â€” IMPORTANT: Add KB management API endpoints**
- `GET /api/kb/status` â€” return counts from `index.json`
- `POST /api/kb/reindex` â€” rebuild index from disk (move from `server/server.js`)

**2.4 â€” IMPORTANT: Extend voice PDF import to also save to KB**

In `POST /api/voice/import-pdf` and `POST /api/voice/import-folder`, after saving to `voice_training.json`, also call `addExample()` with `sourceType: 'imported'`, `qualityScore: 70`.

**2.5 â€” OPTIONAL: Add KB phrase management endpoints**
- `GET /api/kb/phrases` â€” return all phrases
- `POST /api/kb/phrases` â€” add a new phrase
- `DELETE /api/kb/phrases/:id` â€” remove a phrase

#### Files to edit
- `cacc-writer-server.js` â€” feedback endpoint, new KB endpoints, voice import extension

#### Definition of done
- Approving an edit saves to both `feedback.json` AND `knowledge_base/approved_edits/<id>.json`
- `knowledge_base/index.json` updates automatically after each approval
- `GET /api/kb/status` returns real counts
- Voice training migration works and populates the KB

#### âœ… Stop and verify checkpoint
```
1. Create a case, generate a section, edit the text, click approve (rating: 'up')
2. Check knowledge_base/approved_edits/ â€” a new .json file should appear
3. Check knowledge_base/index.json â€” counts.approved_edits should be > 0
4. GET /api/kb/status â€” returns non-zero counts
5. Generate the same field again â€” the approved edit should appear in the examples block
6. POST /api/kb/migrate-voice â€” migrates voice_training.json entries
```

---

### PHASE 3 â€” Retrieval and Prompt Pipeline Completion

**Objective:** Every generation request uses the full structured pipeline: system prompt â†’ style guide â†’ retrieved examples â†’ phrase bank â†’ facts â†’ user request.

**Why it matters:** Currently `generate-batch` uses `collectExamples()` (old system) and `genInput()` (just system + style). The modular `buildPromptMessages()` is never called from production. This phase makes the full pipeline real.

#### Tasks

**3.1 â€” CRITICAL: Update `generate-batch` to use `buildPromptMessages()`**

Replace the current per-field prompt construction in `generate-batch`:
```js
// OLD:
const r = await client.responses.create({ model: MODEL, input: genInput(bp + factsContext + exBlock) });

// NEW:
const messages = buildPromptMessages({
  formType: caseFormType || '1004',
  fieldId: sid,
  facts: readJSON(path.join(caseDir, 'facts.json'), {}),
  examples: getRelevantExamples({ formType: caseFormType, fieldId: sid }),
});
const text = await callAI(messages);
```

**3.2 â€” CRITICAL: Update `POST /api/generate` to use `buildPromptMessages()`**

Update the single-field generate endpoint to accept `fieldId`, `formType`, `facts` and use `buildPromptMessages()`.

**3.3 â€” IMPORTANT: Complete `FIELD_LABELS` in `promptBuilder.js`**

Add all field IDs from all form configs to the `FIELD_LABELS` map:
```js
offering_history:        'Offering History',
contract_analysis:       'Contract Analysis',
concessions:             'Concessions / Financial Assistance',
neighborhood_boundaries: 'Neighborhood Boundaries',
site_comments:           'Site / Utilities / Adverse Conditions',
improvements_condition:  'Improvements / Condition Narrative',
sca_summary:             'Sales Comparison Approach Summary',
exposure_time:           'Exposure Time',
// ... and all commercial form fields
```

**3.4 â€” IMPORTANT: Complete `FIELD_PHRASE_TAGS` in `promptBuilder.js`**

Add phrase tag mappings for all fields:
```js
offering_history:        ['market_conditions'],
contract_analysis:       ['concession_adjustment'],
concessions:             ['concession_adjustment'],
neighborhood_boundaries: ['flood_zone', 'zoning'],
site_comments:           ['flood_zone', 'zoning', 'fha_well_septic', 'rural_acreage'],
improvements_condition:  ['accessory_dwelling'],
sca_summary:             ['concession_adjustment', 'gla_adjustment', 'market_conditions'],
reconciliation:          ['highest_best_use'],
exposure_time:           ['market_conditions'],
```

**3.5 â€” IMPORTANT: Inject form-specific `tpl` instructions into `buildPromptMessages()`**

Each form config field has a `tpl` with specific generation instructions. Add a Block 3.5 to `buildPromptMessages()`:
```js
// Block 3.5: Form-specific field instructions (from form config tpl)
if (formConfig?.fields) {
  const fieldDef = formConfig.fields.find(f => f.id === fieldId);
  if (fieldDef?.tpl) {
    messages.push({ role: 'system', content: 'FIELD-SPECIFIC INSTRUCTIONS:\n' + fieldDef.tpl });
  }
}
```

**3.6 â€” OPTIONAL: Add retrieval fallback logging**

When retrieval falls back to Pass 3 (cross-form) or Pass 4 (no examples), log it:
```js
if (results.length === 0) {
  console.warn(`[retrieval] No examples found for fieldId=${fieldId}, formType=${formType}. KB needs more examples.`);
}
```

#### Files to edit
- `cacc-writer-server.js` â€” update generate and generate-batch endpoints
- `server/promptBuilder.js` â€” add FIELD_LABELS, FIELD_PHRASE_TAGS completeness, form tpl injection
- `server/retrieval.js` â€” add fallback logging

#### Definition of done
- Every generation call goes through `buildPromptMessages()`
- Phrase bank entries appear in prompts for relevant fields
- Retrieved examples appear in prompts when KB has examples
- Facts are injected in the structured format
- Form-specific tpl instructions are included

#### âœ… Stop and verify checkpoint
```
1. Generate a neighborhood_description with a case that has facts
2. Log the messages array sent to OpenAI â€” verify all 6 blocks are present
3. Approve an edit, then generate the same field again â€” verify the approved edit appears
4. Check that flood_zone phrases appear in neighborhood_description prompts
5. Verify form tpl instructions appear in the messages
```

---

### PHASE 4 â€” Two-Pass Draft / Review Workflow

**Objective:** Implement a draft â†’ review â†’ approve pipeline that catches unsupported claims, tone issues, and missing facts before the appraiser sees the output.

**Why it matters:** Single-pass generation produces output that often needs significant editing. A second AI pass as a reviewer dramatically reduces rewrite time and catches hallucinations.

#### Tasks

**4.1 â€” CRITICAL: Create `prompts/review_pass.txt`**

New file with the reviewer system prompt:
```
You are a senior appraisal reviewer for Appraisal Agent.

Check the draft narrative for:
1. Unsupported factual claims â€” anything stated as fact not in the provided facts
2. Overconfident language â€” certainty where support is limited
3. Missing placeholders â€” facts that should be [INSERT] but were invented
4. Tone issues â€” speculative, academic, or non-professional language
5. USPAP compliance â€” avoid unsupported conclusions
6. Internal contradictions â€” statements that conflict with each other or the facts

Return JSON only:
{
  "revisedText": "<the corrected narrative>",
  "issues": [
    { "type": "unsupported_claim|missing_fact|tone|uspap|contradiction",
      "description": "...", "severity": "critical|major|minor" }
  ],
  "confidence": "high|medium|low",
  "changesMade": true|false
}
```

**4.2 â€” CRITICAL: Add `POST /api/cases/:caseId/review-section` endpoint**

In `cacc-writer-server.js`:
- Takes: `fieldId`, `draftText`, `formType` (optional)
- Loads facts from case
- Builds review messages using `review_pass.txt` + facts + draft
- Returns: `{ revisedText, issues, confidence, changesMade }`

**4.3 â€” IMPORTANT: Add `buildReviewMessages()` to `promptBuilder.js`**

```js
export function buildReviewMessages({ draftText, facts, fieldId, formType }) {
  const messages = [];
  // Block 1: Review system prompt (review_pass.txt)
  // Block 2: Facts context (so reviewer knows what's supported)
  // Block 3: The draft to review
  return messages;
}
```

**4.4 â€” IMPORTANT: Add `twoPass` option to `generate-batch`**

```js
// In generate-batch request body:
// twoPass: true  â€” run draft then review, return reviewed text
// twoPass: false â€” return draft as-is (default, faster)
```

**4.5 â€” IMPORTANT: Update UI to show review results**
- Add a "Review Draft" button next to each generated field
- Show the issues list from the review pass (severity-colored)
- Allow accepting the revised text or keeping the draft
- Show confidence indicator (high/medium/low)

**4.6 â€” OPTIONAL: Auto-review for high-stakes fields**

Define high-stakes fields that always get auto-reviewed:
```js
const AUTO_REVIEW_FIELDS = ['reconciliation', 'sca_summary', 'market_conditions', 'hbu_analysis'];
```

#### Files to create
- `prompts/review_pass.txt` â€” new reviewer system prompt

#### Files to edit
- `cacc-writer-server.js` â€” new review-section endpoint, twoPass option in generate-batch
- `server/promptBuilder.js` â€” add `buildReviewMessages()` function
- `app.js` â€” UI review button and issues display

#### Definition of done
- `POST /api/cases/:caseId/review-section` works and returns revised text + issues
- Two-pass mode works in generate-batch
- UI shows review results with severity indicators

#### âœ… Stop and verify checkpoint
```
1. Generate a section with intentionally missing facts
2. Call review-section on the draft
3. Verify the review catches missing facts and returns [INSERT] placeholders
4. Verify the revised text is better than the draft
5. Test two-pass batch generation â€” verify it takes ~2x longer but produces better output
6. Test auto-review for reconciliation field
```

---

### PHASE 5 â€” Fact Confidence Gating and Safety Rules

**Objective:** Prevent low-confidence facts from being stated as certain in generated narratives.

**Why it matters:** The facts schema already has `confidence: 'low'|'medium'|'high'` on every field. But `buildFactsContext()` ignores confidence and presents all facts equally. A `confidence: 'low'` address gets stated as certain fact.

#### Tasks

**5.1 â€” CRITICAL: Update `buildFactsContext()` to annotate confidence**

In `cacc-writer-server.js`, update the facts output format:
```js
// For high confidence: output value as-is
L.push('  address: 123 Main St');

// For medium confidence: add hedge annotation
L.push('  address: 123 Main St [confidence: medium â€” use hedged language]');

// For low confidence: replace with INSERT
L.push('  address: [INSERT] [confidence: low â€” do not state as fact]');
```

Logic:
- `confidence: 'high'` â†’ output value as-is, no annotation
- `confidence: 'medium'` â†’ output value with `[confidence: medium â€” use hedged language]`
- `confidence: 'low'` â†’ output `[INSERT]` with `[confidence: low â€” do not state as fact]`
- `null` value â†’ output `[INSERT]` regardless of confidence

**5.2 â€” CRITICAL: Update `prompts/system_cacc_writer.txt` with confidence rules**

Add to the system prompt:
```
CONFIDENCE RULES (strictly enforced):
- Facts with no annotation: state as fact
- Facts marked [confidence: medium]: use hedged language â€” "reportedly", "per available records", "indicated as", "per the [source]"
- Facts marked [confidence: low]: write [INSERT] or omit entirely â€” NEVER state as certain
- If a fact is [INSERT]: use neutral language or write [INSERT fieldname] as a placeholder
- Never invent a value to replace an [INSERT] placeholder
```

**5.3 â€” IMPORTANT: Update `buildPromptMessages()` facts block to match**

The `promptBuilder.js` facts block has its own formatting. Update it to use the same confidence-annotated format as `buildFactsContext()`.

**5.4 â€” IMPORTANT: Add confidence check to review pass**

In `prompts/review_pass.txt`, add:
```
CONFIDENCE CHECK:
- Scan for any facts marked [confidence: low] that were stated as certain in the draft
- Flag these as "unsupported_claim" issues with severity "critical"
- Replace them with [INSERT] or hedged language in the revisedText
```

**5.5 â€” OPTIONAL: Confidence upgrade on approval**

When an appraiser approves a section, offer to upgrade the confidence of facts used in that section from 'low' to 'medium' or 'high'. This creates a feedback loop where facts get more reliable over time.

#### Files to edit
- `cacc-writer-server.js` â€” `buildFactsContext()` function
- `server/promptBuilder.js` â€” facts block formatting
- `prompts/system_cacc_writer.txt` â€” add confidence rules
- `prompts/review_pass.txt` â€” add confidence check (Phase 4 dependency)

#### Definition of done
- Low-confidence facts produce `[INSERT]` or hedged language in output
- High-confidence facts are stated directly
- The review pass flags any low-confidence facts stated as certain
- Generation behavior visibly changes based on confidence level

#### âœ… Stop and verify checkpoint
```
1. Create a case with all facts set to confidence: 'low'
2. Generate a section â€” verify output uses [INSERT] or hedged language throughout
3. Set one fact to confidence: 'high', regenerate â€” verify that fact is stated directly
4. Run review pass â€” verify it flags any remaining overconfident statements
5. Verify medium-confidence facts use hedged language ("reportedly", "indicated")
```

---

### PHASE 6 â€” ACI Automation Hardening

**Objective:** Make ACI insertion reliable enough for daily use on the highest-value forms (1004 first, then 1025, 1073).

**Why it matters:** The current ACI agent uses label-based control finding which is fragile. ACI's Win32 controls may not expose accessible names matching the label text. Without calibration, you won't know if insertion is working until you try it live.

#### Tasks

**6.1 â€” CRITICAL: Add `GET /calibrate` endpoint to ACI agent**

In `desktop_agent/agent.py`:
```python
@flask_app.route('/calibrate', methods=['GET'])
def calibrate():
    """
    List all Edit controls in the current ACI window.
    Use this to find the correct automation_id or label for each field.
    Returns: { controls: [{ name, automation_id, class_name, index, value_preview }] }
    """
    app = connect_to_aci()
    if not app:
        return jsonify({'ok': False, 'error': 'ACI not connected'})
    main_window = app.top_window()
    controls = []
    for i, ctrl in enumerate(main_window.descendants(control_type='Edit')):
        try:
            controls.append({
                'index': i,
                'name': ctrl.window_text() or '',
                'automation_id': ctrl.automation_id() or '',
                'class_name': ctrl.class_name() or '',
                'value_preview': (ctrl.get_value() or '')[:80],
            })
        except Exception:
            pass
    return jsonify({'ok': True, 'controls': controls, 'count': len(controls)})
```

**6.2 â€” CRITICAL: Add `automation_id` support to field maps and insertion strategy**

Update `desktop_agent/field_maps/1004.json` to support:
```json
{
  "neighborhood_description": {
    "label": "Neighborhood Description",
    "automation_id": "",
    "control_index": null,
    "notes": "Fill automation_id after running /calibrate"
  }
}
```

Update `insert_text()` in `agent.py` to try automation_id first (Strategy 0), then control_index (Strategy 0.5), then existing label strategies.

**6.3 â€” CRITICAL: Add `POST /test-field` endpoint**

```python
@flask_app.route('/test-field', methods=['POST'])
def test_field():
    """
    Insert a test string into a field, verify it appeared, then clear it.
    Use this to verify each field mapping before using real content.
    Returns: { ok, inserted, verified, cleared, fieldLabel }
    """
```

**6.4 â€” IMPORTANT: Add screenshot-on-failure**

In `insert_text()` and `verify_insertion()`, on failure:
```python
import datetime
screenshot_dir = os.path.join(AGENT_DIR, 'screenshots')
os.makedirs(screenshot_dir, exist_ok=True)
timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
screenshot_path = os.path.join(screenshot_dir, f'failure_{field_id}_{timestamp}.png')
try:
    app.top_window().capture_as_image().save(screenshot_path)
    log.info(f"Failure screenshot saved: {screenshot_path}")
except Exception:
    pass
```

**6.5 â€” IMPORTANT: Add `POST /insert-batch` endpoint**

```python
@flask_app.route('/insert-batch', methods=['POST'])
def insert_batch():
    """
    Insert multiple fields sequentially.
    Request: { fields: [{ fieldId, text, formType }], delay_ms: 500 }
    Response: { results: [{ fieldId, ok, method, verified }] }
    """
```

**6.6 â€” IMPORTANT: Escalating strategy retry**

Current retry just retries the same strategy 3 times. Update to escalate:
- Attempt 1: automation_id strategy
- Attempt 2: label strategy
- Attempt 3: clipboard fallback

Each escalation should be logged clearly.

#### Files to edit
- `desktop_agent/agent.py` â€” calibrate, test-field, batch insert, screenshot-on-failure, automation_id strategy
- `desktop_agent/field_maps/1004.json` â€” add automation_id fields after calibration
- `desktop_agent/field_maps/1025.json` â€” same
- `desktop_agent/field_maps/1073.json` â€” same
- `desktop_agent/config.json` â€” add screenshot_dir setting

#### Definition of done
- `/calibrate` returns a list of all ACI controls with their identifiers
- Insertion works reliably for at least 3 fields on the 1004 form
- `/test-field` confirms each mapped field is reachable
- Screenshots are saved on failure for debugging
- Batch insert works for sequential field insertion

#### âœ… Stop and verify checkpoint
```
1. Open ACI with a 1004 report loaded
2. GET http://localhost:5180/calibrate â€” verify it returns control list with automation_ids
3. Update field_maps/1004.json with real automation_ids from calibration output
4. POST /test-field for neighborhood_description â€” verify test string appears in ACI
5. POST /insert with real text â€” verify it inserts and verifies correctly
6. Test clipboard fallback by temporarily breaking the label match
7. POST /insert-batch with 3 fields â€” verify all 3 insert sequentially
```

#### Risk notes
- ACI's Win32 control structure may vary by version. The calibration endpoint is essential before any other ACI work.
- Some ACI fields may be in child windows or dialogs â€” the agent may need to handle window switching.
- Run calibration with a real 1004 report open, not just the ACI main window.

---

### PHASE 7 â€” Real Quantum Automation Hardening

**Objective:** Replace placeholder selectors with real ones. Make RQ automation useful for at least the 3 highest-value commercial fields.

**Why it matters:** Every selector in `real_quantum_agent/field_maps/commercial.json` is explicitly marked as a placeholder. The agent cannot insert anything until real selectors are discovered.

#### Tasks

**7.1 â€” CRITICAL: Run selector discovery on a live Real Quantum session**

Use the existing `GET http://localhost:5181/list-sections` endpoint with a commercial report open.
Use `real_quantum_agent/selector_discovery.py` to dump all interactive elements.

Priority fields to discover selectors for (in order):
1. `income_approach` â€” highest value for commercial
2. `reconciliation` â€” highest value for commercial
3. `site_description` â€” commonly needed
4. `hbu_analysis` â€” commonly needed
5. `sales_comparison` â€” commonly needed

Update `real_quantum_agent/field_maps/commercial.json` with real selectors after discovery.

**7.2 â€” CRITICAL: Add screenshot-on-failure to RQ agent**

In `insert_text()` and `navigate_to_section()` except blocks:
```python
screenshot_dir = os.path.join(AGENT_DIR, 'screenshots')
os.makedirs(screenshot_dir, exist_ok=True)
timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
page.screenshot(path=os.path.join(screenshot_dir, f'failure_{field_id}_{timestamp}.png'))
log.info(f"Failure screenshot saved")
```

**7.3 â€” IMPORTANT: Add `POST /test-field` endpoint to RQ agent**

Same concept as ACI: insert a test string, verify, clear. Essential for validating selectors.

**7.4 â€” IMPORTANT: Add `POST /insert-batch` endpoint to RQ agent**

Sequential batch insert for commercial fields.

**7.5 â€” IMPORTANT: Add configuration-driven navigation timeout**

Some RQ sections may take longer to load. Make `NAVIGATION_TIMEOUT` configurable per-field in the field map:

