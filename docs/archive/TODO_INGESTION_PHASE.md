# Ingestion + Comp Commentary Phase — TODO

## Steps

- [ ] Step 1: Create `scripts/ingestVoicePdfs.mjs` (scan all voice_pdfs → extract → stage)
- [ ] Step 2: Create `scripts/promoteStaged.mjs` (review staging → promote to production memory)
- [ ] Step 3: Create `server/engines/compCommentaryEngine.js` (comp commentary engine module)
- [ ] Step 4: Update `knowledge_base/phrase_bank/phrases.json` (add 6 Hundman phrases)
- [ ] Step 5: Update `index.html` (add comp commentary panel in Generate tab)
- [ ] Step 6: Update `app.js` (add comp commentary JS)
- [ ] Step 7: Run ingestion — `node scripts/ingestVoicePdfs.mjs --formType 1004`
- [ ] Step 8: Review staging file, set `approved: true` on desired sections
- [ ] Step 9: Run promotion — `node scripts/promoteStaged.mjs --formType 1004`
- [ ] Step 10: Verify 227/227 tests still pass

## Staging Schema

```json
{
  "sourceFile": "Hundman.PDF",
  "formType": "1004",
  "extractedAt": "ISO timestamp",
  "status": "staged",
  "metadata": {
    "propertyType": "residential",
    "subjectCondition": "C3",
    "marketType": "suburban",
    "city": "Bloomington",
    "county": "McLean",
    "state": "IL",
    "assignmentPurpose": "refinance"
  },
  "sections": [
    { "sectionType": "neighborhood_description", "text": "...", "wordCount": 45, "approved": null, "promotedId": null }
  ],
  "phrases": [
    { "id": "c3_condition_standard", "tag": "condition", "context": "...", "text": "...", "approved": null }
  ],
  "compExamples": [
    { "sectionType": "sca_summary", "text": "...", "approved": null }
  ]
}
```

## Notes

- Staging files live in `knowledge_base/staging/<formType>/<filename>.json`
- Manifest of processed files: `knowledge_base/staging/manifest.json`
- Promotion writes to `approvedNarratives`, `phrase_bank/phrases.json`, `compExamples/<formType>/`
- `POST /api/cases/:caseId/generate-comp-commentary` already exists — no new server endpoint needed
- `sca_summary` already in `destinationRegistry.js` for ACI
