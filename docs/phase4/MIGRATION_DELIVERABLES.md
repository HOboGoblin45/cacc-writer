# PostgreSQL Migration Tooling — Deliverables Summary

**Completed:** 2026-03-28
**Project:** Zero-downtime SQLite → PostgreSQL migration for CACC Writer
**Status:** All files built and syntax-validated

---

## Deliverables Overview

### 1. Core Utility Libraries

#### `server/db/TypeConverter.js` (5.4 KB)
**Purpose:** SQLite → PostgreSQL type conversions and parameterized SQL generation

**Key Exports:**
- `convertRow(row, columns)` — Converts booleans (0/1→true/false), timestamps (text→ISO), JSON (string→parsed)
- `buildInsertSQL(tableName, columns, schema)` — Generates parameterized INSERT with PostgreSQL placeholders ($1, $2...)
- `buildBatchInsertSQL(tableName, columns, batchSize, schema)` — Multi-row batch INSERT generator
- `getParameterIndex(columns, columnName)` — Utility for complex query construction

**Features:**
- Type-safe conversions
- PostgreSQL $N placeholder generation
- Batch SQL generation for 100+ row inserts
- Comprehensive error handling

---

#### `server/db/MigrationCheckpoint.js` (6.2 KB)
**Purpose:** Resumable checkpoint tracking for long-running migrations

**Key Exports:**
- `MigrationCheckpoint` class with methods:
  - `load()` / `save()` — Persist to/from JSON
  - `markTableDone(userId, tableName, rowCount)` — Track completion
  - `isTableDone(userId, tableName)` — Query completion status
  - `getProgress()` — Overall progress metrics
  - `getPendingUsers()` / `getPendingTables(userId)` — Resume support

**Features:**
- Resumable migrations after interruption
- Per-user, per-table tracking
- Progress reporting (users completed, tables completed, rows migrated)
- JSON persistence for durability

**Checkpoint File:** `data/migration_checkpoint.json`

---

#### `server/db/DualWriteManager.js` (6.4 KB)
**Purpose:** Runtime dual-write support for zero-downtime cutover

**Key Exports:**
- `DualWriteManager` class with methods:
  - `run(sql, params)` — Routes writes based on mode
  - `all(sql, params)` / `get(sql, params)` — Routes reads
  - `getWriteMode()` — Returns current mode
  - `getStatus()` — Diagnostic status

**Write Modes (via `DB_WRITE_MODE` env var):**
- `sqlite-only` (default) — SQLite only
- `dual-write` — Both databases, SQLite primary for reads
- `pg-primary` — Both databases, PostgreSQL primary for reads
- `pg-only` — PostgreSQL only

**Features:**
- Automatic failover and error handling
- Asynchronous secondary writes
- Verification utilities (`verifyTableSync`)
- Mode-aware read/write routing

---

#### `server/db/tenancy/TenantContext.js` (6.4 KB)
**Purpose:** PostgreSQL Row-Level Security (RLS) management for multi-tenancy

**Key Exports:**
- `TenantContext` class with methods:
  - `setTenant(tenantId)` — Set current tenant for RLS
  - `withTenant(tenantId, fn)` — Execute within tenant context
  - `createRlsPolicy(tableName, schema)` — Create isolation policy
  - `getRlsStatus(tableName, schema)` — Check RLS configuration

**Features:**
- Session-based tenant isolation
- RLS policy creation/configuration
- Policy validation and status checking
- Error handling with fallback modes

---

### 2. Data Migration Scripts

#### `scripts/migrate_sqlite_to_pg.mjs` (17 KB)
**Purpose:** Main data migration engine — reads all per-user SQLite DBs and writes to PostgreSQL

**Command:**
```bash
node scripts/migrate_sqlite_to_pg.mjs --pg-url postgresql://... [options]
```

**Key Options:**
- `--pg-url` (required) — PostgreSQL connection string
- `--data-dir` — SQLite data directory (default: `./data/users`)
- `--user` — Single user only (for testing)
- `--dry-run` — Preview without executing
- `--batch-size` — Rows per INSERT (default: 500)
- `--resume` — Resume from checkpoint
- `--verify` — Post-migration verification
- `--verbose` — Detailed logging

**Features:**
- Discovers all user databases in `data/users/{userId}/appraisal.db`
- Reads schema from `SCHEMA_CATALOG`
- Type conversion for each row (via `TypeConverter`)
- Batch INSERT for performance
- Per-table error isolation
- Automatic checkpoint saving
- Optional verification pass
- Resumable from last checkpoint

**Output:**
- Logs with timestamps and structured JSON
- Migration checkpoint file: `data/migration_checkpoint.json`
- Summary: users completed, tables completed, rows migrated

---

#### `scripts/migration_verify.mjs` (12 KB)
**Purpose:** Post-migration validation — ensures data integrity

**Command:**
```bash
node scripts/migration_verify.mjs --pg-url postgresql://... [options]
```

**Key Options:**
- `--pg-url` (required) — PostgreSQL connection string
- `--data-dir` — SQLite directory (default: `./data/users`)
- `--user` — Single user only
- `--sample-size` — Rows to sample per table (default: 10)
- `--verbose` — Detailed logging

**Verification Checks:**
- Row count parity between SQLite and PostgreSQL
- Sample data verification (random row checks)
- Orphaned record detection
- Summary of discrepancies

**Exit Codes:**
- `0` — All verifications passed
- `1` — Discrepancies found or error

---

#### `scripts/cutover_control.mjs` (13 KB)
**Purpose:** Orchestrates zero-downtime cutover phases

**Commands:**
```bash
node scripts/cutover_control.mjs pre-check --pg-url postgresql://...
node scripts/cutover_control.mjs enable-dual-write
node scripts/cutover_control.mjs verify-sync --pg-url postgresql://...
node scripts/cutover_control.mjs switch-primary
node scripts/cutover_control.mjs disable-sqlite
node scripts/cutover_control.mjs cleanup
node scripts/cutover_control.mjs rollback
node scripts/cutover_control.mjs status
```

**Phases:**
1. **pre-check** — Verify PostgreSQL ready, schema exists
2. **enable-dual-write** — Both databases receive writes, SQLite primary for reads
3. **verify-sync** — Ensure both databases stay in sync
4. **switch-primary** — PostgreSQL primary for reads, both for writes
5. **disable-sqlite** — PostgreSQL only
6. **cleanup** — Archive SQLite files to `data/archive`
7. **rollback** — Revert to sqlite-only mode
8. **status** — Show current cutover state

**State File:** `.env.cutover` (contains `DB_WRITE_MODE`)

---

### 3. Test Suite

#### `tests/vitest/dataMigration.test.mjs` (16 KB)
**Purpose:** Comprehensive test coverage for migration utilities

**Test Coverage:**

**TypeConverter Tests (9 tests):**
- Boolean conversion (0→false, 1→true)
- Timestamp conversion (ISO strings)
- JSON conversion (string→object)
- NULL/undefined handling
- Invalid JSON handling
- Parameterized SQL generation
- Batch SQL generation
- Parameter index resolution

**MigrationCheckpoint Tests (8 tests):**
- Save and load roundtrips
- Table completion tracking
- User completion tracking
- Progress calculation
- Pending users/tables retrieval
- Resume functionality
- Reset capability

**DualWriteManager Tests (8 tests):**
- Mode-based write routing (sqlite-only, dual-write, pg-primary, pg-only)
- Mode-based read routing
- Status information
- Default mode fallback
- Transaction support

**Run Tests:**
```bash
npm test -- tests/vitest/dataMigration.test.mjs
npm test -- tests/vitest/dataMigration.test.mjs --reporter=verbose
```

**Total Test Count:** 25 tests
**Frameworks:** Vitest with mocking support

---

### 4. Documentation

#### `docs/migration/MIGRATION_TOOLS.md` (8 KB)
**Purpose:** Comprehensive guide for operators

**Sections:**
- Overview and architecture
- File locations
- Step-by-step usage guide (6 phases)
- Runtime configuration
- Type conversions reference
- Testing instructions
- Error handling procedures
- Performance tuning
- PostgreSQL setup requirements
- Monitoring and logging
- FAQ and troubleshooting

---

## File Structure

```
cacc-writer/
├── server/db/
│   ├── TypeConverter.js
│   ├── MigrationCheckpoint.js
│   ├── DualWriteManager.js
│   └── tenancy/
│       ├── TenantContext.js
│       └── index.js
├── scripts/
│   ├── migrate_sqlite_to_pg.mjs
│   ├── migration_verify.mjs
│   └── cutover_control.mjs
├── tests/vitest/
│   └── dataMigration.test.mjs
└── docs/migration/
    └── MIGRATION_TOOLS.md
```

---

## Key Features

### Data Migration
✓ Discovers all per-user databases
✓ Type conversion (bool, timestamp, JSON)
✓ Batch INSERT for performance (configurable)
✓ Per-table error isolation
✓ Resumable from checkpoint
✓ Verification pass included

### Dual-Write Support
✓ 4 operational modes
✓ Primary/secondary routing
✓ Asynchronous secondary writes
✓ Error handling and logging
✓ Verification utilities

### Zero-Downtime Cutover
✓ 7-phase orchestration
✓ Pre-flight checks
✓ Sync verification
✓ Read source switching
✓ Rollback capability
✓ Archive functionality

### Multi-Tenancy
✓ Per-tenant RLS policies
✓ Session-based isolation
✓ Policy creation and validation
✓ Tenant context management

### Reliability
✓ Checkpoint persistence (JSON)
✓ Resume after interruption
✓ Per-table error isolation
✓ Comprehensive error logging
✓ 25 unit tests
✓ Test coverage: utilities, types, modes

---

## Syntax Validation

All files syntax-checked and passing:

✓ `server/db/TypeConverter.js`
✓ `server/db/MigrationCheckpoint.js`
✓ `server/db/DualWriteManager.js`
✓ `server/db/tenancy/TenantContext.js`
✓ `scripts/migrate_sqlite_to_pg.mjs`
✓ `scripts/migration_verify.mjs`
✓ `scripts/cutover_control.mjs`

---

## Environment Variables

**During Cutover:**
- `DB_WRITE_MODE` — Controls routing (sqlite-only, dual-write, pg-primary, pg-only)
- Stored in: `.env.cutover`
- Set by: `cutover_control.mjs`

**PostgreSQL Setup:**
- Environment variable for connection: `PG_URL` or CLI flag `--pg-url`
- No hardcoded credentials
- Connection pooling recommended

---

## Testing Instructions

1. **Unit Tests:**
   ```bash
   npm test -- tests/vitest/dataMigration.test.mjs
   ```

2. **Syntax Validation:**
   ```bash
   npm test  # Runs syntax.test.mjs which covers all .js files
   ```

3. **Integration Testing:**
   - Set up PostgreSQL test instance
   - Run: `node scripts/migrate_sqlite_to_pg.mjs --pg-url postgresql://localhost/cacc-test --dry-run`
   - Verify checkpoint creation
   - Test resume capability

---

## Implementation Timeline

| Component | Status | Size |
|-----------|--------|------|
| TypeConverter | ✓ Complete | 5.4 KB |
| MigrationCheckpoint | ✓ Complete | 6.2 KB |
| DualWriteManager | ✓ Complete | 6.4 KB |
| TenantContext | ✓ Complete | 6.4 KB |
| migrate_sqlite_to_pg.mjs | ✓ Complete | 17 KB |
| migration_verify.mjs | ✓ Complete | 12 KB |
| cutover_control.mjs | ✓ Complete | 13 KB |
| dataMigration.test.mjs | ✓ Complete | 16 KB |
| MIGRATION_TOOLS.md | ✓ Complete | 8 KB |
| **TOTAL** | **9 files** | **~90 KB** |

---

## Next Steps

1. **PostgreSQL Setup:** Create schema and tables (pg_schema.sql)
2. **Test Migration:** Dry-run with test data
3. **Production Preparation:**
   - Set up PostgreSQL in production
   - Enable backups
   - Plan maintenance window
4. **Migration Execution:** Follow 6-phase sequence in MIGRATION_TOOLS.md
5. **Post-Migration:** Archive SQLite files, monitor logs
6. **Performance Tuning:** Adjust batch size, indexing, RLS policies

---

## Dependencies

- `better-sqlite3` — Reading SQLite databases (existing)
- `pg` — PostgreSQL driver (must be installed: `npm install pg`)
- Standard Node.js modules (fs, path, etc.)

---

## Conventions Followed

✓ ES Modules (`import`/`export`, `.mjs` for scripts)
✓ Camel case for JS identifiers
✓ Kebab case for CLI arguments
✓ Structured logging with `log.info()`, `log.error()`, etc.
✓ Repository pattern for database access
✓ Error handling with per-operation isolation
✓ Comprehensive JSDoc comments

---

**Document:** MIGRATION_DELIVERABLES.md
**Created:** 2026-03-28
**Version:** 1.0
