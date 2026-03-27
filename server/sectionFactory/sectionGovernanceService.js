/**
 * server/sectionFactory/sectionGovernanceService.js
 * ---------------------------------------------------
 * Section governance: queries governance metadata from generated_sections,
 * builds dependency graphs per case, marks sections stale when upstream
 * dependencies change, and provides downstream invalidation workflows.
 */

import { dbAll, dbGet, dbRun } from '../db/database.js';
import { getDependentSections } from '../context/reportPlanner.js';
import log from '../logger.js';

// ── Freshness constants ───────────────────────────────────────────────────────
export const FRESHNESS_STATUS = {
  CURRENT: 'current',
  STALE: 'stale',
  REGENERATING: 'regenerating',
};

// ── Governance metadata queries ───────────────────────────────────────────────

/**
 * getSectionGovernanceMetadata
 * Returns governance metadata for all generated sections belonging to a case.
 *
 * @param {string} caseId
 * @returns {Array<Object>}
 */
export function getSectionGovernanceMetadata(caseId) {
  if (!caseId) return [];
  const rows = dbAll(
    `SELECT
       id,
       case_id,
       section_id,
       form_type,
       prompt_version,
       section_policy_json,
       dependency_snapshot_json,
       quality_score,
       quality_metadata_json,
       freshness_status,
       stale_reason,
       stale_since,
       regeneration_count,
       created_at
     FROM generated_sections
     WHERE case_id = ?
     ORDER BY created_at DESC`,
    [caseId],
  );

  return rows.map(parseGovernanceRow);
}

/**
 * getSingleSectionGovernance
 * Returns governance metadata for one specific section of a case.
 * Uses the most recent generated_section row for that section_id.
 *
 * @param {string} caseId
 * @param {string} sectionId
 * @returns {Object|null}
 */
export function getSingleSectionGovernance(caseId, sectionId) {
  if (!caseId || !sectionId) return null;
  const row = dbGet(
    `SELECT
       id,
       case_id,
       section_id,
       form_type,
       prompt_version,
       section_policy_json,
       dependency_snapshot_json,
       quality_score,
       quality_metadata_json,
       freshness_status,
       stale_reason,
       stale_since,
       regeneration_count,
       created_at
     FROM generated_sections
     WHERE case_id = ? AND section_id = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [caseId, sectionId],
  );
  if (!row) return null;
  return parseGovernanceRow(row);
}

// ── Dependency graph ──────────────────────────────────────────────────────────

/**
 * getSectionDependencyGraph
 * Builds a dependency graph for all sections in a case.
 * Returns an object keyed by section_id with upstream/downstream lists.
 *
 * @param {string} caseId
 * @param {string} [formType='1004']
 * @returns {Object}
 */
export function getSectionDependencyGraph(caseId, formType = '1004') {
  if (!caseId) return {};

  const rows = dbAll(
    `SELECT DISTINCT section_id, dependency_snapshot_json
     FROM generated_sections
     WHERE case_id = ?
     ORDER BY created_at DESC`,
    [caseId],
  );

  // De-duplicate by section_id (keep most recent)
  const seen = new Set();
  const unique = [];
  for (const row of rows) {
    if (!seen.has(row.section_id)) {
      seen.add(row.section_id);
      unique.push(row);
    }
  }

  const graph = {};
  for (const row of unique) {
    const snapshot = safeJsonParse(row.dependency_snapshot_json, {});
    const upstream = snapshot.upstreamSections || [];
    const downstream = getDependentSections(formType, row.section_id);
    graph[row.section_id] = { upstream, downstream };
  }

  return graph;
}

// ── Invalidation ──────────────────────────────────────────────────────────────

/**
 * markSectionStale
 * Marks a single section as stale with a reason.
 *
 * @param {string} caseId
 * @param {string} sectionId
 * @param {string} [reason='manual_invalidation']
 * @returns {{ ok: boolean, updated: number }}
 */
export function markSectionStale(caseId, sectionId, reason = 'manual_invalidation') {
  if (!caseId || !sectionId) {
    return { ok: false, updated: 0 };
  }

  const now = new Date().toISOString();
  const result = dbRun(
    `UPDATE generated_sections
     SET freshness_status = ?,
         stale_reason = ?,
         stale_since = ?
     WHERE case_id = ? AND section_id = ? AND freshness_status != ?`,
    [FRESHNESS_STATUS.STALE, reason, now, caseId, sectionId, FRESHNESS_STATUS.STALE],
  );

  log.info('governance:mark-stale', { caseId, sectionId, reason, updated: result.changes });
  return { ok: true, updated: result.changes };
}

/**
 * invalidateDownstream
 * Cascades staleness from a changed dependency to all downstream sections.
 * Returns the list of section IDs that were invalidated.
 *
 * @param {string} caseId
 * @param {string} changedSectionId - the upstream section that changed
 * @param {string} [formType='1004']
 * @returns {{ ok: boolean, invalidated: string[] }}
 */
export function invalidateDownstream(caseId, changedSectionId, formType = '1004') {
  if (!caseId || !changedSectionId) {
    return { ok: false, invalidated: [] };
  }

  const downstream = getDependentSections(formType, changedSectionId);
  const invalidated = [];
  const now = new Date().toISOString();
  const reason = `upstream_changed:${changedSectionId}`;

  for (const sectionId of downstream) {
    const result = dbRun(
      `UPDATE generated_sections
       SET freshness_status = ?,
           stale_reason = ?,
           stale_since = ?
       WHERE case_id = ? AND section_id = ? AND freshness_status != ?`,
      [FRESHNESS_STATUS.STALE, reason, now, caseId, sectionId, FRESHNESS_STATUS.STALE],
    );
    if (result.changes > 0) {
      invalidated.push(sectionId);
    }
  }

  log.info('governance:invalidate-downstream', {
    caseId,
    changedSectionId,
    invalidated,
  });

  return { ok: true, invalidated };
}

// ── Freshness summary ─────────────────────────────────────────────────────────

/**
 * getFreshnessSummary
 * Returns a summary of section freshness status for a case.
 *
 * @param {string} caseId
 * @returns {Object}
 */
export function getFreshnessSummary(caseId) {
  if (!caseId) {
    return { caseId: null, totalSections: 0, current: 0, stale: 0, regenerating: 0, sections: [] };
  }

  const rows = dbAll(
    `SELECT section_id, freshness_status, stale_reason, stale_since, regeneration_count
     FROM generated_sections
     WHERE case_id = ?
     ORDER BY created_at DESC`,
    [caseId],
  );

  // De-duplicate by section_id (keep most recent)
  const seen = new Set();
  const unique = [];
  for (const row of rows) {
    if (!seen.has(row.section_id)) {
      seen.add(row.section_id);
      unique.push(row);
    }
  }

  let current = 0;
  let stale = 0;
  let regenerating = 0;

  const sections = unique.map((row) => {
    const status = row.freshness_status || FRESHNESS_STATUS.CURRENT;
    if (status === FRESHNESS_STATUS.CURRENT) current++;
    else if (status === FRESHNESS_STATUS.STALE) stale++;
    else if (status === FRESHNESS_STATUS.REGENERATING) regenerating++;

    return {
      sectionId: row.section_id,
      freshnessStatus: status,
      staleReason: row.stale_reason || null,
      staleSince: row.stale_since || null,
      regenerationCount: row.regeneration_count || 0,
    };
  });

  return {
    caseId,
    totalSections: unique.length,
    current,
    stale,
    regenerating,
    sections,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeJsonParse(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseGovernanceRow(row) {
  return {
    id: row.id,
    caseId: row.case_id,
    sectionId: row.section_id,
    formType: row.form_type,
    promptVersion: row.prompt_version || null,
    sectionPolicy: safeJsonParse(row.section_policy_json, {}),
    dependencySnapshot: safeJsonParse(row.dependency_snapshot_json, {}),
    qualityScore: row.quality_score ?? null,
    qualityMetadata: safeJsonParse(row.quality_metadata_json, {}),
    freshnessStatus: row.freshness_status || FRESHNESS_STATUS.CURRENT,
    staleReason: row.stale_reason || null,
    staleSince: row.stale_since || null,
    regenerationCount: row.regeneration_count || 0,
    createdAt: row.created_at || null,
  };
}

// ── Default export ────────────────────────────────────────────────────────────
export default {
  FRESHNESS_STATUS,
  getSectionGovernanceMetadata,
  getSingleSectionGovernance,
  getSectionDependencyGraph,
  markSectionStale,
  invalidateDownstream,
  getFreshnessSummary,
};
