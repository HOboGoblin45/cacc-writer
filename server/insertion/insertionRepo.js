/**
 * server/insertion/insertionRepo.js
 * -----------------------------------
 * Phase 9: SQLite persistence for insertion runs and run items.
 *
 * All reads/writes go through this module.
 * Keeps DB access isolated from business logic.
 */

import { getDb } from '../db/database.js';
import { randomUUID } from 'crypto';

// ── Helpers ───────────────────────────────────────────────────────────────────

function now() {
  return new Date().toISOString();
}

function parseJsonCol(val, fallback = {}) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

function toJson(val) {
  return JSON.stringify(val ?? {});
}

// ── Insertion Runs ────────────────────────────────────────────────────────────

/**
 * Create a new insertion run.
 * @param {Object} params
 * @returns {Object} The created insertion run row
 */
export function createInsertionRun({
  caseId,
  generationRunId = null,
  formType,
  targetSoftware,
  config = {},
  qcRunId = null,
  qcBlockerCount = 0,
  qcGatePassed = true,
}) {
  const db = getDb();
  const id = `irun_${randomUUID().slice(0, 12)}`;
  const stmt = db.prepare(`
    INSERT INTO insertion_runs
      (id, case_id, generation_run_id, form_type, target_software,
       status, config_json, qc_run_id, qc_blocker_count, qc_gate_passed, created_at)
    VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id, caseId, generationRunId, formType, targetSoftware,
    toJson(config), qcRunId, qcBlockerCount, qcGatePassed ? 1 : 0, now()
  );
  return getInsertionRun(id);
}

/**
 * Get an insertion run by ID.
 * @param {string} id
 * @returns {Object|null}
 */
export function getInsertionRun(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM insertion_runs WHERE id = ?').get(id);
  return row ? hydrateRun(row) : null;
}

/**
 * List insertion runs for a case.
 * @param {string} caseId
 * @param {Object} [opts]
 * @param {number} [opts.limit=20]
 * @returns {Object[]}
 */
export function listInsertionRuns(caseId, { limit = 20 } = {}) {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM insertion_runs WHERE case_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(caseId, limit);
  return rows.map(hydrateRun);
}

/**
 * Update insertion run status and counters.
 * @param {string} id
 * @param {Object} updates
 */
export function updateInsertionRun(id, updates) {
  const db = getDb();
  const allowed = [
    'status', 'total_fields', 'completed_fields', 'failed_fields',
    'skipped_fields', 'verified_fields', 'started_at', 'completed_at',
    'duration_ms', 'summary_json', 'qc_run_id', 'qc_blocker_count', 'qc_gate_passed',
  ];
  const sets = [];
  const vals = [];
  for (const [key, val] of Object.entries(updates)) {
    const col = toSnake(key);
    if (!allowed.includes(col)) continue;
    sets.push(`${col} = ?`);
    if (col === 'summary_json') {
      vals.push(typeof val === 'string' ? val : toJson(val));
    } else if (col === 'qc_gate_passed') {
      vals.push(val ? 1 : 0);
    } else {
      vals.push(val);
    }
  }
  if (sets.length === 0) return;
  vals.push(id);
  db.prepare(`UPDATE insertion_runs SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

/**
 * Get the latest insertion run for a case.
 * @param {string} caseId
 * @returns {Object|null}
 */
export function getLatestInsertionRun(caseId) {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM insertion_runs WHERE case_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(caseId);
  return row ? hydrateRun(row) : null;
}

function hydrateRun(row) {
  return {
    id: row.id,
    caseId: row.case_id,
    generationRunId: row.generation_run_id,
    formType: row.form_type,
    targetSoftware: row.target_software,
    status: row.status,
    totalFields: row.total_fields,
    completedFields: row.completed_fields,
    failedFields: row.failed_fields,
    skippedFields: row.skipped_fields,
    verifiedFields: row.verified_fields,
    qcRunId: row.qc_run_id,
    qcBlockerCount: row.qc_blocker_count,
    qcGatePassed: !!row.qc_gate_passed,
    config: parseJsonCol(row.config_json),
    summary: parseJsonCol(row.summary_json),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  };
}

// ── Insertion Run Items ───────────────────────────────────────────────────────

/**
 * Create a batch of insertion run items.
 * @param {Object[]} items - Array of item params
 * @returns {number} Number of items created
 */
export function createInsertionRunItems(items) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO insertion_run_items
      (id, insertion_run_id, case_id, field_id, form_type,
       target_software, destination_key, status,
       canonical_text, canonical_text_length,
       max_attempts, fallback_strategy, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((rows) => {
    for (const item of rows) {
      const id = `iitem_${randomUUID().slice(0, 12)}`;
      const canonicalText = item.canonicalText || '';
      stmt.run(
        id,
        item.insertionRunId,
        item.caseId,
        item.fieldId,
        item.formType,
        item.targetSoftware,
        item.destinationKey || '',
        canonicalText,
        canonicalText.length,
        item.maxAttempts || 3,
        item.fallbackStrategy || 'retry_then_clipboard',
        item.sortOrder || 0,
        now()
      );
    }
    return rows.length;
  });

  return insertMany(items);
}

/**
 * Get all items for an insertion run.
 * @param {string} insertionRunId
 * @returns {Object[]}
 */
export function getInsertionRunItems(insertionRunId) {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM insertion_run_items WHERE insertion_run_id = ? ORDER BY sort_order, created_at'
  ).all(insertionRunId);
  return rows.map(hydrateItem);
}

/**
 * Get a single insertion run item.
 * @param {string} id
 * @returns {Object|null}
 */
export function getInsertionRunItem(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM insertion_run_items WHERE id = ?').get(id);
  return row ? hydrateItem(row) : null;
}

/**
 * Update an insertion run item.
 * @param {string} id
 * @param {Object} updates
 */
export function updateInsertionRunItem(id, updates) {
  const db = getDb();
  const allowed = [
    'status', 'formatted_text', 'formatted_text_length',
    'verification_status', 'verification_raw', 'verification_normalized',
    'attempt_count', 'fallback_used', 'fallback_strategy',
    'agent_response_json', 'error_code', 'error_text', 'error_detail_json',
    'started_at', 'completed_at', 'duration_ms',
  ];
  const sets = [];
  const vals = [];
  for (const [key, val] of Object.entries(updates)) {
    const col = toSnake(key);
    if (!allowed.includes(col)) continue;
    sets.push(`${col} = ?`);
    if (col.endsWith('_json')) {
      vals.push(typeof val === 'string' ? val : toJson(val));
    } else if (col === 'fallback_used') {
      vals.push(val ? 1 : 0);
    } else {
      vals.push(val);
    }
  }
  if (sets.length === 0) return;
  vals.push(id);
  db.prepare(`UPDATE insertion_run_items SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

/**
 * Batch update items by insertion run ID and status filter.
 * Used for bulk skip/cancel operations.
 * @param {string} insertionRunId
 * @param {string} fromStatus
 * @param {string} toStatus
 * @returns {number} Number of rows updated
 */
export function bulkUpdateItemStatus(insertionRunId, fromStatus, toStatus) {
  const db = getDb();
  const result = db.prepare(
    'UPDATE insertion_run_items SET status = ? WHERE insertion_run_id = ? AND status = ?'
  ).run(toStatus, insertionRunId, fromStatus);
  return result.changes;
}

/**
 * Get items for a specific field across all runs for a case.
 * Useful for checking previous insertion history.
 * @param {string} caseId
 * @param {string} fieldId
 * @param {number} [limit=5]
 * @returns {Object[]}
 */
export function getItemHistoryForField(caseId, fieldId, limit = 5) {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM insertion_run_items
     WHERE case_id = ? AND field_id = ?
     ORDER BY created_at DESC LIMIT ?`
  ).all(caseId, fieldId, limit);
  return rows.map(hydrateItem);
}

function hydrateItem(row) {
  return {
    id: row.id,
    insertionRunId: row.insertion_run_id,
    caseId: row.case_id,
    fieldId: row.field_id,
    formType: row.form_type,
    targetSoftware: row.target_software,
    destinationKey: row.destination_key,
    status: row.status,
    canonicalText: row.canonical_text,
    canonicalTextLength: row.canonical_text_length,
    formattedText: row.formatted_text,
    formattedTextLength: row.formatted_text_length,
    verificationStatus: row.verification_status,
    verificationRaw: row.verification_raw,
    verificationNormalized: row.verification_normalized,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    fallbackStrategy: row.fallback_strategy,
    fallbackUsed: !!row.fallback_used,
    agentResponse: parseJsonCol(row.agent_response_json),
    errorCode: row.error_code,
    errorText: row.error_text,
    errorDetail: parseJsonCol(row.error_detail_json),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

// ── Destination Profiles ──────────────────────────────────────────────────────

/**
 * List all destination profiles.
 * @param {Object} [opts]
 * @param {boolean} [opts.activeOnly=true]
 * @returns {Object[]}
 */
export function listDestinationProfiles({ activeOnly = true } = {}) {
  const db = getDb();
  const sql = activeOnly
    ? 'SELECT * FROM destination_profiles WHERE active = 1 ORDER BY name'
    : 'SELECT * FROM destination_profiles ORDER BY name';
  return db.prepare(sql).all().map(hydrateProfile);
}

/**
 * Get a destination profile by ID.
 * @param {string} id
 * @returns {Object|null}
 */
export function getDestinationProfile(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM destination_profiles WHERE id = ?').get(id);
  return row ? hydrateProfile(row) : null;
}

/**
 * Get the active destination profile for a target software + form type.
 * @param {string} targetSoftware
 * @param {string} formType
 * @returns {Object|null}
 */
export function getActiveProfile(targetSoftware, formType) {
  const db = getDb();
  const row = db.prepare(
    `SELECT * FROM destination_profiles
     WHERE target_software = ? AND form_type = ? AND active = 1
     ORDER BY created_at DESC LIMIT 1`
  ).get(targetSoftware, formType);
  return row ? hydrateProfile(row) : null;
}

/**
 * Update a destination profile.
 * @param {string} id
 * @param {Object} updates
 */
export function updateDestinationProfile(id, updates) {
  const db = getDb();
  const allowed = [
    'name', 'base_url', 'supports_readback', 'supports_rich_text',
    'supports_partial_retry', 'supports_append_mode', 'requires_focus_target',
    'config_json', 'active',
  ];
  const sets = ['updated_at = ?'];
  const vals = [now()];
  for (const [key, val] of Object.entries(updates)) {
    const col = toSnake(key);
    if (!allowed.includes(col)) continue;
    sets.push(`${col} = ?`);
    if (col === 'config_json') {
      vals.push(typeof val === 'string' ? val : toJson(val));
    } else if (typeof val === 'boolean') {
      vals.push(val ? 1 : 0);
    } else {
      vals.push(val);
    }
  }
  vals.push(id);
  db.prepare(`UPDATE destination_profiles SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

function hydrateProfile(row) {
  return {
    id: row.id,
    name: row.name,
    targetSoftware: row.target_software,
    formType: row.form_type,
    baseUrl: row.base_url,
    capabilities: {
      supportsReadback: !!row.supports_readback,
      supportsRichText: !!row.supports_rich_text,
      supportsPartialRetry: !!row.supports_partial_retry,
      supportsAppendMode: !!row.supports_append_mode,
      requiresFocusTarget: !!row.requires_focus_target,
    },
    config: parseJsonCol(row.config_json),
    active: !!row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Utility ───────────────────────────────────────────────────────────────────

/**
 * camelCase → snake_case
 * @param {string} str
 * @returns {string}
 */
function toSnake(str) {
  return str.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}
