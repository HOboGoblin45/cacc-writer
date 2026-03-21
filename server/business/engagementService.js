/**
 * server/business/engagementService.js
 * --------------------------------------
 * Engagement/order tracking service for Appraisal Agent.
 *
 * Tracks the full lifecycle of an appraisal engagement from order receipt
 * through completion, including fee adjustments, holds, and cancellations.
 *
 * Usage:
 *   import { createEngagement, getEngagement, ... } from './engagementService.js';
 */

import { randomUUID } from 'crypto';
import { getDb } from '../db/database.js';
import { emitAuditEvent, emitCaseEvent } from '../operations/auditLogger.js';
import log from '../logger.js';

// â”€â”€ ID helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function makeId() {
  return 'eng_' + randomUUID().slice(0, 12);
}

// â”€â”€ JSON helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€ Row hydration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function hydrateEngagement(row) {
  if (!row) return null;
  return {
    ...row,
    fee_adjustments_json: parseJson(row.fee_adjustments_json, []),
    contact_info_json: parseJson(row.contact_info_json, null),
    status_history_json: parseJson(row.status_history_json, []),
  };
}

// â”€â”€ Status history helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function addStatusEntry(current, newStatus, reason) {
  const history = Array.isArray(current) ? [...current] : [];
  history.push({
    status: newStatus,
    date: new Date().toISOString(),
    reason: reason || null,
  });
  return history;
}

// â”€â”€ Public API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Create a new engagement record and create/update associated pipeline entry.
 *
 * @param {Object} data
 * @returns {Object} The created engagement record
 */
export function createEngagement(data) {
  const db = getDb();
  const id = makeId();
  const now = new Date().toISOString();

  const statusHistory = [{ status: 'pending', date: now, reason: 'Engagement created' }];

  const stmt = db.prepare(`
    INSERT INTO engagement_records (
      id, case_id, quote_id, client_name, client_type, engagement_type,
      engagement_status, order_number, order_date, due_date, fee_agreed,
      fee_adjustments_json, scope_of_work, special_instructions,
      contact_info_json, status_history_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    data.case_id,
    data.quote_id || null,
    data.client_name,
    data.client_type,
    data.engagement_type,
    data.engagement_status || 'pending',
    data.order_number || null,
    data.order_date || null,
    data.due_date || null,
    data.fee_agreed,
    stringifyJson(data.fee_adjustments_json || []),
    data.scope_of_work || null,
    data.special_instructions || null,
    stringifyJson(data.contact_info_json),
    JSON.stringify(statusHistory),
    now,
    now,
  );

  // Create or update pipeline entry
  try {
    const existingPipeline = db.prepare(
      'SELECT id FROM pipeline_entries WHERE case_id = ? AND engagement_id IS NULL'
    ).get(data.case_id);

    if (existingPipeline) {
      // Update existing pipeline entry with engagement link
      db.prepare(`
        UPDATE pipeline_entries SET engagement_id = ?, stage = 'engaged', stage_entered_at = ?, updated_at = ?
        WHERE id = ?
      `).run(id, now, now, existingPipeline.id);
    } else {
      // Create new pipeline entry
      const pipeId = 'pipe_' + randomUUID().slice(0, 12);
      const stageHistory = [{ stage: 'engaged', entered_at: now, exited_at: null }];
      db.prepare(`
        INSERT INTO pipeline_entries (
          id, case_id, quote_id, engagement_id, stage, property_address,
          client_name, form_type, fee, due_date, stage_entered_at,
          stage_history_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        pipeId, data.case_id, data.quote_id || null, id, 'engaged',
        data.property_address || '', data.client_name,
        data.form_type || null, data.fee_agreed, data.due_date || null,
        now, JSON.stringify(stageHistory), now, now,
      );
    }
  } catch (err) {
    log.warn('engagement:pipeline-sync', { error: err.message, engagementId: id });
  }

  emitCaseEvent(
    data.case_id,
    'engagement.created',
    `Engagement created for ${data.client_name}: $${data.fee_agreed}`,
    { engagementId: id, clientName: data.client_name, feeAgreed: data.fee_agreed },
    { entityType: 'engagement_record', entityId: id },
  );

  return getEngagement(id);
}

/**
 * Get a single engagement by ID.
 *
 * @param {string} id
 * @returns {Object|null}
 */
export function getEngagement(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM engagement_records WHERE id = ?').get(id);
  return hydrateEngagement(row);
}

/**
 * List engagements with optional filters.
 *
 * @param {Object} [opts={}]
 * @param {string} [opts.status]
 * @param {string} [opts.clientName]
 * @param {string} [opts.caseId]
 * @param {string} [opts.dueBefore] - ISO date
 * @param {string} [opts.dueAfter] - ISO date
 * @param {number} [opts.limit=50]
 * @param {number} [opts.offset=0]
 * @returns {Object[]}
 */
export function listEngagements(opts = {}) {
  const db = getDb();
  const conditions = [];
  const params = [];

  if (opts.status) {
    conditions.push('engagement_status = ?');
    params.push(opts.status);
  }
  if (opts.clientName) {
    conditions.push('client_name = ?');
    params.push(opts.clientName);
  }
  if (opts.caseId) {
    conditions.push('case_id = ?');
    params.push(opts.caseId);
  }
  if (opts.dueBefore) {
    conditions.push('due_date <= ?');
    params.push(opts.dueBefore);
  }
  if (opts.dueAfter) {
    conditions.push('due_date >= ?');
    params.push(opts.dueAfter);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const limit = opts.limit || 50;
  const offset = opts.offset || 0;

  const rows = db.prepare(`SELECT * FROM engagement_records ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all([...params, limit, offset]);

  return rows.map(hydrateEngagement);
}

/**
 * Update engagement fields.
 *
 * @param {string} id
 * @param {Object} updates
 * @returns {Object|null}
 */
export function updateEngagement(id, updates) {
  const db = getDb();
  const now = new Date().toISOString();

  const allowedFields = [
    'case_id', 'quote_id', 'client_name', 'client_type', 'engagement_type',
    'engagement_status', 'order_number', 'order_date', 'due_date',
    'fee_agreed', 'scope_of_work', 'special_instructions',
    'contact_info_json', 'fee_adjustments_json',
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

  if (sets.length === 0) return getEngagement(id);

  sets.push('updated_at = ?');
  params.push(now);
  params.push(id);

  db.prepare(`UPDATE engagement_records SET ${sets.join(', ')} WHERE id = ?`).run(params);

  return getEngagement(id);
}

/**
 * Mark engagement as accepted.
 *
 * @param {string} id
 * @returns {Object|null}
 */
export function acceptEngagement(id) {
  const db = getDb();
  const now = new Date().toISOString();
  const eng = getEngagement(id);
  if (!eng) return null;

  const history = addStatusEntry(eng.status_history_json, 'accepted', 'Engagement accepted');

  db.prepare(`
    UPDATE engagement_records
    SET engagement_status = 'accepted', accepted_date = ?, status_history_json = ?, updated_at = ?
    WHERE id = ?
  `).run(now, JSON.stringify(history), now, id);

  // Update pipeline stage
  try {
    db.prepare(`
      UPDATE pipeline_entries SET stage = 'in_progress', stage_entered_at = ?, updated_at = ?
      WHERE engagement_id = ?
    `).run(now, now, id);
  } catch (err) {
    log.warn('engagement:pipeline-update', { error: err.message, engagementId: id });
  }

  emitCaseEvent(
    eng.case_id,
    'engagement.accepted',
    `Engagement accepted: ${eng.client_name}`,
    { engagementId: id },
    { entityType: 'engagement_record', entityId: id },
  );

  return getEngagement(id);
}

/**
 * Put engagement on hold with reason.
 *
 * @param {string} id
 * @param {string} reason
 * @returns {Object|null}
 */
export function putOnHold(id, reason) {
  const db = getDb();
  const now = new Date().toISOString();
  const eng = getEngagement(id);
  if (!eng) return null;

  const history = addStatusEntry(eng.status_history_json, 'on_hold', reason);

  db.prepare(`
    UPDATE engagement_records
    SET engagement_status = 'on_hold', status_history_json = ?, updated_at = ?
    WHERE id = ?
  `).run(JSON.stringify(history), now, id);

  emitCaseEvent(
    eng.case_id,
    'engagement.on_hold',
    `Engagement put on hold: ${reason}`,
    { engagementId: id, reason },
    { entityType: 'engagement_record', entityId: id },
  );

  return getEngagement(id);
}

/**
 * Resume engagement from hold.
 *
 * @param {string} id
 * @returns {Object|null}
 */
export function resumeEngagement(id) {
  const db = getDb();
  const now = new Date().toISOString();
  const eng = getEngagement(id);
  if (!eng) return null;

  const history = addStatusEntry(eng.status_history_json, 'active', 'Resumed from hold');

  db.prepare(`
    UPDATE engagement_records
    SET engagement_status = 'active', status_history_json = ?, updated_at = ?
    WHERE id = ?
  `).run(JSON.stringify(history), now, id);

  emitCaseEvent(
    eng.case_id,
    'engagement.resumed',
    `Engagement resumed: ${eng.client_name}`,
    { engagementId: id },
    { entityType: 'engagement_record', entityId: id },
  );

  return getEngagement(id);
}

/**
 * Mark engagement as completed and update pipeline stage.
 *
 * @param {string} id
 * @returns {Object|null}
 */
export function completeEngagement(id) {
  const db = getDb();
  const now = new Date().toISOString();
  const eng = getEngagement(id);
  if (!eng) return null;

  const history = addStatusEntry(eng.status_history_json, 'completed', 'Engagement completed');

  db.prepare(`
    UPDATE engagement_records
    SET engagement_status = 'completed', completed_date = ?, status_history_json = ?, updated_at = ?
    WHERE id = ?
  `).run(now, JSON.stringify(history), now, id);

  // Update pipeline stage to submitted
  try {
    db.prepare(`
      UPDATE pipeline_entries SET stage = 'submitted', stage_entered_at = ?, updated_at = ?
      WHERE engagement_id = ?
    `).run(now, now, id);
  } catch (err) {
    log.warn('engagement:pipeline-complete', { error: err.message, engagementId: id });
  }

  emitCaseEvent(
    eng.case_id,
    'engagement.completed',
    `Engagement completed: ${eng.client_name}`,
    { engagementId: id },
    { entityType: 'engagement_record', entityId: id },
  );

  return getEngagement(id);
}

/**
 * Cancel engagement with reason.
 *
 * @param {string} id
 * @param {string} reason
 * @returns {Object|null}
 */
export function cancelEngagement(id, reason) {
  const db = getDb();
  const now = new Date().toISOString();
  const eng = getEngagement(id);
  if (!eng) return null;

  const history = addStatusEntry(eng.status_history_json, 'cancelled', reason);

  db.prepare(`
    UPDATE engagement_records
    SET engagement_status = 'cancelled', cancelled_date = ?, status_history_json = ?, updated_at = ?
    WHERE id = ?
  `).run(now, JSON.stringify(history), now, id);

  // Update pipeline stage to closed
  try {
    db.prepare(`
      UPDATE pipeline_entries SET stage = 'closed', stage_entered_at = ?, updated_at = ?
      WHERE engagement_id = ?
    `).run(now, now, id);
  } catch (err) {
    log.warn('engagement:pipeline-cancel', { error: err.message, engagementId: id });
  }

  emitCaseEvent(
    eng.case_id,
    'engagement.cancelled',
    `Engagement cancelled: ${reason}`,
    { engagementId: id, reason },
    { entityType: 'engagement_record', entityId: id },
  );

  return getEngagement(id);
}

/**
 * Add a fee adjustment to an engagement (e.g., complexity increase).
 *
 * @param {string} id
 * @param {{ reason: string, amount: number }} adjustment
 * @returns {Object|null}
 */
export function addFeeAdjustment(id, { reason, amount }) {
  const db = getDb();
  const now = new Date().toISOString();
  const eng = getEngagement(id);
  if (!eng) return null;

  const adjustments = Array.isArray(eng.fee_adjustments_json) ? [...eng.fee_adjustments_json] : [];
  adjustments.push({ reason, amount, date: now });

  const newFee = eng.fee_agreed + amount;

  db.prepare(`
    UPDATE engagement_records
    SET fee_adjustments_json = ?, fee_agreed = ?, updated_at = ?
    WHERE id = ?
  `).run(JSON.stringify(adjustments), newFee, now, id);

  // Update pipeline fee
  try {
    db.prepare('UPDATE pipeline_entries SET fee = ?, updated_at = ? WHERE engagement_id = ?')
      .run(newFee, now, id);
  } catch (err) {
    log.warn('engagement:pipeline-fee-update', { error: err.message, engagementId: id });
  }

  emitCaseEvent(
    eng.case_id,
    'engagement.fee_adjusted',
    `Fee adjusted: ${reason} ($${amount})`,
    { engagementId: id, reason, amount, newFee },
    { entityType: 'engagement_record', entityId: id },
  );

  return getEngagement(id);
}

/**
 * Get engagements due within the specified number of days.
 *
 * @param {number} [daysAhead=7]
 * @returns {Object[]}
 */
export function getEngagementsByDueDate(daysAhead = 7) {
  const db = getDb();
  const now = new Date().toISOString();
  const future = new Date();
  future.setDate(future.getDate() + daysAhead);
  const futureStr = future.toISOString();

  const rows = db.prepare(`
    SELECT * FROM engagement_records
    WHERE due_date IS NOT NULL
      AND due_date >= ?
      AND due_date <= ?
      AND engagement_status NOT IN ('completed', 'cancelled')
    ORDER BY due_date ASC
  `).all(now, futureStr);

  return rows.map(hydrateEngagement);
}

/**
 * Get overdue engagements (past due date, not completed or cancelled).
 *
 * @returns {Object[]}
 */
export function getOverdueEngagements() {
  const db = getDb();
  const now = new Date().toISOString();

  const rows = db.prepare(`
    SELECT * FROM engagement_records
    WHERE due_date IS NOT NULL
      AND due_date < ?
      AND engagement_status NOT IN ('completed', 'cancelled')
    ORDER BY due_date ASC
  `).all(now);

  return rows.map(hydrateEngagement);
}

export default {
  createEngagement,
  getEngagement,
  listEngagements,
  updateEngagement,
  acceptEngagement,
  putOnHold,
  resumeEngagement,
  completeEngagement,
  cancelEngagement,
  addFeeAdjustment,
  getEngagementsByDueDate,
  getOverdueEngagements,
};

