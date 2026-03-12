/**
 * server/security/retentionService.js
 * --------------------------------------
 * Phase 15 — Data Retention Service
 *
 * Manages data retention rules and executes lifecycle actions
 * (archive, delete, anonymize) on data that has exceeded its retention period.
 * All functions are synchronous (better-sqlite3).
 *
 * Usage:
 *   import { createRetentionRule, runRetentionCheck, seedDefaultRules } from './retentionService.js';
 */

import { randomUUID } from 'crypto';
import { dbAll, dbGet, dbRun, dbTransaction } from '../db/database.js';
import log from '../logger.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseJSON(val, fallback = null) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

function toJSON(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') return val;
  return JSON.stringify(val);
}

function genId() {
  return 'retn_' + randomUUID().slice(0, 12);
}

function now() {
  return new Date().toISOString();
}

/**
 * Compute an ISO date string N days ago from now.
 *
 * @param {number} days
 * @returns {string}
 */
function daysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

// ── Resource type to table mapping ──────────────────────────────────────────

const RESOURCE_TABLE_MAP = {
  case: { table: 'case_records', dateCol: 'updated_at', idCol: 'case_id' },
  export: { table: 'export_jobs', dateCol: 'created_at', idCol: 'id' },
  audit_log: { table: 'audit_events', dateCol: 'created_at', idCol: 'id' },
  access_log: { table: 'access_log', dateCol: 'created_at', idCol: 'id' },
  temp_files: { table: 'retrieval_cache', dateCol: 'created_at', idCol: 'id' },
  learning_data: { table: 'learned_patterns', dateCol: 'created_at', idCol: 'id' },
};

// ── Default retention rules ─────────────────────────────────────────────────

const DEFAULT_RULES = [
  {
    name: 'Case Archive — 7 Years',
    resource_type: 'case',
    retention_days: 2555, // ~7 years
    action: 'archive',
    conditions: { status: 'completed' },
  },
  {
    name: 'Audit Log Retention — 5 Years',
    resource_type: 'audit_log',
    retention_days: 1825, // ~5 years
    action: 'delete',
  },
  {
    name: 'Access Log Retention — 2 Years',
    resource_type: 'access_log',
    retention_days: 730, // ~2 years
    action: 'delete',
  },
  {
    name: 'Temp Files Cleanup — 30 Days',
    resource_type: 'temp_files',
    retention_days: 30,
    action: 'delete',
  },
];

// ── CRUD Operations ──────────────────────────────────────────────────────────

/**
 * Create a retention rule.
 *
 * @param {Object} data
 * @returns {{ id: string } | { error: string }}
 */
export function createRetentionRule(data) {
  if (!data.name || !data.resource_type || !data.retention_days || !data.action) {
    return { error: 'name, resource_type, retention_days, and action are required' };
  }

  const validActions = ['archive', 'delete', 'anonymize'];
  if (!validActions.includes(data.action)) {
    return { error: `Invalid action: ${data.action}. Must be one of: ${validActions.join(', ')}` };
  }

  const id = genId();
  const ts = now();

  // Compute next run: tomorrow at midnight
  const nextRun = new Date();
  nextRun.setDate(nextRun.getDate() + 1);
  nextRun.setHours(0, 0, 0, 0);

  try {
    dbRun(
      `INSERT INTO data_retention_rules (id, name, resource_type, retention_days, action, conditions_json, active, next_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.name,
        data.resource_type,
        data.retention_days,
        data.action,
        toJSON(data.conditions),
        data.active !== undefined ? (data.active ? 1 : 0) : 1,
        nextRun.toISOString(),
        ts,
        ts,
      ]
    );

    log.info('retention:rule-created', { id, name: data.name });
    return { id };
  } catch (err) {
    log.error('retention:create-error', { error: err.message });
    return { error: err.message };
  }
}

/**
 * Get a retention rule by ID.
 *
 * @param {string} id
 * @returns {Object|null}
 */
export function getRetentionRule(id) {
  const row = dbGet('SELECT * FROM data_retention_rules WHERE id = ?', [id]);
  if (!row) return null;
  return {
    ...row,
    conditions: parseJSON(row.conditions_json),
  };
}

/**
 * List retention rules with optional filters.
 *
 * @param {Object} [opts={}]
 * @param {string} [opts.resource_type]
 * @param {boolean} [opts.active]
 * @param {number} [opts.limit=50]
 * @param {number} [opts.offset=0]
 * @returns {{ rules: Object[], total: number }}
 */
export function listRetentionRules(opts = {}) {
  const conditions = [];
  const params = [];

  if (opts.resource_type) {
    conditions.push('resource_type = ?');
    params.push(opts.resource_type);
  }
  if (opts.active !== undefined) {
    conditions.push('active = ?');
    params.push(opts.active ? 1 : 0);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = opts.limit || 50;
  const offset = opts.offset || 0;

  const countRow = dbGet(`SELECT COUNT(*) AS n FROM data_retention_rules ${where}`, params);
  const total = countRow?.n ?? 0;

  const rows = dbAll(
    `SELECT * FROM data_retention_rules ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const rules = rows.map(row => ({
    ...row,
    conditions: parseJSON(row.conditions_json),
  }));

  return { rules, total };
}

/**
 * Update a retention rule.
 *
 * @param {string} id
 * @param {Object} updates
 * @returns {{ ok: boolean } | { error: string }}
 */
export function updateRetentionRule(id, updates) {
  const rule = dbGet('SELECT id FROM data_retention_rules WHERE id = ?', [id]);
  if (!rule) return { error: 'Retention rule not found' };

  const allowedFields = ['name', 'resource_type', 'retention_days', 'action', 'active'];
  const setClauses = [];
  const params = [];

  for (const [key, value] of Object.entries(updates)) {
    if (key === 'conditions') {
      setClauses.push('conditions_json = ?');
      params.push(toJSON(value));
    } else if (allowedFields.includes(key)) {
      setClauses.push(`${key} = ?`);
      params.push(key === 'active' ? (value ? 1 : 0) : value);
    }
  }

  if (setClauses.length === 0) return { error: 'No valid fields to update' };

  setClauses.push('updated_at = ?');
  params.push(now());
  params.push(id);

  try {
    dbRun(`UPDATE data_retention_rules SET ${setClauses.join(', ')} WHERE id = ?`, params);
    log.info('retention:rule-updated', { id });
    return { ok: true };
  } catch (err) {
    log.error('retention:update-error', { error: err.message, id });
    return { error: err.message };
  }
}

/**
 * Delete a retention rule.
 *
 * @param {string} id
 * @returns {{ ok: boolean } | { error: string }}
 */
export function deleteRetentionRule(id) {
  const rule = dbGet('SELECT id FROM data_retention_rules WHERE id = ?', [id]);
  if (!rule) return { error: 'Retention rule not found' };

  dbRun('DELETE FROM data_retention_rules WHERE id = ?', [id]);
  log.info('retention:rule-deleted', { id });
  return { ok: true };
}

// ── Retention Execution ─────────────────────────────────────────────────────

/**
 * Check all active retention rules and return items due for action.
 *
 * @returns {{ rules: Object[], totalItemsDue: number }}
 */
export function runRetentionCheck() {
  const rules = dbAll(
    `SELECT * FROM data_retention_rules WHERE active = 1 ORDER BY resource_type`,
    []
  );

  const results = [];
  let totalItemsDue = 0;

  for (const rule of rules) {
    const mapping = RESOURCE_TABLE_MAP[rule.resource_type];
    if (!mapping) {
      results.push({
        ruleId: rule.id,
        ruleName: rule.name,
        resource_type: rule.resource_type,
        itemsDue: 0,
        error: 'Unknown resource type',
      });
      continue;
    }

    const cutoffDate = daysAgo(rule.retention_days);
    const conditions = parseJSON(rule.conditions_json);

    let extraWhere = '';
    const params = [cutoffDate];

    if (conditions && conditions.status) {
      extraWhere = ' AND status = ?';
      params.push(conditions.status);
    }

    try {
      const countRow = dbGet(
        `SELECT COUNT(*) AS n FROM ${mapping.table} WHERE ${mapping.dateCol} < ?${extraWhere}`,
        params
      );

      const itemsDue = countRow?.n ?? 0;
      totalItemsDue += itemsDue;

      results.push({
        ruleId: rule.id,
        ruleName: rule.name,
        resource_type: rule.resource_type,
        action: rule.action,
        retention_days: rule.retention_days,
        cutoffDate,
        itemsDue,
      });
    } catch (err) {
      results.push({
        ruleId: rule.id,
        ruleName: rule.name,
        resource_type: rule.resource_type,
        itemsDue: 0,
        error: err.message,
      });
    }
  }

  return { rules: results, totalItemsDue };
}

/**
 * Execute a specific retention rule — archive, delete, or anonymize matching items.
 *
 * @param {string} ruleId
 * @returns {{ ok: boolean, itemsProcessed: number } | { error: string }}
 */
export function executeRetentionRule(ruleId) {
  const rule = dbGet('SELECT * FROM data_retention_rules WHERE id = ?', [ruleId]);
  if (!rule) return { error: 'Retention rule not found' };
  if (!rule.active) return { error: 'Retention rule is inactive' };

  const mapping = RESOURCE_TABLE_MAP[rule.resource_type];
  if (!mapping) return { error: `Unknown resource type: ${rule.resource_type}` };

  const cutoffDate = daysAgo(rule.retention_days);
  const conditions = parseJSON(rule.conditions_json);

  let extraWhere = '';
  const params = [cutoffDate];

  if (conditions && conditions.status) {
    extraWhere = ' AND status = ?';
    params.push(conditions.status);
  }

  let itemsProcessed = 0;

  try {
    if (rule.action === 'delete') {
      const result = dbRun(
        `DELETE FROM ${mapping.table} WHERE ${mapping.dateCol} < ?${extraWhere}`,
        params
      );
      itemsProcessed = result.changes;
    } else if (rule.action === 'archive') {
      // For archive, we set status to 'archived' if the table has a status column
      try {
        const result = dbRun(
          `UPDATE ${mapping.table} SET status = 'archived' WHERE ${mapping.dateCol} < ?${extraWhere}`,
          params
        );
        itemsProcessed = result.changes;
      } catch {
        // Table may not have a status column — log and skip
        log.warn('retention:archive-no-status', { ruleId, table: mapping.table });
        itemsProcessed = 0;
      }
    } else if (rule.action === 'anonymize') {
      // For anonymize, we clear PII fields if applicable
      try {
        const result = dbRun(
          `UPDATE ${mapping.table} SET user_agent = NULL, ip_address = NULL WHERE ${mapping.dateCol} < ?${extraWhere}`,
          params
        );
        itemsProcessed = result.changes;
      } catch {
        log.warn('retention:anonymize-not-supported', { ruleId, table: mapping.table });
        itemsProcessed = 0;
      }
    }

    // Update rule metadata
    const ts = now();
    const nextRun = new Date();
    nextRun.setDate(nextRun.getDate() + 1);

    dbRun(
      `UPDATE data_retention_rules
       SET last_run_at = ?, next_run_at = ?, items_processed = items_processed + ?, updated_at = ?
       WHERE id = ?`,
      [ts, nextRun.toISOString(), itemsProcessed, ts, ruleId]
    );

    log.info('retention:executed', { ruleId, action: rule.action, itemsProcessed });
    return { ok: true, itemsProcessed };
  } catch (err) {
    log.error('retention:execute-error', { error: err.message, ruleId });
    return { error: err.message };
  }
}

/**
 * Get a summary of all retention rules, their last runs, and upcoming actions.
 *
 * @returns {Object}
 */
export function getRetentionSummary() {
  const rules = dbAll('SELECT * FROM data_retention_rules ORDER BY resource_type', []);

  const summary = {
    totalRules: rules.length,
    activeRules: rules.filter(r => r.active).length,
    totalItemsProcessed: rules.reduce((sum, r) => sum + (r.items_processed || 0), 0),
    rules: rules.map(r => ({
      id: r.id,
      name: r.name,
      resource_type: r.resource_type,
      retention_days: r.retention_days,
      action: r.action,
      active: !!r.active,
      last_run_at: r.last_run_at,
      next_run_at: r.next_run_at,
      items_processed: r.items_processed || 0,
      conditions: parseJSON(r.conditions_json),
    })),
  };

  return summary;
}

/**
 * Seed default retention rules if none exist.
 *
 * @returns {{ created: number }}
 */
export function seedDefaultRules() {
  const existing = dbGet('SELECT COUNT(*) AS n FROM data_retention_rules');
  if (existing && existing.n > 0) {
    return { created: 0, message: 'Retention rules already exist — skipping seed' };
  }

  let created = 0;
  dbTransaction(() => {
    for (const rule of DEFAULT_RULES) {
      const id = genId();
      const ts = now();
      const nextRun = new Date();
      nextRun.setDate(nextRun.getDate() + 1);
      nextRun.setHours(0, 0, 0, 0);

      dbRun(
        `INSERT INTO data_retention_rules (id, name, resource_type, retention_days, action, conditions_json, active, next_run_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          rule.name,
          rule.resource_type,
          rule.retention_days,
          rule.action,
          rule.conditions ? JSON.stringify(rule.conditions) : null,
          1,
          nextRun.toISOString(),
          ts,
          ts,
        ]
      );
      created++;
    }
  });

  log.info('retention:seeded', { created });
  return { created };
}

export default {
  createRetentionRule,
  getRetentionRule,
  listRetentionRules,
  updateRetentionRule,
  deleteRetentionRule,
  runRetentionCheck,
  executeRetentionRule,
  getRetentionSummary,
  seedDefaultRules,
};
