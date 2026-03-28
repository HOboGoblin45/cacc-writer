# Next Conversion Example: comparableIntelligenceRepo

This document shows the exact pattern to follow when converting the next repository file.

## Current Status

**Target File:** `server/db/repositories/comparableIntelligenceRepo.js`
- Current: 57 sync DB patterns, MEDIUM complexity
- Patterns: 32x `.prepare()`, 24x `getDb()`
- Estimated effort: 4-6 hours

## Step 1: Analyze Current File

Read the current sync version:
```bash
# Get file size and pattern breakdown
wc -l server/db/repositories/comparableIntelligenceRepo.js  # ~721 lines
grep -c "\.prepare(" server/db/repositories/comparableIntelligenceRepo.js  # 32
grep -c "getDb(" server/db/repositories/comparableIntelligenceRepo.js  # 24
```

Identify function signatures:
```bash
grep "^export function" server/db/repositories/comparableIntelligenceRepo.js
```

This will show all exported functions that need async versions.

## Step 2: Create Async Version

Create `server/db/repositories/comparableIntelligenceRepoAsync.js`

**Template Structure:**
```javascript
/**
 * server/db/repositories/comparableIntelligenceRepoAsync.js
 * =========================================================
 * Async version of comparableIntelligenceRepo.
 *
 * Pair with: server/db/repositories/comparableIntelligenceRepo.js
 * Effort: 4-6 hours
 * Patterns: 57 (32 .prepare, 24 getDb)
 *
 * Usage:
 *   import * as compRepoAsync from './repositories/comparableIntelligenceRepoAsync.js';
 *   import { createAsyncRunner } from '../AsyncQueryRunner.js';
 *
 *   const runner = createAsyncRunner(db);
 *   const result = await compRepoAsync.getComparables(runner, caseId);
 */

import { v4 as uuidv4 } from 'uuid';
import { createAsyncRunner } from '../AsyncQueryRunner.js';
import log from '../../logger.js';

// Re-export constants from sync version
export {
  COMP_STATUS,
  ADJUSTMENT_TYPE,
  // ... other constants
} from './comparableIntelligenceRepo.js';

import {
  COMP_STATUS,
  ADJUSTMENT_TYPE,
  // ... other constants
} from './comparableIntelligenceRepo.js';

/**
 * Get all comparables for a case.
 *
 * @async
 * @param {Object} runner - AsyncQueryRunner or database object
 * @param {string} caseId
 * @returns {Promise<Array<Object>>}
 */
export async function getComparables(runner, caseId) {
  if (!runner) throw new Error('getComparables: runner is required');
  const sqlRunner = createAsyncRunner(runner);

  return await sqlRunner.all(`
    SELECT * FROM comp_candidates
    WHERE case_id = ?
    ORDER BY created_at DESC
  `, [caseId]);
}

/**
 * Create a comparable candidate.
 *
 * @async
 * @param {Object} runner
 * @param {Object} params
 * @returns {Promise<string>} ID of created record
 */
export async function createComparable(runner, params) {
  if (!runner) throw new Error('createComparable: runner is required');
  const sqlRunner = createAsyncRunner(runner);

  const id = uuidv4();
  await sqlRunner.run(`
    INSERT INTO comp_candidates (id, case_id, ...)
    VALUES (?, ?, ...)
  `, [id, params.caseId, ...]);

  return id;
}

// ... convert all remaining functions
```

## Step 3: Conversion Checklist

For each function in sync version:

- [ ] Read function signature (e.g., `export function getFoo(db, param1, param2)`)
- [ ] Add JSDoc comment with `@async` tag
- [ ] Make function `async`
- [ ] First parameter becomes `runner` (was implicit `getDb()`)
- [ ] Create `sqlRunner = createAsyncRunner(runner)` at start
- [ ] Replace `getDb().prepare(sql).get(...)` with `await sqlRunner.get(sql, [...])`
- [ ] Replace `getDb().prepare(sql).all(...)` with `await sqlRunner.all(sql, [...])`
- [ ] Replace `getDb().prepare(sql).run(...)` with `await sqlRunner.run(sql, [...])`
- [ ] Update parameter binding: `.run(a, b)` → `sqlRunner.run(sql, [a, b])`
- [ ] Add null checks at start: `if (!runner) throw new Error(...)`
- [ ] Test function compiles with `node -c`

## Step 4: Testing

Create test file: `tests/vitest/comparableIntelligenceRepo.test.mjs`

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import * as compRepoAsync from '../../server/db/repositories/comparableIntelligenceRepoAsync.js';
import { createAsyncRunner } from '../../server/db/AsyncQueryRunner.js';

// Mock database
class MockDb {
  prepare(sql) {
    return {
      get: () => ({ id: 'mock-1' }),
      all: () => [{ id: 'mock-1' }, { id: 'mock-2' }],
      run: () => ({ changes: 1, lastInsertRowid: 1 })
    };
  }
}

describe('comparableIntelligenceRepoAsync', () => {
  let runner;

  beforeEach(() => {
    runner = createAsyncRunner(new MockDb());
  });

  it('should get comparables for a case', async () => {
    const comps = await compRepoAsync.getComparables(runner, 'case-123');
    expect(Array.isArray(comps)).toBe(true);
    expect(comps.length).toBe(2);
  });

  it('should create comparable', async () => {
    const id = await compRepoAsync.createComparable(runner, {
      caseId: 'case-123',
      // ... other params
    });
    expect(id).toBeDefined();
  });

  // Test all exported functions
});
```

Run tests:
```bash
npm test -- comparableIntelligenceRepo.test.mjs
```

## Step 5: Update Callers

Find where `comparableIntelligenceRepo` is used:
```bash
grep -r "comparableIntelligenceRepo" server/ --include="*.js" | head -20
```

Update each caller to use async version:

**Before:**
```javascript
import * as compRepo from './db/repositories/comparableIntelligenceRepo.js';

router.get('/comparables/:caseId', (req, res) => {
  const comps = compRepo.getComparables(req.params.caseId);
  res.json(comps);
});
```

**After:**
```javascript
import * as compRepoAsync from './db/repositories/comparableIntelligenceRepoAsync.js';
import { createAsyncRunner } from './db/AsyncQueryRunner.js';
import { getDb } from './db/database.js';

router.get('/comparables/:caseId', async (req, res) => {
  try {
    const runner = createAsyncRunner(getDb());
    const comps = await compRepoAsync.getComparables(runner, req.params.caseId);
    res.json(comps);
  } catch (err) {
    log.error('GET /comparables error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});
```

**Key changes:**
- Route handler becomes `async`
- Create `runner` from `getDb()`
- Pass `runner` to repo function
- Add `await` for async call
- Wrap in try/catch

## Step 6: Validation

1. **Syntax check:**
   ```bash
   node -c server/db/repositories/comparableIntelligenceRepoAsync.js
   ```

2. **Test execution:**
   ```bash
   npm test -- comparableIntelligenceRepo.test.mjs
   ```

3. **Route testing:**
   ```bash
   # Manual test with curl or Postman
   curl http://localhost:5178/api/comparables/case-123
   ```

4. **Integration test:**
   - Full workflow with case creation → comparable assignment → retrieval
   - Verify database state

## Step 7: Documentation

Update repo's JSDoc:
```javascript
/**
 * Create a comparable for a case.
 *
 * This is the async version. The sync version (comparableIntelligenceRepo.js)
 * is deprecated but still available for backward compatibility.
 *
 * @async
 * @param {AsyncQueryRunner|BetterSqlite3.Database} runner
 * @param {Object} params
 * @param {string} params.caseId
 * @returns {Promise<string>} ID of created comparable
 *
 * @example
 *   const runner = createAsyncRunner(getDb());
 *   const compId = await createComparable(runner, { caseId: '123' });
 */
export async function createComparable(runner, params) {
  // implementation
}
```

## Step 8: Code Review Checklist

Before declaring done:

- [ ] All functions converted (count matches sync version)
- [ ] All constants re-exported
- [ ] All functions have `@async` JSDoc
- [ ] All functions take `runner` as first parameter
- [ ] No `getDb()` calls in async version
- [ ] All queries use `sqlRunner`
- [ ] Null checks on runner parameter
- [ ] Parameter binding uses array form
- [ ] Syntax check passes: `node -c`
- [ ] All tests pass: `npm test`
- [ ] All callers updated to use async version
- [ ] Error handling in place (try/catch)
- [ ] Routes converted to async handlers
- [ ] Integration tests pass
- [ ] No regressions in existing tests

## Step 9: Commit & Cleanup

```bash
# Commit the new async version
git add server/db/repositories/comparableIntelligenceRepoAsync.js
git add tests/vitest/comparableIntelligenceRepo.test.mjs
git commit -m "feat: add async version of comparableIntelligenceRepo

- Implement generationRepoAsync pattern
- All 15 functions converted to async
- Compatible with both sync and async databases
- 30+ tests covering all operations
- Routes updated to use async version

Effort: 5 hours
Patterns converted: 57 (32 .prepare, 24 getDb)
"

# Keep sync version for now (fallback)
# Remove after all callers confirmed migrated
```

## Expected Results

After completion of comparableIntelligenceRepo conversion:

- ✅ `comparableIntelligenceRepoAsync.js` created (22-25 KB)
- ✅ Test file created (15-20 KB)
- ✅ All routes updated to async
- ✅ All tests passing
- ✅ Zero regressions
- ✅ ~5 hours invested

## Quick Command Reference

```bash
# Analyze file
grep -c "\.prepare\|getDb\|dbRun\|dbAll\|dbGet" server/db/repositories/comparableIntelligenceRepo.js

# Syntax check
node -c server/db/repositories/comparableIntelligenceRepoAsync.js

# Run tests
npm test -- comparableIntelligence.test.mjs

# Find callers
grep -r "comparableIntelligenceRepo" server/ --include="*.js"

# Quick diff (before/after comparison)
diff -u <(grep "^export function" server/db/repositories/comparableIntelligenceRepo.js) \
        <(grep "^export async function" server/db/repositories/comparableIntelligenceRepoAsync.js)
```

## Success Criteria

- [ ] Async version complete and tested
- [ ] All callers updated and working
- [ ] No performance regression
- [ ] All tests green
- [ ] Code review passed
- [ ] Committed with clear message

Once this is done, move to the next file on the audit list!
