/**
 * server/operations/auditLogger.js
 * ----------------------------------
 * Phase 10 — Centralized Audit Event Emitter
 *
 * Every significant state change in the system flows through this module.
 * It writes to both:
 *   - audit_events table (global trail)
 *   - case_timeline_events table (case-scoped, if case_id is present)
 *
 * Usage:
 *   import { emitAuditEvent } from './auditLogger.js';
 *   emitAuditEvent({
 *     eventType: 'case.created',
 *     category: 'case',
 *     caseId: '4d75eded',
 *     summary: 'Case created: 123 Main St',
 *     detail: { address: '123 Main St', formType: '1004' }
 *   });
 *
 * Design:
 *   - Fire-and-forget: audit failures are non-fatal (logged to stderr, never thrown)
 *   - Synchronous SQLite writes (fast, no async overhead)
 *   - Automatically derives timeline icon from event type
 *   - Deferred initialization: safe to import before DB is ready
 */

import { randomUUID } from 'crypto';
import log from '../logger.js';

// ── Lazy DB reference ─────────────────────────────────────────────────────────
// We import getDb lazily to avoid circular dependency at module load time.
let _getDb = null;

function db() {
  if (!_getDb) {
    try {
      // Dynamic import would be async; instead we do a lazy require-style approach.
      // Since this is ESM, we cache the import at first call.
      const mod = await_getDb_sync();
      _getDb = mod;
    } catch {
      return null;
    }
  }
  return _getDb();
}

// Synchronous lazy loader — called once, caches the getDb function
let _dbModule = null;
function await_getDb_sync() {
  if (_dbModule) return _dbModule;
  // This works because database.js is already loaded by the time audit events fire
  // (schema init happens at server startup before any routes execute)
  try {
    // We'll use a direct approach: the caller must call initAuditLogger(getDb)
    return _dbModule;
  } catch {
    return null;
  }
}

/**
 * Initialize the audit logger with the database accessor.
 * Call once at server startup after DB is ready.
 *
 * @param {function} getDbFn - The getDb() function from server/db/database.js
 */
export function initAuditLogger(getDbFn) {
  _getDb = getDbFn;
  log.info('audit-logger:init', { status: 'ready' });
}

// ── Icon Mapping ──────────────────────────────────────────────────────────────

/** @type {Record<string, import('./types.js').TimelineIcon>} */
const EVENT_ICON_MAP = {
  'case.created':               'create',
  'case.updated':               'edit',
  'case.archived':              'archive',
  'case.restored':              'restore',
  'case.deleted':               'delete',
  'case.status_changed':        'status',
  'case.pipeline_advanced':     'status',
  'case.facts_updated':         'edit',
  'assignment.context_built':   'create',
  'assignment.intelligence_updated': 'edit',
  'document.uploaded':          'upload',
  'document.classified':        'info',
  'document.extracted':         'extract',
  'document.fact_reviewed':     'approve',
  'generation.run_started':     'generate',
  'generation.run_completed':   'generate',
  'generation.run_failed':      'error',
  'generation.section_approved':'approve',
  'generation.section_rejected':'reject',
  'generation.section_edited':  'edit',
  'memory.approved':            'approve',
  'memory.rejected':            'reject',
  'memory.deactivated':         'archive',
  'memory.reactivated':         'restore',
  'qc.run_started':             'qc',
  'qc.run_completed':           'qc',
  'qc.finding_dismissed':       'dismiss',
  'qc.finding_resolved':        'approve',
  'qc.finding_reopened':        'info',
  'insertion.run_started':      'insert',
  'insertion.run_completed':    'insert',
  'insertion.run_failed':       'error',
  'insertion.item_verified':    'verify',
  'insertion.item_retried':     'insert',
  'system.startup':             'info',
  'system.export_created':      'create',
  'system.health_check':        'info',
};

/**
 * Derive a timeline icon from an event type.
 * @param {string} eventType
 * @returns {string}
 */
function iconForEvent(eventType) {
  return EVENT_ICON_MAP[eventType] || 'info';
}

// ── Prepared Statements (cached) ──────────────────────────────────────────────

let _stmtAudit = null;
let _stmtTimeline = null;

function getStatements() {
  const d = _getDb ? _getDb() : null;
  if (!d) return null;

  if (!_stmtAudit) {
    try {
      _stmtAudit = d.prepare(`
        INSERT INTO audit_events (id, event_type, category, case_id, entity_type, entity_id, actor, summary, detail_json, severity, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
    } catch {
      _stmtAudit = null;
    }
  }

  if (!_stmtTimeline) {
    try {
      _stmtTimeline = d.prepare(`
        INSERT INTO case_timeline_events (id, case_id, event_type, category, summary, entity_type, entity_id, icon, detail_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
    } catch {
      _stmtTimeline = null;
    }
  }

  return { audit: _stmtAudit, timeline: _stmtTimeline };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Emit an audit event. Fire-and-forget — never throws.
 *
 * @param {import('./types.js').AuditEventInput} input
 * @returns {string|null} The audit event ID, or null if write failed
 */
export function emitAuditEvent(input) {
  try {
    const {
      eventType,
      category,
      caseId = null,
      entityType = null,
      entityId = null,
      actor = 'user',
      summary,
      detail = {},
      severity = 'info',
    } = input;

    if (!eventType || !category || !summary) {
      log.warn('audit-logger:skip', { reason: 'missing required fields', eventType, category });
      return null;
    }

    const stmts = getStatements();
    if (!stmts || !stmts.audit) {
      // DB not ready yet — log to file logger only
      log.info('audit-event:unwritten', { eventType, category, caseId, summary });
      return null;
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const detailStr = typeof detail === 'string' ? detail : JSON.stringify(detail);

    // Write to audit_events
    stmts.audit.run(id, eventType, category, caseId, entityType, entityId, actor, summary, detailStr, severity, now);

    // Write to case_timeline_events if case-scoped
    if (caseId && stmts.timeline) {
      const timelineId = randomUUID();
      const icon = iconForEvent(eventType);
      stmts.timeline.run(timelineId, caseId, eventType, category, summary, entityType, entityId, icon, detailStr, now);
    }

    return id;
  } catch (err) {
    // Audit failures are non-fatal — log and continue
    log.warn('audit-logger:error', { error: err.message, eventType: input?.eventType });
    return null;
  }
}

/**
 * Emit multiple audit events in a single transaction.
 * Useful for batch operations (e.g., archiving multiple cases).
 *
 * @param {Array<import('./types.js').AuditEventInput>} inputs
 * @returns {Array<string|null>} Array of event IDs
 */
export function emitAuditEventBatch(inputs) {
  if (!Array.isArray(inputs) || inputs.length === 0) return [];

  const d = _getDb ? _getDb() : null;
  if (!d) return inputs.map(() => null);

  try {
    const results = [];
    const txn = d.transaction(() => {
      for (const input of inputs) {
        results.push(emitAuditEvent(input));
      }
    });
    txn();
    return results;
  } catch (err) {
    log.warn('audit-logger:batch-error', { error: err.message, count: inputs.length });
    return inputs.map(() => null);
  }
}

/**
 * Convenience: emit a case-scoped event.
 *
 * @param {string} caseId
 * @param {string} eventType
 * @param {string} summary
 * @param {Object} [detail={}]
 * @param {Object} [opts={}]
 * @returns {string|null}
 */
export function emitCaseEvent(caseId, eventType, summary, detail = {}, opts = {}) {
  const category = eventType.split('.')[0] || 'case';
  return emitAuditEvent({
    eventType,
    category,
    caseId,
    summary,
    detail,
    actor: opts.actor || 'user',
    entityType: opts.entityType || null,
    entityId: opts.entityId || null,
    severity: opts.severity || 'info',
  });
}

/**
 * Convenience: emit a system-level event (no case).
 *
 * @param {string} eventType
 * @param {string} summary
 * @param {Object} [detail={}]
 * @returns {string|null}
 */
export function emitSystemEvent(eventType, summary, detail = {}) {
  return emitAuditEvent({
    eventType,
    category: 'system',
    summary,
    detail,
    actor: 'system',
    severity: 'info',
  });
}

export default {
  initAuditLogger,
  emitAuditEvent,
  emitAuditEventBatch,
  emitCaseEvent,
  emitSystemEvent,
};
