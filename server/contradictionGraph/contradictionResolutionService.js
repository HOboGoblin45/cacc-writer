/**
 * server/contradictionGraph/contradictionResolutionService.js
 * -----------------------------------------------------------
 * Phase E — Contradiction Resolution Workflow
 *
 * Manages the lifecycle of contradiction resolution:
 *   - resolve: the contradiction has been addressed (e.g. fact corrected)
 *   - dismiss: the appraiser intentionally accepts the inconsistency
 *   - acknowledge: noted but deferred for later resolution
 *   - reopen: previously resolved/dismissed contradiction needs re-review
 *
 * Resolution state is persisted in the contradiction_resolutions DB table.
 * The contradiction graph builds items; this service tracks their disposition.
 *
 * Resolution decisions are auditable: who, when, why, and what action.
 */

import { randomUUID } from 'crypto';
import { getDb } from '../db/database.js';
import { emitCaseEvent } from '../operations/auditLogger.js';

// ── Resolution statuses ──────────────────────────────────────────────────────

export const RESOLUTION_STATUS = {
  OPEN:         'open',
  RESOLVED:     'resolved',
  DISMISSED:    'dismissed',
  ACKNOWLEDGED: 'acknowledged',
};

// ── DB helpers ───────────────────────────────────────────────────────────────

function getRow(caseId, contradictionId) {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM contradiction_resolutions WHERE case_id = ? AND contradiction_id = ?'
  ).get(caseId, contradictionId) || null;
}

function getAllRows(caseId) {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM contradiction_resolutions WHERE case_id = ?'
  ).all(caseId);
}

function upsertRow(record) {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO contradiction_resolutions
      (id, case_id, contradiction_id, status, actor, note, reason, history_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.case_id,
    record.contradiction_id,
    record.status,
    record.actor,
    record.note,
    record.reason,
    record.history_json,
    record.created_at,
    record.updated_at,
  );
}

function rowToRecord(row) {
  if (!row) return null;
  return {
    contradictionId: row.contradiction_id,
    status: row.status,
    actor: row.actor,
    note: row.note || '',
    reason: row.reason || '',
    history: JSON.parse(row.history_json || '[]'),
  };
}

// ── Resolution actions ───────────────────────────────────────────────────────

/**
 * Resolve a contradiction — the underlying issue has been fixed.
 */
export function resolveContradiction(caseId, contradictionId, { actor, note }) {
  const existing = getRow(caseId, contradictionId);
  const existingHistory = existing ? JSON.parse(existing.history_json || '[]') : [];
  const now = new Date().toISOString();
  const actorVal = actor || 'appraiser';
  const noteVal = note || '';

  const history = [
    ...existingHistory,
    { action: 'resolve', actor: actorVal, note: noteVal, at: now },
  ];

  upsertRow({
    id: existing?.id || randomUUID(),
    case_id: caseId,
    contradiction_id: contradictionId,
    status: RESOLUTION_STATUS.RESOLVED,
    actor: actorVal,
    note: noteVal,
    reason: existing?.reason || '',
    history_json: JSON.stringify(history),
    created_at: existing?.created_at || now,
    updated_at: now,
  });

  emitCaseEvent(caseId, 'contradiction.resolved', `Contradiction ${contradictionId} resolved`, {
    contradictionId, actor: actorVal, note: noteVal,
  });

  return {
    contradictionId,
    status: RESOLUTION_STATUS.RESOLVED,
    actor: actorVal,
    note: noteVal,
    resolvedAt: now,
    history,
  };
}

/**
 * Dismiss a contradiction — appraiser intentionally accepts the inconsistency.
 */
export function dismissContradiction(caseId, contradictionId, { actor, reason }) {
  const existing = getRow(caseId, contradictionId);
  const existingHistory = existing ? JSON.parse(existing.history_json || '[]') : [];
  const now = new Date().toISOString();
  const actorVal = actor || 'appraiser';
  const reasonVal = reason || '';

  const history = [
    ...existingHistory,
    { action: 'dismiss', actor: actorVal, reason: reasonVal, at: now },
  ];

  upsertRow({
    id: existing?.id || randomUUID(),
    case_id: caseId,
    contradiction_id: contradictionId,
    status: RESOLUTION_STATUS.DISMISSED,
    actor: actorVal,
    note: existing?.note || '',
    reason: reasonVal,
    history_json: JSON.stringify(history),
    created_at: existing?.created_at || now,
    updated_at: now,
  });

  emitCaseEvent(caseId, 'contradiction.dismissed', `Contradiction ${contradictionId} dismissed`, {
    contradictionId, actor: actorVal, reason: reasonVal,
  });

  return {
    contradictionId,
    status: RESOLUTION_STATUS.DISMISSED,
    actor: actorVal,
    reason: reasonVal,
    dismissedAt: now,
    history,
  };
}

/**
 * Acknowledge a contradiction — noted, deferred for later.
 */
export function acknowledgeContradiction(caseId, contradictionId, { actor, note }) {
  const existing = getRow(caseId, contradictionId);
  const existingHistory = existing ? JSON.parse(existing.history_json || '[]') : [];
  const now = new Date().toISOString();
  const actorVal = actor || 'appraiser';
  const noteVal = note || '';

  const history = [
    ...existingHistory,
    { action: 'acknowledge', actor: actorVal, note: noteVal, at: now },
  ];

  upsertRow({
    id: existing?.id || randomUUID(),
    case_id: caseId,
    contradiction_id: contradictionId,
    status: RESOLUTION_STATUS.ACKNOWLEDGED,
    actor: actorVal,
    note: noteVal,
    reason: existing?.reason || '',
    history_json: JSON.stringify(history),
    created_at: existing?.created_at || now,
    updated_at: now,
  });

  emitCaseEvent(caseId, 'contradiction.acknowledged', `Contradiction ${contradictionId} acknowledged`, {
    contradictionId, actor: actorVal, note: noteVal,
  });

  return {
    contradictionId,
    status: RESOLUTION_STATUS.ACKNOWLEDGED,
    actor: actorVal,
    note: noteVal,
    acknowledgedAt: now,
    history,
  };
}

/**
 * Reopen a previously resolved or dismissed contradiction.
 */
export function reopenContradiction(caseId, contradictionId, { actor, reason }) {
  const existing = getRow(caseId, contradictionId);
  const existingHistory = existing ? JSON.parse(existing.history_json || '[]') : [];
  const now = new Date().toISOString();
  const actorVal = actor || 'appraiser';
  const reasonVal = reason || '';

  const history = [
    ...existingHistory,
    { action: 'reopen', actor: actorVal, reason: reasonVal, at: now },
  ];

  upsertRow({
    id: existing?.id || randomUUID(),
    case_id: caseId,
    contradiction_id: contradictionId,
    status: RESOLUTION_STATUS.OPEN,
    actor: actorVal,
    note: existing?.note || '',
    reason: reasonVal,
    history_json: JSON.stringify(history),
    created_at: existing?.created_at || now,
    updated_at: now,
  });

  emitCaseEvent(caseId, 'contradiction.reopened', `Contradiction ${contradictionId} reopened`, {
    contradictionId, actor: actorVal, reason: reasonVal,
  });

  return {
    contradictionId,
    status: RESOLUTION_STATUS.OPEN,
    actor: actorVal,
    reopenedAt: now,
    history,
  };
}

// ── Query helpers ────────────────────────────────────────────────────────────

/**
 * Get the resolution status for a specific contradiction.
 */
export function getContradictionResolution(caseId, contradictionId) {
  return rowToRecord(getRow(caseId, contradictionId));
}

/**
 * Get all resolution records for a case.
 * @returns {object} map of contradictionId → resolution record
 */
export function getAllResolutions(caseId) {
  const rows = getAllRows(caseId);
  const map = {};
  for (const row of rows) {
    map[row.contradiction_id] = rowToRecord(row);
  }
  return map;
}

/**
 * Merge resolution status into a contradiction graph's items array.
 */
export function mergeResolutionStatus(caseId, graphItems) {
  const resolutions = getAllResolutions(caseId);
  return (graphItems || []).map(item => ({
    ...item,
    resolution: resolutions[item.id] || { status: RESOLUTION_STATUS.OPEN },
  }));
}

/**
 * Compute a summary of resolution progress for a case.
 */
export function buildResolutionSummary(caseId, graphItems) {
  const resolutions = getAllResolutions(caseId);
  const total = (graphItems || []).length;
  let open = 0;
  let resolved = 0;
  let dismissed = 0;
  let acknowledged = 0;

  for (const item of (graphItems || [])) {
    const resolution = resolutions[item.id];
    if (!resolution || resolution.status === RESOLUTION_STATUS.OPEN) {
      open++;
    } else if (resolution.status === RESOLUTION_STATUS.RESOLVED) {
      resolved++;
    } else if (resolution.status === RESOLUTION_STATUS.DISMISSED) {
      dismissed++;
    } else if (resolution.status === RESOLUTION_STATUS.ACKNOWLEDGED) {
      acknowledged++;
    } else {
      open++;
    }
  }

  return {
    total,
    open,
    resolved,
    dismissed,
    acknowledged,
    allAddressed: open === 0,
    completionPercent: total > 0 ? Math.round(((resolved + dismissed) / total) * 100) : 100,
  };
}
