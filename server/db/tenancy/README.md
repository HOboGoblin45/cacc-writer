# Row-Level Security (RLS) Multi-Tenancy System

## Overview

This directory contains the complete implementation of CACC Writer's Row-Level Security (RLS) multi-tenancy system for PostgreSQL migrations. It provides thread-local tenant context isolation, automatic query scoping, and backward-compatible migrations from per-user SQLite databases to a shared PostgreSQL database with RLS policies.

## Architecture

### Core Components

#### 1. **TenantContext.js** — Thread-Local Tenant Isolation
- Uses Node.js `AsyncLocalStorage` to maintain per-request tenant context
- `runWithTenant(tenantId, fn)` — Run a function within a tenant context
- `getCurrentTenantId()` — Get the current tenant ID (throws if not set)
- `hasTenantContext()` — Check if context is active
- `getTenantContext()` — Get the full context object

**Key Feature:** Automatically inherited across async boundaries (promises, async/await).

```javascript
import { runWithTenant, getCurrentTenantId } from './TenantContext.js';

runWithTenant('user-123', () => {
  const tenantId = getCurrentTenantId(); // 'user-123'
  // All queries within this scope are scoped to user-123
});
```

#### 2. **TenantAwareAdapter.js** — Query Wrapping
- Wraps any database adapter (SQLite or PostgreSQL)
- Automatically injects tenant context into every query
- For PostgreSQL: Sets session variable `app.current_tenant_id` before each query
- For SQLite: No-op (per-user databases provide isolation via file separation)
- Supports all standard DB operations: `all()`, `get()`, `run()`, `transaction()`

```javascript
import { TenantAwareAdapter } from './TenantAwareAdapter.js';

const baseAdapter = new PostgresAdapter(connectionString);
const adapter = new TenantAwareAdapter(baseAdapter);

await runWithTenant('user-123', async () => {
  const rows = await adapter.all('SELECT * FROM cases', []);
  // Only user-123's cases are returned (enforced by RLS policies)
});
```

#### 3. **tenantMiddleware.js** — Express Integration
- Express middleware that extracts user ID from `req.user` and sets tenant context
- `tenantMiddleware()` — Wraps handlers in tenant context
- `requireTenantContext()` — Strict mode (rejects if context missing)
- `getTenantIdFromRequest()` — Helper to extract user ID from request

```javascript
import { requireAuth } from '../middleware/authMiddleware.js';
import { tenantMiddleware } from './tenancy/tenantMiddleware.js';

app.use(requireAuth);        // Sets req.user
app.use(tenantMiddleware);   // Sets tenant context
// All subsequent handlers run with context set
```

#### 4. **UserDbBridge.js** — Backward Compatibility Shim
- Bridges old `getUserDb(userId)` pattern to new async adapters
- Allows gradual migration of routes from sync to async
- `createUserDbBridge(adapter)` — Create a compatibility wrapper
- `getUserDbCompat(userId, adapter)` — Drop-in replacement for `getUserDb()`

```javascript
// During migration, old code continues to work:
const db = createUserDbBridge(tenantAwareAdapter);
const stmt = db.prepare('SELECT * FROM cases WHERE id = ?');
const row = stmt.get(caseId);

// New code uses async:
const row = await adapter.get('SELECT * FROM cases WHERE id = $1', [caseId]);
```

### Supporting Files

#### 5. **rls_policies.sql** — PostgreSQL Policies
Comprehensive Row-Level Security policies for all tenant-scoped tables:
- Enables RLS on 50+ tables (case_records, assignments, generation_runs, etc.)
- Creates SELECT, INSERT, UPDATE, DELETE policies for each table
- Uses `current_setting('app.current_tenant_id')` for tenant scoping
- Tables **without** tenant isolation (system-wide): users, model_registry, access_log

#### 6. **tenant_migration.sql** — Schema Migration Script
SQL to migrate existing tables from per-user DBs to shared PostgreSQL:
- **Phase 1:** Add `user_id` columns (nullable)
- **Phase 2:** Backfill `user_id` values (requires domain knowledge)
- **Phase 3:** Set `NOT NULL` constraints
- **Phase 4:** Create indexes on `user_id`
- **Phase 5:** Add foreign key constraints

#### 7. **index.js** — Barrel Export
Convenience export for all public APIs.

## Usage Patterns

### Pattern 1: Service Function with Tenant Context

```javascript
// server/db/repositories/caseRecordRepo.js
import { getCurrentTenantId } from '../tenancy/TenantContext.js';

export async function getCasesByTenant() {
  const tenantId = getCurrentTenantId();
  const db = await getDb(); // Tenant-aware adapter

  // RLS policy ensures only tenant's data is visible
  const sql = `
    SELECT id, title, status FROM cases
    WHERE user_id = $1
    ORDER BY created_at DESC
  `;
  return await db.all(sql, [tenantId]);
}
```

### Pattern 2: API Route with Middleware

```javascript
// server/api/casesRoutes.js
import { requireAuth } from '../middleware/authMiddleware.js';
import { tenantMiddleware } from '../db/tenancy/tenantMiddleware.js';

const router = Router();

router.use(requireAuth);
router.use(tenantMiddleware); // Sets context from req.user

router.get('/:caseId', async (req, res) => {
  try {
    const caseId = req.params.caseId;
    const userId = req.user.userId; // From auth middleware

    // Database is tenant-aware; tenant context already set by middleware
    const db = await getDb();
    const caseData = await db.get(
      'SELECT * FROM cases WHERE id = $1',
      [caseId]
    );

    if (!caseData) {
      return res.status(404).json({ error: 'Case not found' });
    }

    res.json(caseData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

### Pattern 3: Gradual Migration (Sync to Async)

```javascript
// server/db/repositories/legacyRepo.js
import { createUserDbBridge } from '../tenancy/UserDbBridge.js';

const db = createUserDbBridge(tenantAwareAdapter);

// Old code (still works):
export function getAssignmentSync(assignmentId) {
  const stmt = db.prepare('SELECT * FROM assignments WHERE id = ?');
  return stmt.get(assignmentId);
}

// New code (async):
export async function getAssignmentAsync(assignmentId) {
  const adapter = db.getAdapter(); // Access underlying async adapter
  return await adapter.get('SELECT * FROM assignments WHERE id = $1', [assignmentId]);
}
```

## PostgreSQL Setup

### 1. Enable RLS Policies

```bash
# On PostgreSQL server
psql -U postgres -d cacc_writer < server/db/tenancy/rls_policies.sql
```

### 2. Add user_id Columns and Migrate Data

```bash
# Phase 1-3: Schema changes
psql -U postgres -d cacc_writer < server/db/tenancy/tenant_migration.sql

# Phase 2 requires manual SQL based on your data:
# UPDATE case_records SET user_id = (SELECT user_id FROM assignments ...)
# UPDATE generation_runs SET user_id = (SELECT user_id FROM assignments ...)
```

### 3. Configure Session Variable

PostgreSQL needs to support setting `app.current_tenant_id`:

```sql
-- No special setup needed — PostgreSQL supports arbitrary session variables
-- They're set dynamically by TenantAwareAdapter
```

## Testing

Run comprehensive tests with:

```bash
npm test -- tests/vitest/tenancy.test.mjs
```

Tests cover:
- TenantContext: AsyncLocalStorage behavior, nested contexts, error cases
- TenantAwareAdapter: Query wrapping, tenant context setting, SQLite/PostgreSQL behavior
- tenantMiddleware: Request context extraction, authenticated/unauthenticated paths
- UserDbBridge: Backward compatibility, statement wrapping
- Concurrent isolation: Parallel requests maintain separate contexts
- Async boundary preservation: Context survives across async/await

## Migration Path

### Phase 4 of PostgreSQL Migration Plan

1. **Database Abstraction Layer (Phase 1):** Create adapter interface supporting both SQLite and PostgreSQL
2. **Repository Consolidation (Phase 2):** Centralize all data access
3. **Schema Translation (Phase 3):** Make SQL database-agnostic
4. **Multi-Tenancy Strategy (Phase 4 — THIS):** Implement RLS with tenant_id columns
5. **Async Conversion (Phase 5):** Convert sync SQLite to async PostgreSQL
6. **Data Migration (Phase 6):** Tooling for zero-downtime migration
7. **Testing & Cutover (Phase 7):** Comprehensive testing and production deployment

### Incremental Route Migration

Routes can migrate one at a time:

```javascript
// OLD: Per-user SQLite
const db = getUserDb(userId);
db.prepare(sql).run(...);

// TRANSITION: Tenant-aware adapter with bridge
const db = createUserDbBridge(tenantAwareAdapter);
db.prepare(sql).run(...);

// NEW: Direct async adapter
const db = await getDb(); // Returns TenantAwareAdapter
await db.run(sql, params);
```

## Security Considerations

### RLS Enforcement

- **SELECT:** Only rows where `user_id = current_setting('app.current_tenant_id')`
- **INSERT:** Only allows inserting rows with `user_id = current_setting('app.current_tenant_id')`
- **UPDATE:** Can only update rows owned by the current tenant
- **DELETE:** Can only delete rows owned by the current tenant

### Session Variable Setting

The session variable `app.current_tenant_id` is set by `TenantAwareAdapter._setTenantContext()` before every query (PostgreSQL only). This ensures:
- No query can escape the current tenant context
- Even if a query is missing a WHERE clause, RLS enforces isolation
- Forgotten `AND user_id = ?` clauses are caught by RLS

### SQLite Compatibility

For SQLite (dev environments):
- Per-user databases provide isolation via file separation
- `user_id` column is optional (recommended for schema compatibility)
- RLS policies are ignored (SQLite doesn't support them)
- TenantAwareAdapter operates as a pass-through

## Troubleshooting

### "No tenant context — query rejected"
**Cause:** Query executed without tenant context set
**Fix:** Ensure `tenantMiddleware` is applied before route handler
```javascript
app.use(requireAuth);
app.use(tenantMiddleware); // Must be before route handlers
```

### RLS Policy Not Enforced
**Cause:** Session variable not set correctly
**Fix:** Verify `TenantAwareAdapter._setTenantContext()` is called before queries
```javascript
// Check logs for "tenant:context-set-failed" warnings
```

### Connection Pool Issues
**Cause:** Too many connections per tenant
**Fix:** Increase PostgreSQL connection pool size
```javascript
// In .env:
PG_POOL_SIZE=20
PG_IDLE_TIMEOUT_MS=30000
```

### Concurrent Request Context Leakage
**Cause:** AsyncLocalStorage misused
**Fix:** Always use `runWithTenant()` wrapper, never share context across requests
```javascript
// CORRECT: Each request has isolated context
app.use(tenantMiddleware); // Creates runWithTenant per request

// WRONG: Storing tenantId globally
const globalTenantId = req.user.userId; // ❌ Leaks across requests
```

## API Reference

### TenantContext.js

```javascript
runWithTenant(tenantId: string, fn: Function) -> any
getCurrentTenantId() -> string // throws if no context
hasTenantContext() -> boolean
getTenantContext() -> { tenantId: string } | null
```

### TenantAwareAdapter

```javascript
new TenantAwareAdapter(baseAdapter: DatabaseAdapter)
adapter.all(sql: string, params: any[]) -> Promise<any[]>
adapter.get(sql: string, params: any[]) -> Promise<any>
adapter.run(sql: string, params: any[]) -> Promise<{ changes: number }>
adapter.transaction(fn: Function) -> Promise<any>
adapter.exec(sql: string) -> Promise<void>
adapter.tableExists(tableName: string) -> Promise<boolean>
adapter.getDialect() -> string // 'sqlite' or 'postgresql'
adapter.getBaseAdapter() -> DatabaseAdapter
```

### tenantMiddleware.js

```javascript
tenantMiddleware(req, res, next) -> void // Express middleware
requireTenantContext(req, res, next) -> void // Strict mode middleware
getTenantIdFromRequest(req) -> string | null
```

### UserDbBridge.js

```javascript
createUserDbBridge(adapter: TenantAwareAdapter) -> object
getUserDbCompat(userId: string, adapter: TenantAwareAdapter) -> object
// Returned object has: prepare(), exec(), transaction(), pragma(), getAdapter()
```

## Performance Considerations

- **Session Variable Overhead:** ~1-2ms per query (PostgreSQL)
- **Index Efficiency:** Queries with `user_id` in WHERE clause should use `idx_*_user_id` indexes
- **RLS Policy Evaluation:** Minimal (~1% overhead) if indexes are in place
- **Connection Pool:** Reuse connections aggressively to amortize session setup

## Future Improvements

1. **Query Rewriting:** Automatically inject `user_id = ?` into queries lacking user scope
2. **Audit Logging:** Track all cross-tenant query attempts
3. **Performance Monitoring:** Built-in metrics for RLS enforcement overhead
4. **Schema Validation:** Automatic checks that all tables have `user_id` column
5. **Multi-Tenant Features:** Organizations, teams, workspace sharing (future)

## References

- PostgreSQL RLS Docs: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- CACC Writer PostgreSQL Migration Plan: `/docs/migration/POSTGRESQL_MIGRATION_PLAN.md`
- Phase 4 Multi-Tenancy Strategy: `/docs/migration/POSTGRESQL_MIGRATION_PLAN.md#phase-4-multi-tenancy-strategy`
