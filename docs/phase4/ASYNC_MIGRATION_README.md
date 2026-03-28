# Async Database Migration Infrastructure

Complete infrastructure for gradual conversion from sync to async database patterns.

## Quick Start

### 1. Audit Current Usage
See which files use sync DB patterns and effort estimates:
```bash
node scripts/audit_sync_repos.mjs
```

### 2. Run Tests
Verify infrastructure works correctly:
```bash
npm test -- asyncConversion.test.mjs
```

### 3. Use in New Code
For new async-first features:
```javascript
import { createAsyncRunner } from './db/AsyncQueryRunner.js';
import * as genRepoAsync from './db/repositories/generationRepoAsync.js';

const runner = createAsyncRunner(db);
const run = await genRepoAsync.createRun(runner, {...});
```

### 4. Migrate Existing Code
For existing sync repos:
```javascript
import { wrapRepoAsync } from './db/AsyncRepoWrapper.js';
import * as syncRepo from './repositories/caseRecordRepo.js';

const asyncRepo = wrapRepoAsync(syncRepo);
const caseRecord = await asyncRepo.getCaseById(runner, caseId);
```

## Files

### Core Infrastructure
- **AsyncQueryRunner.js** - Unified async query interface (5.6 KB)
- **AsyncRepoWrapper.js** - Function wrapping utilities (4.1 KB)
- **migrationHelpers.js** - Detection & conversion helpers (8.0 KB)

### Reference Implementation
- **generationRepoAsync.js** - Async version of generationRepo (22 KB)
  - All 20+ functions converted to async
  - Takes `runner` as first parameter
  - Re-exports constants (RUN_STATUS, JOB_STATUS)

### Testing & Auditing
- **tests/vitest/asyncConversion.test.mjs** - Comprehensive test suite (14 KB)
  - 30+ tests covering all infrastructure
  - Mock sync DB and async adapter
  - Integration tests

- **scripts/audit_sync_repos.mjs** - Codebase analyzer (8.2 KB)
  - Identifies 160 files with sync DB usage
  - Classifies complexity
  - Estimates effort per file
  - Outputs JSON report

### Documentation
- **ASYNC_CONVERSION_GUIDE.md** - Full migration guide
- **ASYNC_MIGRATION_README.md** - This file

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Express Routes                          │
│                   (Async handlers)                          │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│         Orchestrator / Service Layer                        │
│              (Async functions)                              │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│      AsyncQueryRunner ◄─────────────────────────────────────┤
│  (Unified Async Interface)                                  │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
┌───────▼──────┐ ┌────▼──────┐ ┌────▼──────┐
│  generationRepoAsync  │  memoryRepoAsync  │  brainRepoAsync  │
│  (Async Repos)        │  (Async Repos)    │  (Async Repos)   │
└───────┬──────┘ └────┬──────┘ └────┬──────┘
        │             │             │
        └─────────────┼─────────────┘
                      │
        ┌─────────────┴──────────────┐
        │                            │
    ┌───▼────┐            ┌────────▼──┐
    │ SQLite │            │ PostgreSQL │
    │  (sync │            │  (async    │
    │ better │            │  adapter)  │
    │sqlite3)│            │            │
    └────────┘            └────────────┘
```

## Key Concepts

### AsyncQueryRunner
Wraps both sync databases and async adapters in a consistent interface.

```javascript
// Works with either source type
const runner = createAsyncRunner(dbOrAdapter);
const rows = await runner.all(sql, params);
```

**Supported Methods:**
- `run(sql, params)` - INSERT/UPDATE/DELETE
- `get(sql, params)` - Single row
- `all(sql, params)` - Multiple rows
- `exec(sql)` - DDL statements
- `transaction(fn)` - Transaction handling
- `getDialect()` - 'sqlite' or 'postgresql'

### Async Repositories
Convert sync repository functions to async:

```javascript
// Before (sync)
export function createRun({ runId, caseId, formType }) {
  getDb().prepare(`INSERT INTO ...`).run(...);
}

// After (async)
export async function createRun(runner, { runId, caseId, formType }) {
  const sqlRunner = createAsyncRunner(runner);
  await sqlRunner.run(`INSERT INTO ...`, [...]);
}
```

**Pattern:**
- First parameter is `runner` (db or adapter)
- All functions are `async`
- Use `createAsyncRunner(runner)` to wrap
- Parameters in array form for consistent binding

### Migration Helpers
Detect source type and create flexible functions:

```javascript
import { isAsyncAdapter, makeAsyncQuery } from './db/migrationHelpers.js';

if (isAsyncAdapter(db)) {
  // PostgreSQL path
  const rows = await db.all(sql, params);
} else {
  // SQLite path
  const rows = await makeAsyncQuery(db, sql, params);
}
```

## Migration Path

### Current State
- 160 files use sync database patterns
- 1,809 total pattern occurrences
- ~490 story points of effort

### Recommended Order
1. **Core repositories** (5 files, ~4 hrs each)
   - generationRepo ✅ (done: generationRepoAsync.js)
   - comparableIntelligenceRepo
   - memoryRepo
   - brainRepo
   - caseRecordRepo

2. **Orchestrator & Services** (10 files, ~3 hrs each)
   - generationOrchestrator
   - sectionJobRunner
   - Service layer files

3. **Routes & API** (80+ files, ~1-2 hrs each)
   - Express route handlers
   - API responses

4. **Other Files** (50+ files, varying)
   - Utilities, helpers, specialized services

### Timeline
- **Phase 2 (Repos):** 2-3 weeks
- **Phase 3 (Orchestrator):** 1 week
- **Phase 4 (Routes):** 2-3 weeks
- **Phase 5 (Cleanup):** 1-2 weeks
- **Total:** ~6-9 weeks

## Testing

### Unit Tests
```bash
npm test -- asyncConversion.test.mjs
```

Covers:
- AsyncQueryRunner with sync & async sources
- CRUD operations
- Transactions
- Error handling
- Migration helpers
- Dual-mode functions

### Integration Tests
Add tests for each converted repo in existing test suites.

### End-to-End Tests
Run full workflows (report generation, etc.) with async code.

## Performance

- **Overhead:** Minimal (<1ms per query)
- **Better-sqlite3:** Synchronous path, no event loop
- **PostgreSQL:** True async, scales better under load

## Status

✅ **Phase 1 Complete:**
- AsyncQueryRunner implemented
- AsyncRepoWrapper implemented
- Migration helpers implemented
- generationRepoAsync reference implementation
- Test suite (30+ tests)
- Audit script
- Documentation

🔄 **Phase 2 Ready to Start:**
- All infrastructure in place
- Audit identifies priority files
- Reference implementation shows pattern
- Tests verify correctness

## FAQ

**Q: Can I use this with existing sync code?**
A: Yes. Create AsyncQueryRunner from existing sync db, call async functions.

**Q: What about existing transactions?**
A: `runner.transaction(fn)` works with both sync and async.

**Q: Do I need to convert everything?**
A: No. Gradual conversion. Sync and async can coexist.

**Q: When should I use PostgreSQL?**
A: After async conversion is complete (no tight coupling to SQLite then).

**Q: How do I debug async code?**
A: Use try/catch, log errors, inspect promises in debugger.

**Q: What about rate limiting?**
A: Infrastructure agnostic. Implement at route or service layer.

## Next Steps

1. Run audit: `node scripts/audit_sync_repos.mjs`
2. Review ASYNC_CONVERSION_GUIDE.md for detailed strategy
3. Pick first repository to convert (comparableIntelligenceRepo recommended)
4. Follow generationRepoAsync.js pattern
5. Add tests to asyncConversion.test.mjs
6. Update routes to use async runner
7. Repeat for remaining files

## Files Summary

| File | Size | Purpose |
|------|------|---------|
| AsyncQueryRunner.js | 5.6 KB | Unified async interface |
| AsyncRepoWrapper.js | 4.1 KB | Function wrapping utilities |
| migrationHelpers.js | 8.0 KB | Detection & conversion helpers |
| generationRepoAsync.js | 22 KB | Reference async implementation |
| asyncConversion.test.mjs | 14 KB | Test suite (30+ tests) |
| audit_sync_repos.mjs | 8.2 KB | Codebase analyzer |
| ASYNC_CONVERSION_GUIDE.md | Full guide with patterns & examples |
| ASYNC_MIGRATION_README.md | This file |

**Total:** ~62 KB of new infrastructure

## Related Files

- `server/db/database.js` - Current sync database setup
- `server/db/adapters/DatabaseAdapter.js` - Abstract adapter interface
- `server/db/adapters/SQLiteAdapter.js` - Existing SQLite adapter
- `server/db/repositories/*.js` - 25+ repository files to convert
- `server/orchestrator/*.js` - Orchestrator to make async-ready
- `server/api/*.js` - 80+ route files to make async-ready
