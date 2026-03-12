/**
 * server/contradictionGraph/contradictionResolutionService.js
 * -----------------------------------------------------------
 * Phase E — Contradiction Resolution Workflow
 *
 * Manages the lifecycle of contradiction resolution:
 *   - resolve: the contradiction has been addressed (e.g. fact corrected)
 *   - dismiss: the appraiser acknowledges and intentionally dismisses
 *   - acknowledge: noted but deferred for later resolution
 *   - reopen: previously resolved/dismissed contradiction needs re-review
 *
 * Resolution state is persisted per case and survives workspace rebuilds.
 * The contradiction graph builds items; this service tracks their disposition.
 *
 * Resolution decisions are auditable: who, when, why, and what action.
 */

import { getCaseProjection, saveCaseProjection } from '../caseRecord/caseRecordService.js';

// ── Resolution statuses ──────────────────────────────────────────────────────

export const RESOLUTION_STATUS = {
  OPEN:         'open',
  RESOLVED:     'resolved',
  DISMISSED:    'dismissed',
  ACKNOWLEDGED: 'acknowledged',
};

// ── Resolution store access ──────────────────────────────────────────────────
// Resolutions are stored in the case projection under provenance.contradictionResolutions

function getResolutions(caseId) {
  const projection = getCaseProjection(caseId);
  if (!projection) return {};
  return projection.provenance?.contradictionResolutions || {};
}

function saveResolutions(caseId, resolutions) {
  const projection = getCaseProjection(caseId);
  if (!projection) return;
  if (!projection.provenance) projection.provenance = {};
  projection.provenance.contradictionResolutions = resolutions;
  saveCaseProjection(caseId, projection);
}

// ── Resolution actions ───────────────────────────────────────────────────────

/**
 * Resolve a contradiction — the underlying issue has been fixed.
 *
 * @param {string} caseId
 * @param {string} contradictionId
 * @param {object} params
 * @param {string} params.actor - who resolved it
 * @param {string} [params.note] - resolution note
 * @returns {object} resolution record
 */
export function resolveContradiction(caseId, contradictionId, { actor, note }) {
  const resolutions = getResolutions(caseId);
  const record = {
    contradictionId,
    status: RESOLUTION_STATUS.RESOLVED,
    actor: actor || 'appraiser',
    note: note || '',
    resolvedAt: new Date().toISOString(),
    history: [
      ...(resolutions[contradictionId]?.history || []),
      {
        action: 'resolve',
        actor: actor || 'appraiser',
        note: note || '',
        at: new Date().toISOString(),
      },
    ],
  };
  resolutions[contradictionId] = record;
  saveResolutions(caseId, resolutions);
  return record;
}

/**
 * Dismiss a contradiction — appraiser intentionally accepts the inconsistency.
 *
 * @param {string} caseId
 * @param {string} contradictionId
 * @param {object} params
 * @param {string} params.actor
 * @param {string} params.reason - mandatory dismissal reason
 * @returns {object} resolution record
 */
export function dismissContradiction(caseId, contradictionId, { actor, reason }) {
  const resolutions = getResolutions(caseId);
  const record = {
    contradictionId,
    status: RESOLUTION_STATUS.DISMISSED,
    actor: actor || 'appraiser',
    reason: reason || '',
    dismissedAt: new Date().toISOString(),
    history: [
      ...(resolutions[contradictionId]?.history || []),
      {
        action: 'dismiss',
        actor: actor || 'appraiser',
        reason: reason || '',
        at: new Date().toISOString(),
      },
    ],
  };
  resolutions[contradictionId] = record;
  saveResolutions(caseId, resolutions);
  return record;
}

/**
 * Acknowledge a contradiction — noted, deferred for later.
 *
 * @param {string} caseId
 * @param {string} contradictionId
 * @param {object} params
 * @param {string} params.actor
 * @param {string} [params.note]
 * @returns {object} resolution record
 */
export function acknowledgeContradiction(caseId, contradictionId, { actor, note }) {
  const resolutions = getResolutions(caseId);
  const record = {
    contradictionId,
    status: RESOLUTION_STATUS.ACKNOWLEDGED,
    actor: actor || 'appraiser',
    note: note || '',
    acknowledgedAt: new Date().toISOString(),
    history: [
      ...(resolutions[contradictionId]?.history || []),
      {
        action: 'acknowledge',
        actor: actor || 'appraiser',
        note: note || '',
        at: new Date().toISOString(),
      },
    ],
  };
  resolutions[contradictionId] = record;
  saveResolutions(caseId, resolutions);
  return record;
}

/**
 * Reopen a previously resolved or dismissed contradiction.
 *
 * @param {string} caseId
 * @param {string} contradictionId
 * @param {object} params
 * @param {string} params.actor
 * @param {string} [params.reason]
 * @returns {object} resolution record
 */
export function reopenContradiction(caseId, contradictionId, { actor, reason }) {
  const resolutions = getResolutions(caseId);
  const record = {
    contradictionId,
    status: RESOLUTION_STATUS.OPEN,
    actor: actor || 'appraiser',
    reopenedAt: new Date().toISOString(),
    history: [
      ...(resolutions[contradictionId]?.history || []),
      {
        action: 'reopen',
        actor: actor || 'appraiser',
        reason: reason || '',
        at: new Date().toISOString(),
      },
    ],
  };
  resolutions[contradictionId] = record;
  saveResolutions(caseId, resolutions);
  return record;
}

// ── Query helpers ────────────────────────────────────────────────────────────

/**
 * Get the resolution status for a specific contradiction.
 *
 * @param {string} caseId
 * @param {string} contradictionId
 * @returns {object|null} resolution record or null if not yet addressed
 */
export function getContradictionResolution(caseId, contradictionId) {
  const resolutions = getResolutions(caseId);
  return resolutions[contradictionId] || null;
}

/**
 * Get all resolution records for a case.
 *
 * @param {string} caseId
 * @returns {object} map of contradictionId → resolution record
 */
export function getAllResolutions(caseId) {
  return getResolutions(caseId);
}

/**
 * Merge resolution status into a contradiction graph's items array.
 * Adds `resolution` property to each item.
 *
 * @param {string} caseId
 * @param {object[]} graphItems - contradiction items array
 * @returns {object[]} items with resolution status attached
 */
export function mergeResolutionStatus(caseId, graphItems) {
  const resolutions = getResolutions(caseId);
  return (graphItems || []).map(item => ({
    ...item,
    resolution: resolutions[item.id] || { status: RESOLUTION_STATUS.OPEN },
  }));
}

/**
 * Compute a summary of resolution progress for a case.
 *
 * @param {string} caseId
 * @param {object[]} graphItems
 * @returns {object} resolution summary
 */
export function buildResolutionSummary(caseId, graphItems) {
  const resolutions = getResolutions(caseId);
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
