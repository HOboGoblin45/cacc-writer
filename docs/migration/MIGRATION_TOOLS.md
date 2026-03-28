# Migration Tools Documentation

**Date:** 2026-03-28
**Status:** Complete
**Target:** Zero-downtime SQLite → PostgreSQL migration

---

## Overview

This document describes the migration tooling for transitioning CACC Writer from per-user SQLite databases to a shared PostgreSQL database with multi-tenancy support.

### Key Components

1. **Data Migration** (`scripts/migrate_sqlite_to_pg.mjs`)
   - Discovers all per-user SQLite databases
   - Reads and converts data
   - Batch inserts into PostgreSQL
   - Supports resumable checkpoints

2. **Verification** (`scripts/migration_verify.mjs`)
   - Post-migration validation
   - Row count comparisons
   - Sample data verification
   - Orphaned record detection

3. **Cutover Control** (`scripts/cutover_control.mjs`)
   - Managed transition phases
   - Dual-write support
   - Zero-downtime switching
   - Rollback capability

4. **Runtime Support**
   - `DualWriteManager`: Routes reads/writes during cutover
   - `TenantContext`: PostgreSQL RLS management
   - `MigrationCheckpoint`: Resume tracking
   - `TypeConverter`: SQLite ↔ PostgreSQL type handling

---

## File Locations

### Migration Scripts
```
scripts/
├── migrate_sqlite_to_pg.mjs    — Main data migration
├── migration_verify.mjs         — Post-migration verification
└── cutover_control.mjs          — Cutover orchestration
```

### Core Utilities
```
server/db/
├── TypeConverter.js             — Type conversion & SQL generation
├── MigrationCheckpoint.js       — Checkpoint tracking
├── DualWriteManager.js          — Runtime dual-write routing
└── tenancy/
    ├── TenantContext.js         — PostgreSQL RLS management
    └── index.js                 — Exports
```

### Tests
```
tests/vitest/
└── dataMigration.test.mjs       — Comprehensive test suite
```

---

## Usage Guide

### Phase 1: Pre-Migration Checks

```bash
# Verify PostgreSQL is ready and schema exists
node scripts/cutover_control.mjs pre-check --pg-url postgresql://user:pass@localhost/cacc
```

**Validates:**
- PostgreSQL connection
- `cacc` schema exists
- Key tables (case_records, assignments, generation_runs) present

### Phase 2: Dry-Run Migration

```bash
# Preview what would be migrated without executing
node scripts/migrate_sqlite_to_pg.mjs \
  --pg-url postgresql://user:pass@localhost/cacc \
  --data-dir ./data/users \
  --dry-run \
  --verbose
```

**Output:** Lists tables, row counts, and migration plan

### Phase 3: Execute Migration

```bash
# Migrate all users
node scripts/migrate_sqlite_to_pg.mjs \
  --pg-url postgresql://user:pass@localhost/cacc \
  --batch-size 500 \
  --verify
```

**Options:**
- `--batch-size`: Rows per INSERT batch (default: 500)
- `--verify`: Run verification after migration
- `--verbose`: Detailed logging
- `--user <id>`: Single user only (for testing)

**Checkpoint File:** `data/migration_checkpoint.json`
- Auto-saved after each table
- Enables resume if interrupted

### Phase 4: Verification

```bash
# Comprehensive post-migration validation
node scripts/migration_verify.mjs \
  --pg-url postgresql://user:pass@localhost/cacc \
  --data-dir ./data/users \
  --sample-size 10 \
  --verbose
```

**Checks:**
- Row count parity per table per user
- Sample data integrity (10 random rows per table)
- RLS policy enforcement

### Phase 5: Cutover Sequence

#### Step 1: Enable Dual-Write
```bash
# Start writing to both SQLite and PostgreSQL
# Reads continue from SQLite
node scripts/cutover_control.mjs enable-dual-write
```

Sets `DB_WRITE_MODE=dual-write` in `.env.cutover`

#### Step 2: Verify Sync
```bash
# Ensure both databases stay in sync
node scripts/cutover_control.mjs verify-sync --pg-url postgresql://...
```

#### Step 3: Switch to PG Primary
```bash
# Reads now come from PostgreSQL, writes go to both
node scripts/cutover_control.mjs switch-primary
```

Sets `DB_WRITE_MODE=pg-primary`

#### Step 4: Disable SQLite Writes
```bash
# PG becomes the sole data store
node scripts/cutover_control.mjs disable-sqlite
```

Sets `DB_WRITE_MODE=pg-only`

#### Step 5: Cleanup Archive
```bash
# Archive old SQLite files to data/archive
node scripts/cutover_control.mjs cleanup
```

### Phase 6: Rollback (if needed)

```bash
# Revert to SQLite-only mode
node scripts/cutover_control.mjs rollback
```

Sets `DB_WRITE_MODE=sqlite-only`

---

## Runtime Configuration

### Dual-Write Modes

Control via environment variable: `DB_WRITE_MODE`

| Mode | Read Source | Write Target | Use Case |
|------|---|---|---|
| `sqlite-only` | SQLite | SQLite | Default, pre-migration |
| `dual-write` | SQLite | Both | Writes verified, reads unaffected |
| `pg-primary` | PostgreSQL | Both | Reads from PG, writes replicated |
| `pg-only` | PostgreSQL | PostgreSQL | Full migration complete |

### Example: Enable Dual-Write in Code

```javascript
import { DualWriteManager } from './server/db/DualWriteManager.js';

const manager = new DualWriteManager(sqliteAdapter, pgAdapter);

// Writes go to both databases
await manager.run('INSERT INTO cases (id, name) VALUES (?, ?)', ['case-1', 'Test']);

// Reads come from primary (based on mode)
const cases = await manager.all('SELECT * FROM cases');
```

### PostgreSQL Row-Level Security (RLS)

For per-tenant isolation:

```javascript
import { TenantContext } from './server/db/tenancy/TenantContext.js';

const context = new TenantContext(pgAdapter);

// Set tenant for this request
await context.setTenant('user-123');

// All queries are automatically filtered by RLS policy
const cases = await pgAdapter.all('SELECT * FROM cacc.case_records');
// Returns only records WHERE user_id = 'user-123'
```

### Checkpoint Resume

If migration is interrupted:

```bash
# Resume from last checkpoint
node scripts/migrate_sqlite_to_pg.mjs \
  --pg-url postgresql://... \
  --resume
```

Checkpoint data is stored in `data/migration_checkpoint.json`:
- Tracks completed tables per user
- Rows migrated per table
- Overall progress

---

## Type Conversions

SQLite → PostgreSQL automatic conversions:

| SQLite | PostgreSQL | Conversion |
|--------|------------|-----------|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL PRIMARY KEY` | Auto-increment |
| `TEXT` (JSON) | `JSONB` | Parsed to JSON object |
| `0` / `1` | `BOOLEAN` | `false` / `true` |
| `datetime('now')` | `TIMESTAMPTZ` | ISO 8601 string |
| `REAL` | `DOUBLE PRECISION` | Direct cast |

Example:

```javascript
import { convertRow } from './server/db/TypeConverter.js';

const sqliteRow = {
  id: 'case-1',
  active: 1,
  metadata: '{"type":"1004","status":"complete"}',
  created_at: '2026-03-28T14:30:00Z'
};

const schema = [
  { name: 'id', pgType: 'TEXT PRIMARY KEY' },
  { name: 'active', pgType: 'BOOLEAN' },
  { name: 'metadata', pgType: 'JSONB' },
  { name: 'created_at', pgType: 'TIMESTAMPTZ' },
];

const pgRow = convertRow(sqliteRow, schema);
// Result: {
//   id: 'case-1',
//   active: true,                          // 1 → true
//   metadata: {type: '1004', status: ...}, // JSON string → object
//   created_at: '2026-03-28T14:30:00.000Z' // Normalized ISO
// }
```

---

## Testing

Run the comprehensive test suite:

```bash
npm test -- tests/vitest/dataMigration.test.mjs
npm test -- tests/vitest/dataMigration.test.mjs --reporter=verbose
```

Test coverage includes:
- TypeConverter (booleans, timestamps, JSON, SQL generation)
- MigrationCheckpoint (save/load, resume, progress tracking)
- DualWriteManager (routing, mode switching)
- Type conversions

---

## Error Handling

### Migration Errors

**Per-table error isolation:**
- One table failure doesn't stop others
- Errors logged with context (userId, tableName, error message)
- Resume capability allows retry

**Example error handling:**

```javascript
try {
  const inserted = await insertTableIntoPg(
    pgClient,
    tableName,
    rows,
    userId,
    batchSize,
    dryRun,
    logger
  );
} catch (err) {
  logger.error(`Failed to migrate table: ${tableName}`, {
    userId,
    error: err.message,
  });
  // Continue with next table
}
```

### Verification Failures

**Row count mismatches:**
```
[ERROR] Row count mismatch: case_records (user: user-123)
        sqlite: 42
        pg: 41
        diff: 1
```

**Data discrepancies:**
```
[WARN] Row found in SQLite but not in PG: cases (pk: case-1)
```

### Rollback Procedure

If issues are discovered during cutover:

```bash
# Revert to sqlite-only mode
node scripts/cutover_control.mjs rollback

# Investigate issues
# Fix PostgreSQL data if needed
# Re-run verification
node scripts/migration_verify.mjs --pg-url postgresql://...

# Restart cutover sequence
node scripts/cutover_control.mjs enable-dual-write
```

---

## Performance Considerations

### Batch Size

**Default:** 500 rows per INSERT batch

Tuning:
- **Increase** (1000+): Better performance for large tables, higher memory
- **Decrease** (100-200): Lower memory footprint, slightly slower

```bash
node scripts/migrate_sqlite_to_pg.mjs \
  --pg-url postgresql://... \
  --batch-size 1000
```

### Concurrency

Currently sequential per user. For parallel migration:

1. Modify `migrate_sqlite_to_pg.mjs` user loop to use `Promise.all()`
2. Ensure PostgreSQL connection pool can handle concurrency
3. Monitor resource usage

### Index Strategy

- **Pre-migration:** Disable indexes if not needed during migration
- **Post-migration:** Rebuild indexes on large tables

```sql
-- Disable during migration
ALTER TABLE cacc.case_records DISABLE TRIGGER ALL;

-- Rebuild after migration
REINDEX TABLE cacc.case_records;
ALTER TABLE cacc.case_records ENABLE TRIGGER ALL;
```

---

## PostgreSQL Setup Requirements

### Schema and Tables

```sql
-- Create schema
CREATE SCHEMA IF NOT EXISTS cacc;

-- Enable UUID extension (optional)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create all tables (from server/db/postgresql/pg_schema.sql)
-- Tables must include user_id column for multi-tenancy
```

### Row-Level Security (RLS)

```sql
-- Enable RLS on tables
ALTER TABLE cacc.case_records ENABLE ROW LEVEL SECURITY;

-- Create isolation policy
CREATE POLICY case_records_isolate ON cacc.case_records
  USING (user_id = current_setting('app.user_id'))
  WITH CHECK (user_id = current_setting('app.user_id'));
```

### Connection Pooling

Recommended for production:

```javascript
// PostgreSQL adapter with connection pool
const { Pool } = require('pg');
const pool = new Pool({
  max: 20,           // Max connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

---

## Monitoring & Logging

### Log Output

Scripts produce structured JSON logs:

```json
{
  "ts": "2026-03-28T14:30:00.123Z",
  "level": "info",
  "msg": "migration:started",
  "pgUrl": "postgresql://***",
  "dataDir": "./data/users"
}
```

### Key Metrics

Monitor during migration:

- **Migration time:** Per-user, per-table
- **Rows migrated:** Total and by table
- **Error count:** Failures per user
- **Verification:** Row count discrepancies

### Checkpoint Progress

```bash
cat data/migration_checkpoint.json | jq '.usersCompleted'
```

---

## FAQ

**Q: Can I migrate a single user for testing?**
```bash
node scripts/migrate_sqlite_to_pg.mjs \
  --pg-url postgresql://... \
  --user user-123
```

**Q: What if migration fails midway?**
Resume from checkpoint:
```bash
node scripts/migrate_sqlite_to_pg.mjs --pg-url postgresql://... --resume
```

**Q: How do I test cutover without production data?**
Use `--dry-run` to preview, then use test/staging environment.

**Q: Can I switch back to SQLite after migration?**
Yes, use `cutover_control.mjs rollback` to revert to `sqlite-only` mode.

**Q: What's the performance impact of dual-write?**
Minimal — secondary writes happen asynchronously and don't block primary.

**Q: How do I monitor data sync between SQLite and PostgreSQL?**
```bash
node scripts/cutover_control.mjs verify-sync --pg-url postgresql://...
```

---

## Support & Troubleshooting

### Common Issues

**PostgreSQL connection refused:**
- Check `--pg-url` is correct
- Verify PostgreSQL is running and accessible
- Check firewall/network configuration

**Row count mismatches after migration:**
- Likely data corruption or duplicate rows
- Run `migration_verify.mjs` for details
- Check PostgreSQL constraint violations

**Migration hangs or times out:**
- Reduce `--batch-size` to lower memory pressure
- Check PostgreSQL resource limits
- Monitor disk I/O and network

### Debug Mode

Enable verbose logging:

```bash
node scripts/migrate_sqlite_to_pg.mjs \
  --pg-url postgresql://... \
  --verbose
```

### Contacting Support

Include:
1. Checkpoint file: `data/migration_checkpoint.json`
2. Error logs from script output
3. PostgreSQL version and configuration
4. SQLite file sizes (du -h data/users/*/appraisal.db)

---

**Document Version:** 1.0
**Last Updated:** 2026-03-28
