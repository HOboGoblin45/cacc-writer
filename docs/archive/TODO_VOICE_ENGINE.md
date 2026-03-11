# Personal Appraiser Voice Engine — Implementation TODO
# Active production scope: 1004 (ACI) + commercial (Real Quantum)
# Last updated: Voice Engine Phase 1 COMPLETE + Disk Write Verified ✅

## Files to Create
- [x] server/config/retrievalWeights.js — centralized weight config (DIMENSION_WEIGHTS + SOURCE_BONUSES)
- [x] server/storage/saveApprovedNarrative.js — saves approved narrative with full metadata + index
- [x] server/retrieval/approvedNarrativeRetriever.js — two-phase weighted multi-dimensional retrieval
- [x] server/data/normalizedDataModel.js — normalized internal fact schema (future external data)

## Files to Update
- [x] server/knowledgeBase.js — added addApprovedNarrative() + re-export getApprovedNarratives()
- [x] server/retrieval.js — added Pass 0 (approvedNarratives), getRelevantExamplesWithVoice(), formatVoiceExamplesBlock()
- [x] server/promptBuilder.js — split Block 3 → Block 3a (voice) + Block 3b (other examples)
- [x] cacc-writer-server.js — all 3 approval paths + all 5 generation calls updated

## Tests
- [x] node _test_smoke.mjs → 28/28 ✅
- [x] node _test_phase3.mjs → 77/77 ✅
- [x] node _test_voice_write.mjs → 20/22 ✅ (2 non-issues: text trim + expected multi-entry behavior)
- [x] Disk write verified: approve section → knowledge_base/approvedNarratives/index.json + <id>.json created ✅
- [x] Full metadata verified: sectionType, formType, subjectCondition, state, county, sourceType=approvedNarrative ✅
- [x] Feedback approval path verified: savedToKB=true ✅
- [x] Repeated approval: no corruption ✅
- [ ] Manual: generate same section type → verify voice examples appear with correct label in prompt

## Architecture Summary (completed)

### Storage layout
```
knowledge_base/approvedNarratives/
  index.json          ← metadata only (no text), fast scoring without I/O
  <id>.json           ← individual entry files (includes full text)
```

### Retrieval weights (server/config/retrievalWeights.js)
| Dimension         | Points |
|-------------------|--------|
| sectionType match | 30     |
| formType match    | 20     |
| propertyType      | 15     |
| subjectCondition  | 10     |
| county            | 8      |
| city              | 5      |
| marketType        | 5      |
| assignmentPurpose | 3      |
| loanProgram       | 2      |

| Source            | Bonus  |
|-------------------|--------|
| approvedNarrative | +25    |
| approved_edit     | +15    |
| curated           | +10    |
| imported          | +5     |

### Prompt block order (server/promptBuilder.js)
```
[system] Block 1:   CACC Writer system instructions
[system] Block 2:   Cresci style guide
[system] Block 3a:  VOICE EXAMPLES (appraiser's own approved reports) ← highest priority
[system] Block 3b:  Other examples (approved_edits / curated / imported)
[system] Block 3.5: Form-specific field instructions
[system] Block 4:   Phrase bank entries
[system] Block 5:   Facts context (confidence-aware)
[system] Block 5.5: Location context (neighborhood fields)
[system] Block 5.7: Assignment context
[user]   Block 6:   Write request
```

### Approval paths wired (cacc-writer-server.js)
1. `POST /api/cases/:caseId/feedback` — rating=up → addApprovedNarrative()
2. `PATCH /api/cases/:caseId/outputs/:fieldId` — approved=true → addApprovedNarrative()
3. `PATCH /api/cases/:caseId/sections/:fieldId/status` — status=approved → addApprovedNarrative()

### Generation calls updated (cacc-writer-server.js)
All 5 generation endpoints now use `getRelevantExamplesWithVoice()` + pass `voiceExamples` + `examples: otherExamples` to `buildPromptMessages()`:
1. `POST /api/generate` (fieldId path)
2. `POST /api/generate-batch` (processField)
3. `POST /api/cases/:caseId/generate-all` (processField)
4. `POST /api/cases/:caseId/generate-core` (processCoreField)
5. `POST /api/cases/:caseId/generate-comp-commentary`

## Pending (future phases)
- [ ] Manual verification of approvedNarratives/ file creation on approval
- [ ] Tune retrieval weights after real-world usage data
- [ ] Add GET /api/kb/voice-narratives endpoint for UI visibility
- [ ] Migrate existing approved_edits → approvedNarratives with enriched metadata
- [ ] Add qualityScore auto-tagging via buildApproveEditPrompt()
