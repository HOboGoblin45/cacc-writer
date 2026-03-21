# Changelog

## 2026-03-21

### Backend hardening
- Removed `dotenv.config({ override: true })` from `cacc-writer-server.js` and `server/openaiClient.js` so runtime and harness environment variables can override `.env` safely.
- Added `server/utils/errorResponse.js` and routed sanitized 500 responses through the highest-traffic API modules, keeping internal error text out of production responses.
- Switched upload middleware in `server/utils/middleware.js` from in-memory multer storage to disk-backed temp storage.
- Added upload helpers to read temporary files from disk and clean them up after request processing.
- Updated upload flows in `server/api/documentRoutes.js`, `server/api/caseCompatRoutes.js`, `server/api/compsRoutes.js`, `server/api/intakeRoutes.js`, `server/api/memoryRoutes.js`, and `server/api/workflowRoutes.js` to process files from disk instead of `req.file.buffer`.
- Exported `CACC_APPRAISALS_ROOT` from `server/config/productionScope.js` and made it configurable with `process.env.CACC_APPRAISALS_ROOT`, with the prior workstation path retained as the fallback.
- Updated `server/api/intakeRoutes.js` to consume the shared `CACC_APPRAISALS_ROOT` config.

### Test and source fixes
- Fixed the pre-existing `promptBuilder` unit failures by removing the style-guide phrase collision with the facts block header in `prompts/style_guide_cresci.txt`.
- Fixed the pre-existing `fieldProfiles` unit failure by restoring fail-closed metadata for `offering_history`, `contract_analysis`, `sales_comparison_commentary`, and `reconciliation` in `desktop_agent/field_maps/1004.json`.
- Improved `desktop_agent/agent_core.py` field-map loading so grouped field-map JSON structures are flattened into usable field definitions.

### Desktop and startup updates
- Updated `start-all.bat` to launch the residential ACI agent with `C:\Python313-32\python.exe`.
- Updated `start-all.bat` to start `desktop_agent\agent_v3.py` instead of `desktop_agent\agent.py`.
- Left the existing Real Quantum agent and Node server startup commands intact.

### Branding and packaging
- Renamed the package from `cacc-writer` to `appraisal-agent` and bumped the version to `3.0.0` in `package.json` and `package-lock.json`.
- Updated UI branding from `CACC Writer` to `Appraisal Agent` in `index.html`.
- Updated the frontend runtime title in `app.js` and tuned the brand-mark styling in `styles.css` for the new initials.
- Preserved `Cresci Appraisal & Consulting` as the company name.

### Frontend rebuild documentation
- Documented the current session as the stabilization and commercialization pass on top of the newly rebuilt professional SaaS UI.
- Captured the backend audit follow-through work, branding pass, startup changes, and regression fixes in this changelog for handoff/reference.

### Validation
- Ran `npm run test:unit` → `304 passed, 0 failed`.
- Ran `npm run typecheck` → passed.
