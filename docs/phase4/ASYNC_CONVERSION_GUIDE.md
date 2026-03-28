# Async Database Conversion Guide

## Overview

This guide covers the gradual migration of CACC Writer from synchronous better-sqlite3 patterns to async-ready patterns that support both SQLite and PostgreSQL.

The conversion infrastructure enables a **non-breaking migration path** where:
1. New infrastructure coexists with existing sync code
2. Conversion happens file-by-file over time
3. Both sync and async code can run simultaneously
4. No forced rewrite of 173 files at once

## Architecture

### Infrastructure Files Created

#### 1. `server/db/AsyncQueryRunner.js`
Wraps database queries in a consistent async pattern.

**Features:**
- Works with both sync better-sqlite3 and async DatabaseAdapter
- Detects source type automatically via `getDialect()` method
- Provides unified interface: `run()`, `get()`, `all()`, `exec()`, `transaction()`
- Logging via error handler

**Usage:**
```javascript
import { createAsyncRunner } from './db/AsyncQueryRunner.js';
import { getDb } from './db/database.js';

// With sync database
const runner = createAsyncRunner(getDb());
const rows = await runner.all('SELECT * FROM cases WHERE status = ?', ['active']);

// With async adapter (future PostgreSQL)
const rows = await runner.all(sql, params);
```

#### 2. `server/db/AsyncRepoWrapper.js`
Higher-order functions to convert sync repositories to async.

**Provides:**
- `wrapRepoAsync(syncModule)` - Wraps all functions in a module
- `wrapFunctionAsync(syncFn)` - Wraps a single function
- `wrapRepoConditional(module, flag)` - Conditional wrapping for feature flags

**Usage:**
```javascript
import * as syncRepo from './repositories/caseRecordRepo.js';
import { wrapRepoAsync } from './db/AsyncRepoWrapper.js';

// Convert sync repo to async
const asyncRepo = wrapRepoAsync(syncRepo);

// Now awaitable
const caseRecord = await asyncRepo.getCaseById(runner, caseId);
```

#### 3. `server/db/migrationHelpers.js`
Utilities for the sync→async migration.

**Key functions:**
- `isAsyncAdapter(obj)` - Detect adapter vs sync db
- `isSyncDb(obj)` - Inverse of above
- `makeAsyncQuery()`, `makeAsyncGet()`, `makeAsyncRun()` - Flexible query makers
- `createDualModeFunction()` - Create functions that work with both sync/async
- `detectDialect()` - Get 'sqlite' or 'postgresql'
- `validateModuleFunctions()` - Verify required functions exist

**Usage:**
```javascript
import { isAsyncAdapter, makeAsyncQuery } from './db/migrationHelpers.js';

if (isAsyncAdapter(dbOrAdapter)) {
  // New async path
} else {
  // Old sync path
}

const rows = await makeAsyncQuery(db, sql, params);
```

#### 4. `server/db/repositories/generationRepoAsync.js`
Reference async implementation of `generationRepo.js`.

**Features:**
- All functions take `runner` as first parameter
- Async versions of every sync function
- Re-exports constants (RUN_STATUS, JOB_STATUS)
- Drop-in replacement pattern for gradual migration
- Both versions can coexist during conversion

**Usage:**
```javascript
import * as genRepoAsync from './repositories/generationRepoAsync.js';
import { createAsyncRunner } from './db/AsyncQueryRunner.js';

const runner = createAsyncRunner(db);
const runId = await genRepoAsync.createRun(runner, {
  runId: 'run-123',
  caseId: 'case-456',
  formType: '1004'
});
```

#### 5. `scripts/audit_sync_repos.mjs`
Analyzes codebase for sync DB patterns.

**Output:**
- Identifies all files with sync DB usage (160 files in current codebase)
- Classifies complexity (LOW/MEDIUM/HIGH)
- Estimates effort per file (1-5 scale)
- Generates JSON report to `audit-sync-repos.json`
- Recommends migration order

**Run:**
```bash
node scripts/audit_sync_repos.mjs
```

#### 6. `tests/vitest/asyncConversion.test.mjs`
Comprehensive test suite for migration infrastructure.

**Coverage:**
- AsyncQueryRunner with sync & async sources
- All query methods (run, get, all, exec, transaction)
- AsyncRepoWrapper function wrapping
- Migration helper detection & utilities
- Dual-mode function behavior
- Integration tests

**Run:**
```bash
npm test -- asyncConversion.test.mjs
```

## Migration Strategy

### Phase 1: Foundation (Done)
✅ Created AsyncQueryRunner for unified interface
✅ Created AsyncRepoWrapper for function wrapping
✅ Created migration helpers for detection & conversion
✅ Created generationRepoAsync as reference implementation
✅ Created test suite for infrastructure

### Phase 2: Gradual Repository Conversion (Next)
Plan to convert repositories in priority order:

**Priority 1 (Most-used):**
1. `server/db/repositories/generationRepo.js` (56 patterns) → **generationRepoAsync.js** ✅
2. `server/db/repositories/comparableIntelligenceRepo.js` (57 patterns)
3. `server/db/repositories/memoryRepo.js` (36 patterns)
4. `server/db/repositories/caseRecordRepo.js` (12 patterns)
5. `server/db/repositories/brainRepo.js` (22 patterns)

**Effort per repository:** 4-6 hours
**Timeline:** ~2-3 weeks for all 5 core repos

### Phase 3: Orchestrator & Service Conversion
Update orchestrator files to use async repos:
- `server/orchestrator/generationOrchestrator.js`
- `server/orchestrator/sectionJobRunner.js`
- Routes that call orchestrator

**Effort:** 8-12 hours
**Timeline:** 1 week

### Phase 4: Route & API Conversion
Update Express routes to be async-ready:
- ~80+ route files
- Most already use `async` handlers
- Update DB calls to use async runners

**Effort:** 40-60 hours
**Timeline:** 2-3 weeks

### Phase 5: Cleanup & Testing
- Remove sync repo versions after all callers converted
- Update test suite
- Performance testing
- PostgreSQL support validation

**Effort:** 20-30 hours
**Timeline:** 1-2 weeks

## Conversion Patterns

### Pattern 1: Wrap Individual Repository

**Before (Sync):**
```javascript
export function getCaseById(caseId) {
  return getDb().prepare(`
    SELECT * FROM cases WHERE id = ?
  `).get(caseId);
}
```

**After (Async):**
```javascript
export async function getCaseById(runner, caseId) {
  const sqlRunner = createAsyncRunner(runner);
  return await sqlRunner.get(`
    SELECT * FROM cases WHERE id = ?
  `, [caseId]);
}
```

**Key changes:**
- Function becomes `async`
- First parameter is `runner` (can be db or adapter)
- All queries go through `sqlRunner`
- SQL parameter array instead of spread

### Pattern 2: Wrap Route Handler

**Before (Sync):**
```javascript
router.get('/:caseId', (req, res) => {
  const caseRecord = getCaseById(req.params.caseId);
  res.json(caseRecord);
});
```

**After (Async):**
```javascript
router.get('/:caseId', async (req, res) => {
  try {
    const runner = createAsyncRunner(getDb());
    const caseRecord = await getCaseById(runner, req.params.caseId);
    res.json(caseRecord);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

**Key changes:**
- Handler becomes `async`
- Create runner in handler (or at middleware level)
- Pass runner to repo functions
- Wrap in try/catch for error handling

### Pattern 3: Wrap Service/Orchestrator

**Before (Sync):**
```javascript
function generateReport(caseId, formType) {
  const run = createRun({ runId, caseId, formType });
  const jobs = createSectionJobs(runId, sections);
  // ... more sync operations
  return results;
}
```

**After (Async):**
```javascript
async function generateReport(runner, caseId, formType) {
  const runId = uuidv4();
  await generationRepoAsync.createRun(runner, { runId, caseId, formType });
  const jobs = await Promise.all(
    sections.map(s => generationRepoAsync.createSectionJob(runner, {...}))
  );
  // ... more async operations
  return results;
}
```

**Key changes:**
- Function becomes `async`
- Pass runner through call chain
- All repo calls use await
- Consider Promise.all() for parallel operations

### Pattern 4: Dual-Mode Function (For Gradual Transition)

Use `createDualModeFunction` when you need to support both sync and async:

```javascript
const syncImpl = (db, caseId) => db.prepare('SELECT * FROM cases WHERE id = ?').get(caseId);

const asyncImpl = async (adapter, caseId) => {
  return await adapter.get('SELECT * FROM cases WHERE id = ?', [caseId]);
};

export const getCaseById = createDualModeFunction(syncImpl, asyncImpl, 'getCaseById');

// Works with both:
const case1 = getCaseById(syncDb, caseId);     // Sync result
const case2 = await getCaseById(asyncAdapter, caseId);  // Promise result
```

## Testing & Validation

### Run Infrastructure Tests
```bash
npm test -- asyncConversion.test.mjs
```

Tests cover:
- AsyncQueryRunner with sync & async sources ✅
- All CRUD operations
- Transaction handling
- Error handling
- Migration helper detection
- Integration scenarios

### Manual Testing Process

1. **Unit test the async repo:**
   ```javascript
   const runner = createAsyncRunner(getDb());
   const run = await genRepoAsync.createRun(runner, {...});
   expect(run).toBeDefined();
   ```

2. **Integration test with route:**
   ```javascript
   const response = await request(app).get('/api/cases/case-123');
   expect(response.status).toBe(200);
   ```

3. **End-to-end test with orchestrator:**
   - Full report generation
   - Section job execution
   - Result persistence

### PostgreSQL Compatibility

Once async conversion complete:

1. Create PostgreSQL adapter (if not done)
2. Test with both SQLite and PostgreSQL
3. Run same test suite against both
4. Verify performance characteristics

## Decision Points

### When to Use AsyncQueryRunner
✅ Wrapping database calls in services, orchestrator, or routes
✅ Creating new async-first code
✅ Adding PostgreSQL support

### When to Use AsyncRepoWrapper
✅ Quick wrapper for existing sync repo (temporary)
✅ Feature-flagging the async conversion
✅ Testing migration without full rewrite

### When to Use migrationHelpers
✅ Detecting source type (sync vs async)
✅ Creating flexible query functions
✅ Implementing dual-mode functions during transition
✅ Validating module completeness

## Troubleshooting

### "AsyncQueryRunner: not connected"
Error occurs when wrapping `null` or `undefined`.
```javascript
// Check before wrapping
const runner = createAsyncRunner(getDb()); // Must not be null
```

### "runner is required" errors in generationRepoAsync
The async version requires `runner` as first parameter (sync version uses implicit `getDb()`).
```javascript
// Correct
await genRepoAsync.createRun(runner, {...});

// Wrong
await genRepoAsync.createRun({runId, ...}); // Missing runner
```

### Tests failing with "SQL error"
Mock database may not implement full statement interface.
```javascript
// Ensure MockPreparedStatement has all methods
get(...) { ... }
all(...) { ... }
run(...) { ... }
```

### Performance issues with async wrappers
The wrapper adds minimal overhead (one function call). If you see slowdown:
1. Check if database is the bottleneck (use query logging)
2. Profile with `node --prof`
3. Consider pooling for PostgreSQL

## FAQ

**Q: Do I need to convert everything at once?**
A: No. The infrastructure allows gradual conversion. Convert high-priority files first.

**Q: Can sync and async code coexist?**
A: Yes. Both can run simultaneously. Plan careful transition points.

**Q: What about database transactions?**
A: `runner.transaction(fn)` handles both sync (via better-sqlite3 TX) and async (via adapter TX).

**Q: Will this support MongoDB later?**
A: Yes. Implement a MongoDB adapter extending DatabaseAdapter.

**Q: How do I handle errors in async code?**
A: Use try/catch in async functions, pass errors through promise chain.

**Q: When should I migrate to PostgreSQL?**
A: After async conversion is complete and tested. PostgreSQL adapter should already exist.

**Q: What about backward compatibility?**
A: Sync generationRepo stays available until all callers converted. Both versions coexist.

## References

- `server/db/AsyncQueryRunner.js` - Unified query interface
- `server/db/AsyncRepoWrapper.js` - Function wrapping utilities
- `server/db/migrationHelpers.js` - Detection & conversion helpers
- `server/db/repositories/generationRepoAsync.js` - Reference implementation
- `tests/vitest/asyncConversion.test.mjs` - Test suite
- `scripts/audit_sync_repos.mjs` - Migration auditor

## Contact & Questions

For questions about the async conversion:
1. Check tests in `asyncConversion.test.mjs`
2. Review reference implementation in `generationRepoAsync.js`
3. Read inline documentation in helper modules
4. Run audit script to identify next files to convert
