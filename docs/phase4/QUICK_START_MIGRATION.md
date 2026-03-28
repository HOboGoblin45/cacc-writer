# Quick Start: PostgreSQL Migration

**For operators:** Complete guide to migrating from SQLite to PostgreSQL

---

## Prerequisites

```bash
# Install PostgreSQL driver
npm install pg

# Verify Node.js version (14+)
node --version

# Check PostgreSQL is accessible
psql -c "SELECT version();"
```

---

## 5-Minute Setup

### 1. Create PostgreSQL Schema

```bash
# Connect to PostgreSQL and run schema file
psql -U postgres -d your_database < server/db/postgresql/pg_schema.sql
```

### 2. Test Dry-Run Migration

```bash
# Preview migration without making changes
node scripts/migrate_sqlite_to_pg.mjs \
  --pg-url postgresql://user:pass@localhost/cacc \
  --dry-run
```

### 3. Run Full Migration

```bash
# Migrate all data with verification
node scripts/migrate_sqlite_to_pg.mjs \
  --pg-url postgresql://user:pass@localhost/cacc \
  --verify
```

Monitor progress in `data/migration_checkpoint.json`

### 4. Verify Results

```bash
# Check row count parity
node scripts/migration_verify.mjs \
  --pg-url postgresql://user:pass@localhost/cacc
```

### 5. Execute Cutover (Zero-Downtime)

```bash
# Step 1: Pre-check
node scripts/cutover_control.mjs pre-check \
  --pg-url postgresql://user:pass@localhost/cacc

# Step 2: Enable dual-write (both databases get writes)
node scripts/cutover_control.mjs enable-dual-write

# Step 3: Verify sync (check both databases match)
node scripts/cutover_control.mjs verify-sync \
  --pg-url postgresql://user:pass@localhost/cacc

# Step 4: Switch primary (read from PostgreSQL)
node scripts/cutover_control.mjs switch-primary

# Step 5: Disable SQLite writes
node scripts/cutover_control.mjs disable-sqlite

# Step 6: Archive old files
node scripts/cutover_control.mjs cleanup

# Done!
node scripts/cutover_control.mjs status
```

---

## Common Commands

```bash
# Single user (testing)
node scripts/migrate_sqlite_to_pg.mjs --pg-url postgresql://... --user user-123

# Resume interrupted migration
node scripts/migrate_sqlite_to_pg.mjs --pg-url postgresql://... --resume

# Detailed logging
node scripts/migrate_sqlite_to_pg.mjs --pg-url postgresql://... --verbose

# Custom batch size (larger = faster but higher memory)
node scripts/migrate_sqlite_to_pg.mjs --pg-url postgresql://... --batch-size 1000

# Run tests
npm test -- tests/vitest/dataMigration.test.mjs

# Rollback to SQLite
node scripts/cutover_control.mjs rollback
```

---

## Environment Variables

During cutover, the application reads `DB_WRITE_MODE`:

```bash
# Set manually (or cutover_control.mjs sets automatically)
export DB_WRITE_MODE=dual-write    # Both databases, SQLite primary
export DB_WRITE_MODE=pg-primary    # Both databases, PostgreSQL primary
export DB_WRITE_MODE=pg-only       # PostgreSQL only
```

---

## Troubleshooting

### PostgreSQL Connection Failed

```bash
# Check connection string format
postgresql://username:password@hostname:5432/database

# Test connection
psql postgresql://username:password@hostname:5432/database
```

### Row Count Mismatch

```bash
# Detailed verification
node scripts/migration_verify.mjs \
  --pg-url postgresql://... \
  --sample-size 100 \
  --verbose
```

### Migration Hung or Timed Out

```bash
# Resume from checkpoint (auto-resumes completed tables)
node scripts/migrate_sqlite_to_pg.mjs \
  --pg-url postgresql://... \
  --resume

# Or reduce batch size if memory-constrained
node scripts/migrate_sqlite_to_pg.mjs \
  --pg-url postgresql://... \
  --batch-size 100
```

### Need to Rollback

```bash
# Revert to sqlite-only mode
node scripts/cutover_control.mjs rollback

# Investigate issues
# Re-run migration/verification
```

---

## Timeline

| Step | Time | Command |
|------|------|---------|
| Dry-run | 2 min | `migrate_sqlite_to_pg.mjs --dry-run` |
| Migration | 5-30 min | `migrate_sqlite_to_pg.mjs` |
| Verification | 2-5 min | `migration_verify.mjs` |
| Pre-check | 1 min | `cutover_control.mjs pre-check` |
| Dual-write | Instant | `cutover_control.mjs enable-dual-write` |
| Switch primary | Instant | `cutover_control.mjs switch-primary` |
| Disable SQLite | Instant | `cutover_control.mjs disable-sqlite` |
| Cleanup | 1-5 min | `cutover_control.mjs cleanup` |

**Total:** 15-45 minutes depending on data volume

---

## Monitoring

### Check Progress

```bash
# View migration checkpoint
cat data/migration_checkpoint.json | jq '.'

# View current cutover status
node scripts/cutover_control.mjs status
```

### Check Logs

Scripts output structured JSON logs:

```bash
# Filter for errors
node scripts/... 2>&1 | grep ERROR

# Filter for specific user
node scripts/... 2>&1 | grep "user-123"

# Count rows migrated
cat data/migration_checkpoint.json | jq '.users[].tables[].rowsMigrated | add'
```

---

## Detailed Guide

For comprehensive documentation, see:
- `docs/migration/MIGRATION_TOOLS.md` — Full reference
- `MIGRATION_DELIVERABLES.md` — Technical overview

---

**Version:** 1.0
**Updated:** 2026-03-28
