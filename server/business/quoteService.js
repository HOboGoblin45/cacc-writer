/**
 * server/business/quoteService.js
 * --------------------------------
 * Fee quote management service for Appraisal Agent.
 *
 * Handles the full lifecycle of fee quotes: creation, sending, acceptance,
 * decline, expiration, and conversion to engagement records.
 *
 * Usage:
 *   import { createQuote, getQuote, listQuotes, ... } from './quoteService.js';
 */

import { randomUUID } from 'crypto';
import { getDb } from '../db/database.js';
import { emitAuditEvent, emitCaseEvent } from '../operations/auditLogger.js';
import log from '../logger.js';

// â”€â”€ ID helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function makeId() {
  return 'quot_' + randomUUID().slice(0, 12);
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

function hydrateQuote(row) {
  if (!row) return null;
  return {
    ...row,
    rush_requested: Boolean(row.rush_requested),
    fee_schedule_json: parseJson(row.fee_schedule_json, null),
  };
}

// â”€â”€ Default fee schedule â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Base fee schedule: sfr/1004 standard=$450, complex=$650, highly_complex=$850
// Condo/1073: +$50, multi_family/1025: +$150, rush: +$200

const BASE_FEES = {
  standard: 450,
  complex: 650,
  highly_complex: 850,
};

const PROPERTY_TYPE_ADJUSTMENTS = {
  sfr: 0,
  condo: 50,
  multi_family: 150,
  manufactured: 0,
  land: 0,
  mixed_use: 100,
  commercial: 200,
};

const RUSH_FEE_DEFAULT = 200;

// â”€â”€ Public API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Calculate fee based on property type, form type, complexity, and rush.
 * Takes optional overrides for base fees, adjustments, and rush fee.
 *
 * @param {Object} params
 * @param {string} [params.propertyType]
 * @param {string} [params.formType]
 * @param {string} [params.complexity='standard']
 * @param {boolean} [params.rush=false]
 * @param {Object} [params.overrides] - { baseFees, propertyAdjustments, rushFee }
 * @returns {{ baseFee: number, complexityAdjustment: number, rushFee: number, totalFee: number }}
 */
export function calculateFee(params) {
  const {
    propertyType = 'sfr',
    complexity = 'standard',
    rush = false,
    overrides = {},
  } = params;

  const baseFees = overrides.baseFees || BASE_FEES;
  const propertyAdj = overrides.propertyAdjustments || PROPERTY_TYPE_ADJUSTMENTS;
  const rushAmount = overrides.rushFee !== undefined ? overrides.rushFee : RUSH_FEE_DEFAULT;

  const baseFee = baseFees[complexity] || baseFees.standard || 450;
  const complexityAdjustment = propertyAdj[propertyType] || 0;
  const rushFee = rush ? rushAmount : 0;
  const totalFee = baseFee + complexityAdjustment + rushFee;

  return { baseFee, complexityAdjustment, rushFee, totalFee };
}

/**
 * Create a new fee quote.
 * Auto-calculates total from base + complexity + rush if not provided.
 *
 * @param {Object} data
 * @returns {Object} The created quote record
 */
export function createQuote(data) {
  const db = getDb();
  const id = makeId();
  const now = new Date().toISOString();

  // Auto-calculate fees if total_fee not explicitly set
  let baseFee = data.base_fee;
  let complexityAdj = data.complexity_adjustment || 0;
  let rushFee = data.rush_fee || 0;
  let totalFee = data.total_fee;

  if (totalFee === undefined || totalFee === null) {
    if (baseFee === undefined || baseFee === null) {
      const calc = calculateFee({
        propertyType: data.property_type,
        formType: data.form_type,
        complexity: data.complexity || 'standard',
        rush: Boolean(data.rush_requested),
      });
      baseFee = calc.baseFee;
      complexityAdj = calc.complexityAdjustment;
      rushFee = calc.rushFee;
      totalFee = calc.totalFee;
    } else {
      totalFee = baseFee + complexityAdj + rushFee;
    }
  }

  const stmt = db.prepare(`
    INSERT INTO fee_quotes (
      id, case_id, client_name, client_type, property_address, property_type,
      form_type, complexity, rush_requested, base_fee, complexity_adjustment,
      rush_fee, total_fee, estimated_turnaround_days, quote_status, valid_until,
      notes, fee_schedule_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    data.case_id || null,
    data.client_name,
    data.client_type,
    data.property_address,
    data.property_type || null,
    data.form_type || null,
    data.complexity || null,
    data.rush_requested ? 1 : 0,
    baseFee,
    complexityAdj,
    rushFee,
    totalFee,
    data.estimated_turnaround_days || null,
    data.quote_status || 'draft',
    data.valid_until || null,
    data.notes || null,
    stringifyJson(data.fee_schedule_json),
    now,
    now,
  );

  emitAuditEvent({
    eventType: 'quote.created',
    category: 'business',
    caseId: data.case_id || null,
    entityType: 'fee_quote',
    entityId: id,
    summary: `Fee quote created for ${data.client_name}: $${totalFee}`,
    detail: { quoteId: id, clientName: data.client_name, totalFee, propertyAddress: data.property_address },
    actor: 'user',
  });

  return getQuote(id);
}

/**
 * Get a single fee quote by ID.
 *
 * @param {string} id
 * @returns {Object|null}
 */
export function getQuote(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM fee_quotes WHERE id = ?').get(id);
  return hydrateQuote(row);
}

/**
 * List fee quotes with optional filters.
 *
 * @param {Object} [opts={}]
 * @param {string} [opts.status]
 * @param {string} [opts.clientName]
 * @param {string} [opts.clientType]
 * @param {string} [opts.since] - ISO date, created_at >=
 * @param {string} [opts.until] - ISO date, created_at <=
 * @param {number} [opts.limit=50]
 * @param {number} [opts.offset=0]
 * @returns {Object[]}
 */
export function listQuotes(opts = {}) {
  const db = getDb();
  const conditions = [];
  const params = [];

  if (opts.status) {
    conditions.push('quote_status = ?');
    params.push(opts.status);
  }
  if (opts.clientName) {
    conditions.push('client_name = ?');
    params.push(opts.clientName);
  }
  if (opts.clientType) {
    conditions.push('client_type = ?');
    params.push(opts.clientType);
  }
  if (opts.since) {
    conditions.push('created_at >= ?');
    params.push(opts.since);
  }
  if (opts.until) {
    conditions.push('created_at <= ?');
    params.push(opts.until);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const limit = opts.limit || 50;
  const offset = opts.offset || 0;

  const rows = db.prepare(`SELECT * FROM fee_quotes ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all([...params, limit, offset]);

  return rows.map(hydrateQuote);
}

/**
 * Update fee quote fields.
 *
 * @param {string} id
 * @param {Object} updates
 * @returns {Object|null} Updated quote
 */
export function updateQuote(id, updates) {
  const db = getDb();
  const now = new Date().toISOString();

  const allowedFields = [
    'case_id', 'client_name', 'client_type', 'property_address', 'property_type',
    'form_type', 'complexity', 'rush_requested', 'base_fee', 'complexity_adjustment',
    'rush_fee', 'total_fee', 'estimated_turnaround_days', 'quote_status', 'valid_until',
    'notes', 'fee_schedule_json',
  ];

  const sets = [];
  const params = [];

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      sets.push(`${field} = ?`);
      if (field === 'fee_schedule_json') {
        params.push(stringifyJson(updates[field]));
      } else if (field === 'rush_requested') {
        params.push(updates[field] ? 1 : 0);
      } else {
        params.push(updates[field]);
      }
    }
  }

  if (sets.length === 0) return getQuote(id);

  sets.push('updated_at = ?');
  params.push(now);
  params.push(id);

  db.prepare(`UPDATE fee_quotes SET ${sets.join(', ')} WHERE id = ?`).run(params);

  return getQuote(id);
}

/**
 * Mark a quote as sent. Sets valid_until if not already set (default 30 days).
 *
 * @param {string} id
 * @returns {Object|null}
 */
export function sendQuote(id) {
  const db = getDb();
  const now = new Date().toISOString();
  const quote = getQuote(id);
  if (!quote) return null;

  let validUntil = quote.valid_until;
  if (!validUntil) {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 30);
    validUntil = expiry.toISOString();
  }

  db.prepare(`UPDATE fee_quotes SET quote_status = 'sent', valid_until = ?, updated_at = ? WHERE id = ?`)
    .run(validUntil, now, id);

  emitAuditEvent({
    eventType: 'quote.sent',
    category: 'business',
    caseId: quote.case_id || null,
    entityType: 'fee_quote',
    entityId: id,
    summary: `Fee quote sent to ${quote.client_name}`,
    detail: { quoteId: id, validUntil },
    actor: 'user',
  });

  return getQuote(id);
}

/**
 * Mark a quote as accepted.
 *
 * @param {string} id
 * @returns {Object|null}
 */
export function acceptQuote(id) {
  const db = getDb();
  const now = new Date().toISOString();
  const quote = getQuote(id);
  if (!quote) return null;

  db.prepare(`UPDATE fee_quotes SET quote_status = 'accepted', accepted_at = ?, updated_at = ? WHERE id = ?`)
    .run(now, now, id);

  emitAuditEvent({
    eventType: 'quote.accepted',
    category: 'business',
    caseId: quote.case_id || null,
    entityType: 'fee_quote',
    entityId: id,
    summary: `Fee quote accepted by ${quote.client_name}: $${quote.total_fee}`,
    detail: { quoteId: id, totalFee: quote.total_fee },
    actor: 'user',
  });

  return getQuote(id);
}

/**
 * Mark a quote as declined.
 *
 * @param {string} id
 * @param {string} [reason]
 * @returns {Object|null}
 */
export function declineQuote(id, reason) {
  const db = getDb();
  const now = new Date().toISOString();
  const quote = getQuote(id);
  if (!quote) return null;

  const notes = reason
    ? (quote.notes ? quote.notes + '\nDecline reason: ' + reason : 'Decline reason: ' + reason)
    : quote.notes;

  db.prepare(`UPDATE fee_quotes SET quote_status = 'declined', notes = ?, updated_at = ? WHERE id = ?`)
    .run(notes, now, id);

  emitAuditEvent({
    eventType: 'quote.declined',
    category: 'business',
    caseId: quote.case_id || null,
    entityType: 'fee_quote',
    entityId: id,
    summary: `Fee quote declined by ${quote.client_name}`,
    detail: { quoteId: id, reason: reason || null },
    actor: 'user',
  });

  return getQuote(id);
}

/**
 * Mark a quote as expired.
 *
 * @param {string} id
 * @returns {Object|null}
 */
export function expireQuote(id) {
  const db = getDb();
  const now = new Date().toISOString();
  const quote = getQuote(id);
  if (!quote) return null;

  db.prepare(`UPDATE fee_quotes SET quote_status = 'expired', updated_at = ? WHERE id = ?`)
    .run(now, id);

  emitAuditEvent({
    eventType: 'quote.expired',
    category: 'business',
    caseId: quote.case_id || null,
    entityType: 'fee_quote',
    entityId: id,
    summary: `Fee quote expired for ${quote.client_name}`,
    detail: { quoteId: id },
    actor: 'system',
  });

  return getQuote(id);
}

/**
 * Convert an accepted quote to an engagement record and pipeline entry.
 * Links the quote to the provided case ID.
 *
 * @param {string} id - Quote ID
 * @param {string} caseId - Case ID to link
 * @returns {{ quote: Object, engagement: Object, pipelineEntry: Object }}
 */
export function convertQuoteToCaseAndEngagement(id, caseId) {
  const db = getDb();
  const now = new Date().toISOString();
  const quote = getQuote(id);
  if (!quote) throw new Error(`Quote not found: ${id}`);

  // Mark quote as converted
  db.prepare(`UPDATE fee_quotes SET quote_status = 'converted', converted_case_id = ?, updated_at = ? WHERE id = ?`)
    .run(caseId, now, id);

  // Create engagement record
  const engId = 'eng_' + randomUUID().slice(0, 12);
  const engagementType = quote.complexity === 'highly_complex' ? 'complex'
    : quote.rush_requested ? 'rush'
    : 'standard';

  const statusHistory = [{ status: 'pending', date: now, reason: 'Created from accepted quote' }];

  db.prepare(`
    INSERT INTO engagement_records (
      id, case_id, quote_id, client_name, client_type, engagement_type,
      engagement_status, fee_agreed, scope_of_work, status_history_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    engId, caseId, id, quote.client_name, quote.client_type, engagementType,
    'pending', quote.total_fee, quote.notes || null,
    JSON.stringify(statusHistory), now, now,
  );

  // Create pipeline entry
  const pipeId = 'pipe_' + randomUUID().slice(0, 12);
  const stageHistory = [{ stage: 'engaged', entered_at: now, exited_at: null }];

  db.prepare(`
    INSERT INTO pipeline_entries (
      id, case_id, quote_id, engagement_id, stage, property_address,
      client_name, form_type, fee, stage_entered_at, stage_history_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    pipeId, caseId, id, engId, 'engaged', quote.property_address,
    quote.client_name, quote.form_type || null, quote.total_fee,
    now, JSON.stringify(stageHistory), now, now,
  );

  emitAuditEvent({
    eventType: 'quote.converted',
    category: 'business',
    caseId,
    entityType: 'fee_quote',
    entityId: id,
    summary: `Quote converted to engagement for ${quote.client_name}`,
    detail: { quoteId: id, engagementId: engId, pipelineEntryId: pipeId, caseId },
    actor: 'user',
  });

  // Return all created entities
  const updatedQuote = getQuote(id);
  const engagement = db.prepare('SELECT * FROM engagement_records WHERE id = ?').get(engId);
  const pipelineEntry = db.prepare('SELECT * FROM pipeline_entries WHERE id = ?').get(pipeId);

  return {
    quote: updatedQuote,
    engagement,
    pipelineEntry,
  };
}

/**
 * Get aggregate stats for fee quotes.
 *
 * @returns {Object} Summary stats
 */
export function getQuoteSummary() {
  const db = getDb();

  const total = db.prepare('SELECT COUNT(*) AS n FROM fee_quotes').get();
  const byStatus = db.prepare(
    'SELECT quote_status, COUNT(*) AS n FROM fee_quotes GROUP BY quote_status'
  ).all();
  const avgFee = db.prepare('SELECT AVG(total_fee) AS avg_fee FROM fee_quotes').get();

  const accepted = db.prepare("SELECT COUNT(*) AS n FROM fee_quotes WHERE quote_status IN ('accepted', 'converted')").get();
  const totalSent = db.prepare("SELECT COUNT(*) AS n FROM fee_quotes WHERE quote_status != 'draft'").get();
  const conversionRate = totalSent.n > 0 ? accepted.n / totalSent.n : 0;

  const statusMap = {};
  for (const row of byStatus) {
    statusMap[row.quote_status] = row.n;
  }

  return {
    totalQuotes: total.n,
    byStatus: statusMap,
    averageFee: avgFee.avg_fee || 0,
    conversionRate: Math.round(conversionRate * 10000) / 10000,
  };
}

export default {
  calculateFee,
  createQuote,
  getQuote,
  listQuotes,
  updateQuote,
  sendQuote,
  acceptQuote,
  declineQuote,
  expireQuote,
  convertQuoteToCaseAndEngagement,
  getQuoteSummary,
};

