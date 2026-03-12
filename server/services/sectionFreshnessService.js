/**
 * server/services/sectionFreshnessService.js
 * --------------------------------------------
 * Priority 3 — Section Freshness Tracking Service
 *
 * Provides freshness evaluation for generated sections:
 *   - evaluateSectionFreshness(caseId, sectionId)  — single section freshness check
 *   - evaluateAllSectionsFreshness(caseId)          — batch freshness check
 *   - getStaleSections(caseId)                      — list of stale sections
 *   - invalidateSections(caseId, sectionIds, reason) — manual invalidation
 *   - markSectionFresh(caseId, sectionId)           — mark fresh after regeneration
 *   - onFactsChanged(caseId, changedPaths)          — fact-change invalidation hook
 *
 * Uses detectStaleness() from sectionPolicyService as the core staleness engine.
 * Reads generated sections and their stored dependency snapshots from DB.
 */

import { getDb } from '../db/database.js';
import {
  detectStaleness,
  getPromptVersion,
  buildDependencySnapshot,
  FRESHNESS,
} from './sectionPolicyService.js';
import { SECTION_DEPENDENCIES, getSectionDependencies } from '../sectionDependencies.js';
import { getCaseProjection } from '../caseRecord/caseRecordService.js';
import log from '../logger.js';

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Retrieve the latest generated section row for a given case + section.
 * Returns the most recently created row (latest run).
 */
function getLatestGeneratedSection(caseId, sectionId) {
  return getDb().prepare(`
    SELECT id, section_id, case_id, run_id, draft_text, final_text,
           audit_metadata_json, dependency_snapshot_json,
           quality_score, quality_metadata_json,
           freshness_status, stale_reason, stale_since,
           regeneration_count, prompt_version, created_at
      FROM generated_sections
     WHERE case_id = ? AND section_id = ?
     ORDER BY created_at DESC
     LIMIT 1
  `).get(caseId, sectionId);
}

/**
 * Retrieve all latest generated sections for a case (one per section_id).
 */
function getAllLatestGeneratedSections(caseId) {
  // Use a window function to get the latest per section_id
  return getDb().prepare(`
    SELECT gs.*
      FROM generated_sections gs
     INNER JOIN (
       SELECT section_id, MAX(created_at) AS max_created
         FROM generated_sections
        WHERE case_id = ?
        GROUP BY section_id
     ) latest ON gs.section_id = latest.section_id
                 AND gs.created_at = latest.max_created
     WHERE gs.case_id = ?
     ORDER BY gs.section_id
  `).all(caseId, caseId);
}

function parseJsonSafe(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Update the freshness columns on a generated_sections row.
 */
function updateFreshnessStatus(rowId, freshnessStatus, staleReason, staleSince) {
  getDb().prepare(`
    UPDATE generated_sections
       SET freshness_status = ?, stale_reason = ?, stale_since = ?
     WHERE id = ?
  `).run(freshnessStatus, staleReason, staleSince, rowId);
}

/**
 * Increment the regeneration_count on a generated_sections row.
 */
function incrementRegenerationCount(rowId) {
  getDb().prepare(`
    UPDATE generated_sections
       SET regeneration_count = COALESCE(regeneration_count, 0) + 1
     WHERE id = ?
  `).run(rowId);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Evaluate the freshness of a specific generated section against current facts.
 *
 * @param {string} caseId
 * @param {string} sectionId
 * @returns {{ sectionId, freshness, changedPaths, reasons, generatedAt, qualityScore, regenerationCount }}
 */
export function evaluateSectionFreshness(caseId, sectionId) {
  const row = getLatestGeneratedSection(caseId, sectionId);

  if (!row) {
    return {
      sectionId,
      freshness: FRESHNESS.NOT_GENERATED,
      changedPaths: [],
      reasons: ['Section has not been generated'],
      generatedAt: null,
      qualityScore: null,
      regenerationCount: 0,
    };
  }

  // Get current facts
  const projection = getCaseProjection(caseId);
  const facts = projection?.facts || {};

  // Get stored dependency snapshot
  const storedSnapshot = parseJsonSafe(row.dependency_snapshot_json, null)
    || parseJsonSafe(row.audit_metadata_json, {})?.dependencySnapshot
    || null;

  // Get current prompt version for this section
  const currentPromptVersion = getPromptVersion(sectionId);

  // Run staleness detection
  const staleness = detectStaleness(storedSnapshot, facts, currentPromptVersion);

  // If the DB already has a stale status set (e.g. from manual invalidation),
  // and the staleness engine says current, prefer the DB status.
  const dbFreshness = row.freshness_status || 'current';
  let effectiveFreshness = staleness.freshness;
  let effectiveReasons = staleness.reasons;

  if (staleness.freshness === FRESHNESS.CURRENT && dbFreshness !== 'current') {
    effectiveFreshness = dbFreshness;
    effectiveReasons = [row.stale_reason || 'Manually invalidated'];
  }

  // Persist the computed freshness back to DB if it changed
  if (effectiveFreshness !== dbFreshness) {
    const staleSince = effectiveFreshness === FRESHNESS.CURRENT
      ? null
      : (row.stale_since || new Date().toISOString());
    updateFreshnessStatus(
      row.id,
      effectiveFreshness,
      effectiveReasons.join('; ') || null,
      staleSince,
    );
  }

  return {
    sectionId,
    freshness: effectiveFreshness,
    changedPaths: staleness.changedPaths,
    reasons: effectiveReasons,
    generatedAt: row.created_at,
    qualityScore: row.quality_score,
    regenerationCount: row.regeneration_count || 0,
  };
}

/**
 * Batch freshness check for all generated sections in a case.
 *
 * @param {string} caseId
 * @returns {{ sections: object[], summary: { total, current, stale, notGenerated } }}
 */
export function evaluateAllSectionsFreshness(caseId) {
  const rows = getAllLatestGeneratedSections(caseId);

  // Get current facts once
  const projection = getCaseProjection(caseId);
  const facts = projection?.facts || {};

  const results = [];

  for (const row of rows) {
    const storedSnapshot = parseJsonSafe(row.dependency_snapshot_json, null)
      || parseJsonSafe(row.audit_metadata_json, {})?.dependencySnapshot
      || null;

    const currentPromptVersion = getPromptVersion(row.section_id);
    const staleness = detectStaleness(storedSnapshot, facts, currentPromptVersion);

    const dbFreshness = row.freshness_status || 'current';
    let effectiveFreshness = staleness.freshness;
    let effectiveReasons = staleness.reasons;

    if (staleness.freshness === FRESHNESS.CURRENT && dbFreshness !== 'current') {
      effectiveFreshness = dbFreshness;
      effectiveReasons = [row.stale_reason || 'Manually invalidated'];
    }

    // Update DB if freshness changed
    if (effectiveFreshness !== dbFreshness) {
      const staleSince = effectiveFreshness === FRESHNESS.CURRENT
        ? null
        : (row.stale_since || new Date().toISOString());
      updateFreshnessStatus(row.id, effectiveFreshness, effectiveReasons.join('; ') || null, staleSince);
    }

    results.push({
      sectionId: row.section_id,
      freshness: effectiveFreshness,
      changedPaths: staleness.changedPaths,
      reasons: effectiveReasons,
      generatedAt: row.created_at,
      qualityScore: row.quality_score,
      regenerationCount: row.regeneration_count || 0,
    });
  }

  const summary = {
    total: results.length,
    current: results.filter(r => r.freshness === FRESHNESS.CURRENT).length,
    stale: results.filter(r =>
      r.freshness !== FRESHNESS.CURRENT && r.freshness !== FRESHNESS.NOT_GENERATED
    ).length,
    notGenerated: results.filter(r => r.freshness === FRESHNESS.NOT_GENERATED).length,
  };

  return { sections: results, summary };
}

/**
 * Get the list of sections that need regeneration.
 *
 * @param {string} caseId
 * @returns {object[]} list of stale section descriptors
 */
export function getStaleSections(caseId) {
  const { sections } = evaluateAllSectionsFreshness(caseId);
  return sections.filter(s =>
    s.freshness !== FRESHNESS.CURRENT && s.freshness !== FRESHNESS.NOT_GENERATED
  );
}

/**
 * Manually invalidate one or more sections.
 *
 * @param {string} caseId
 * @param {string[]} sectionIds - sections to invalidate
 * @param {string} [reason] - reason for invalidation
 * @returns {{ invalidated: string[], skipped: string[] }}
 */
export function invalidateSections(caseId, sectionIds, reason = 'Manual invalidation') {
  const invalidated = [];
  const skipped = [];

  for (const sectionId of sectionIds) {
    const row = getLatestGeneratedSection(caseId, sectionId);
    if (!row) {
      skipped.push(sectionId);
      continue;
    }

    updateFreshnessStatus(
      row.id,
      FRESHNESS.STALE_DUE_TO_FACT_CHANGE,
      reason,
      new Date().toISOString(),
    );
    invalidated.push(sectionId);
  }

  log.info('freshness:invalidate', { caseId, invalidated, skipped, reason });
  return { invalidated, skipped };
}

/**
 * Mark a section as fresh (typically after successful regeneration).
 *
 * @param {string} caseId
 * @param {string} sectionId
 */
export function markSectionFresh(caseId, sectionId) {
  const row = getLatestGeneratedSection(caseId, sectionId);
  if (!row) return;

  updateFreshnessStatus(row.id, FRESHNESS.CURRENT, null, null);
  incrementRegenerationCount(row.id);
}

/**
 * Fact-change invalidation hook.
 * When facts change, detect which sections depend on the changed fact paths
 * and mark them as stale in the DB.
 *
 * @param {string} caseId
 * @param {string[]} changedPaths - dot-notation fact paths that changed
 * @returns {{ affectedSections: string[], invalidated: string[] }}
 */
export function onFactsChanged(caseId, changedPaths) {
  if (!changedPaths || changedPaths.length === 0) {
    return { affectedSections: [], invalidated: [] };
  }

  const changedSet = new Set(changedPaths);
  const affectedSections = [];

  // Find all sections that depend on any of the changed paths
  for (const [sectionId, deps] of Object.entries(SECTION_DEPENDENCIES)) {
    const allPaths = [...(deps.required || []), ...(deps.recommended || [])];
    const hasOverlap = allPaths.some(p => changedSet.has(p));
    if (hasOverlap) {
      affectedSections.push(sectionId);
    }
  }

  if (affectedSections.length === 0) {
    return { affectedSections: [], invalidated: [] };
  }

  // Invalidate the affected sections that have been generated
  const { invalidated, skipped } = invalidateSections(
    caseId,
    affectedSections,
    `Fact change: ${changedPaths.join(', ')}`,
  );

  log.info('freshness:fact-change', {
    caseId,
    changedPaths,
    affectedSections,
    invalidated,
  });

  return { affectedSections, invalidated };
}

/**
 * Detect which fact paths changed between old and new facts objects.
 * Useful for integrating with workspace autosave flow.
 *
 * @param {object} oldFacts
 * @param {object} newFacts
 * @returns {string[]} list of changed dot-notation paths
 */
export function detectChangedFactPaths(oldFacts, newFacts) {
  const allPaths = new Set();

  // Collect all declared dependency paths
  for (const deps of Object.values(SECTION_DEPENDENCIES)) {
    for (const p of (deps.required || [])) allPaths.add(p);
    for (const p of (deps.recommended || [])) allPaths.add(p);
  }

  const changed = [];

  for (const dotPath of allPaths) {
    const oldVal = resolveFactPath(oldFacts, dotPath);
    const newVal = resolveFactPath(newFacts, dotPath);
    if (normalize(oldVal) !== normalize(newVal)) {
      changed.push(dotPath);
    }
  }

  return changed;
}

// ── Internal fact resolution helpers ─────────────────────────────────────────

function resolveFactPath(facts, dotPath) {
  if (!facts || !dotPath) return null;
  const parts = dotPath.split('.');
  let cur = facts;
  for (const part of parts) {
    if (cur === null || cur === undefined) return null;
    const idx = parseInt(part, 10);
    if (!isNaN(idx) && Array.isArray(cur)) {
      cur = cur[idx];
    } else {
      cur = cur[part];
    }
  }
  if (cur === null || cur === undefined) return null;
  const val = (cur && typeof cur === 'object' && 'value' in cur) ? cur.value : cur;
  if (val === null || val === undefined) return null;
  return String(val).trim() || null;
}

function normalize(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim().toLowerCase();
}
