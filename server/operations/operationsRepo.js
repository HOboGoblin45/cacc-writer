/**
 * server/operations/operationsRepo.js
 * -------------------------------------
 * Phase 10 — Operations Repository
 *
 * SQLite CRUD for:
 *   - audit_events (query, count, purge)
 *   - case_timeline_events (query by case)
 *   - operational_metrics (store/query snapshots)
 *
 * All reads are synchronous (better-sqlite3).
 * Write operations for audit_events are handled by auditLogger.js.
 * This module handles reads and metric writes.
 */

import { getDb } from '../db/database.js';
import { randomUUID } from 'crypto';

// ── Audit Events ──────────────────────────────────────────────────────────────

/**
 * Query audit events with flexible filters.
 *
 * @param {import('./types.js').AuditQueryOptions} opts
 * @returns {Array<import('./types.js').AuditEvent>}
 */
export function queryAuditEvents(opts = {}) {
  const db = getDb();
  const clauses = [];
  const params = [];

  if (opts.caseId) {
    clauses.push('case_id = ?');
    params.push(opts.caseId);
  }
  if (opts.category) {
    clauses.push('category = ?');
    params.push(opts.category);
  }
  if (opts.eventType) {
    clauses.push('event_type = ?');
    params.push(opts.eventType);
  }
  if (opts.entityType) {
    clauses.push('entity_type = ?');
    params.push(opts.entityType);
  }
  if (opts.entityId) {
    clauses.push('entity_id = ?');
    params.push(opts.entityId);
  }
  if (opts.severity) {
    clauses.push('severity = ?');
    params.push(opts.severity);
  }
  if (opts.since) {
    clauses.push('created_at >= ?');
    params.push(opts.since);
  }
  if (opts.until) {
    clauses.push('created_at <= ?');
    params.push(opts.until);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(opts.limit || 100, 1000);
  const offset = opts.offset || 0;

  const sql = `SELECT * FROM audit_events ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params);
  return rows.map(parseAuditRow);
}

/**
 * Count audit events matching filters.
 *
 * @param {import('./types.js').AuditQueryOptions} opts
 * @returns {number}
 */
export function countAuditEvents(opts = {}) {
  const db = getDb();
  const clauses = [];
  const params = [];

  if (opts.caseId) { clauses.push('case_id = ?'); params.push(opts.caseId); }
  if (opts.category) { clauses.push('category = ?'); params.push(opts.category); }
  if (opts.eventType) { clauses.push('event_type = ?'); params.push(opts.eventType); }
  if (opts.severity) { clauses.push('severity = ?'); params.push(opts.severity); }
  if (opts.since) { clauses.push('created_at >= ?'); params.push(opts.since); }
  if (opts.until) { clauses.push('created_at <= ?'); params.push(opts.until); }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const sql = `SELECT COUNT(*) as cnt FROM audit_events ${where}`;

  const row = db.prepare(sql).get(...params);
  return row?.cnt || 0;
}

/**
 * Get a single audit event by ID.
 *
 * @param {string} id
 * @returns {import('./types.js').AuditEvent|null}
 */
export function getAuditEvent(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM audit_events WHERE id = ?').get(id);
  return row ? parseAuditRow(row) : null;
}

/**
 * Get distinct event types present in audit_events.
 *
 * @returns {Array<string>}
 */
export function getAuditEventTypes() {
  const db = getDb();
  const rows = db.prepare('SELECT DISTINCT event_type FROM audit_events ORDER BY event_type').all();
  return rows.map(r => r.event_type);
}

/**
 * Get audit event counts grouped by category.
 *
 * @param {string} [since] - ISO timestamp
 * @returns {Record<string, number>}
 */
export function getAuditCountsByCategory(since) {
  const db = getDb();
  let sql = 'SELECT category, COUNT(*) as cnt FROM audit_events';
  const params = [];
  if (since) {
    sql += ' WHERE created_at >= ?';
    params.push(since);
  }
  sql += ' GROUP BY category ORDER BY cnt DESC';

  const rows = db.prepare(sql).all(...params);
  const result = {};
  for (const r of rows) result[r.category] = r.cnt;
  return result;
}

// ── Case Timeline ─────────────────────────────────────────────────────────────

/**
 * Query case timeline events.
 *
 * @param {import('./types.js').TimelineQueryOptions} opts
 * @returns {Array<import('./types.js').CaseTimelineEvent>}
 */
export function queryCaseTimeline(opts) {
  const db = getDb();
  const clauses = ['case_id = ?'];
  const params = [opts.caseId];

  if (opts.category) {
    clauses.push('category = ?');
    params.push(opts.category);
  }
  if (opts.since) {
    clauses.push('created_at >= ?');
    params.push(opts.since);
  }
  if (opts.until) {
    clauses.push('created_at <= ?');
    params.push(opts.until);
  }

  const where = `WHERE ${clauses.join(' AND ')}`;
  const limit = Math.min(opts.limit || 50, 500);
  const offset = opts.offset || 0;

  const sql = `SELECT * FROM case_timeline_events ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params);
  return rows.map(parseTimelineRow);
}

/**
 * Count timeline events for a case.
 *
 * @param {string} caseId
 * @param {string} [category]
 * @returns {number}
 */
export function countCaseTimelineEvents(caseId, category) {
  const db = getDb();
  let sql = 'SELECT COUNT(*) as cnt FROM case_timeline_events WHERE case_id = ?';
  const params = [caseId];
  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  const row = db.prepare(sql).get(...params);
  return row?.cnt || 0;
}

/**
 * Get timeline event category counts for a case.
 *
 * @param {string} caseId
 * @returns {Record<string, number>}
 */
export function getCaseTimelineCategoryCounts(caseId) {
  const db = getDb();
  const rows = db.prepare(
    'SELECT category, COUNT(*) as cnt FROM case_timeline_events WHERE case_id = ? GROUP BY category ORDER BY cnt DESC'
  ).all(caseId);
  const result = {};
  for (const r of rows) result[r.category] = r.cnt;
  return result;
}

// ── Operational Metrics ───────────────────────────────────────────────────────

/**
 * Store an operational metric snapshot.
 *
 * @param {string} metricType
 * @param {string} periodStart - ISO date
 * @param {string} periodEnd - ISO date
 * @param {Object} data
 * @returns {string} metric ID
 */
export function storeMetric(metricType, periodStart, periodEnd, data) {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const dataStr = JSON.stringify(data);

  db.prepare(`
    INSERT INTO operational_metrics (id, metric_type, period_start, period_end, data_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, metricType, periodStart, periodEnd, dataStr, now);

  return id;
}

/**
 * Query operational metrics.
 *
 * @param {Object} opts
 * @param {string} [opts.metricType]
 * @param {string} [opts.since]
 * @param {string} [opts.until]
 * @param {number} [opts.limit=30]
 * @returns {Array<import('./types.js').OperationalMetric>}
 */
export function queryMetrics(opts = {}) {
  const db = getDb();
  const clauses = [];
  const params = [];

  if (opts.metricType) {
    clauses.push('metric_type = ?');
    params.push(opts.metricType);
  }
  if (opts.since) {
    clauses.push('period_start >= ?');
    params.push(opts.since);
  }
  if (opts.until) {
    clauses.push('period_end <= ?');
    params.push(opts.until);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(opts.limit || 30, 365);

  const sql = `SELECT * FROM operational_metrics ${where} ORDER BY period_start DESC LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(sql).all(...params);
  return rows.map(parseMetricRow);
}

/**
 * Get the latest metric of a given type.
 *
 * @param {string} metricType
 * @returns {import('./types.js').OperationalMetric|null}
 */
export function getLatestMetric(metricType) {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM operational_metrics WHERE metric_type = ? ORDER BY period_start DESC LIMIT 1'
  ).get(metricType);
  return row ? parseMetricRow(row) : null;
}

// ── Purge / Retention ─────────────────────────────────────────────────────────

/**
 * Purge audit events older than a given date.
 * Only for transient/debug events — meaningful history should not be purged.
 *
 * @param {string} olderThan - ISO timestamp
 * @param {Array<string>} [categoriesOnly] - If provided, only purge these categories
 * @returns {number} rows deleted
 */
export function purgeAuditEvents(olderThan, categoriesOnly) {
  const db = getDb();
  let sql = 'DELETE FROM audit_events WHERE created_at < ?';
  const params = [olderThan];

  if (categoriesOnly && categoriesOnly.length > 0) {
    const placeholders = categoriesOnly.map(() => '?').join(',');
    sql += ` AND category IN (${placeholders})`;
    params.push(...categoriesOnly);
  }

  const result = db.prepare(sql).run(...params);
  return result.changes;
}

/**
 * Purge case timeline events older than a given date.
 *
 * @param {string} olderThan
 * @returns {number}
 */
export function purgeTimelineEvents(olderThan) {
  const db = getDb();
  const result = db.prepare('DELETE FROM case_timeline_events WHERE created_at < ?').run(olderThan);
  return result.changes;
}

/**
 * Purge operational metrics older than a given date.
 *
 * @param {string} olderThan
 * @returns {number}
 */
export function purgeMetrics(olderThan) {
  const db = getDb();
  const result = db.prepare('DELETE FROM operational_metrics WHERE created_at < ?').run(olderThan);
  return result.changes;
}

// ── Row Parsers ───────────────────────────────────────────────────────────────

function parseAuditRow(row) {
  return {
    ...row,
    detail_json: safeParseJSON(row.detail_json, {}),
  };
}

function parseTimelineRow(row) {
  return {
    ...row,
    detail_json: safeParseJSON(row.detail_json, {}),
  };
}

function parseMetricRow(row) {
  return {
    ...row,
    data_json: safeParseJSON(row.data_json, {}),
  };
}

function safeParseJSON(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

export default {
  queryAuditEvents,
  countAuditEvents,
  getAuditEvent,
  getAuditEventTypes,
  getAuditCountsByCategory,
  queryCaseTimeline,
  countCaseTimelineEvents,
  getCaseTimelineCategoryCounts,
  storeMetric,
  queryMetrics,
  getLatestMetric,
  purgeAuditEvents,
  purgeTimelineEvents,
  purgeMetrics,
};
