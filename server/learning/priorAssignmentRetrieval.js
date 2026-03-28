/**
 * server/learning/priorAssignmentRetrieval.js
 * -----------------------------------------------
 * Phase 11 — Prior Assignment Retrieval
 *
 * Finds prior assignments with similar properties to inform comp ranking
 * and narrative drafting in new assignments.
 *
 * Similarity matching on:
 *   - Property type
 *   - Market area
 *   - Price range
 *   - Form type
 *
 * Returns similarity scores and relevant archived data.
 *
 * All functions are synchronous (better-sqlite3).
 */

import { dbAll, dbGet } from '../db/database.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseJSON(val, fallback = {}) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

// ── Similarity Weights ──────────────────────────────────────────────────────

const SIMILARITY_WEIGHTS = {
  propertyType:  30,   // same property type is most important
  formType:      20,   // same form type
  marketArea:    25,   // same market area
  priceRange:    25,   // overlapping price range
};

// ── Main Retrieval ──────────────────────────────────────────────────────────

/**
 * Find prior assignments similar to the given case context.
 *
 * @param {Object} caseContext
 * @param {string} [caseContext.propertyType] — e.g. 'single_family', 'condo'
 * @param {string} [caseContext.marketArea] — e.g. county or city name
 * @param {string} [caseContext.formType] — e.g. '1004', 'commercial'
 * @param {number} [caseContext.estimatedValue] — approximate subject value
 * @param {number} [caseContext.priceRangeLow] — low end of price range
 * @param {number} [caseContext.priceRangeHigh] — high end of price range
 * @param {number} [caseContext.maxResults] — max results to return (default 5)
 * @returns {{ results: Object[], totalScanned: number }}
 */
export function findSimilarAssignments(caseContext = {}) {
  const maxResults = caseContext.maxResults || 5;

  // Load all active archives
  const archives = dbAll(
    "SELECT * FROM assignment_archives WHERE status = 'active' ORDER BY archived_at DESC",
    []
  );

  if (archives.length === 0) {
    return { results: [], totalScanned: 0 };
  }

  // Score each archive for similarity
  const scored = archives.map(archive => {
    const score = computeSimilarityScore(archive, caseContext);
    return { archive, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score.totalScore - a.score.totalScore);

  // Filter out zero-score results and take top N
  const filtered = scored.filter(s => s.score.totalScore > 0);
  const topN = filtered.slice(0, maxResults);

  const results = topN.map(({ archive, score }) => ({
    archiveId: archive.id,
    caseId: archive.case_id,
    formType: archive.form_type,
    propertyType: archive.property_type,
    marketArea: archive.market_area,
    priceRangeLow: archive.price_range_low,
    priceRangeHigh: archive.price_range_high,
    archivedAt: archive.archived_at,
    similarityScore: score.totalScore,
    scoreBreakdown: score.breakdown,
    matchReasons: score.matchReasons,
    // Include summary data for quick reference
    summary: {
      compCount: countComps(archive),
      adjustmentCount: countAdjustments(archive),
      sectionCount: countSections(archive),
    },
  }));

  return {
    results,
    totalScanned: archives.length,
  };
}

/**
 * Get full archive data for a similar assignment.
 * Use after findSimilarAssignments to drill into a specific match.
 *
 * @param {string} archiveId
 * @returns {Object|null}
 */
export function getSimilarAssignmentDetail(archiveId) {
  const row = dbGet('SELECT * FROM assignment_archives WHERE id = ?', [archiveId]);
  if (!row) return null;

  return {
    id: row.id,
    caseId: row.case_id,
    formType: row.form_type,
    propertyType: row.property_type,
    marketArea: row.market_area,
    priceRangeLow: row.price_range_low,
    priceRangeHigh: row.price_range_high,
    archivedAt: row.archived_at,
    subjectSnapshot: parseJSON(row.subject_snapshot_json, {}),
    compSet: parseJSON(row.comp_set_json, {}),
    adjustments: parseJSON(row.adjustments_json, {}),
    narratives: parseJSON(row.narratives_json, {}),
    reconciliation: parseJSON(row.reconciliation_json, {}),
  };
}

// ── Similarity Scoring ──────────────────────────────────────────────────────

/**
 * Compute similarity score between an archive and a case context.
 *
 * @param {Object} archive — raw DB row from assignment_archives
 * @param {Object} context — case context to match against
 * @returns {{ totalScore: number, breakdown: Object, matchReasons: string[] }}
 */
function computeSimilarityScore(archive, context) {
  const breakdown = {};
  const matchReasons = [];
  let total = 0;

  // ── Property type match ────────────────────────────────────────────────
  if (context.propertyType && archive.property_type) {
    if (normalize(archive.property_type) === normalize(context.propertyType)) {
      breakdown.propertyType = SIMILARITY_WEIGHTS.propertyType;
      matchReasons.push(`property type: ${context.propertyType}`);
    } else {
      breakdown.propertyType = 0;
    }
  }

  // ── Form type match ────────────────────────────────────────────────────
  if (context.formType && archive.form_type) {
    if (normalize(archive.form_type) === normalize(context.formType)) {
      breakdown.formType = SIMILARITY_WEIGHTS.formType;
      matchReasons.push(`form type: ${context.formType}`);
    } else {
      breakdown.formType = 0;
    }
  }

  // ── Market area match ──────────────────────────────────────────────────
  if (context.marketArea && archive.market_area) {
    if (normalize(archive.market_area) === normalize(context.marketArea)) {
      breakdown.marketArea = SIMILARITY_WEIGHTS.marketArea;
      matchReasons.push(`market area: ${context.marketArea}`);
    } else {
      breakdown.marketArea = 0;
    }
  }

  // ── Price range overlap ────────────────────────────────────────────────
  const priceScore = computePriceRangeOverlap(archive, context);
  if (priceScore > 0) {
    breakdown.priceRange = Math.round(SIMILARITY_WEIGHTS.priceRange * priceScore);
    matchReasons.push(`price range overlap (${Math.round(priceScore * 100)}%)`);
  } else {
    breakdown.priceRange = 0;
  }

  total = Object.values(breakdown).reduce((s, v) => s + (v || 0), 0);

  return { totalScore: total, breakdown, matchReasons };
}

/**
 * Compute price range overlap between an archive and a context.
 * Returns 0-1 overlap score.
 */
function computePriceRangeOverlap(archive, context) {
  const archiveLow = archive.price_range_low;
  const archiveHigh = archive.price_range_high;

  // Determine context price range
  let ctxLow = context.priceRangeLow;
  let ctxHigh = context.priceRangeHigh;

  if (!ctxLow && !ctxHigh && context.estimatedValue) {
    // Estimate a range of +/- 20% around estimated value
    ctxLow = context.estimatedValue * 0.8;
    ctxHigh = context.estimatedValue * 1.2;
  }

  if (!archiveLow || !archiveHigh || !ctxLow || !ctxHigh) return 0;
  if (archiveLow > ctxHigh || ctxLow > archiveHigh) return 0;

  // Compute overlap
  const overlapLow = Math.max(archiveLow, ctxLow);
  const overlapHigh = Math.min(archiveHigh, ctxHigh);
  const overlap = overlapHigh - overlapLow;

  // Normalize by the smaller range
  const archiveRange = archiveHigh - archiveLow;
  const ctxRange = ctxHigh - ctxLow;
  const smallerRange = Math.min(archiveRange, ctxRange);

  if (smallerRange <= 0) return overlap > 0 ? 1 : 0;

  return Math.min(1, overlap / smallerRange);
}

// ── Summary Helpers ─────────────────────────────────────────────────────────

function countComps(archive) {
  const compSet = parseJSON(archive.comp_set_json, {});
  return (compSet.accepted || []).length + (compSet.rejected || []).length;
}

function countAdjustments(archive) {
  const adjustments = parseJSON(archive.adjustments_json, []);
  return Array.isArray(adjustments) ? adjustments.length : 0;
}

function countSections(archive) {
  const narratives = parseJSON(archive.narratives_json, {});
  return (narratives.sections || []).length;
}

function normalize(str) {
  if (!str) return '';
  return str.toLowerCase().trim().replace(/[\s_-]+/g, '_');
}
