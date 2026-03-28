/**
 * server/db/dbMonitor.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Database health monitoring for SQLite/better-sqlite3.
 *
 * Since better-sqlite3 uses a single synchronous connection (no pool),
 * this module monitors:
 *   - Connection state (open/closed)
 *   - Database file size and WAL file size
 *   - SQLite integrity check
 *   - WAL checkpoint status
 *   - Table row counts for key tables
 *   - Query execution timing (slow query detection)
 */

import fs from 'fs';
import log from '../logger.js';
import { getDb, getDbPath, getDbSizeBytes } from './database.js';

// ── Slow query tracking ─────────────────────────────────────────────────────
const _slowQueries = [];
const MAX_SLOW_QUERIES = 50;
const SLOW_QUERY_THRESHOLD_MS = 500;

/**
 * Record a query execution time. If it exceeds the threshold, log and store it.
 *
 * @param {string} sql — the SQL statement (first 200 chars)
 * @param {number} durationMs — execution time in milliseconds
 * @param {string} [context] — caller context (route, feature, etc.)
 */
export function recordQueryTime(sql, durationMs, context) {
  if (durationMs >= SLOW_QUERY_THRESHOLD_MS) {
    const entry = {
      sql: String(sql).slice(0, 200),
      durationMs,
      context: context || 'unknown',
      timestamp: new Date().toISOString(),
    };
    _slowQueries.push(entry);
    if (_slowQueries.length > MAX_SLOW_QUERIES) {
      _slowQueries.shift();
    }
    log.warn('db:slow-query', entry);
  }
}

/**
 * Get the list of recent slow queries.
 * @returns {Array<{ sql: string, durationMs: number, context: string, timestamp: string }>}
 */
export function getSlowQueries() {
  return [..._slowQueries];
}

/**
 * Clear slow query history.
 */
export function clearSlowQueries() {
  _slowQueries.length = 0;
}

/**
 * Get WAL file size in bytes.
 * @returns {number}
 */
export function getWalSizeBytes() {
  const walPath = getDbPath() + '-wal';
  try {
    return fs.statSync(walPath).size;
  } catch {
    return 0;
  }
}

/**
 * Get comprehensive database health status.
 *
 * @returns {{
 *   connected: boolean,
 *   dbPath: string,
 *   dbSizeBytes: number,
 *   dbSizeMB: string,
 *   walSizeBytes: number,
 *   walSizeMB: string,
 *   journalMode: string,
 *   foreignKeys: boolean,
 *   slowQueries: number,
 *   checkedAt: string,
 * }}
 */
export function getDbHealth() {
  const dbPath = getDbPath();
  const dbSize = getDbSizeBytes();
  const walSize = getWalSizeBytes();

  let connected = false;
  let journalMode = 'unknown';
  let foreignKeys = false;

  try {
    const db = getDb();
    // Quick connectivity check
    db.prepare('SELECT 1').get();
    connected = true;
    journalMode = db.pragma('journal_mode', { simple: true }) || 'unknown';
    foreignKeys = db.pragma('foreign_keys', { simple: true }) === 1;
  } catch {
    connected = false;
  }

  return {
    connected,
    dbPath,
    dbSizeBytes: dbSize,
    dbSizeMB: (dbSize / (1024 * 1024)).toFixed(2),
    walSizeBytes: walSize,
    walSizeMB: (walSize / (1024 * 1024)).toFixed(2),
    journalMode,
    foreignKeys,
    slowQueries: _slowQueries.length,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Run SQLite integrity check.
 * Returns 'ok' if the database is healthy, or a list of issues.
 *
 * @returns {{ ok: boolean, result: string }}
 */
export function runIntegrityCheck() {
  try {
    const db = getDb();
    const rows = db.pragma('integrity_check');
    const results = rows.map(r => r.integrity_check);
    const isOk = results.length === 1 && results[0] === 'ok';
    return { ok: isOk, result: isOk ? 'ok' : results.join('; ') };
  } catch (err) {
    return { ok: false, result: err.message };
  }
}

/**
 * Checkpoint the WAL file to reduce its size.
 * @returns {{ ok: boolean, walPages: number, movedPages: number }}
 */
export function checkpointWal() {
  try {
    const db = getDb();
    const result = db.pragma('wal_checkpoint(TRUNCATE)');
    const row = result[0] || {};
    return {
      ok: row.busy === 0,
      walPages: row.log || 0,
      movedPages: row.checkpointed || 0,
    };
  } catch (err) {
    log.error('db:checkpoint-failed', { error: err.message });
    return { ok: false, walPages: 0, movedPages: 0 };
  }
}

/**
 * Get row counts for important tables.
 * @returns {{ [tableName: string]: number }}
 */
export function getTableStats() {
  const tables = [
    'users', 'subscriptions', 'case_records', 'generated_sections',
    'user_approved_sections', 'export_jobs', 'ai_cost_log',
  ];
  const counts = {};
  try {
    const db = getDb();
    for (const table of tables) {
      try {
        const row = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get();
        counts[table] = row?.c || 0;
      } catch {
        // Table might not exist yet
        counts[table] = -1;
      }
    }
  } catch {
    // DB not connected
  }
  return counts;
}

export default {
  recordQueryTime,
  getSlowQueries,
  clearSlowQueries,
  getWalSizeBytes,
  getDbHealth,
  runIntegrityCheck,
  checkpointWal,
  getTableStats,
};
