# Database Repositories Migration Guide

This directory contains database access layer repositories that mediate between the application and the database. We are migrating from synchronous better-sqlite3 to an async `DatabaseAdapter` pattern for database-agnostic operations.

## Migration Status

- **Phase 1-3 Repositories**: Currently use sync better-sqlite3 (being migrated)
- **Phase 20 Repositories**: Now use async DatabaseAdapter (newer pattern)
  - `autoTuneRepo.js` ✓ Converted
  - `voiceEmbeddingRepo.js` ✓ Converted
  - `stmRepo.js` ✓ Converted

## Old Pattern (Sync, better-sqlite3)

All functions take a `db` parameter (better-sqlite3 Database instance):

```javascript
import { getDb } from '../database.js';

export function getCase(db, caseId) {
  return db.prepare('SELECT * FROM cases WHERE id = ?').get(caseId);
}

export function createCase(db, caseData) {
  const result = db.prepare('INSERT INTO cases (name) VALUES (?)').run(caseData.name);
  return result.lastInsertRowid;
}

// Usage
const db = getDb();
const caseRecord = getCase(db, '123');
```

### Characteristics
- **Synchronous** — blocking database calls
- **Sync parameters**: `?.get(p1, p2)`, `?.run(p1, p2)`, `?.all(p1, p2)`
- **Not database-agnostic** — SQLite-specific patterns
- **Immediate returns** — no async/await needed

## New Pattern (Async, DatabaseAdapter)

All functions take an `adapter` parameter (DatabaseAdapter instance):

```javascript
export async function getCase(adapter, caseId) {
  return adapter.get(
    'SELECT * FROM cases WHERE id = ?',
    [caseId]
  );
}

export async function createCase(adapter, caseData) {
  const result = await adapter.run(
    'INSERT INTO cases (name) VALUES (?)',
    [caseData.name]
  );
  return result.lastInsertRowid;
}

// Usage
const adapter = await getAdapter();
const caseRecord = await getCase(adapter, '123');
```

### Characteristics
- **Async** — all functions return Promises
- **Async parameters**: `await adapter.get(sql, [p1, p2])`, `await adapter.run(...)`, `await adapter.all(...)`
- **Database-agnostic** — works with SQLite or PostgreSQL
- **Parameter arrays** — `[param1, param2]` instead of positional args

## Converting a Repository

### Step 1: Update the File Header
Change from:
```javascript
/**
 * All functions are synchronous (better-sqlite3).
 * Functions take db as first parameter for tenant isolation.
 */
```

To:
```javascript
/**
 * All functions are async and use DatabaseAdapter for database-agnostic operations.
 * Functions take adapter as first parameter for tenant isolation.
 */
```

### Step 2: Convert Each Function

**Before:**
```javascript
/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @returns {Object|null}
 */
export function getItem(db, id) {
  if (!db) throw new Error('db is required');

  const statement = db.prepare(`
    SELECT * FROM items WHERE id = ?
  `);

  try {
    return statement.get(id);
  } catch (err) {
    log.error(`Error fetching item: ${err.message}`);
    throw err;
  }
}
```

**After:**
```javascript
/**
 * @async
 * @param {DatabaseAdapter} adapter
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export async function getItem(adapter, id) {
  if (!adapter) throw new Error('adapter is required');

  const sql = `SELECT * FROM items WHERE id = ?`;

  try {
    return await adapter.get(sql, [id]);
  } catch (err) {
    log.error(`Error fetching item: ${err.message}`);
    throw err;
  }
}
```

### Key Changes

1. **Function signature**:
   - `export function` → `export async function`
   - `(db, ...)` → `(adapter, ...)`

2. **Parameter checking**:
   - `if (!db)` → `if (!adapter)`
   - Error message: `db is required` → `adapter is required`

3. **JSDoc**:
   - Add `@async` tag
   - Parameter: `{import('better-sqlite3').Database} db` → `{DatabaseAdapter} adapter`
   - Return type: `{Object}` → `{Promise<Object>}`

4. **SQL execution**:
   - Store SQL in a const: `const sql = '...'`
   - Replace `db.prepare(sql).run(...)` → `await adapter.run(sql, [...params])`
   - Replace `db.prepare(sql).get(...)` → `await adapter.get(sql, [...params])`
   - Replace `db.prepare(sql).all(...)` → `await adapter.all(sql, [...params])`

5. **Parameter passing**:
   - `statement.get(p1, p2, p3)` → `adapter.get(sql, [p1, p2, p3])`
   - Positional args → Array of params

6. **Transactions**:
   - Old: `db.transaction(() => { ... })()`
   - New: `await adapter.transaction(async () => { ... })`

## DatabaseAdapter Methods

### Queries

```javascript
// SELECT returning all rows
const rows = await adapter.all(sql, [param1, param2]);

// SELECT returning first row (null if not found)
const row = await adapter.get(sql, [param1]);

// INSERT/UPDATE/DELETE
const result = await adapter.run(sql, [param1, param2]);
// result = { changes: number, lastInsertRowid: number|null }

// Execute DDL (CREATE TABLE, ALTER TABLE, etc.)
await adapter.exec(sql);

// Check if table exists
const exists = await adapter.tableExists('table_name');

// PRAGMA statement (SQLite-specific)
const value = await adapter.pragma('journal_mode');
```

### Transactions

```javascript
// Using transaction() method
const result = await adapter.transaction(async () => {
  await adapter.run('INSERT INTO...', [params1]);
  await adapter.run('INSERT INTO...', [params2]);
  return { success: true };
});

// Using explicit BEGIN/COMMIT/ROLLBACK
await adapter.beginTransaction();
try {
  await adapter.run('INSERT INTO...', [params1]);
  await adapter.run('INSERT INTO...', [params2]);
  await adapter.commit();
} catch (err) {
  await adapter.rollback();
  throw err;
}
```

## Backward Compatibility

During the migration period, old synchronous code can still work using the compatibility shim:

```javascript
import { getAdapterSync } from '../database.js';

// Old-style code
const db = getAdapterSync();
const row = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
```

However, **new code should use async adapters** for better database support and future-proofing.

## Common Patterns

### Mapping rows to camelCase objects

```javascript
export async function getAllItems(adapter) {
  const rows = await adapter.all('SELECT * FROM items');
  return rows.map(row => ({
    id: row.id,
    itemName: row.item_name,          // snake_case → camelCase
    description: row.description,
    createdAt: row.created_at,
  }));
}
```

### Handling optional fields

```javascript
export async function getItemById(adapter, id) {
  const row = await adapter.get('SELECT * FROM items WHERE id = ?', [id]);
  if (!row) return null;  // Important: adapter.get() returns null if not found

  return {
    id: row.id,
    name: row.name,
    tags: parseJSON(row.tags_json, []),  // Custom parsing
  };
}
```

### Using helper functions for common operations

```javascript
function parseJSON(val, fallback = {}) {
  if (!val) return fallback;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

export async function getItemWithTags(adapter, id) {
  const row = await adapter.get('SELECT * FROM items WHERE id = ?', [id]);
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    tags: parseJSON(row.tags_json),  // Using helper
  };
}
```

## Testing

New async repositories require async test patterns:

```javascript
import { test, expect, beforeAll, afterAll } from 'vitest';
import { stmRepo } from '../stmRepo.js';
import { SQLiteAdapter } from '../../adapters/SQLiteAdapter.js';

let adapter;

beforeAll(async () => {
  adapter = new SQLiteAdapter();
  await adapter.connect({ filename: ':memory:' });
  // Initialize schema...
});

afterAll(async () => {
  await adapter.disconnect();
});

test('logNormalization should insert a record', async () => {
  const id = await stmRepo.logNormalization(adapter, {
    sectionId: 'test-1',
    formType: '1004',
    originalLength: 100,
    cleanedLength: 80,
    userId: 'user-123',
  });

  expect(id).toBeGreaterThan(0);

  const logs = await stmRepo.getRecentLogs(adapter, 'user-123');
  expect(logs).toHaveLength(1);
  expect(logs[0].sectionId).toBe('test-1');
});
```

## Progress Tracking

- [x] Phase 20: autoTuneRepo (converted)
- [x] Phase 20: voiceEmbeddingRepo (converted)
- [x] Phase 20: stmRepo (converted)
- [ ] Phase 19, 18, ... (pending)
- [ ] Phase 1-3 (pending — largest migration)

## Questions?

When converting a repository:
1. Check if there are similar patterns in already-converted repos (autoTuneRepo, voiceEmbeddingRepo, stmRepo)
2. Ensure all parameter passing uses arrays: `adapter.run(sql, [p1, p2, p3])`
3. Mark functions as `@async` in JSDoc
4. Test with both SQLite (in-memory) and validate PostgreSQL compatibility
5. Update this README if you find new patterns or edge cases

