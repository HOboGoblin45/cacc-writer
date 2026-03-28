/**
 * server/operations/healthDiagnostics.js
 * ----------------------------------------
 * Phase 10 — Health Diagnostics
 *
 * Practical, restrained health checks:
 *   - DB healthy/degraded
 *   - Document storage healthy/degraded
 *   - Orchestrator available/unavailable
 *   - QC engine available/unavailable
 *   - ACI agent reachable/unreachable
 *   - RQ agent reachable/unreachable
 *   - DB stats (table counts, size, WAL)
 *
 * Avoids noisy pseudo-monitoring. Returns structured diagnostics.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, getDbPath } from '../db/database.js';
import log from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_DIR = path.join(__dirname, '..', '..', 'cases');

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run full health diagnostics.
 *
 * @returns {Promise<import('./types.js').HealthDiagnosticsResult>}
 */
export async function runHealthDiagnostics() {
  const checkedAt = new Date().toISOString();

  const [database, documentStorage, orchestrator, qcEngine, aciAgent, rqAgent] = await Promise.all([
    checkDatabase(),
    checkDocumentStorage(),
    checkOrchestrator(),
    checkQcEngine(),
    checkAgent('ACI', 'http://localhost:5180/health'),
    checkAgent('RQ', 'http://localhost:5181/health'),
  ]);

  const dbStats = getDbStats();

  return {
    database,
    documentStorage,
    orchestrator,
    qcEngine,
    aciAgent,
    rqAgent,
    dbStats,
    checkedAt,
  };
}

/**
 * Quick health check — returns a simple status string.
 *
 * @returns {Promise<'healthy' | 'degraded' | 'unavailable'>}
 */
export async function quickHealthCheck() {
  try {
    const diag = await runHealthDiagnostics();
    const statuses = [
      diag.database.status,
      diag.documentStorage.status,
      diag.orchestrator.status,
      diag.qcEngine.status,
    ];

    if (statuses.includes('unavailable')) return 'degraded';
    if (statuses.every(s => s === 'healthy')) return 'healthy';
    return 'degraded';
  } catch {
    return 'unavailable';
  }
}

// ── Individual Checks ─────────────────────────────────────────────────────────

/**
 * Check database health.
 * @returns {Promise<import('./types.js').ServiceHealth>}
 */
async function checkDatabase() {
  try {
    const db = getDb();
    // Quick integrity check — just verify we can read
    const row = db.prepare('SELECT 1 as ok').get();
    if (row?.ok !== 1) {
      return { status: 'degraded', detail: 'SELECT 1 returned unexpected result' };
    }

    // Check WAL mode
    const walRow = db.prepare('PRAGMA journal_mode').get();
    const journalMode = walRow?.journal_mode || 'unknown';

    // Check if tables exist
    const tableCount = db.prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table'").get();

    return {
      status: 'healthy',
      detail: `journal=${journalMode}, tables=${tableCount?.cnt || 0}`,
    };
  } catch (err) {
    return { status: 'unavailable', detail: err.message };
  }
}

/**
 * Check document storage (cases directory).
 * @returns {Promise<import('./types.js').ServiceHealth>}
 */
async function checkDocumentStorage() {
  try {
    if (!fs.existsSync(CASES_DIR)) {
      return { status: 'degraded', detail: 'cases/ directory does not exist' };
    }

    // Check if writable
    const testFile = path.join(CASES_DIR, '.health-check');
    fs.writeFileSync(testFile, 'ok', 'utf8');
    fs.unlinkSync(testFile);

    const caseCount = fs.readdirSync(CASES_DIR).filter(f => {
      const fp = path.join(CASES_DIR, f);
      return fs.statSync(fp).isDirectory();
    }).length;

    return {
      status: 'healthy',
      detail: `${caseCount} case directories`,
    };
  } catch (err) {
    return { status: 'degraded', detail: err.message };
  }
}

/**
 * Check orchestrator availability.
 * @returns {Promise<import('./types.js').ServiceHealth>}
 */
async function checkOrchestrator() {
  try {
    // Check if the orchestrator module can be loaded
    // We just verify the generation_runs table is accessible
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) as cnt FROM generation_runs').get();
    return {
      status: 'healthy',
      detail: `${row?.cnt || 0} generation runs recorded`,
    };
  } catch (err) {
    return { status: 'unavailable', detail: err.message };
  }
}

/**
 * Check QC engine availability.
 * @returns {Promise<import('./types.js').ServiceHealth>}
 */
async function checkQcEngine() {
  try {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) as cnt FROM qc_runs').get();
    return {
      status: 'healthy',
      detail: `${row?.cnt || 0} QC runs recorded`,
    };
  } catch (err) {
    return { status: 'unavailable', detail: err.message };
  }
}

/**
 * Check an external agent's health endpoint.
 *
 * @param {string} name
 * @param {string} url
 * @returns {Promise<import('./types.js').ServiceHealth>}
 */
async function checkAgent(name, url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (resp.ok) {
      return { status: 'healthy', detail: `${name} agent responding` };
    }
    return { status: 'degraded', detail: `${name} agent returned ${resp.status}` };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { status: 'offline', detail: `${name} agent timeout (3s)` };
    }
    return { status: 'offline', detail: `${name} agent unreachable: ${err.message}` };
  }
}

// ── DB Stats ──────────────────────────────────────────────────────────────────

/**
 * Get database statistics.
 *
 * @returns {Object}
 */
function getDbStats() {
  try {
    const db = getDb();
    const dbPath = getDbPath();

    // Table counts
    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name
    `).all().map(r => r.name);

    const tableCounts = {};
    for (const table of tables) {
      try {
        const row = db.prepare(`SELECT COUNT(*) as cnt FROM "${table}"`).get();
        tableCounts[table] = row?.cnt || 0;
      } catch {
        tableCounts[table] = -1; // error reading
      }
    }

    // DB file size
    let dbSizeBytes = 0;
    let walSizeBytes = 0;
    try {
      if (fs.existsSync(dbPath)) {
        dbSizeBytes = fs.statSync(dbPath).size;
      }
      const walPath = dbPath + '-wal';
      if (fs.existsSync(walPath)) {
        walSizeBytes = fs.statSync(walPath).size;
      }
    } catch { /* */ }

    // Page stats
    let pageCount = 0;
    let pageSize = 0;
    try {
      pageCount = db.prepare('PRAGMA page_count').get()?.page_count || 0;
      pageSize = db.prepare('PRAGMA page_size').get()?.page_size || 0;
    } catch { /* */ }

    return {
      tableCount: tables.length,
      tableCounts,
      dbSizeBytes,
      walSizeBytes,
      dbSizeMB: Math.round(dbSizeBytes / 1024 / 1024 * 100) / 100,
      walSizeMB: Math.round(walSizeBytes / 1024 / 1024 * 100) / 100,
      pageCount,
      pageSize,
    };
  } catch (err) {
    log.warn('health:db-stats-error', { error: err.message });
    return { error: err.message };
  }
}

export default {
  runHealthDiagnostics,
  quickHealthCheck,
};
