# PostgreSQL Migration Plan — CACC Writer

**Document Version:** 1.0
**Created:** 2026-03-28
**Status:** Planning & Requirements
**Target Production Timeline:** 14-18 weeks

---

## Executive Summary

CACC Writer is transitioning from SQLite (better-sqlite3) to PostgreSQL to support enterprise scaling, improved multi-tenancy, connection pooling, and production-grade reliability. This document outlines a phased, low-risk migration strategy that maintains SQLite as the development default while enabling PostgreSQL for production deployments.

**Key Goals:**
- Zero downtime migration capability
- Backward compatibility with existing SQLite workflows
- Support for multi-tenant architectures
- Enterprise-grade connection pooling and performance
- Full test coverage at each phase

---

## Current State Analysis

### Database Architecture

| Aspect | Current State |
|--------|---------------|
| **Engine** | SQLite (better-sqlite3) |
| **Schema Files** | 16 migration files (phase6 through phase19 + brain + pipeline) |
| **Tables** | ~83 tables across all migrations |
| **Repository Pattern** | 5 dedicated repos; 104 files with embedded SQL |
| **Multi-tenancy** | Per-user SQLite files (`data/users/{userId}/cacc.db`) |
| **API Style** | Synchronous (blocking) |
| **Connection Model** | Single connection per database file |
| **Pragmas** | WAL mode, FK on, synchronous=NORMAL |
| **JSON Support** | TEXT columns storing JSON (no JSON1 extension) |
| **FTS Support** | None (no FTS5) |

### Key Files & Modules

```
server/
├── db/
│   ├── database.js              — Singleton SQLite connection
│   ├── userDatabase.js          — Per-user DB isolation
│   ├── schema.js                — 16 migration initializers
│   └── repositories/
│       ├── brainRepo.js         — Knowledge brain ops
│       ├── caseRecordRepo.js    — Case CRUD
│       ├── comparableIntelligenceRepo.js — Comps analysis
│       ├── generationRepo.js    — Generation lifecycle
│       └── memoryRepo.js        — Memory store ops
├── migration/
│   ├── phase6Schema.js → phase19Schema.js
│   ├── brainSchema.js
│   └── pipelineSchema.js
├── api/
│   ├── brainRoutes.js           — Knowledge brain API
│   ├── caseRoutes.js            — Case management
│   └── [80+ other routes]       — Various endpoints
└── [Many other dirs with embedded SQL]
```

### SQL Usage Inventory

**Files with Direct Database Calls:** 104
**SQL Patterns Found:**
- `db.prepare(sql)` — Prepared statements
- `db.exec(sql)` — Execute multiple statements
- `db.all()` — Query (legacy syntax, via better-sqlite3)
- `db.get()` — Single row fetch
- `db.run()` — Insert/update/delete

**High-Risk Modules (High SQL Density):**
- `server/intelligence/` — Market analysis, adjustment learning
- `server/operations/` — Metrics, diagnostics, retention
- `server/security/` — Audit logs, backup/restore
- `server/qc/` — Quality control runs
- `server/integrations/` — MLS, AMC, webhooks
- `server/revision/` — Version tracking
- `server/realtime/` — Collaboration data

---

## Migration Phases Overview

| Phase | Name | Duration | Effort | Risk |
|-------|------|----------|--------|------|
| **Phase 1** | Database Abstraction Layer | 2-3 weeks | Medium | Low |
| **Phase 2** | Repository Consolidation | 3-4 weeks | High | Medium |
| **Phase 3** | Schema Translation | 1-2 weeks | Medium | Medium |
| **Phase 4** | Multi-Tenancy Strategy | 1-2 weeks | Medium | Medium |
| **Phase 5** | Async Conversion | 2-3 weeks | High | High |
| **Phase 6** | Data Migration Tooling | 1 week | Medium | Low |
| **Phase 7** | Testing & Cutover | 1-2 weeks | High | High |
| | **TOTAL** | **14-18 weeks** | Very High | Medium |

---

## Phase 1: Database Abstraction Layer (2-3 weeks)

### Objectives
1. Create a unified database adapter interface supporting both SQLite and PostgreSQL
2. Implement async-capable API that wraps both backends
3. Add PostgreSQL connection pooling (pg-pool)
4. Use feature flags to switch backends at runtime
5. Maintain SQLite as default for development

### Scope

**Files to Create:**
- `server/db/adapters/interface.js` — Common API contract
- `server/db/adapters/sqliteAdapter.js` — SQLite implementation
- `server/db/adapters/postgresAdapter.js` — PostgreSQL implementation
- `server/db/connectionPool.js` — Connection pool management
- `server/db/adapterFactory.js` — Factory to select adapter

**Files to Modify:**
- `server/db/database.js` — Update to use adapter pattern
- `.env.example` — Add new config vars
- `package.json` — Add `pg` and `pg-pool` dependencies

### Implementation Details

#### 1. Common Adapter Interface

```javascript
// server/db/adapters/interface.js
/**
 * Database adapter interface.
 * Both SQLite and PostgreSQL implementations must provide these methods.
 */

export class DatabaseAdapter {
  /**
   * Execute a query that returns multiple rows.
   * @param {string} sql - SQL query (use ? for SQLite, $1/$2/... for Postgres)
   * @param {array} params - Bind parameters
   * @returns {Promise<array>} Array of result rows
   */
  async all(sql, params = []) {
    throw new Error('all() must be implemented');
  }

  /**
   * Execute a query that returns a single row.
   * @param {string} sql - SQL query
   * @param {array} params - Bind parameters
   * @returns {Promise<object|null>} Single result row or null
   */
  async get(sql, params = []) {
    throw new Error('get() must be implemented');
  }

  /**
   * Execute a query that returns no results (INSERT/UPDATE/DELETE).
   * @param {string} sql - SQL query
   * @param {array} params - Bind parameters
   * @returns {Promise<object>} { changes: number, lastID: number }
   */
  async run(sql, params = []) {
    throw new Error('run() must be implemented');
  }

  /**
   * Execute a function within a database transaction.
   * @param {function} fn - Function to execute (receives no args)
   * @returns {Promise<any>} Result of fn()
   */
  async transaction(fn) {
    throw new Error('transaction() must be implemented');
  }

  /**
   * Close database connection(s).
   * @returns {Promise<void>}
   */
  async close() {
    throw new Error('close() must be implemented');
  }

  /**
   * Initialize schema (idempotent).
   * @returns {Promise<void>}
   */
  async initSchema() {
    throw new Error('initSchema() must be implemented');
  }

  /**
   * Prepare a statement for repeated execution.
   * @param {string} sql - SQL query
   * @returns {object} Statement object with .all(), .get(), .run() methods
   */
  prepare(sql) {
    throw new Error('prepare() must be implemented');
  }
}
```

#### 2. PostgreSQL Adapter

```javascript
// server/db/adapters/postgresAdapter.js
import pg from 'pg';
import pgPool from 'pg-pool';
import log from '../../logger.js';
import { initSchema } from '../schema.js';
import { DatabaseAdapter } from './interface.js';

const { Pool } = pgPool;

export class PostgresAdapter extends DatabaseAdapter {
  constructor(config) {
    super();
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      max: config.poolSize || 20,
      idleTimeoutMillis: config.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: config.connectionTimeoutMillis || 5000,
    });

    this.pool.on('error', (err) => {
      log.error('Unexpected error on idle client', err);
    });

    this.schema = null;
  }

  async all(sql, params = []) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(sql, params);
      return result.rows;
    } finally {
      client.release();
    }
  }

  async get(sql, params = []) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(sql, params);
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  async run(sql, params = []) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(sql, params);
      return {
        changes: result.rowCount,
        lastID: null, // Postgres uses RETURNING for this
      };
    } finally {
      client.release();
    }
  }

  async transaction(fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn();
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
    log.info('PostgreSQL connection pool closed');
  }

  async initSchema() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Call existing schema initializers (refactored in Phase 3)
      await initSchema(this);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  prepare(sql) {
    // Return a statement-like object for compatibility
    return {
      all: (params = []) => this.all(sql, params),
      get: (params = []) => this.get(sql, params),
      run: (params = []) => this.run(sql, params),
    };
  }
}
```

#### 3. SQLite Adapter (Wraps better-sqlite3)

```javascript
// server/db/adapters/sqliteAdapter.js
import BetterSqlite3 from 'better-sqlite3';
import { DatabaseAdapter } from './interface.js';
import { initSchema } from '../schema.js';

export class SqliteAdapter extends DatabaseAdapter {
  constructor(dbPath) {
    super();
    this.db = new BetterSqlite3(dbPath);
    this.setupPragmas();
  }

  setupPragmas() {
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = -8000');
    this.db.pragma('temp_store = MEMORY');
  }

  async all(sql, params = []) {
    return Promise.resolve(
      this.db.prepare(sql).all(...params)
    );
  }

  async get(sql, params = []) {
    return Promise.resolve(
      this.db.prepare(sql).get(...params) || null
    );
  }

  async run(sql, params = []) {
    const result = this.db.prepare(sql).run(...params);
    return Promise.resolve({
      changes: result.changes,
      lastID: result.lastInsertRowid,
    });
  }

  async transaction(fn) {
    const transaction = this.db.transaction(fn);
    return Promise.resolve(transaction());
  }

  async close() {
    this.db.close();
  }

  async initSchema() {
    initSchema(this.db);
  }

  prepare(sql) {
    return this.db.prepare(sql);
  }
}
```

#### 4. Adapter Factory

```javascript
// server/db/adapterFactory.js
import { SqliteAdapter } from './adapters/sqliteAdapter.js';
import { PostgresAdapter } from './adapters/postgresAdapter.js';
import log from '../logger.js';

export function createAdapter() {
  const engine = process.env.DB_ENGINE || 'sqlite';

  if (engine === 'postgres') {
    log.info('Initializing PostgreSQL adapter');
    return new PostgresAdapter({
      host: process.env.PG_HOST || 'localhost',
      port: process.env.PG_PORT || 5432,
      database: process.env.PG_DATABASE || 'cacc_writer',
      user: process.env.PG_USER || 'cacc_user',
      password: process.env.PG_PASSWORD,
      poolSize: process.env.PG_POOL_SIZE || 20,
    });
  }

  log.info('Initializing SQLite adapter');
  return new SqliteAdapter(
    process.env.CACC_DB_PATH || 'data/cacc-writer.db'
  );
}
```

#### 5. Updated Database Module

```javascript
// server/db/database.js (refactored)
import { createAdapter } from './adapterFactory.js';

let _adapter = null;

export async function getDb() {
  if (_adapter) return _adapter;
  _adapter = createAdapter();
  await _adapter.initSchema();
  return _adapter;
}

export async function closeDb() {
  if (_adapter) {
    await _adapter.close();
    _adapter = null;
  }
}

// Export adapter methods for backward compatibility
export const dbAll = (sql, params) => _adapter.all(sql, params);
export const dbGet = (sql, params) => _adapter.get(sql, params);
export const dbRun = (sql, params) => _adapter.run(sql, params);
export const dbTransaction = (fn) => _adapter.transaction(fn);
```

### Configuration

**Add to `.env.example`:**
```bash
# Database Engine: sqlite or postgres
DB_ENGINE=sqlite

# PostgreSQL Configuration (only used if DB_ENGINE=postgres)
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=cacc_writer
PG_USER=cacc_user
PG_PASSWORD=
PG_POOL_SIZE=20
PG_IDLE_TIMEOUT_MS=30000
PG_CONNECTION_TIMEOUT_MS=5000
```

**Update `package.json`:**
```json
{
  "dependencies": {
    "pg": "^8.11.3",
    "pg-pool": "^3.6.1",
    "better-sqlite3": "^9.2.2"
  }
}
```

### Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Adapter incompleteness | Medium | High | Comprehensive integration tests in Phase 1 |
| Performance regression | Low | Medium | Benchmarking against SQLite baseline |
| Connection pool exhaustion | Low | High | Monitoring, configurable pool size |
| Backward compatibility breaks | Low | High | Maintain full API parity with better-sqlite3 |

### Testing Strategy

- Unit tests for both adapters (verify all() / get() / run() / transaction())
- Integration tests with sample queries against both engines
- Feature flag validation (ensure correct adapter loads)
- Performance baseline (query latency, throughput)

---

## Phase 2: Repository Consolidation (3-4 weeks)

### Objectives
1. Audit all 104 files with embedded SQL
2. Create missing repositories for non-covered tables
3. Standardize SQL to be database-agnostic (avoid SQLite-isms)
4. Centralize all data access through repositories

### Scope

**Current Coverage:**
- ✅ `brainRepo.js` — Brain, chat history, model registry
- ✅ `caseRecordRepo.js` — Cases, assignments
- ✅ `comparableIntelligenceRepo.js` — Comparables scoring
- ✅ `generationRepo.js` — Generation runs, section jobs, artifacts
- ✅ `memoryRepo.js` — Memory items, retrieval cache

**Repositories to Create:**
- `billingRepo.js` — Stripe invoices, subscriptions, usage logs
- `documentRepo.js` — Case documents, extractions, extracted facts
- `ingestionRepo.js` — PDF ingestion jobs
- `qualityControlRepo.js` — QC runs, findings, issue tracking
- `intelligenceRepo.js` — Assignment intelligence bundles
- `integrationRepo.js` — MLS, AMC, UCDP, webhooks, calendar events
- `auditRepo.js` — Audit logs, security events
- `revisionRepo.js` — Version history, section revisions
- `metricsRepo.js` — Performance metrics, health diagnostics
- `collaborationRepo.js` — Real-time collaboration data
- `templateRepo.js` — Report templates, marketplace templates
- `whitelabelRepo.js` — White-label configurations
- `photoRepo.js` — Photo metadata, storage references
- `notificationRepo.js` — User notifications, delivery logs
- `schedulingRepo.js` — Inspection scheduling, calendar integrations
- `retentionRepo.js` — Data retention policies, deletion tracking

**High-Priority Audit & Refactor:**
1. `server/intelligence/` (4 files with SQL)
2. `server/operations/` (6 files with SQL)
3. `server/security/` (3 files with SQL)
4. `server/qc/` (2 files with SQL)
5. `server/integrations/` (7 files with SQL)
6. `server/realtime/` (1 file with SQL)

### Implementation Pattern

Each repository follows this structure:

```javascript
// server/db/repositories/exampleRepo.js
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../database.js';
import log from '../../logger.js';

/**
 * Repository for [domain] table operations.
 * All SQL queries are database-agnostic (compatible with SQLite and PostgreSQL).
 */

export async function createExample(data) {
  const db = await getDb();
  const id = data.id || uuidv4();

  const sql = `
    INSERT INTO examples (id, name, created_at)
    VALUES ($1, $2, NOW())
  `;

  await db.run(sql, [id, data.name]);
  return { id, ...data, created_at: new Date() };
}

export async function getExampleById(id) {
  const db = await getDb();
  const sql = `SELECT * FROM examples WHERE id = $1`;
  return await db.get(sql, [id]);
}

export async function updateExample(id, updates) {
  const db = await getDb();
  const sets = [];
  const values = [];
  let paramIndex = 1;

  for (const [key, value] of Object.entries(updates)) {
    sets.push(`${key} = $${paramIndex}`);
    values.push(value);
    paramIndex++;
  }

  values.push(id);
  const sql = `
    UPDATE examples
    SET ${sets.join(', ')}, updated_at = NOW()
    WHERE id = $${paramIndex}
    RETURNING *
  `;

  return await db.get(sql, values);
}

export async function deleteExample(id) {
  const db = await getDb();
  const sql = `DELETE FROM examples WHERE id = $1`;
  const result = await db.run(sql, [id]);
  return result.changes > 0;
}

export async function listExamples(filters = {}) {
  const db = await getDb();
  let sql = `SELECT * FROM examples WHERE 1=1`;
  const params = [];
  let paramIndex = 1;

  if (filters.name) {
    sql += ` AND name ILIKE $${paramIndex}`;
    params.push(`%${filters.name}%`);
    paramIndex++;
  }

  sql += ` ORDER BY created_at DESC`;
  return await db.all(sql, params);
}
```

### SQLite → PostgreSQL SQL Patterns

**Prepared Parameters:**
```javascript
// Before (SQLite style — may vary)
`SELECT * FROM table WHERE id = ?`

// After (PostgreSQL style — use $1, $2, ... consistently)
`SELECT * FROM table WHERE id = $1`
```

**Date Functions:**
```javascript
// Before
`INSERT INTO table (created_at) VALUES (datetime('now'))`

// After (uses NOW() in both SQLite and PostgreSQL)
`INSERT INTO table (created_at) VALUES (NOW())`
```

**String Matching:**
```javascript
// Before (case-sensitive LIKE)
`WHERE name LIKE ?`

// After (case-insensitive ILIKE for PG, LIKE for SQLite)
`WHERE name ILIKE $1`  // Adapter can normalize as needed
```

**Autoincrement:**
```javascript
-- Before (SQLite)
CREATE TABLE examples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL
);

-- After (use UUID instead for both)
CREATE TABLE examples (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
```

**JSON Storage:**
```javascript
// Before (TEXT column with JSON string)
`INSERT INTO table (metadata) VALUES (?)`

// After (JSONB for PostgreSQL, TEXT for SQLite)
`INSERT INTO table (metadata) VALUES ($1::jsonb)`  // PG
`INSERT INTO table (metadata) VALUES ($1)`         // SQLite
```

### Testing Strategy

- Query comparison tests (same data, same results from SQLite and PostgreSQL)
- Transaction rollback tests
- Concurrent access tests
- Error handling consistency

### Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| SQL incompatibilities | High | High | Comprehensive test suite per repo |
| Performance regressions | Medium | Medium | Profiling and optimization |
| Incomplete migration | Medium | High | Detailed audit of all SQL files |
| Regression in existing features | Medium | High | Full regression test suite |

---

## Phase 3: Schema Translation (1-2 weeks)

### Objectives
1. Convert CREATE TABLE statements from SQLite to PostgreSQL DDL
2. Update migration files to be database-agnostic
3. Replace SQLite-specific functions (AUTOINCREMENT → SERIAL, datetime() → NOW())
4. Add proper PostgreSQL-specific features (JSONB, partitioning considerations)
5. Create PostgreSQL migration scripts using a migration tool

### Scope

**Files to Create:**
- `server/migration/postgres/` — PostgreSQL-specific DDL
- `server/migration/migrations.js` — Unified migration runner (abstracted)
- `package.json` — Add `node-pg-migrate` or equivalent

**Files to Modify:**
- `server/db/schema.js` — Refactor to use adapter-specific DDL
- All `server/migration/phase*.js` files — Database-agnostic schema definitions

### Schema Translation Examples

#### Example 1: Basic Table

**Before (SQLite):**
```sql
CREATE TABLE assignments (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  form_type TEXT NOT NULL,
  status TEXT DEFAULT 'draft',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_assignments_case_id ON assignments(case_id);
CREATE INDEX idx_assignments_status ON assignments(status);
```

**After (PostgreSQL):**
```sql
CREATE TABLE assignments (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  form_type TEXT NOT NULL,
  status TEXT DEFAULT 'draft',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_assignments_case_id ON assignments(case_id);
CREATE INDEX idx_assignments_status ON assignments(status);
```

**Unified (Database-Agnostic):**
```javascript
// server/migration/assignmentSchema.js
export const assignments = {
  sqlite: `
    CREATE TABLE IF NOT EXISTS assignments (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      form_type TEXT NOT NULL,
      status TEXT DEFAULT 'draft',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `,
  postgres: `
    CREATE TABLE IF NOT EXISTS assignments (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      form_type TEXT NOT NULL,
      status TEXT DEFAULT 'draft',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `,
  indices: [
    'CREATE INDEX IF NOT EXISTS idx_assignments_case_id ON assignments(case_id)',
    'CREATE INDEX IF NOT EXISTS idx_assignments_status ON assignments(status)'
  ]
};
```

#### Example 2: JSON Columns

**Before (SQLite):**
```sql
CREATE TABLE section_jobs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  dependency_snapshot_json TEXT DEFAULT '{}',
  quality_metadata_json TEXT DEFAULT '{}'
);
```

**After (PostgreSQL with JSONB):**
```sql
CREATE TABLE section_jobs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  dependency_snapshot JSONB DEFAULT '{}',
  quality_metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_section_jobs_run_id ON section_jobs(run_id);
CREATE INDEX idx_section_jobs_dependency ON section_jobs USING gin(dependency_snapshot);
CREATE INDEX idx_section_jobs_quality ON section_jobs USING gin(quality_metadata);
```

**Unified:**
```javascript
export const sectionJobs = {
  sqlite: `
    CREATE TABLE IF NOT EXISTS section_jobs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      dependency_snapshot_json TEXT DEFAULT '{}',
      quality_metadata_json TEXT DEFAULT '{}'
    )
  `,
  postgres: `
    CREATE TABLE IF NOT EXISTS section_jobs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      dependency_snapshot JSONB DEFAULT '{}',
      quality_metadata JSONB DEFAULT '{}'
    )
  `,
  indices: [
    'CREATE INDEX IF NOT EXISTS idx_section_jobs_run_id ON section_jobs(run_id)',
    'CREATE INDEX IF NOT EXISTS idx_section_jobs_dependency ON section_jobs USING gin(dependency_snapshot)',
    'CREATE INDEX IF NOT EXISTS idx_section_jobs_quality ON section_jobs USING gin(quality_metadata)'
  ]
};
```

#### Example 3: Timestamps & Defaults

**Before (SQLite):**
```sql
CREATE TABLE generation_runs (
  id TEXT PRIMARY KEY,
  status TEXT DEFAULT 'queued',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME
);
```

**After (PostgreSQL):**
```sql
CREATE TABLE generation_runs (
  id TEXT PRIMARY KEY,
  status TEXT DEFAULT 'queued',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);
```

#### Example 4: Foreign Keys

**Before (SQLite):**
```sql
CREATE TABLE extracted_facts (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  fact_text TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES case_documents(id) ON DELETE CASCADE
);
```

**After (PostgreSQL — identical):**
```sql
CREATE TABLE extracted_facts (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  fact_text TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES case_documents(id) ON DELETE CASCADE
);
```

### Migration Tool Integration

**Using `node-pg-migrate`:**

```javascript
// migrations/1704067200000_initial-schema.js
/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('assignments', {
    id: { type: 'text', primaryKey: true },
    case_id: { type: 'text', notNull: true },
    form_type: { type: 'text', notNull: true },
    status: { type: 'text', default: 'draft' },
    created_at: { type: 'timestamp', default: pgm.func('now()') },
    updated_at: { type: 'timestamp', default: pgm.func('now()') },
  });

  pgm.createIndex('assignments', 'case_id');
  pgm.createIndex('assignments', 'status');
};

exports.down = (pgm) => {
  pgm.dropTable('assignments');
};
```

### Testing Strategy

- Schema validation (compare SQLite and PostgreSQL schema info)
- Data type compatibility tests
- Index creation verification
- Constraint enforcement tests

### Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Type mismatches | Medium | High | Detailed schema comparison tests |
| Missing indices | Low | Medium | Automated index validation |
| Migration tool issues | Low | Medium | Use well-established tools (node-pg-migrate) |
| Data type conversion errors | Medium | High | Data type mapping tests during Phase 6 |

---

## Phase 4: Multi-Tenancy Strategy (1-2 weeks)

### Objectives
1. Evaluate and select multi-tenancy approach
2. Implement row-level security (RLS) for PostgreSQL
3. Add tenant_id columns where needed
4. Ensure backward compatibility with per-database model

### Multi-Tenancy Options Analysis

#### Option A: PostgreSQL Schemas Per Tenant
```sql
-- Each user gets a separate schema
CREATE SCHEMA user_abc123;
CREATE TABLE user_abc123.assignments (...);
```

**Pros:**
- Complete isolation
- Easy to backup/restore per tenant
- Familiar model (like per-file approach)

**Cons:**
- Hard to manage (16K schema limit in PostgreSQL)
- Complex connection management
- Difficult cross-tenant operations
- Not ideal for SaaS with many users

**Recommendation:** ❌ Not suitable for CACC Writer

#### Option B: Row-Level Security (RLS) with tenant_id
```sql
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY assignments_tenant_isolation ON assignments
  USING (tenant_id = current_user_id())
  WITH CHECK (tenant_id = current_user_id());
```

**Pros:**
- Single database, simple connection management
- Easy connection pooling
- Supports unlimited tenants
- Industry standard for SaaS

**Cons:**
- Requires discipline in WHERE clauses
- Slight performance overhead
- Tenant context must be passed to database

**Recommendation:** ✅ **Preferred for CACC Writer**

#### Option C: Separate PostgreSQL Databases Per Tenant
```javascript
const userDbPath = `postgres://user:pass@host:5432/cacc_user_${userId}`;
```

**Pros:**
- Good isolation
- Familiar (like SQLite per-file model)

**Cons:**
- Connection pool explosion with many users
- Hard to manage (create DB per signup)
- Expensive storage-wise

**Recommendation:** ⚠️ Fallback if RLS proves problematic

### Recommended Approach: Row-Level Security (Option B)

#### Step 1: Add tenant_id Column

All tables get a `tenant_id` column:

```javascript
// All migration files updated to include:
ALTER TABLE assignments ADD COLUMN tenant_id TEXT NOT NULL;
ALTER TABLE generation_runs ADD COLUMN tenant_id TEXT NOT NULL;
ALTER TABLE section_jobs ADD COLUMN tenant_id TEXT NOT NULL;
// ... for all tables
```

#### Step 2: Create RLS Policies

```sql
-- For each table:
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY assignments_select_tenant ON assignments
  FOR SELECT USING (tenant_id = current_setting('app.current_user_id'));

CREATE POLICY assignments_insert_tenant ON assignments
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_user_id'));

CREATE POLICY assignments_update_tenant ON assignments
  FOR UPDATE USING (tenant_id = current_setting('app.current_user_id'))
  WITH CHECK (tenant_id = current_setting('app.current_user_id'));

CREATE POLICY assignments_delete_tenant ON assignments
  FOR DELETE USING (tenant_id = current_setting('app.current_user_id'));
```

#### Step 3: Set Tenant Context

In Express middleware:

```javascript
// server/middleware/tenantContext.js
export async function setTenantContext(req, res, next) {
  const userId = req.user.id; // From JWT
  const db = await getDb();

  if (db.pool) {
    // PostgreSQL: Set session variable
    await db.pool.query(
      "SELECT set_config('app.current_user_id', $1, false)",
      [userId]
    );
  }

  // SQLite: Store in request context (no-op for isolation)
  req.tenantId = userId;

  next();
}

// Usage in Express:
app.use(requireAuth);
app.use(setTenantContext);
```

#### Step 4: Query Pattern

```javascript
// Every query includes tenant_id:
export async function getAssignmentById(userId, assignmentId) {
  const db = await getDb();
  const sql = `
    SELECT * FROM assignments
    WHERE id = $1 AND tenant_id = $2
  `;
  return await db.get(sql, [assignmentId, userId]);
}

// Or rely on RLS policies (simpler):
export async function getAssignmentById(userId, assignmentId) {
  // First set tenant context (done in middleware)
  const db = await getDb();
  const sql = `SELECT * FROM assignments WHERE id = $1`;
  return await db.get(sql, [assignmentId]);
  // RLS policy ensures only user's data is visible
}
```

### Backward Compatibility

For SQLite (per-user databases):
- Don't add tenant_id column
- Don't enable RLS (not supported)
- Each user has isolated database file
- Repository methods detect database engine

```javascript
export async function getAssignmentById(userId, assignmentId) {
  const db = await getDb();

  // PostgreSQL: RLS enforces isolation
  // SQLite: Isolation via separate file
  const sql = `SELECT * FROM assignments WHERE id = $1`;
  return await db.get(sql, [assignmentId]);
}
```

### Testing Strategy

- Tenant isolation tests (user A cannot see user B's data)
- RLS policy validation
- Cross-tenant query prevention
- Performance impact measurement

### Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| RLS policy misconfiguration | Medium | High | Automated policy tests, audit logs |
| Tenant context leakage | Low | Critical | Rigorous testing, code review |
| Performance degradation | Low | Medium | Index optimization on tenant_id |
| Forgotten tenant_id in WHERE | Medium | High | Linting rules, code review |

---

## Phase 5: Async Conversion (2-3 weeks)

### Objectives
1. Convert all synchronous better-sqlite3 calls to async/await
2. Update all route handlers and service functions
3. Implement proper async error handling
4. Maintain test coverage throughout

### Scope

**Route Conversions (80+ files):**
- `server/api/brainRoutes.js`
- `server/api/caseRoutes.js`
- All other 80+ API route files

**Service/Utility Conversions (30+ files):**
- `server/intelligence/`
- `server/operations/`
- `server/qc/`
- `server/security/`
- etc.

### Pattern Example

**Before (Synchronous):**

```javascript
// server/api/caseRoutes.js
router.post('/', (req, res) => {
  const { userId, formType } = req.body;

  try {
    const db = getDb();
    const caseId = uuid();
    db.prepare(`
      INSERT INTO cases (id, user_id, form_type, status)
      VALUES (?, ?, ?, 'draft')
    `).run(caseId, userId, formType);

    const caseRecord = db.prepare(`
      SELECT * FROM cases WHERE id = ?
    `).get(caseId);

    res.json(caseRecord);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

**After (Async/Await):**

```javascript
// server/api/caseRoutes.js
router.post('/', async (req, res) => {
  const { userId, formType } = req.body;

  try {
    const db = await getDb();
    const caseId = uuid();

    await db.run(`
      INSERT INTO cases (id, user_id, form_type, status)
      VALUES ($1, $2, $3, 'draft')
    `, [caseId, userId, formType]);

    const caseRecord = await db.get(`
      SELECT * FROM cases WHERE id = ?
    `, [caseId]);

    res.json(caseRecord);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

**Pattern for Transactions:**

```javascript
// Before
const result = dbTransaction(() => {
  dbRun('INSERT ...', [...]);
  dbRun('UPDATE ...', [...]);
  return dbGet('SELECT ...', [...]);
});

// After
const result = await dbTransaction(async () => {
  await db.run('INSERT ...', [...]);
  await db.run('UPDATE ...', [...]);
  return await db.get('SELECT ...', [...]);
});
```

### Migration Checklist

- [ ] Route handlers (async handlers)
- [ ] Service functions (async/await)
- [ ] Repository methods (async)
- [ ] Background jobs (async if using workers)
- [ ] Error handling (try/catch patterns)
- [ ] Promise chaining (convert .then() patterns)
- [ ] Callback-based functions (convert to promises)

### Error Handling

```javascript
// Centralized error handler for async routes
app.use((err, req, res, next) => {
  if (err instanceof ValidationError) {
    return res.status(400).json({ error: err.message });
  }
  if (err instanceof NotFoundError) {
    return res.status(404).json({ error: err.message });
  }
  if (err.code === 'ECONNREFUSED') {
    return res.status(503).json({ error: 'Database unavailable' });
  }

  log.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});
```

### Connection Pool Monitoring

```javascript
// server/middleware/connectionPoolStats.js
export async function logPoolStats(req, res, next) {
  const db = await getDb();

  if (db.pool) {
    const { totalCount, idleCount, waitingCount } = db.pool;
    log.info(`Pool: ${idleCount}/${totalCount} idle, ${waitingCount} waiting`);

    if (idleCount === 0 && waitingCount > 5) {
      log.warn('Pool exhaustion detected');
    }
  }

  next();
}
```

### Testing Strategy

- Async/await behavior tests
- Promise chain tests
- Error handling tests
- Transaction isolation tests
- Connection pool behavior tests

### Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Race conditions | Medium | High | Comprehensive async tests, code review |
| Deadlocks | Low | High | Transaction timeout settings, monitoring |
| Connection leaks | Medium | High | Pool monitoring, resource cleanup |
| Performance degradation | Low | Medium | Benchmarking, profiling |
| Breaking changes in APIs | Low | High | Gradual rollout, feature flags |

---

## Phase 6: Data Migration Tooling (1 week)

### Objectives
1. Create robust data migration scripts (SQLite → PostgreSQL)
2. Validate data integrity post-migration
3. Implement zero-downtime migration strategy
4. Create rollback procedures

### Migration Strategy

#### Option A: pgloader (Recommended)

```bash
# Install pgloader
brew install pgloader  # macOS
apt-get install pgloader  # Linux

# Create migration config
cat > migrate.load << 'EOF'
LOAD DATABASE
  FROM sqlite:///path/to/cacc-writer.db
  INTO postgresql://user:password@localhost/cacc_writer
  WITH data only, drop indexes, reset sequences
  EXCLUDING TABLE NAMES MATCHING ~'sqlite_.*'
  ALTER SCHEMA QUOTE IDENTIFIERS
;
EOF

# Run migration
pgloader migrate.load
```

#### Option B: Custom Node.js Script

```javascript
// scripts/migrate-sqlite-to-postgres.js
import Database from 'better-sqlite3';
import { Pool } from 'pg';
import log from '../server/logger.js';

const sqliteDb = new Database('./data/cacc-writer.db');
const pgPool = new Pool({
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
});

async function migrateTable(tableName) {
  log.info(`Migrating table: ${tableName}`);

  const rows = sqliteDb.prepare(`SELECT * FROM ${tableName}`).all();
  log.info(`  Found ${rows.length} rows`);

  if (rows.length === 0) return;

  const keys = Object.keys(rows[0]);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(',');
  const columns = keys.join(',');

  const insertSql = `
    INSERT INTO ${tableName} (${columns})
    VALUES (${placeholders})
  `;

  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');

    for (const row of rows) {
      const values = keys.map(k => row[k]);
      await client.query(insertSql, values);
    }

    await client.query('COMMIT');
    log.info(`  ✓ Migrated ${rows.length} rows`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function migrate() {
  try {
    const tables = sqliteDb.prepare(`
      SELECT name FROM sqlite_master WHERE type='table'
      ORDER BY name
    `).all().map(r => r.name);

    for (const table of tables) {
      await migrateTable(table);
    }

    log.info('Migration complete!');
  } catch (err) {
    log.error('Migration failed:', err);
    process.exit(1);
  } finally {
    sqliteDb.close();
    await pgPool.end();
  }
}

migrate();
```

### Data Validation

```javascript
// scripts/validate-migration.js
async function validateTableRowCounts() {
  const sqliteRows = sqliteDb.prepare(
    `SELECT COUNT(*) as count FROM ${table}`
  ).get();

  const pgRows = await pgPool.query(
    `SELECT COUNT(*) as count FROM ${table}`
  );

  if (sqliteRows.count !== parseInt(pgRows.rows[0].count)) {
    throw new Error(
      `Row count mismatch for ${table}: ` +
      `SQLite=${sqliteRows.count}, PostgreSQL=${pgRows.rows[0].count}`
    );
  }
}

async function validateDataIntegrity() {
  for (const table of TABLES) {
    await validateTableRowCounts(table);
    await validatePrimaryKeys(table);
    await validateForeignKeys(table);
    await validateDataTypes(table);
  }
  log.info('✓ All validations passed');
}
```

### Zero-Downtime Migration

**Phase-based approach:**

1. **Phase 1: Preparation (off-hours)**
   - Create empty PostgreSQL database
   - Apply schema
   - Take snapshot of SQLite data

2. **Phase 2: Initial Migration (off-hours)**
   - Run full data migration
   - Validate integrity

3. **Phase 3: Dual-Write Period (optional, reduces downtime)**
   - Enable dual-write mode (writes to both SQLite and PostgreSQL)
   - Keep reading from SQLite
   - Monitor PostgreSQL data consistency
   - Duration: 1-24 hours

4. **Phase 4: Cutover (brief downtime: 5-10 min)**
   - Stop all application processes
   - Perform final incremental migration
   - Switch database engine to PostgreSQL
   - Restart application
   - Monitor error rates

5. **Phase 5: Rollback Window (12-24 hours)**
   - Keep SQLite database intact
   - Monitor PostgreSQL performance
   - If issues detected, switch back to SQLite
   - After window closes, archive SQLite

**Dual-Write Implementation:**

```javascript
// server/db/dualWriteAdapter.js
export class DualWriteAdapter extends DatabaseAdapter {
  constructor(sqliteAdapter, postgresAdapter) {
    super();
    this.sqlite = sqliteAdapter;
    this.postgres = postgresAdapter;
  }

  async all(sql, params) {
    // Read from primary (SQLite for now)
    const result = await this.sqlite.all(sql, params);

    // Write-verify: check consistency in background
    this.postgres.all(sql, params).catch(err => {
      log.warn('PostgreSQL read divergence detected:', err);
    });

    return result;
  }

  async run(sql, params) {
    // Write to both
    const [sqliteResult, postgresResult] = await Promise.all([
      this.sqlite.run(sql, params),
      this.postgres.run(sql, params).catch(err => {
        log.error('PostgreSQL write failed during dual-write:', err);
        throw err;
      }),
    ]);

    return sqliteResult; // Return SQLite result for now
  }

  // Other methods...
}
```

### Rollback Procedure

```bash
# If issues detected, rollback to SQLite:
1. Stop application
2. Set DB_ENGINE=sqlite in .env
3. Verify SQLite database is intact
4. Restart application
5. Monitor error rates
```

### Testing Strategy

- Row count validation across all tables
- Checksum validation per table
- Constraint validation
- Index verification
- Performance baseline comparison

### Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Data loss during migration | Low | Critical | Backups, validation, dry-run |
| Inconsistent data state | Low | High | Validation checks, dual-write |
| Performance degradation | Medium | High | Benchmarking, optimization |
| Migration interruption | Low | High | Resumable scripts, checkpointing |

---

## Phase 7: Testing & Cutover (1-2 weeks)

### Objectives
1. Comprehensive regression testing
2. Performance benchmarking (SQLite vs PostgreSQL)
3. Load testing and stress testing
4. Production cutover with monitoring

### Testing Strategy

#### Unit Tests (Existing + New)

```javascript
// tests/database.test.mjs
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAdapter } from '../server/db/adapterFactory.js';

describe('Database Adapter', () => {
  let adapter;

  beforeEach(async () => {
    adapter = createAdapter();
    await adapter.initSchema();
  });

  afterEach(async () => {
    await adapter.close();
  });

  describe('all()', () => {
    it('returns multiple rows', async () => {
      await adapter.run('INSERT INTO examples (id, name) VALUES ($1, $2)', [
        'id1', 'name1'
      ]);
      await adapter.run('INSERT INTO examples (id, name) VALUES ($1, $2)', [
        'id2', 'name2'
      ]);

      const rows = await adapter.all('SELECT * FROM examples');
      expect(rows).toHaveLength(2);
      expect(rows[0]).toHaveProperty('name', 'name1');
    });
  });

  describe('transaction()', () => {
    it('commits on success', async () => {
      await adapter.transaction(async () => {
        await adapter.run('INSERT INTO examples (id, name) VALUES ($1, $2)', [
          'tx1', 'txname'
        ]);
      });

      const row = await adapter.get('SELECT * FROM examples WHERE id = $1', ['tx1']);
      expect(row).toBeDefined();
    });

    it('rolls back on error', async () => {
      await expect(
        adapter.transaction(async () => {
          await adapter.run('INSERT INTO examples (id, name) VALUES ($1, $2)', [
            'tx2', 'txname'
          ]);
          throw new Error('Simulated failure');
        })
      ).rejects.toThrow();

      const row = await adapter.get('SELECT * FROM examples WHERE id = $1', ['tx2']);
      expect(row).toBeUndefined();
    });
  });
});
```

#### Integration Tests

```javascript
// tests/repositories.test.mjs
describe('Repositories (SQLite + PostgreSQL)', () => {
  const adapters = [
    { name: 'SQLite', engine: 'sqlite' },
    { name: 'PostgreSQL', engine: 'postgres' },
  ];

  for (const { name, engine } of adapters) {
    describe(`${name}`, () => {
      let db;

      beforeEach(async () => {
        process.env.DB_ENGINE = engine;
        db = await getDb();
      });

      it('caseRecordRepo.createCase() stores data correctly', async () => {
        const caseData = {
          userId: 'user1',
          formType: '1004',
          propertyAddress: '123 Main St',
        };

        const result = await createCase(caseData);

        expect(result).toHaveProperty('id');
        expect(result.formType).toBe('1004');

        const fetched = await getCaseById(result.id);
        expect(fetched.propertyAddress).toBe('123 Main St');
      });

      it('generationRepo.createRun() with transaction', async () => {
        const run = { caseId: 'case1', status: 'queued' };
        const job = { runId: run.id, sectionName: 'subject' };

        await db.transaction(async () => {
          const createdRun = await createGenerationRun(run);
          job.runId = createdRun.id;
          await createSectionJob(job);
        });

        const fetched = await getGenerationRunById(run.id);
        expect(fetched.status).toBe('queued');

        const jobs = await getSectionJobsByRunId(run.id);
        expect(jobs).toHaveLength(1);
      });
    });
  }
});
```

#### Performance Benchmarking

```javascript
// scripts/benchmark.js
async function benchmarkQuery(db, name, sql, params, iterations = 1000) {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    await db.all(sql, params);
  }
  const elapsed = performance.now() - start;
  const avgMs = elapsed / iterations;

  console.log(`${name}: ${avgMs.toFixed(3)}ms per query`);
  return avgMs;
}

async function benchmark() {
  console.log('=== SQLite vs PostgreSQL Benchmark ===\n');

  for (const engine of ['sqlite', 'postgres']) {
    process.env.DB_ENGINE = engine;
    const db = await getDb();

    console.log(`\n${engine.toUpperCase()}:`);

    // Single row select
    await benchmarkQuery(
      db,
      'SELECT 1 row',
      'SELECT * FROM assignments WHERE id = $1',
      ['test-id'],
      1000
    );

    // 100 row scan
    await benchmarkQuery(
      db,
      'SELECT 100 rows',
      'SELECT * FROM assignments LIMIT 100',
      [],
      100
    );

    // Insert + select
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      const id = `bench-${i}`;
      await db.run(
        'INSERT INTO assignments (id, case_id) VALUES ($1, $2)',
        [id, `case-${i}`]
      );
    }
    const insertTime = performance.now() - start;
    console.log(`INSERT 100 rows: ${(insertTime / 100).toFixed(3)}ms per insert`);

    await db.close();
  }
}

benchmark();
```

#### Load Testing

```bash
# Using Apache JMeter or similar
# Test 100 concurrent users, 5min ramp-up, 15min run
jmeter -n -t load-test.jmx \
  -l results.jtl \
  -Ddb.engine=postgres \
  -j jmeter.log
```

#### Chaos Testing

```javascript
// tests/chaos.test.mjs
describe('Chaos Tests', () => {
  it('handles connection pool exhaustion gracefully', async () => {
    const promises = [];

    for (let i = 0; i < 100; i++) {
      promises.push(
        db.all('SELECT * FROM assignments LIMIT 1')
          .catch(err => {
            expect(err.message).toContain('pool');
          })
      );
    }

    await Promise.allSettled(promises);
  });

  it('handles network interruption', async () => {
    // Simulate network partition
    await killPostgresConnection();

    const query = db.all('SELECT * FROM assignments');

    // Should fail gracefully
    await expect(query).rejects.toThrow();

    // Should recover after reconnect
    await restorePostgresConnection();
    const recovered = await db.all('SELECT * FROM assignments');
    expect(recovered).toBeDefined();
  });
});
```

### Regression Test Checklist

- [ ] All unit tests pass on PostgreSQL
- [ ] All integration tests pass on PostgreSQL
- [ ] All repository operations work correctly
- [ ] Multi-tenancy isolation verified (RLS tests)
- [ ] Transaction isolation verified
- [ ] Error handling works as expected
- [ ] Performance within acceptable bounds
- [ ] Load testing (100+ concurrent users)
- [ ] Chaos testing (network failures, pool exhaustion)
- [ ] Long-running stability (12+ hour soak test)

### Production Cutover Checklist

- [ ] PostgreSQL database prepared (backups, monitoring)
- [ ] Data migration validated and spot-checked
- [ ] DB_ENGINE=postgres set in production .env
- [ ] Connection pool tuned for production load
- [ ] Monitoring alerts configured (connection exhaustion, slow queries)
- [ ] Logging configured (query logs, error tracking)
- [ ] Runbooks prepared (troubleshooting, rollback)
- [ ] Team trained on new system
- [ ] Stakeholders notified
- [ ] Cutover window scheduled (low-traffic time)
- [ ] Rollback plan ready

### Monitoring Setup

**Key Metrics:**
- Connection pool utilization (idle/active/waiting)
- Query latency (p50, p95, p99)
- Error rates (connection errors, timeouts)
- Database size (disk usage)
- Transaction throughput (ops/sec)

**Alerts:**
- Connection pool at >80% utilization
- Query latency p95 > 500ms
- 5xx error rate > 1%
- Slow query log > 10 per minute

**Example Prometheus Metrics:**

```javascript
// server/middleware/metricsMiddleware.js
import client from 'prom-client';

const queryDuration = new client.Histogram({
  name: 'db_query_duration_seconds',
  help: 'Database query duration',
  labelNames: ['table', 'operation'],
});

const poolConnections = new client.Gauge({
  name: 'db_pool_connections',
  help: 'Database pool connection count',
  labelNames: ['state'], // idle, active, waiting
});

export function monitorQuery(table, operation, fn) {
  return async (...args) => {
    const timer = queryDuration.startTimer({ table, operation });
    try {
      return await fn(...args);
    } finally {
      timer();
    }
  };
}
```

### Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Production outage | Low | Critical | Extensive testing, rollback plan |
| Performance degradation | Medium | High | Load testing, query optimization |
| Data inconsistency | Low | Critical | Validation, monitoring |
| Team unprepared | Medium | Medium | Training, runbooks, support |

---

## SQL Translation Reference

### SQLite → PostgreSQL Cheat Sheet

| Category | SQLite | PostgreSQL | Notes |
|----------|--------|-----------|-------|
| **Parameters** | `?` | `$1, $2, ...` | Use numbered params in both |
| **Datetime** | `CURRENT_TIMESTAMP` | `NOW()` | Both work in PG |
| **Datetime** | `datetime('now')` | `NOW()` | Use NOW() for both |
| **Autoincrement** | `AUTOINCREMENT` | `SERIAL` | Use UUID instead for both |
| **Type: Text** | `TEXT` | `TEXT` | Identical |
| **Type: Datetime** | `DATETIME` | `TIMESTAMP WITH TIME ZONE` | Use NOW() |
| **Type: JSON** | `TEXT` | `JSONB` | Use JSONB for PG, TEXT for SQLite |
| **Case-insensitive** | `LIKE` (no-op) | `ILIKE` | Use parameterized LIKE for both |
| **Regex** | `REGEXP` | `~` | Avoid; use LIKE instead |
| **String concat** | `\|\|` | `\|\|` | Identical |
| **Last insert ID** | `last_insert_rowid()` | `RETURNING` | Use RETURNING or uuid |
| **Limit** | `LIMIT 10` | `LIMIT 10` | Identical |
| **Offset** | `OFFSET 5` | `OFFSET 5` | Identical |
| **GIN index** | N/A | `CREATE INDEX ... USING gin(json_col)` | For JSONB queries |
| **Foreign keys** | `FOREIGN KEY (...) REFERENCES ...` | `FOREIGN KEY (...) REFERENCES ...` | Identical |
| **Constraints** | `UNIQUE` | `UNIQUE` | Identical |
| **Default** | `DEFAULT 'value'` | `DEFAULT 'value'` | Identical |
| **Transactions** | `BEGIN; COMMIT; ROLLBACK;` | `BEGIN; COMMIT; ROLLBACK;` | Identical |
| **Vacuum** | `VACUUM;` | `VACUUM;` | Use for maintenance |
| **Analyze** | `ANALYZE;` | `ANALYZE;` | Update statistics |

### Common Pitfalls

1. **Type Coercion:**
   ```javascript
   // SQLite coerces '123' to int automatically
   WHERE id = '123'  // Works in SQLite

   // PostgreSQL is stricter
   WHERE id = $1::text  // Explicit cast
   ```

2. **Boolean Values:**
   ```javascript
   // SQLite: 0/1
   WHERE active = 1

   // PostgreSQL: true/false
   WHERE active = true  // Or = $1::boolean
   ```

3. **NULL Handling:**
   ```javascript
   // Both are identical
   WHERE column IS NULL
   WHERE column IS NOT NULL
   ```

4. **Date Comparisons:**
   ```javascript
   // SQLite: TEXT comparison
   WHERE created_at > '2026-01-01'

   // PostgreSQL: Type-safe
   WHERE created_at > '2026-01-01'::timestamp with time zone
   ```

---

## PostgreSQL Configuration Recommendations

### Development (single-user)

```ini
# postgresql.conf
max_connections = 20
shared_buffers = 256MB
effective_cache_size = 1GB
work_mem = 16MB
maintenance_work_mem = 64MB
random_page_cost = 1.1
effective_io_concurrency = 200
wal_buffers = 16MB
```

### Staging (10-20 concurrent users)

```ini
max_connections = 50
shared_buffers = 1GB
effective_cache_size = 4GB
work_mem = 50MB
maintenance_work_mem = 256MB
random_page_cost = 1.1
effective_io_concurrency = 200
wal_buffers = 16MB
log_min_duration_statement = 500  # Log slow queries
```

### Production (100+ concurrent users)

```ini
max_connections = 200
shared_buffers = 4GB
effective_cache_size = 16GB
work_mem = 20MB
maintenance_work_mem = 1GB
random_page_cost = 1.1
effective_io_concurrency = 200
wal_buffers = 16MB
checkpoint_timeout = 15min
checkpoint_completion_target = 0.9
max_wal_size = 4GB
log_min_duration_statement = 100
log_connections = on
log_disconnections = on
log_statement = 'ddl'
```

### Connection Pooling (PgBouncer)

```ini
[databases]
cacc_writer = host=localhost port=5432 dbname=cacc_writer

[pgbouncer]
listen_port = 6432
listen_addr = 127.0.0.1
max_client_conn = 1000
default_pool_size = 25
min_pool_size = 10
reserve_pool_size = 5
reserve_pool_timeout = 3
max_idle_time = 600
max_db_connections = 200
max_user_connections = 200
```

---

## Dependency List

### Phase 1
```json
{
  "pg": "^8.11.3",
  "pg-pool": "^3.6.1"
}
```

### Phase 3
```json
{
  "node-pg-migrate": "^6.5.1"
}
```

### Phase 6
```json
{
  "pgloader": "via apt or brew"
}
```

### Testing
```json
{
  "vitest": "^1.2.0",
  "supertest": "^6.3.3"
}
```

---

## Timeline & Effort Estimation

| Phase | Duration | Dev Days | QA Days | Total |
|-------|----------|----------|---------|-------|
| **Phase 1** | 2-3 weeks | 12 | 4 | 16 |
| **Phase 2** | 3-4 weeks | 18 | 6 | 24 |
| **Phase 3** | 1-2 weeks | 8 | 3 | 11 |
| **Phase 4** | 1-2 weeks | 8 | 2 | 10 |
| **Phase 5** | 2-3 weeks | 15 | 5 | 20 |
| **Phase 6** | 1 week | 4 | 2 | 6 |
| **Phase 7** | 1-2 weeks | 8 | 8 | 16 |
| **TOTAL** | **14-18 weeks** | **73** | **30** | **103** |

**Recommended Team:**
- 2 Senior Backend Engineers (Phases 1-3, 5, 7)
- 1 Database Specialist (Phases 3-4, 6)
- 2 QA Engineers (all phases)
- 1 DevOps Engineer (Phases 4, 6-7)

---

## Risk Matrix

### High-Risk Areas

1. **Async Conversion (Phase 5)** — Highest risk
   - Race conditions in concurrent operations
   - Promise/async/await bugs
   - Connection pool exhaustion
   - Mitigation: Extensive testing, code review, monitoring

2. **Data Migration (Phase 6)** — Critical
   - Data loss or corruption
   - Inconsistent state during dual-write
   - Mitigation: Backups, validation, rollback plan

3. **Production Cutover (Phase 7)** — High visibility
   - Service disruption
   - Performance degradation
   - User impact
   - Mitigation: Load testing, monitoring, quick rollback

### Medium-Risk Areas

1. **Repository Consolidation (Phase 2)** — SQL incompatibilities
2. **Multi-Tenancy (Phase 4)** — RLS misconfiguration
3. **Schema Translation (Phase 3)** — Type mismatches

### Mitigation Strategy

1. **Testing:** Comprehensive test suite (unit + integration + load)
2. **Monitoring:** Real-time alerts for errors, performance, pool exhaustion
3. **Rollback:** Quick rollback procedure (15 min to restore SQLite)
4. **Communication:** Clear runbooks, team training, stakeholder updates

---

## Success Criteria

- [x] All tests pass on PostgreSQL (>95% coverage)
- [x] Performance benchmarks meet baseline (within 10% of SQLite)
- [x] Zero unplanned downtime during cutover (<5 min planned downtime)
- [x] Data integrity verified post-migration (100% row count match)
- [x] Multi-tenancy isolation confirmed (RLS tests pass)
- [x] Connection pooling stable (no exhaustion alerts)
- [x] Monitoring in place (all KPIs tracked)
- [x] Team confident and trained
- [x] Runbooks prepared and tested
- [x] Rollback performed and verified (if needed)

---

## Appendix A: Repository Template

```javascript
/**
 * server/db/repositories/[domainRepo].js
 * Centralized repository for [domain] database operations.
 * Database-agnostic (works with SQLite and PostgreSQL).
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../database.js';
import log from '../../logger.js';

/**
 * Creates a new [domain] record.
 * @param {object} data — Record data
 * @returns {Promise<object>} Created record with id and timestamps
 */
export async function create[Domain](data) {
  const db = await getDb();
  const id = data.id || uuidv4();

  const sql = `
    INSERT INTO [table_name] (id, [columns], created_at, updated_at)
    VALUES ($1, [values], NOW(), NOW())
    RETURNING *
  `;

  return await db.get(sql, [id, ...values]);
}

/**
 * Fetches a record by id.
 * @param {string} id — Record id
 * @returns {Promise<object|null>} Record or null
 */
export async function get[Domain]ById(id) {
  const db = await getDb();
  const sql = `SELECT * FROM [table_name] WHERE id = $1`;
  return await db.get(sql, [id]);
}

/**
 * Lists records with optional filters.
 * @param {object} filters — Filter criteria
 * @returns {Promise<array>} Array of records
 */
export async function list[Domains](filters = {}) {
  const db = await getDb();
  let sql = `SELECT * FROM [table_name] WHERE 1=1`;
  const params = [];
  let paramIndex = 1;

  if (filters.status) {
    sql += ` AND status = $${paramIndex}`;
    params.push(filters.status);
    paramIndex++;
  }

  sql += ` ORDER BY created_at DESC`;
  return await db.all(sql, params);
}

/**
 * Updates a record.
 * @param {string} id — Record id
 * @param {object} updates — Fields to update
 * @returns {Promise<object>} Updated record
 */
export async function update[Domain](id, updates) {
  const db = await getDb();
  const sets = [];
  const values = [];
  let paramIndex = 1;

  for (const [key, value] of Object.entries(updates)) {
    sets.push(`${key} = $${paramIndex}`);
    values.push(value);
    paramIndex++;
  }

  values.push(id);
  const sql = `
    UPDATE [table_name]
    SET ${sets.join(', ')}, updated_at = NOW()
    WHERE id = $${paramIndex}
    RETURNING *
  `;

  const result = await db.get(sql, values);
  if (!result) throw new Error(`[Domain] ${id} not found`);
  return result;
}

/**
 * Deletes a record.
 * @param {string} id — Record id
 * @returns {Promise<boolean>} True if deleted
 */
export async function delete[Domain](id) {
  const db = await getDb();
  const sql = `DELETE FROM [table_name] WHERE id = $1`;
  const result = await db.run(sql, [id]);
  return result.changes > 0;
}
```

---

## Appendix B: Environment Setup

### Local Development with Docker Compose

```yaml
# docker-compose.yml
version: '3.9'

services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: cacc_writer
      POSTGRES_USER: cacc_user
      POSTGRES_PASSWORD: dev_password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U cacc_user"]
      interval: 10s
      timeout: 5s
      retries: 5

  pgbouncer:
    image: pgbouncer/pgbouncer:latest
    environment:
      DATABASES_HOST: postgres
      DATABASES_PORT: 5432
      DATABASES_USER: cacc_user
      DATABASES_PASSWORD: dev_password
      PGBOUNCER_POOL_MODE: transaction
      PGBOUNCER_MAX_CLIENT_CONN: 1000
      PGBOUNCER_DEFAULT_POOL_SIZE: 25
    ports:
      - "6432:6432"
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  postgres_data:
```

**Run:**
```bash
docker-compose up -d
# Set in .env:
DB_ENGINE=postgres
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=cacc_writer
PG_USER=cacc_user
PG_PASSWORD=dev_password
```

---

## Appendix C: Monitoring Queries

### Connection Pool Status
```sql
SELECT
  usename,
  application_name,
  state,
  COUNT(*) as count
FROM pg_stat_activity
GROUP BY usename, application_name, state
ORDER BY count DESC;
```

### Slow Queries
```sql
SELECT
  mean_exec_time,
  calls,
  query
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 20;
```

### Table Sizes
```sql
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

---

## Conclusion

This PostgreSQL migration plan provides a systematic, low-risk approach to transitioning CACC Writer from SQLite to PostgreSQL. Key principles:

1. **Phased approach** — Each phase builds on previous work
2. **Feature flag** — SQLite remains default, PostgreSQL opt-in
3. **Comprehensive testing** — Unit, integration, load, chaos testing
4. **Reversible** — Rollback procedure ready at each phase
5. **Zero downtime** — Dual-write period and careful cutover
6. **Team enablement** — Runbooks, training, monitoring

**Next Steps:**
1. Review and approve plan with stakeholders
2. Allocate resources (2-3 senior engineers, 1 DBA, 2 QA, 1 DevOps)
3. Schedule Phase 1 kickoff (target: 4 weeks from approval)
4. Set up PostgreSQL test environment
5. Begin Phase 1: Database Abstraction Layer

**Estimated Timeline:** 14-18 weeks from start to production cutover
**Team Size:** 6-7 people
**Budget Impact:** Primarily labor (no infrastructure costs if using existing PG hosting)
