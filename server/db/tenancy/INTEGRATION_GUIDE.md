# Tenant Context Integration Guide

Quick reference for integrating the multi-tenancy system into existing CACC Writer code.

## 1. Enable Tenant Middleware in Express Server

**File:** `cacc-writer-server.js`

Add tenant middleware after authentication:

```javascript
import { requireAuth } from './server/middleware/authMiddleware.js';
import { tenantMiddleware } from './server/db/tenancy/tenantMiddleware.js';

// ... existing middleware ...

// Auth + Tenancy stack (order matters!)
app.use(requireAuth);        // Sets req.user from JWT
app.use(tenantMiddleware);   // Sets AsyncLocalStorage context

// All routes below this point have tenant context
app.use('/api/cases', casesRouter);
app.use('/api/generation', generationRouter);
// ... etc
```

## 2. Update Database Module (For PostgreSQL)

**File:** `server/db/database.js`

When switching to PostgreSQL, wrap adapter with TenantAwareAdapter:

```javascript
import { TenantAwareAdapter } from './tenancy/TenantAwareAdapter.js';

let _adapter = null;

export async function getDb() {
  if (_adapter) return _adapter;

  // Create base adapter (PostgreSQL or SQLite)
  const baseAdapter = createAdapter(); // Existing factory function

  // Wrap with tenant awareness
  _adapter = new TenantAwareAdapter(baseAdapter);
  await _adapter.initSchema();

  return _adapter;
}

export async function closeDb() {
  if (_adapter) {
    await _adapter.close();
    _adapter = null;
  }
}
```

## 3. Update Repository Functions (Gradual Migration)

**Pattern:** Add async/await and remove `userId` parameter (comes from context)

### Before (SQLite, synchronous)
```javascript
// server/db/repositories/caseRecordRepo.js
import { getUserDb } from '../userDatabase.js';

export function getCasesByUser(userId) {
  const db = getUserDb(userId);
  const sql = 'SELECT * FROM case_records WHERE user_id = ?';
  return db.prepare(sql).all([userId]);
}
```

### After (PostgreSQL, asynchronous)
```javascript
// server/db/repositories/caseRecordRepo.js
import { getDb } from '../database.js';
import { getCurrentTenantId } from '../tenancy/TenantContext.js';

export async function getCasesByUser() {
  const userId = getCurrentTenantId();
  const db = await getDb();
  const sql = 'SELECT * FROM cases WHERE id = $1'; // user_id enforced by RLS
  return await db.all(sql, [userId]);
}
```

### Transition (Using Bridge)
During migration, old code continues working:

```javascript
import { createUserDbBridge } from '../tenancy/UserDbBridge.js';

const db = createUserDbBridge(tenantAwareAdapter);

// Old sync code still works:
const stmt = db.prepare('SELECT * FROM cases WHERE id = ?');
const cases = stmt.all([caseId]);

// But should migrate to:
const adapter = db.getAdapter(); // Access async adapter
const cases = await adapter.all('SELECT * FROM cases WHERE id = $1', [caseId]);
```

## 4. Update Route Handlers

**Pattern:** Remove `userId` from function signatures, use context instead

### Before
```javascript
router.get('/cases/:caseId', async (req, res) => {
  const userId = req.user.userId;
  const caseId = req.params.caseId;

  const db = getUserDb(userId);
  const caseData = db.prepare('SELECT * FROM cases WHERE id = ?').get([caseId]);

  res.json(caseData);
});
```

### After
```javascript
import { runWithTenant, getCurrentTenantId } from '../db/tenancy/TenantContext.js';

router.get('/cases/:caseId', async (req, res) => {
  try {
    const caseId = req.params.caseId;
    const userId = getCurrentTenantId(); // From context (set by middleware)

    const db = await getDb(); // Returns TenantAwareAdapter
    const caseData = await db.get(
      'SELECT * FROM cases WHERE id = $1',
      [caseId]
    );

    if (!caseData) {
      return res.status(404).json({ error: 'Not found' });
    }

    res.json(caseData);
  } catch (err) {
    log.error('route:error', { path: req.path, error: err.message });
    res.status(500).json({ error: err.message });
  }
});
```

## 5. Service Functions (No User Parameter)

**Pattern:** Call `getCurrentTenantId()` inside service, not in route

### Before
```javascript
// route
const service = require('../services/caseService.js');
const cases = service.listCases(userId); // Pass userId

// service
function listCases(userId) {
  const db = getUserDb(userId);
  return db.prepare('SELECT * FROM cases').all();
}
```

### After
```javascript
// route
const { listCases } = require('../services/caseService.js');
const cases = await listCases(); // No userId parameter

// service
import { getCurrentTenantId } from '../db/tenancy/TenantContext.js';

export async function listCases() {
  const userId = getCurrentTenantId(); // Get from context
  const db = await getDb();
  return await db.all('SELECT * FROM cases', []);
  // RLS ensures only userId's cases returned
}
```

## 6. Testing With Tenant Context

Test function that needs tenant context:

```javascript
import { runWithTenant } from './tenancy/TenantContext.js';

describe('caseService', () => {
  it('should get cases for tenant', async () => {
    const cases = await runWithTenant('test-user-123', async () => {
      const { listCases } = require('../services/caseService.js');
      return await listCases();
    });

    expect(cases).toEqual([/* ... */]);
  });

  it('should throw if no tenant context', async () => {
    const { listCases } = require('../services/caseService.js');
    await expect(listCases()).rejects.toThrow('No tenant context');
  });
});
```

## 7. Public/Unauthenticated Routes

Routes that don't need authentication skip tenant context:

```javascript
// In express server, before tenantMiddleware
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/auth/login', async (req, res) => {
  // No tenant context here
  const user = await authService.login(req.body);
  res.json({ token: user.token });
});

// Tenant context starts here
app.use(requireAuth);
app.use(tenantMiddleware);

// These routes have tenant context
app.get('/api/cases', casesRoutes);
```

## 8. Cross-Tenant Operations (Admin Only)

**Pattern:** Use strict mode, explicit admin check

```javascript
import { requireTenantContext } from '../db/tenancy/tenantMiddleware.js';

// Require context, but allow admin to bypass
router.delete('/admin/user/:userId', async (req, res) => {
  const currentUser = getCurrentTenantId();
  const targetUser = req.params.userId;

  if (currentUser !== targetUser && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Admin can delete any user's data
  const db = await getDb();

  // NOTE: RLS still enforces isolation — admin needs special permissions
  // Or bypass RLS with SECURITY DEFINER functions in PostgreSQL

  await db.run('DELETE FROM cases WHERE user_id = ?', [targetUser]);
  res.json({ ok: true });
});
```

## 9. Transactions With Tenant Context

Transactions automatically inherit tenant context:

```javascript
import { getDb } from '../db/database.js';

export async function updateCaseWithSections(caseId, updates) {
  const db = await getDb();

  // Transaction inherits tenant context from parent scope
  return await db.transaction(async () => {
    // All queries within transaction are scoped to current tenant

    const case = await db.get(
      'UPDATE cases SET status = $1 WHERE id = $2 RETURNING *',
      [updates.status, caseId]
    );

    for (const section of updates.sections) {
      await db.run(
        'UPDATE sections SET content = $1 WHERE id = $2',
        [section.content, section.id]
      );
    }

    return case;
  });
}
```

## 10. Logging & Debugging

Add tenant context to logs:

```javascript
import log from '../logger.js';
import { getCurrentTenantId, hasTenantContext } from '../db/tenancy/TenantContext.js';

export async function importantOperation() {
  const context = {
    userId: hasTenantContext() ? getCurrentTenantId() : 'unknown',
    operation: 'import_case',
  };

  log.info('operation:start', context);

  try {
    // Do work
    log.info('operation:complete', context);
  } catch (err) {
    log.error('operation:failed', { ...context, error: err.message });
    throw err;
  }
}
```

## Checklist for Integration

- [ ] `tenantMiddleware` added to Express server (after requireAuth)
- [ ] Database module updated to return TenantAwareAdapter
- [ ] First route migrated to async (test thoroughly)
- [ ] Service functions updated to call getCurrentTenantId()
- [ ] PostgreSQL RLS policies applied
- [ ] `user_id` columns added and backfilled
- [ ] Indexes created on `user_id`
- [ ] Tests updated with runWithTenant() wrapper
- [ ] Logging includes tenant context
- [ ] Documentation updated with new patterns
- [ ] Staging deployment and testing
- [ ] Production cutover with monitoring

## Common Mistakes to Avoid

### ❌ Don't pass userId through function signatures
```javascript
// WRONG
function getCase(userId, caseId) { /* ... */ }
router.get('/cases/:id', (req, res) => {
  const c = getCase(req.user.userId, req.params.id);
});

// RIGHT
function getCase(caseId) { /* ... */ }
router.get('/cases/:id', (req, res) => {
  const c = await getCase(req.params.id);
});
```

### ❌ Don't skip tenant context checks
```javascript
// WRONG
function listCases() {
  try {
    return await db.all('SELECT * FROM cases', []);
  } catch (e) {
    return []; // Silent fail
  }
}

// RIGHT
function listCases() {
  const userId = getCurrentTenantId(); // Throws if not set
  return await db.all('SELECT * FROM cases', []);
}
```

### ❌ Don't forget to await
```javascript
// WRONG (mixing sync and async)
const db = getDb();
const cases = db.prepare('SELECT * FROM cases').all();

// RIGHT
const db = await getDb();
const cases = await db.all('SELECT * FROM cases', []);
```

### ❌ Don't enable RLS on system tables
```sql
-- WRONG
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- RIGHT (users table is system-wide, not tenant-scoped)
-- Don't enable RLS on: users, model_registry, access_log, access_policies
```

## Testing Tenant Isolation

Verify that one tenant can't see another's data:

```javascript
import { runWithTenant } from './tenancy/TenantContext.js';

it('should isolate tenants', async () => {
  // Create case for user-A
  let caseA;
  await runWithTenant('user-A', async () => {
    const db = await getDb();
    await db.run(
      'INSERT INTO cases (id, user_id, title) VALUES ($1, $2, $3)',
      ['case-1', 'user-A', 'Case for A']
    );
  });

  // Try to access from user-B
  let caseInB;
  await runWithTenant('user-B', async () => {
    const db = await getDb();
    caseInB = await db.get(
      'SELECT * FROM cases WHERE id = $1',
      ['case-1']
    );
  });

  // RLS should prevent user-B from seeing user-A's case
  expect(caseInB).toBeUndefined();
});
```

## Performance Tuning

### 1. Index on user_id
Already created by migration script. Verify:
```sql
SELECT * FROM pg_indexes WHERE tablename = 'cases' AND indexname LIKE '%user_id%';
```

### 2. Query Plans
Verify RLS policy is being applied:
```sql
EXPLAIN SELECT * FROM cases WHERE id = '123'; -- Should show RLS policy check
```

### 3. Connection Pool
Monitor pool usage:
```javascript
// In database module
if (db.pool) {
  console.log('Pool stats:', db.pool._waitingCount, db.pool._totalCount);
}
```

## Support & Documentation

- **Full README:** `/server/db/tenancy/README.md`
- **API Reference:** `/server/db/tenancy/README.md#api-reference`
- **Tests:** `/tests/vitest/tenancy.test.mjs`
- **Migration Plan:** `/docs/migration/POSTGRESQL_MIGRATION_PLAN.md`
- **Build Summary:** `/TENANCY_BUILD_SUMMARY.md`
