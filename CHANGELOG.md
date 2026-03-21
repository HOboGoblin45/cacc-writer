# Changelog

## 2026-03-21 — v3.1.0

### Frontend polish & UX excellence
- Added command palette (Ctrl+K) with fuzzy search across all app commands
- Added keyboard shortcuts: Ctrl+S (save facts), Ctrl+Shift+G (generate), Ctrl+Enter (insert), Alt+1-5 (navigate steps)
- Added page transition animations (fade+slide on step changes)
- Added micro-interactions: hero card hover glow, section card hover effects
- Added skeleton loader utility class for future loading states
- Added subtle noise texture overlay for depth
- Added pulse animation for live generation indicator
- Added custom scrollbar styling (thin, semi-transparent)
- Added focus-visible ring for keyboard accessibility
- Added SVG favicon with AA brand mark
- Connected Google Fonts (Inter) for consistent typography rendering
- Added auto-refresh polling (8s) to detect new generated content
- Added shortcut hint pill in topbar linking to command palette
- Version bumped to 3.1.0

### Test fixes & verification
- Fixed 4 failing Phase 3 tests (disk-write vs API-write mismatch for outputs)
- Fixed 3 failing scope enforcement tests (activeScope vs activeForms array check)
- Fixed SyntaxError in compsRoutes.js (await in non-async function)
- Wired insertion pipeline to real run engine (was calling non-existent functions)
- All test suites green: 308 unit, 147 integration, 70 Phase 3, 37 Phase 2, 22 missing facts, 17 scope
- Installed vitest as devDependency, restored custom runner as primary test:unit

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
- Updated UI branding from `Appraisal Agent` to `Appraisal Agent` in `index.html`.
- Updated the frontend runtime title in `app.js` and tuned the brand-mark styling in `styles.css` for the new initials.
- Preserved `Cresci Appraisal & Consulting` as the company name.

### Frontend rebuild documentation
- Documented the current session as the stabilization and commercialization pass on top of the newly rebuilt professional SaaS UI.
- Captured the backend audit follow-through work, branding pass, startup changes, and regression fixes in this changelog for handoff/reference.

### Validation
- Ran `npm run test:unit` â†’ `304 passed, 0 failed`.
- Ran `npm run typecheck` â†’ passed.

