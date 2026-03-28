/**
 * server/learning/learningBoostProvider.js
 * -------------------------------------------
 * Phase 11 — Learning Boost Provider
 *
 * Provides learning-based boost/demotion scores for the retrieval ranking engine.
 * Queries the learned_patterns table to determine if similar items were
 * previously accepted or rejected by the appraiser.
 *
 * All boosts are transparent and explainable — every score delta includes
 * a reason string that can be surfaced to the appraiser.
 *
 * This module is designed to be fail-safe: if the learning tables don't exist
 * or any query fails, it returns zero boost rather than crashing.
 */

import { dbAll } from '../db/database.js';

// ── Constants ────────────────────────────────────────────────────────────────

const LEARNING_BOOST_MAX = 20;     // Maximum positive boost from learning
const LEARNING_DEMOTION_MAX = -10; // Maximum negative demotion from learning
const CONFIDENCE_THRESHOLD = 0.3;  // Minimum confidence to apply a boost

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseJSON(val, fallback = {}) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

// ── Main Boost Function ──────────────────────────────────────────────────────

/**
 * Get learning-based boost for a memory item in the context of a retrieval query.
 *
 * Checks learned patterns to see if:
 *   - Items with similar characteristics were previously accepted (+boost)
 *   - Items with similar characteristics were previously rejected (-demotion)
 *
 * @param {Object} item — memory item from approved_memory being scored
 * @param {Object} query — retrieval query context
 * @returns {{ score: number, reasons: string[] }}
 */
export function getLearningBoostForItem(item, query) {
  const score = 0;
  const reasons = [];

  try {
    // Look for relevant patterns that match this item's characteristics
    const patterns = findRelevantPatternsForItem(item, query);

    if (patterns.length === 0) {
      return { score: 0, reasons: [] };
    }

    let totalBoost = 0;

    for (const pattern of patterns) {
      const data = parseJSON(pattern.pattern_data_json, {});
      const confidence = pattern.confidence || 0.5;

      if (confidence < CONFIDENCE_THRESHOLD) continue;

      if (pattern.pattern_type === 'comp_acceptance') {
        const boost = computeCompAcceptanceBoost(data, confidence, item);
        if (boost.score !== 0) {
          totalBoost += boost.score;
          reasons.push(...boost.reasons);
        }
      } else if (pattern.pattern_type === 'narrative_edit') {
        const boost = computeNarrativeEditBoost(data, confidence, item, query);
        if (boost.score !== 0) {
          totalBoost += boost.score;
          reasons.push(...boost.reasons);
        }
      }
    }

    // Clamp to bounds
    const clampedScore = Math.max(
      LEARNING_DEMOTION_MAX,
      Math.min(LEARNING_BOOST_MAX, totalBoost)
    );

    return { score: clampedScore, reasons };
  } catch {
    // Fail safe — learning tables may not exist yet
    return { score: 0, reasons: [] };
  }
}

// ── Pattern Matching ─────────────────────────────────────────────────────────

/**
 * Find learned patterns relevant to a given item and query.
 */
function findRelevantPatternsForItem(item, query) {
  try {
    const where = ['confidence >= ?'];
    const params = [CONFIDENCE_THRESHOLD];

    // Match on form type if available
    if (query.formType) {
      where.push('pattern_key LIKE ?');
      params.push(`%${query.formType.toLowerCase()}%`);
    }

    // Limit to the most relevant patterns
    const rows = dbAll(`
      SELECT * FROM learned_patterns
      WHERE ${where.join(' AND ')}
      ORDER BY confidence DESC, usage_count DESC
      LIMIT 10
    `, params);

    return rows;
  } catch {
    return [];
  }
}

// ── Boost Calculators ────────────────────────────────────────────────────────

/**
 * Compute boost based on comp acceptance patterns.
 */
function computeCompAcceptanceBoost(data, confidence, item) {
  const reasons = [];
  let score = 0;

  if (!data.action) return { score: 0, reasons: [] };

  // Check if the item's property type matches the pattern
  const itemPropertyType = (item.propertyType || '').toLowerCase();
  const patternPropertyType = (data.propertyType || '').toLowerCase();

  if (itemPropertyType && patternPropertyType && itemPropertyType === patternPropertyType) {
    if (data.action === 'accepted') {
      score = Math.round(LEARNING_BOOST_MAX * 0.5 * confidence);
      reasons.push(`learning: similar property type previously accepted (+${score}, confidence: ${(confidence * 100).toFixed(0)}%)`);
    } else if (data.action === 'rejected') {
      score = Math.round(LEARNING_DEMOTION_MAX * 0.3 * confidence);
      reasons.push(`learning: similar property type previously rejected (${score}, confidence: ${(confidence * 100).toFixed(0)}%)`);
    }
  }

  return { score, reasons };
}

/**
 * Compute boost based on narrative edit patterns.
 */
function computeNarrativeEditBoost(data, confidence, item, query) {
  const reasons = [];
  let score = 0;

  if (!data.sectionId || !query.canonicalFieldId) return { score: 0, reasons: [] };

  // If this is the same section the appraiser consistently edits,
  // boost examples from similar sections (more examples = better drafts)
  if (data.sectionId === query.canonicalFieldId) {
    if (data.wasApproved) {
      score = Math.round(LEARNING_BOOST_MAX * 0.3 * confidence);
      reasons.push(`learning: section ${data.sectionId} had approved edits (+${score})`);
    }
  }

  return { score, reasons };
}

/**
 * Get learning-enhanced suggestions for a case.
 * Returns patterns formatted as suggestions with boost scores.
 *
 * @param {string} caseId
 * @param {Object} context — case context
 * @returns {Object[]}
 */
export function getLearningEnhancedSuggestions(caseId, context = {}) {
  try {
    const where = ['confidence >= ?'];
    const params = [CONFIDENCE_THRESHOLD];

    if (context.formType) {
      where.push('pattern_key LIKE ?');
      params.push(`%${context.formType.toLowerCase()}%`);
    }

    const patterns = dbAll(`
      SELECT lp.*, aa.case_id AS source_case_id, aa.form_type AS source_form_type,
             aa.property_type AS source_property_type, aa.market_area AS source_market_area
      FROM learned_patterns lp
      LEFT JOIN assignment_archives aa ON lp.archive_id = aa.id
      WHERE ${where.join(' AND ')}
      ORDER BY lp.confidence DESC, lp.usage_count DESC
      LIMIT 20
    `, params);

    return patterns.map(p => ({
      patternId: p.id,
      patternType: p.pattern_type,
      patternKey: p.pattern_key,
      confidence: p.confidence,
      usageCount: p.usage_count,
      data: parseJSON(p.pattern_data_json, {}),
      source: {
        caseId: p.source_case_id,
        formType: p.source_form_type,
        propertyType: p.source_property_type,
        marketArea: p.source_market_area,
      },
    }));
  } catch {
    return [];
  }
}
