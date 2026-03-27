/**
 * server/db/database.js
 * ----------------------
 * SQLite database connection for Appraisal Agent.
 * Uses better-sqlite3 (synchronous, WAL mode, prepared statements).
 *
 * Database path: data/cacc-writer.db (default)
 * Override via env: CACC_DB_PATH=<absolute or relative path>
 *
 * Usage:
 *   import { getDb, dbAll, dbGet, dbRun, dbTransaction } from './db/database.js';
 *
 *   const rows = dbAll('SELECT * FROM generation_runs WHERE case_id = ?', [caseId]);
 *   const row  = dbGet('SELECT * FROM assignments WHERE case_id = ?', [caseId]);
 *   dbRun('INSERT INTO assignments (id, case_id, ...) VALUES (?, ?, ...)', [id, caseId, ...]);
 *   dbTransaction(() => { dbRun(...); dbRun(...); });
 */

import BetterSqlite3 from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { initSchema } from './schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// â”€â”€ Database path â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Default: <project-root>/data/cacc-writer.db
// Override: set CACC_DB_PATH env var to an absolute or relative path
const DEFAULT_DB_DIR  = path.join(__dirname, '..', '..', 'data');
const DEFAULT_DB_PATH = path.join(DEFAULT_DB_DIR, 'cacc-writer.db');

function resolveDbPath() {
  if (process.env.CACC_DB_PATH) {
    const p = path.resolve(process.env.CACC_DB_PATH);
    return p;
  }
  return DEFAULT_DB_PATH;
}

// â”€â”€ Singleton connection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let _db = null;

/**
 * Get (or initialize) the SQLite database connection.
 * Idempotent â€” safe to call multiple times.
 *
 * @returns {import('better-sqlite3').Database}
 */
export function getDb() {
  if (_db) return _db;

  const dbPath = resolveDbPath();
  const dbDir  = path.dirname(dbPath);

  // Ensure data directory exists
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  _db = new BetterSqlite3(dbPath);

  // Performance + safety pragmas
  _db.pragma('journal_mode = WAL');      // Write-Ahead Logging â€” faster concurrent reads
  _db.pragma('foreign_keys = ON');       // Enforce FK constraints
  _db.pragma('synchronous = NORMAL');    // Balance safety vs speed for local desktop use
  _db.pragma('cache_size = -8000');      // 8MB page cache
  _db.pragma('temp_store = MEMORY');     // Temp tables in memory

  // Initialize schema (idempotent â€” uses CREATE TABLE IF NOT EXISTS)
  initSchema(_db);

  return _db;
}

/**
 * Close the database connection.
 * Call this on process exit or in tests.
 */
export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/**
 * Get the resolved database file path.
 */
export function getDbPath() {
  return resolveDbPath();
}

/**
 * Get database file size in bytes (0 if not yet created).
 */
export function getDbSizeBytes() {
  const p = resolveDbPath();
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

// â”€â”€ Query helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Run a SELECT and return all matching rows.
 *
 * @param {string} sql
 * @param {any[]} params
 * @returns {any[]}
 */
export function dbAll(sql, params = []) {
  return getDb().prepare(sql).all(params);
}

/**
 * Run a SELECT and return the first matching row (or undefined).
 *
 * @param {string} sql
 * @param {any[]} params
 * @returns {any|undefined}
 */
export function dbGet(sql, params = []) {
  return getDb().prepare(sql).get(params);
}

/**
 * Run an INSERT / UPDATE / DELETE statement.
 * Returns the better-sqlite3 RunResult: { changes, lastInsertRowid }
 *
 * @param {string} sql
 * @param {any[]} params
 * @returns {{ changes: number, lastInsertRowid: number|bigint }}
 */
export function dbRun(sql, params = []) {
  return getDb().prepare(sql).run(params);
}

/**
 * Execute multiple statements inside a single transaction.
 * The callback receives no arguments â€” use dbRun() / dbAll() inside it.
 * Automatically rolls back on error.
 *
 * @param {() => void} fn
 * @returns {any} return value of fn
 */
export function dbTransaction(fn) {
  return getDb().transaction(fn)();
}

/**
 * Return row counts for all orchestrator tables.
 * Used by GET /api/db/status.
 *
 * @returns {{ [tableName: string]: number }}
 */
export function getTableCounts() {
  const tables = [
    'case_records',
    'case_facts',
    'case_outputs',
    'case_history',
    'assignments',
    'report_plans',
    'generation_runs',
    'section_jobs',
    'generated_sections',
    'memory_items',
    'retrieval_cache',
    'analysis_artifacts',
    'ingest_jobs',
    'staged_memory_reviews',
    'assignment_intelligence',
    'case_documents',
    'document_ingest_jobs',
    'document_extractions',
    'extracted_facts',
    'extracted_sections',
    'comp_candidates',
    'comp_scores',
    'comp_tier_assignments',
    'comp_acceptance_events',
    'comp_rejection_events',
    'adjustment_support_records',
    'adjustment_recommendations',
    'paired_sales_library_records',
    'comp_burden_metrics',
    'qc_runs',
    'qc_findings',
    'insertion_runs',
    'insertion_run_items',
    'destination_profiles',
    'audit_events',
    'case_timeline_events',
    'operational_metrics',
    'assignment_archives',
    'learned_patterns',
    'pattern_applications',
    'fee_quotes',
    'engagement_records',
    'invoices',
    'pipeline_entries',
    'inspections',
    'inspection_photos',
    'inspection_measurements',
    'inspection_conditions',
    'export_jobs',
    'delivery_records',
    'export_templates',
    'users',
    'access_policies',
    'access_log',
    'data_retention_rules',
    'compliance_records',
  ];

  const counts = {};
  const db = getDb();
  for (const t of tables) {
    try {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get();
      counts[t] = row?.n ?? 0;
    } catch {
      counts[t] = -1; // table may not exist yet in edge cases
    }
  }
  return counts;
}

