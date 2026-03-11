/**
 * server/operations/retentionManager.js
 * ----------------------------------------
 * Phase 10 — Retention & Archival Manager
 *
 * Handles:
 *   - Case archival (hidden + retained + restorable, NOT destructive)
 *   - Case restoration from archive
 *   - Cleanup of transient artifacts (retrieval cache, temp files)
 *   - Optional purge of old operational metrics (not audit trail by default)
 *
 * Default policy: unlimited retention for meaningful operational history.
 * Only transient/debug/cache artifacts are cleaned up.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db/database.js';
import { purgeMetrics } from './operationsRepo.js';
import { emitCaseEvent, emitSystemEvent } from './auditLogger.js';
import log from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_DIR = path.join(__dirname, '..', '..', 'cases');

// ── Default Retention Policy ──────────────────────────────────────────────────

/** @type {import('./types.js').RetentionPolicy} */
const DEFAULT_POLICY = {
  auditEventsDays: null,           // unlimited — never auto-purge audit trail
  operationalMetricsDays: null,    // unlimited — keep all metric snapshots
  retrievalCacheHours: 1,          // 1 hour TTL (existing behavior)
  archivePreservesHistory: true,   // archive = hidden, not deleted
};

// ── Case Archival ─────────────────────────────────────────────────────────────

/**
 * Archive a case. Sets status to 'archived' in meta.json.
 * Does NOT delete any data. Case remains fully restorable.
 *
 * @param {string} caseId
 * @returns {{ success: boolean, message: string }}
 */
export function archiveCase(caseId) {
  try {
    const metaPath = path.join(CASES_DIR, caseId, 'meta.json');
    if (!fs.existsSync(metaPath)) {
      return { success: false, message: `Case ${caseId} not found` };
    }

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const previousStatus = meta.status;

    if (meta.status === 'archived') {
      return { success: true, message: 'Case already archived' };
    }

    meta.status = 'archived';
    meta.archivedAt = new Date().toISOString();
    meta.previousStatus = previousStatus;

    // Add to pipeline history
    if (!meta.pipelineHistory) meta.pipelineHistory = [];
    meta.pipelineHistory.push({
      stage: 'archived',
      timestamp: meta.archivedAt,
      from: previousStatus,
    });

    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');

    emitCaseEvent(caseId, 'case.archived', `Case archived (was: ${previousStatus})`, {
      previousStatus,
      archivedAt: meta.archivedAt,
    });

    log.info('retention:case-archived', { caseId, previousStatus });
    return { success: true, message: `Case ${caseId} archived` };
  } catch (err) {
    log.error('retention:archive-error', { caseId, error: err.message });
    return { success: false, message: err.message };
  }
}

/**
 * Restore a case from archive. Sets status back to previous status.
 *
 * @param {string} caseId
 * @returns {{ success: boolean, message: string }}
 */
export function restoreCase(caseId) {
  try {
    const metaPath = path.join(CASES_DIR, caseId, 'meta.json');
    if (!fs.existsSync(metaPath)) {
      return { success: false, message: `Case ${caseId} not found` };
    }

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

    if (meta.status !== 'archived') {
      return { success: true, message: `Case is not archived (status: ${meta.status})` };
    }

    const restoredStatus = meta.previousStatus || 'active';
    meta.status = restoredStatus;
    meta.restoredAt = new Date().toISOString();
    delete meta.previousStatus;

    if (!meta.pipelineHistory) meta.pipelineHistory = [];
    meta.pipelineHistory.push({
      stage: 'restored',
      timestamp: meta.restoredAt,
      from: 'archived',
      to: restoredStatus,
    });

    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');

    emitCaseEvent(caseId, 'case.restored', `Case restored to ${restoredStatus}`, {
      restoredStatus,
      restoredAt: meta.restoredAt,
    });

    log.info('retention:case-restored', { caseId, restoredStatus });
    return { success: true, message: `Case ${caseId} restored to ${restoredStatus}` };
  } catch (err) {
    log.error('retention:restore-error', { caseId, error: err.message });
    return { success: false, message: err.message };
  }
}

/**
 * List archived cases.
 *
 * @returns {Array<{ caseId: string, archivedAt: string, address: string }>}
 */
export function listArchivedCases() {
  const archived = [];
  try {
    if (!fs.existsSync(CASES_DIR)) return archived;

    const dirs = fs.readdirSync(CASES_DIR).filter(f => {
      return fs.statSync(path.join(CASES_DIR, f)).isDirectory();
    });

    for (const dir of dirs) {
      try {
        const metaPath = path.join(CASES_DIR, dir, 'meta.json');
        if (!fs.existsSync(metaPath)) continue;
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        if (meta.status === 'archived') {
          archived.push({
            caseId: dir,
            archivedAt: meta.archivedAt || null,
            address: meta.address || meta.subject?.address || 'Unknown',
            formType: meta.formType || meta.form_type || 'unknown',
          });
        }
      } catch (err) { log.warn('retention:list-read-case', { dir, error: err.message }); }
    }
  } catch (err) { log.warn('retention:list-archived', { error: err.message }); }

  return archived;
}

// ── Transient Cleanup ─────────────────────────────────────────────────────────

/**
 * Clean up expired retrieval cache entries.
 *
 * @returns {number} entries purged
 */
export function purgeExpiredRetrievalCache() {
  try {
    const db = getDb();
    const now = new Date().toISOString();
    const result = db.prepare('DELETE FROM retrieval_cache WHERE expires_at < ?').run(now);
    const purged = result.changes;
    if (purged > 0) {
      log.info('retention:cache-purged', { entries: purged });
    }
    return purged;
  } catch (err) {
    log.warn('retention:cache-purge-error', { error: err.message });
    return 0;
  }
}

/**
 * Run all transient cleanup tasks.
 * Safe to call periodically (e.g., on server startup or daily).
 *
 * @returns {import('./types.js').RetentionResult}
 */
export function runTransientCleanup() {
  const result = {
    auditEventsPurged: 0,
    metricsPurged: 0,
    cacheEntriesPurged: 0,
    executedAt: new Date().toISOString(),
  };

  // Purge expired retrieval cache
  result.cacheEntriesPurged = purgeExpiredRetrievalCache();

  // Note: We do NOT purge audit events or metrics by default (unlimited retention).
  // This function only cleans transient/cache artifacts.

  if (result.cacheEntriesPurged > 0) {
    emitSystemEvent('system.cleanup', `Transient cleanup: ${result.cacheEntriesPurged} cache entries purged`, result);
  }

  return result;
}

/**
 * Manual purge of old operational metrics (admin action only).
 * Not called automatically — requires explicit user action.
 *
 * @param {number} olderThanDays
 * @returns {number} metrics purged
 */
export function manualPurgeMetrics(olderThanDays) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  const purged = purgeMetrics(cutoff);
  if (purged > 0) {
    emitSystemEvent('system.cleanup', `Manual metrics purge: ${purged} entries older than ${olderThanDays} days`, {
      olderThanDays,
      purged,
    });
    log.info('retention:metrics-purged', { olderThanDays, purged });
  }
  return purged;
}

/**
 * Get current retention policy (read-only for now).
 *
 * @returns {import('./types.js').RetentionPolicy}
 */
export function getRetentionPolicy() {
  return { ...DEFAULT_POLICY };
}

export default {
  archiveCase,
  restoreCase,
  listArchivedCases,
  purgeExpiredRetrievalCache,
  runTransientCleanup,
  manualPurgeMetrics,
  getRetentionPolicy,
};
