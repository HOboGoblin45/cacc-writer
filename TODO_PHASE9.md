# Phase 9: Destination Automation and Final Output Integration

## Status: IN PROGRESS

## Steps

### Foundation
- [ ] 1. Create `server/migration/phase9Schema.js` — SQLite schema for insertion_runs, insertion_run_items, destination_profiles
- [ ] 2. Modify `server/db/schema.js` — Import and call initPhase9Schema
- [ ] 3. Create `server/insertion/types.js` — JSDoc type definitions for all Phase 9 entities
- [ ] 4. Create `server/insertion/insertionRepo.js` — SQLite persistence for insertion runs and items

### Core Logic
- [ ] 5. Create `server/insertion/destinationMapper.js` — Canonical-to-destination mapping (derives from fieldRegistry)
- [ ] 6. Create `server/insertion/formatters/aciFormatter.js` — ACI plain-text destination formatter
- [ ] 7. Create `server/insertion/formatters/rqFormatter.js` — RQ TinyMCE HTML destination formatter
- [ ] 8. Create `server/insertion/formatters/index.js` — Formatter dispatcher
- [ ] 9. Create `server/insertion/verificationEngine.js` — Read-back verification via agent endpoints
- [ ] 10. Create `server/insertion/fallbackHandler.js` — Fallback/recovery logic
- [ ] 11. Create `server/insertion/insertionRunEngine.js` — Batch insertion run orchestrator

### API Layer
- [ ] 12. Create `server/api/insertionRoutes.js` — REST endpoints
- [ ] 13. Modify `cacc-writer-server.js` — Mount insertion routes

### UI
- [ ] 14. Add insertion UI panel to Generate tab in `index.html`
- [ ] 15. Wire insertion UI logic in `app.js`

### Testing & Verification
- [ ] 16. Restart server and verify schema migration
- [ ] 17. Test insertion run lifecycle
- [ ] 18. Verify UI controls

## Key Design Decisions
- `fieldRegistry.js` is canonical source for field definitions
- `destinationRegistry.js` kept as thin compatibility shim
- Destination-specific formatters (not one blanket sanitizer)
- `approved_text` preserved as canonical; `formatted_text` as destination output
- Node.js orchestrates verification via agent `/read-field` endpoints
- QC gate is severity-aware and configurable (block on blocker, warn on high)
- Insertion controls live in Generate tab
- Per-destination capability flags (supports_readback, supports_rich_text, etc.)
- Mapping preview required before insertion launch
- Structured failure logging (not just generic error text)
- Retry safety: skip already-verified fields unless forced
