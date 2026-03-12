/**
 * server/business/pipelineService.js
 * ------------------------------------
 * Pipeline/workflow dashboard service for CACC Writer.
 *
 * Tracks assignments through the full business pipeline from prospect
 * through payment. Provides the canonical workflow dashboard view.
 *
 * Pipeline stages (in order):
 *   prospect -> quoted -> engaged -> in_progress -> review -> submitted -> invoiced -> paid -> closed
 *
 * Usage:
 *   import { createPipelineEntry, listPipeline, advanceStage, ... } from './pipelineService.js';
 */

import { randomUUID } from 'crypto';
import { getDb } from '../db/database.js';
import { emitAuditEvent, emitCaseEvent } from '../operations/auditLogger.js';
import log from '../logger.js';

// ── ID helper ────────────────────────────────────────────────────────────────

function makeId() {
  return 'pipe_' + randomUUID().slice(0, 12);
}

// ── JSON helpers ─────────────────────────────────────────────────────────────

function parseJson(str, fallback = null) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function stringifyJson(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') return val;
  return JSON.stringify(val);
}

// ── Row hydration ────────────────────────────────────────────────────────────

function hydratePipelineEntry(row) {
  if (!row) return null;
  return {
    ...row,
    tags_json: parseJson(row.tags_json, []),
    stage_history_json: parseJson(row.stage_history_json, []),
  };
}

// ── Stage order ──────────────────────────────────────────────────────────────

const STAGE_ORDER = [
  'prospect', 'quoted', 'engaged', 'in_progress',
  'review', 'submitted', 'invoiced', 'paid', 'closed',
];

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a new pipeline entry.
 *
 * @param {Object} data
 * @returns {Object} The created pipeline entry
 */
export function createPipelineEntry(data) {
  const db = getDb();
  const id = makeId();
  const now = new Date().toISOString();
  const stage = data.stage || 'prospect';

  const stageHistory = [{ stage, entered_at: now, exited_at: null }];

  const stmt = db.prepare(`
    INSERT INTO pipeline_entries (
      id, case_id, quote_id, engagement_id, stage, priority,
      property_address, client_name, form_type, assigned_appraiser,
      due_date, fee, notes, tags_json, stage_entered_at,
      stage_history_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    data.case_id || null,
    data.quote_id || null,
    data.engagement_id || null,
    stage,
    data.priority || 'normal',
    data.property_address,
    data.client_name,
    data.form_type || null,
    data.assigned_appraiser || null,
    data.due_date || null,
    data.fee || null,
    data.notes || null,
    stringifyJson(data.tags_json || []),
    now,
    JSON.stringify(stageHistory),
    now,
    now,
  );

  emitAuditEvent({
    eventType: 'pipeline.entry_created',
    category: 'business',
    caseId: data.case_id || null,
    entityType: 'pipeline_entry',
    entityId: id,
    summary: `Pipeline entry created: ${data.property_address} (${stage})`,
    detail: { pipelineEntryId: id, stage, clientName: data.client_name },
    actor: 'user',
  });

  return getPipelineEntry(id);
}

/**
 * Get a single pipeline entry by ID.
 *
 * @param {string} id
 * @returns {Object|null}
 */
export function getPipelineEntry(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM pipeline_entries WHERE id = ?').get(id);
  return hydratePipelineEntry(row);
}

/**
 * List pipeline entries with optional filters.
 *
 * @param {Object} [opts={}]
 * @param {string} [opts.stage]
 * @param {string} [opts.priority]
 * @param {string} [opts.assignedAppraiser]
 * @param {string} [opts.clientName]
 * @param {string} [opts.dueBefore]
 * @param {number} [opts.limit=50]
 * @param {number} [opts.offset=0]
 * @returns {Object[]}
 */
export function listPipeline(opts = {}) {
  const db = getDb();
  const conditions = [];
  const params = [];

  if (opts.stage) {
    conditions.push('stage = ?');
    params.push(opts.stage);
  }
  if (opts.priority) {
    conditions.push('priority = ?');
    params.push(opts.priority);
  }
  if (opts.assignedAppraiser) {
    conditions.push('assigned_appraiser = ?');
    params.push(opts.assignedAppraiser);
  }
  if (opts.clientName) {
    conditions.push('client_name = ?');
    params.push(opts.clientName);
  }
  if (opts.dueBefore) {
    conditions.push('due_date <= ?');
    params.push(opts.dueBefore);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const limit = opts.limit || 50;
  const offset = opts.offset || 0;

  const rows = db.prepare(`SELECT * FROM pipeline_entries ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all([...params, limit, offset]);

  return rows.map(hydratePipelineEntry);
}

/**
 * Update pipeline entry fields.
 *
 * @param {string} id
 * @param {Object} updates
 * @returns {Object|null}
 */
export function updatePipelineEntry(id, updates) {
  const db = getDb();
  const now = new Date().toISOString();

  const allowedFields = [
    'case_id', 'quote_id', 'engagement_id', 'stage', 'priority',
    'property_address', 'client_name', 'form_type', 'assigned_appraiser',
    'due_date', 'fee', 'notes', 'tags_json',
  ];

  const sets = [];
  const params = [];

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      sets.push(`${field} = ?`);
      if (field.endsWith('_json')) {
        params.push(stringifyJson(updates[field]));
      } else {
        params.push(updates[field]);
      }
    }
  }

  if (sets.length === 0) return getPipelineEntry(id);

  sets.push('updated_at = ?');
  params.push(now);
  params.push(id);

  db.prepare(`UPDATE pipeline_entries SET ${sets.join(', ')} WHERE id = ?`).run(params);

  return getPipelineEntry(id);
}

/**
 * Advance a pipeline entry to a new stage, recording history.
 *
 * @param {string} id
 * @param {string} newStage
 * @returns {Object|null}
 */
export function advanceStage(id, newStage) {
  const db = getDb();
  const now = new Date().toISOString();
  const entry = getPipelineEntry(id);
  if (!entry) return null;

  // Update stage history — close the current stage and add the new one
  const history = Array.isArray(entry.stage_history_json) ? [...entry.stage_history_json] : [];

  // Close the last open stage
  if (history.length > 0) {
    const lastEntry = history[history.length - 1];
    if (!lastEntry.exited_at) {
      lastEntry.exited_at = now;
    }
  }

  // Add new stage
  history.push({ stage: newStage, entered_at: now, exited_at: null });

  db.prepare(`
    UPDATE pipeline_entries
    SET stage = ?, stage_entered_at = ?, stage_history_json = ?, updated_at = ?
    WHERE id = ?
  `).run(newStage, now, JSON.stringify(history), now, id);

  emitAuditEvent({
    eventType: 'pipeline.stage_advanced',
    category: 'business',
    caseId: entry.case_id || null,
    entityType: 'pipeline_entry',
    entityId: id,
    summary: `Pipeline stage: ${entry.stage} -> ${newStage}`,
    detail: { pipelineEntryId: id, previousStage: entry.stage, newStage },
    actor: 'user',
  });

  return getPipelineEntry(id);
}

/**
 * Change the priority of a pipeline entry.
 *
 * @param {string} id
 * @param {string} priority - low | normal | high | urgent
 * @returns {Object|null}
 */
export function setPriority(id, priority) {
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare('UPDATE pipeline_entries SET priority = ?, updated_at = ? WHERE id = ?')
    .run(priority, now, id);

  return getPipelineEntry(id);
}

/**
 * Add a tag to a pipeline entry.
 *
 * @param {string} id
 * @param {string} tag
 * @returns {Object|null}
 */
export function addTag(id, tag) {
  const db = getDb();
  const now = new Date().toISOString();
  const entry = getPipelineEntry(id);
  if (!entry) return null;

  const tags = Array.isArray(entry.tags_json) ? [...entry.tags_json] : [];
  if (!tags.includes(tag)) {
    tags.push(tag);
  }

  db.prepare('UPDATE pipeline_entries SET tags_json = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(tags), now, id);

  return getPipelineEntry(id);
}

/**
 * Remove a tag from a pipeline entry.
 *
 * @param {string} id
 * @param {string} tag
 * @returns {Object|null}
 */
export function removeTag(id, tag) {
  const db = getDb();
  const now = new Date().toISOString();
  const entry = getPipelineEntry(id);
  if (!entry) return null;

  const tags = Array.isArray(entry.tags_json) ? entry.tags_json.filter(t => t !== tag) : [];

  db.prepare('UPDATE pipeline_entries SET tags_json = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(tags), now, id);

  return getPipelineEntry(id);
}

/**
 * Get aggregate pipeline stats.
 *
 * @returns {Object} Summary with counts by stage/priority, total value, avg days in stage, upcoming due
 */
export function getPipelineSummary() {
  const db = getDb();

  // Count by stage
  const byStage = db.prepare(
    "SELECT stage, COUNT(*) AS n FROM pipeline_entries WHERE stage != 'closed' GROUP BY stage"
  ).all();

  // Count by priority
  const byPriority = db.prepare(
    "SELECT priority, COUNT(*) AS n FROM pipeline_entries WHERE stage != 'closed' GROUP BY priority"
  ).all();

  // Total pipeline value (non-closed entries)
  const totalValue = db.prepare(
    "SELECT COALESCE(SUM(fee), 0) AS total FROM pipeline_entries WHERE stage NOT IN ('closed', 'paid')"
  ).get();

  // Average days in current stage
  const avgDays = db.prepare(`
    SELECT AVG(
      CAST((julianday('now') - julianday(stage_entered_at)) AS REAL)
    ) AS avg_days
    FROM pipeline_entries
    WHERE stage NOT IN ('closed', 'paid')
  `).get();

  // Upcoming due dates (next 7 days)
  const now = new Date();
  const sevenDays = new Date();
  sevenDays.setDate(sevenDays.getDate() + 7);

  const upcoming = db.prepare(`
    SELECT * FROM pipeline_entries
    WHERE due_date IS NOT NULL
      AND due_date >= ?
      AND due_date <= ?
      AND stage NOT IN ('closed', 'paid')
    ORDER BY due_date ASC
  `).all(now.toISOString(), sevenDays.toISOString());

  const stageMap = {};
  for (const row of byStage) stageMap[row.stage] = row.n;

  const priorityMap = {};
  for (const row of byPriority) priorityMap[row.priority] = row.n;

  return {
    byStage: stageMap,
    byPriority: priorityMap,
    totalPipelineValue: totalValue.total,
    averageDaysInStage: avgDays.avg_days ? Math.round(avgDays.avg_days * 10) / 10 : 0,
    upcomingDue: upcoming.map(hydratePipelineEntry),
  };
}

/**
 * Get workload per appraiser with stage breakdown.
 *
 * @returns {Object[]} Array of { appraiser, total, byStage: { stage: count } }
 */
export function getAppraisersWorkload() {
  const db = getDb();

  const rows = db.prepare(`
    SELECT assigned_appraiser, stage, COUNT(*) AS n
    FROM pipeline_entries
    WHERE assigned_appraiser IS NOT NULL
      AND stage NOT IN ('closed', 'paid')
    GROUP BY assigned_appraiser, stage
    ORDER BY assigned_appraiser, stage
  `).all();

  // Aggregate into per-appraiser objects
  const appraiserMap = {};
  for (const row of rows) {
    const key = row.assigned_appraiser;
    if (!appraiserMap[key]) {
      appraiserMap[key] = { appraiser: key, total: 0, byStage: {} };
    }
    appraiserMap[key].byStage[row.stage] = row.n;
    appraiserMap[key].total += row.n;
  }

  return Object.values(appraiserMap);
}

/**
 * Sync a pipeline entry from case status/stage changes.
 * Finds the pipeline entry for the given case and updates its stage
 * based on the current case state.
 *
 * @param {string} caseId
 * @returns {Object|null} Updated pipeline entry, or null if none found
 */
export function syncPipelineFromCase(caseId) {
  const db = getDb();
  const now = new Date().toISOString();

  // Find existing pipeline entry for this case
  const entry = db.prepare(
    'SELECT * FROM pipeline_entries WHERE case_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(caseId);

  if (!entry) return null;

  // Look up case record to determine stage
  let caseRecord;
  try {
    caseRecord = db.prepare('SELECT * FROM case_records WHERE case_id = ?').get(caseId);
  } catch {
    return hydratePipelineEntry(entry);
  }

  if (!caseRecord) return hydratePipelineEntry(entry);

  // Map case pipeline_stage to pipeline entry stage
  const stageMapping = {
    intake: 'in_progress',
    facts_gathering: 'in_progress',
    analysis: 'in_progress',
    drafting: 'in_progress',
    review: 'review',
    revision: 'review',
    submission: 'submitted',
    complete: 'closed',
  };

  const mappedStage = stageMapping[caseRecord.pipeline_stage] || entry.stage;

  if (mappedStage !== entry.stage) {
    // Use advanceStage to properly record history
    return advanceStage(entry.id, mappedStage);
  }

  return hydratePipelineEntry(entry);
}

export default {
  createPipelineEntry,
  getPipelineEntry,
  listPipeline,
  updatePipelineEntry,
  advanceStage,
  setPriority,
  addTag,
  removeTag,
  getPipelineSummary,
  getAppraisersWorkload,
  syncPipelineFromCase,
};
