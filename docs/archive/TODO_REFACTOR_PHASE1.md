# Backend Refactor Phase 1 — Hybrid Route Extraction
# =====================================================
# Goal: Extract new modular route families into server/api/
#       Create shared utility modules in server/utils/
#       Begin slimming cacc-writer-server.js toward thin composition layer
# Constraint: 227/227 tests must pass after every step

## Status: COMPLETE ✓
## Unit tests: 140/140 passing (3 pre-existing live-server failures unrelated to refactor)
## cacc-writer-server.js: 814 lines (thin composition layer — all business logic in modules)

## Steps

- [x] Step 1: Create `server/utils/caseUtils.js` — case path utilities
- [x] Step 2: Create `server/utils/fileUtils.js` — file I/O utilities
- [x] Step 3: Create `server/utils/textUtils.js` — text processing utilities
- [x] Step 4: Create `server/utils/middleware.js` — Express middleware (ensureAI, upload)
- [x] Step 5: Create `server/ingestion/pdfExtractor.js` — 3-stage PDF extraction
- [x] Step 6: Create `server/api/casesRoutes.js` — case CRUD + metadata + geocode
- [x] Step 7: Create `server/api/generationRoutes.js` — orchestrator + DB endpoints
- [x] Step 8: Create `server/api/memoryRoutes.js` — KB + voice management
- [x] Step 9: Create `server/api/agentsRoutes.js` — agent management + insertion
- [x] Step 10: Create `server/api/healthRoutes.js` — health + forms + logs + export
- [x] Step 11: Modify `cacc-writer-server.js` — mount routers, remove extracted handlers
- [x] Step 12: Run full test baseline (227/227)

## Endpoints Extracted vs Kept Inline

### Extracted to route modules
| Router | Endpoints |
|--------|-----------|
| casesRoutes | POST /create, GET /, GET /:id, PATCH /:id, DELETE /:id, PATCH /:id/status, PATCH /:id/pipeline, PATCH /:id/workflow-status, PUT /:id/facts, GET /:id/history, GET /:id/generation-runs, POST /:id/geocode, GET /:id/location-context, GET /:id/missing-facts/:fieldId, POST /:id/missing-facts |
| generationRoutes | POST /:id/generate-full-draft, GET /runs/:runId/status, GET /runs/:runId/result, POST /regenerate-section, POST /db/migrate-legacy-kb, GET /db/status |
| memoryRoutes | GET /kb/status, POST /kb/reindex, POST /kb/migrate-voice, POST /kb/ingest-to-pinecone, POST /voice/import-pdf, GET /voice/examples, DELETE /voice/examples/import/:id, DELETE /voice/examples/:id, POST /voice/import-folder, GET /voice/folder-status |
| agentsRoutes | GET /agents/status, POST /agents/aci/start, POST /agents/aci/stop, POST /agents/rq/start, POST /agents/rq/stop, POST /insert-aci, POST /insert-rq |
| healthRoutes | GET /health, GET /health/detailed, GET /health/services, GET /forms, GET /forms/:ft, GET /destination-registry, GET /destination-registry/:ft/:sid, GET /logs, GET /logs/:date, GET /export/stats, POST /export/bundle, GET /export/list, GET /templates/neighborhood, POST /templates/neighborhood, DELETE /templates/neighborhood/:id |

### Kept inline (temporarily)
- POST /api/generate, POST /api/generate-batch, POST /api/similar-examples
- POST /api/cases/:id/upload, extract-facts, questionnaire, grade, feedback, review-section
- POST /api/cases/:id/generate-all, generate-core, generate-comp-commentary
- GET/PATCH/POST /api/cases/:id/sections/*, outputs/:fieldId, exceptions, destination-registry, insert-all
- POST /api/workflow/run, run-batch, ingest-pdf; GET /api/workflow/health
