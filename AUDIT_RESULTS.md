# Backend Audit Results

## Scope

- Audited all `214` JavaScript files under `server/`.
- Used a full-file scripted pass for pattern discovery, then manually reviewed the high-risk modules and route hotspots.
- Focus areas: error handling, auth, backup integrity, file-system safety, SQL safety, and high-impact reliability/performance issues.

## Fixed Critical / High Issues

### 1. Unhandled async route failures in Express 4
- **Severity:** High
- **Risk:** Many `async` route handlers in `server/api/` could reject without reaching Express error handling, causing hung requests, inconsistent responses, or process-level unhandled rejection behavior.
- **Fix:** Added a router-level async wrapper patch and a centralized JSON error handler.
- **Files:** `server/utils/patchExpressAsync.js`, `cacc-writer-server.js`

### 2. Auth misconfiguration silently bypassed protection
- **Severity:** High
- **Risk:** When `CACC_AUTH_ENABLED=true` but `CACC_API_KEY` was missing, requests were allowed through instead of failing closed.
- **Fix:** Changed auth middleware to return `503 AUTH_MISCONFIGURED` instead of bypassing authentication.
- **Files:** `server/middleware/authMiddleware.js`

### 3. Backup creation could produce inconsistent / partial SQLite backups
- **Severity:** High
- **Risk:** `server/security/backupRestoreService.js` started `better-sqlite3` backup asynchronously without awaiting it, then immediately fell back to a raw file copy. `server/api/operationsRoutes.js` also performed raw `.db` file copies directly. Both patterns are unsafe for live SQLite/WAL databases.
- **Fix:** Switched backup creation to an awaited SQLite backup path, removed silent promise swallowing, cleaned up partial files on failure, and routed operations backups through the backup service.
- **Files:** `server/security/backupRestoreService.js`, `server/api/securityRoutes.js`, `server/api/operationsRoutes.js`

### 4. XML intake allowed path traversal / arbitrary write via embedded PDF export
- **Severity:** Critical
- **Risk:** `formTypeCode` and `appraiserFileId` / XML-derived filenames flowed into filesystem paths without containment checks. A crafted XML could influence output paths outside the intended `voice_pdfs` tree.
- **Fix:** Sanitized path segments, corrected project-root resolution for `voice_pdfs`, and added a destination-directory containment guard before writing extracted PDFs.
- **Files:** `server/api/intakeRoutes.js`, `server/intake/xmlParser.js`

### 5. Job-folder scan endpoint exposed arbitrary local directory enumeration
- **Severity:** High
- **Risk:** `/api/intake/scan-job-folder` accepted arbitrary absolute paths and returned file listings, allowing filesystem discovery outside the intended intake area.
- **Fix:** Restricted scans to folders inside the configured CACC intake root.
- **Files:** `server/api/intakeRoutes.js`

## Medium / Low Findings Not Patched

### 6. `.env` override behavior reduces testability and runtime override control
- **Severity:** Medium
- **Detail:** `dotenv.config({ override: true })` in startup/client modules can override harness-provided env vars, which interfered with the integration harness when it tried to launch on a non-default port.
- **Files:** `cacc-writer-server.js`, `server/openaiClient.js`

### 7. Several 500 paths still expose raw internal error text
- **Severity:** Medium
- **Detail:** The new global async error middleware now sanitizes unhandled failures, but many synchronous route handlers still return `err.message` directly on 500 responses.
- **Recommendation:** Normalize all 500 responses through a shared responder/helper.

### 8. Large in-memory uploads can spike RAM
- **Severity:** Medium
- **Detail:** `multer.memoryStorage()` plus large PDF/XML/image payloads can cause avoidable memory pressure.
- **Recommendation:** Stream to temp files or use disk-backed storage for large ingest flows.
- **Files:** `server/utils/middleware.js`, intake/document upload routes

### 9. Hard-coded intake root path reduces portability
- **Severity:** Low
- **Detail:** `CACC_APPRAISALS_ROOT` is hard-coded to a workstation-specific path.
- **Recommendation:** Move to env/config with startup validation.
- **Files:** `server/api/intakeRoutes.js`

### 10. Dynamic SQL is mostly allowlisted but scattered
- **Severity:** Low
- **Detail:** Multiple services build `WHERE` / `SET` clauses dynamically. Current reviewed call sites appear allowlist-backed, but the pattern is repeated enough that future regressions are likely.
- **Recommendation:** Centralize dynamic SQL fragment construction helpers and table/column allowlists.

## Validation

- `npm run typecheck` ✅
- `npm run test:unit` ⚠️ `300 passed, 4 failed`
- Remaining failing suites were pre-existing and unrelated to the audit fixes:
  - `tests/unit/promptBuilder.test.mjs`
  - `tests/unit/fieldProfiles.test.mjs`
- Focused regression checks added/passed for:
  - `tests/unit/authMiddleware.test.mjs`
  - `tests/unit/xmlParser.test.mjs`

## Audit Notes

- The audit covered the full `server/` JavaScript surface with scripted pattern scans (async routes, SQL interpolation, file-system writes, child processes, OpenAI usage) and manual review of the highest-risk modules.
- I fixed the issues that were both high-impact and safe to address surgically without broad architectural churn.
