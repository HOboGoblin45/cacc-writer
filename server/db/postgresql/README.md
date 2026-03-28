# PostgreSQL Schema & Migration Infrastructure

## Overview

This directory contains the PostgreSQL schema translation infrastructure for CACC Writer, including:

1. **Schema Catalog** — Complete inventory of all SQLite tables
2. **PostgreSQL DDL** — Full PostgreSQL schema definition
3. **Migration Runner** — Production-grade migration orchestration
4. **DDL Translator** — Automated SQLite → PostgreSQL conversion utility
5. **Migration Files** — Individual migration SQL scripts
6. **Tests** — Comprehensive test coverage

## Files

### Core Infrastructure

- **`schema_catalog.js`** — Complete catalog of all tables with metadata
  - ~110 tables documented
  - Column definitions with SQLite and PostgreSQL types
  - Index and constraint specifications
  - Source file tracking

- **`pg_schema.sql`** — Complete PostgreSQL DDL (single file)
  - All tables in `cacc` schema
  - All indexes and constraints
  - Ready for direct import into PostgreSQL

- **`MigrationRunner.js`** — Migration orchestration engine
  - Tracks applied migrations in `_migrations` table
  - Applies migrations in order
  - Skips already-applied migrations
  - Supports rollback infrastructure (stub)

- **`SQLiteTranslator.js`** — Programmatic DDL translation
  - Converts SQLite DDL to PostgreSQL
  - Translates types: REAL → DOUBLE PRECISION, etc.
  - Converts defaults: datetime('now') → NOW()
  - Validates generated SQL syntax

### Migration SQL Files

Located in `pg_migrations/`:

- **`001_initial_schema.sql`** — Core tables (assignments, cases, generation, memory)
- **`002_generation_tables.sql`** — Generation pipeline specific tables (planned)
- **`003_brain_tables.sql`** — Knowledge brain tables (planned)
- **`004_phase3_tables.sql`** — Phase 3 tables (planned)
- **`005_indexes_and_constraints.sql`** — All indexes and constraints (planned)

### Tests

- **`tests/vitest/pgSchemaTranslation.test.mjs`** — 40+ test cases
  - SQLiteTranslator validation
  - Schema catalog verification
  - Migration runner functionality
  - Integration tests

## Schema Structure

### Core Tables (101 total)

**Core Management:**
- assignments, case_records, case_facts, case_outputs, case_history

**Generation Pipeline:**
- report_plans, generation_runs, section_jobs, generated_sections

**Memory & Retrieval:**
- memory_items, retrieval_cache, analysis_artifacts
- ingest_jobs, staged_memory_reviews

**Phase 6 (Voice & Approved Memory):**
- approved_memory, voice_profiles, voice_rules
- comp_commentary_memory, memory_staging_candidates

**Phase 7 (QC):**
- qc_runs, qc_findings

**Phase 9 (Insertion & Destination):**
- insertion_runs, insertion_run_items, destination_profiles

**Phase 10 (Operations):**
- audit_events, case_timeline_events, operational_metrics

**Phase 11 (Learning):**
- assignment_archives, learned_patterns, pattern_applications

**Phase 12 (Business):**
- fee_quotes, engagement_records, invoices, pipeline_entries

**Phase 13 (Inspection):**
- inspections, inspection_photos, inspection_measurements, inspection_conditions

**Phase 14 (Export):**
- export_jobs, delivery_records, export_templates

**Phase 15 (Security):**
- users, access_policies, access_log, data_retention_rules, compliance_records

**Phase 16 (Contradiction Resolution):**
- contradiction_resolutions

**Phase 17 (Valuation):**
- income_approach_data, cost_approach_data, reconciliation_data

**Phase 18 (Learning Loop):**
- revision_diffs, suggestion_outcomes

**Phase 19 (Security Completion):**
- encryption_keys, backup_records, backup_schedule
- tenant_configs, feature_flags, billing_events

**Phase 20 (AutoTune):**
- autotune_ema_state, autotune_outcomes
- voice_reference_embeddings, stm_normalization_log

**Pipeline (Data Pipeline):**
- pipeline_cache, pipeline_crawl_jobs, pipeline_presets

**Brain (Knowledge Graph):**
- model_registry, graph_nodes, graph_edges
- brain_chat_history, ai_cost_log

## Usage

### 1. Quick Start (Single File)

```sql
-- Import complete PostgreSQL schema
psql -U postgres -d cacc_writer < server/db/postgresql/pg_schema.sql
```

### 2. Migrated Approach (Programmatic)

```javascript
import { MigrationRunner } from './MigrationRunner.js';
import { PostgresAdapter } from './adapters/postgresAdapter.js';
import fs from 'fs';

const adapter = new PostgresAdapter(config);
const runner = new MigrationRunner(adapter);

await runner.init();
const results = await runner.runAll('./pg_migrations', fs);
console.log(results);
// { applied: ['001_initial_schema'], skipped: [], failed: [] }
```

### 3. Schema Catalog Access

```javascript
import { SCHEMA_CATALOG, TABLE_COUNT } from './schema_catalog.js';

console.log(`Total tables: ${TABLE_COUNT}`);

for (const table of SCHEMA_CATALOG.tables) {
  console.log(`\nTable: ${table.name}`);
  for (const col of table.columns) {
    console.log(`  ${col.name}: ${col.pgType}`);
  }
}
```

### 4. Manual DDL Translation

```javascript
import { translateDDL, validatePostgresSQL } from './SQLiteTranslator.js';

const sqliteDDL = 'id INTEGER PRIMARY KEY AUTOINCREMENT';
const pgDDL = translateDDL(sqliteDDL);
console.log(pgDDL); // id SERIAL PRIMARY KEY

if (validatePostgresSQL(pgDDL)) {
  console.log('Valid PostgreSQL syntax');
}
```

## Key Translations

### Column Types

| SQLite | PostgreSQL |
|--------|-----------|
| INTEGER PRIMARY KEY AUTOINCREMENT | SERIAL PRIMARY KEY |
| TEXT | TEXT |
| REAL | DOUBLE PRECISION |
| INTEGER | INTEGER |
| (implicit BOOLEAN) | BOOLEAN |

### Default Values

| SQLite | PostgreSQL |
|--------|-----------|
| datetime('now') | NOW() |
| CURRENT_TIMESTAMP | CURRENT_TIMESTAMP |

### Constraints

All PRIMARY KEY, FOREIGN KEY, UNIQUE, CHECK constraints are preserved as-is.

## Migration Tracking

The `_migrations` table tracks all applied migrations:

```sql
CREATE TABLE cacc._migrations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);
```

Migrations are never re-applied; they're skipped if the name already exists.

## Testing

Run the full test suite:

```bash
npm test tests/vitest/pgSchemaTranslation.test.mjs
```

Tests cover:
- Type conversion accuracy
- Schema catalog completeness
- Migration tracking
- SQL validation
- Integration scenarios

## Deployment Strategy

### Phase 1: Development
- Use SQLite locally (default)
- Test with both SQLite and PostgreSQL via feature flags

### Phase 2: Staging
- Deploy PostgreSQL in staging
- Run migrations via MigrationRunner
- Validate data consistency

### Phase 3: Production
- Zero-downtime migration via separate PostgreSQL instance
- Use MigrationRunner for controlled rollout
- Fallback to SQLite if issues occur

## Architecture Notes

1. **Schema-First Design** — `cacc` schema isolates all app tables
2. **Adapter Pattern** — Database operations abstracted via adapter interface
3. **Idempotent Migrations** — Each migration can be safely re-run
4. **Type Safety** — Catalog provides runtime schema introspection
5. **No Manual DDL** — Use MigrationRunner for all schema changes

## Future Work

- [ ] Implement `MigrationRunner.rollback()`
- [ ] Add migration timestamps for correlation
- [ ] Build migration diff/validation tool
- [ ] Support schema versioning
- [ ] Add JSON/JSONB upgrade path
- [ ] Partition large tables (audit_events, access_log)
- [ ] Add materialized views for common queries

## References

- PostgreSQL DDL: https://www.postgresql.org/docs/current/sql-createtable.html
- SQLite → PostgreSQL: https://wiki.postgresql.org/wiki/SQLite_or_PostgreSQL
- Migration Patterns: https://databasechangelog.org/
