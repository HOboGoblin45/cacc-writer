/**
 * server/memory/retrievalRankingEngine.js
 * ------------------------------------------
 * Phase 6 — Retrieval Ranking Engine
 *
 * Deterministic + scored retrieval layer that ranks relevant approved memory
 * for a given assignment and section.
 *
 * Scoring dimensions (configurable weights):
 *   - canonicalFieldId match
 *   - reportFamily match
 *   - formType match
 *   - propertyType match
 *   - assignmentType match
 *   - loanProgram match
 *   - marketType match
 *   - county/city match
 *   - subjectCondition match
 *   - issue/flag tag overlap
 *   - style tag overlap
 *   - source trust bonus
 *   - quality score bonus
 *   - recency bonus
 *   - pinned bonus
 *
 * Output: ranked candidates with traceable scoring breakdowns.
 *
 * This is NOT naive keyword search.
 * Every score component is explainable and debuggable.
 */

import {
  getApprovedMemoryForRetrieval,
  getCompCommentaryForRetrieval,
} from '../db/repositories/memoryRepo.js';
import { getLearningBoostForItem } from '../learning/learningBoostProvider.js';

// ── Scoring Weights ─────────────────────────────────────────────────────────
// These are the Phase 6 retrieval weights.
// They extend the Phase 3 weights from server/config/retrievalWeights.js
// but are specific to the approved_memory and comp_commentary_memory tables.

const DIMENSION_WEIGHTS = {
  canonicalFieldId:  35,   // exact section match is most important
  sectionGroup:      15,   // same section group (e.g. 'neighborhood')
  reportFamily:      20,   // same report family
  formType:          15,   // same form type
  propertyType:      12,   // same property type
  assignmentType:     8,   // same assignment type (purchase, refinance)
  loanProgram:        5,   // same loan program
  marketType:         8,   // same market type (urban/suburban/rural)
  county:            10,   // same county
  city:               6,   // same city
  state:              3,   // same state
  subjectCondition:   5,   // same condition rating
};

const SOURCE_TRUST_BONUS = {
  approved_narrative:  25,
  approved_edit:       15,
  curated:             12,
  voice_exemplar:      20,
  generated:            5,
  imported:             8,
};

const TAG_OVERLAP_WEIGHT = 5;    // per matching tag
const QUALITY_WEIGHT     = 0.15; // multiplied by quality_score (0-100)
const RECENCY_WEIGHT     = 10;   // max bonus for recent items
const RECENCY_HALF_LIFE_DAYS = 90;
const PINNED_BONUS       = 30;

const MAX_CANDIDATES_DEFAULT = 5;
const MAX_COMP_COMMENTARY_DEFAULT = 3;

// ── Main Ranking Function ───────────────────────────────────────────────────

/**
 * Rank approved memory items for a given retrieval query.
 *
 * @param {import('./memoryTypes.js').RetrievalQuery} query
 * @returns {{ candidates: import('./memoryTypes.js').RetrievalCandidate[], totalScanned: number, durationMs: number }}
 */
export function rankApprovedMemory(query) {
  const t0 = Date.now();
  const maxResults = query.maxResults || MAX_CANDIDATES_DEFAULT;

  // Load all eligible items from DB
  const items = getApprovedMemoryForRetrieval({
    bucket: query.bucketFilter || undefined,
    formType: query.formType || undefined,
  });

  // Score each item
  const scored = items.map(item => {
    const score = scoreItem(item, query);
    return { item, score };
  });

  // Sort by total score descending
  scored.sort((a, b) => b.score.totalScore - a.score.totalScore);

  // Take top N
  const topN = scored.slice(0, maxResults);

  // Build candidates with full metadata
  const candidates = topN.map(({ item, score }) => ({
    id: item.id,
    text: item.text,
    bucket: item.bucket,
    sourceType: item.sourceType,
    score,
    metadata: {
      canonicalFieldId: item.canonicalFieldId,
      reportFamily: item.reportFamily,
      formType: item.formType,
      propertyType: item.propertyType,
      qualityScore: item.qualityScore,
      pinned: item.pinned,
    },
  }));

  return {
    candidates,
    totalScanned: items.length,
    durationMs: Date.now() - t0,
  };
}

/**
 * Rank comp commentary memory items for a given query.
 *
 * @param {Object} query — similar to RetrievalQuery but with comp-specific fields
 * @returns {{ candidates: Object[], totalScanned: number, durationMs: number }}
 */
export function rankCompCommentary(query) {
  const t0 = Date.now();
  const maxResults = query.maxResults || MAX_COMP_COMMENTARY_DEFAULT;

  const items = getCompCommentaryForRetrieval({
    formType: query.formType || undefined,
  });

  const scored = items.map(item => {
    const score = scoreCompCommentary(item, query);
    return { item, score };
  });

  scored.sort((a, b) => b.score.totalScore - a.score.totalScore);

  const topN = scored.slice(0, maxResults);

  const candidates = topN.map(({ item, score }) => ({
    id: item.id,
    text: item.text,
    commentaryType: item.commentaryType,
    sourceType: 'comp_commentary',
    score,
    metadata: {
      commentaryType: item.commentaryType,
      subjectPropertyType: item.subjectPropertyType,
      compPropertyType: item.compPropertyType,
      marketDensity: item.marketDensity,
      urbanSuburbanRural: item.urbanSuburbanRural,
      qualityScore: item.qualityScore,
      pinned: item.pinned,
    },
  }));

  return {
    candidates,
    totalScanned: items.length,
    durationMs: Date.now() - t0,
  };
}

// ── Scoring Logic ───────────────────────────────────────────────────────────

/**
 * Score a single approved memory item against a retrieval query.
 * Returns a full breakdown for explainability.
 *
 * @param {Object} item — from getApprovedMemoryForRetrieval()
 * @param {Object} query — RetrievalQuery
 * @returns {import('./memoryTypes.js').RetrievalScoreBreakdown}
 */
function scoreItem(item, query) {
  const dimensionScores = {};
  const matchReasons = [];
  let total = 0;

  // ── Dimension matching ──────────────────────────────────────────────────

  // Canonical field ID — exact match
  if (query.canonicalFieldId && item.canonicalFieldId) {
    if (item.canonicalFieldId === query.canonicalFieldId) {
      dimensionScores.canonicalFieldId = DIMENSION_WEIGHTS.canonicalFieldId;
      matchReasons.push(`exact field match: ${query.canonicalFieldId}`);
    } else {
      dimensionScores.canonicalFieldId = 0;
    }
  }

  // Section group — partial match when field doesn't match exactly
  if (query.canonicalFieldId && item.sectionGroup && !dimensionScores.canonicalFieldId) {
    // Infer section group from canonical field ID
    const queryGroup = inferSectionGroup(query.canonicalFieldId);
    if (queryGroup && item.sectionGroup === queryGroup) {
      dimensionScores.sectionGroup = DIMENSION_WEIGHTS.sectionGroup;
      matchReasons.push(`section group match: ${queryGroup}`);
    }
  }

  // Report family
  if (query.reportFamily && item.reportFamily) {
    if (item.reportFamily === query.reportFamily) {
      dimensionScores.reportFamily = DIMENSION_WEIGHTS.reportFamily;
      matchReasons.push(`report family match: ${query.reportFamily}`);
    }
  }

  // Form type
  if (query.formType && item.formType) {
    if (item.formType === query.formType) {
      dimensionScores.formType = DIMENSION_WEIGHTS.formType;
      matchReasons.push(`form type match: ${query.formType}`);
    }
  }

  // Property type
  if (query.propertyType && item.propertyType) {
    if (item.propertyType === query.propertyType) {
      dimensionScores.propertyType = DIMENSION_WEIGHTS.propertyType;
      matchReasons.push(`property type match: ${query.propertyType}`);
    }
  }

  // Assignment type
  if (query.assignmentType && item.assignmentType) {
    if (item.assignmentType === query.assignmentType) {
      dimensionScores.assignmentType = DIMENSION_WEIGHTS.assignmentType;
      matchReasons.push(`assignment type match: ${query.assignmentType}`);
    }
  }

  // Loan program
  if (query.loanProgram && item.loanProgram) {
    if (item.loanProgram === query.loanProgram) {
      dimensionScores.loanProgram = DIMENSION_WEIGHTS.loanProgram;
      matchReasons.push(`loan program match: ${query.loanProgram}`);
    }
  }

  // Market type
  if (query.marketType && item.marketType) {
    if (item.marketType === query.marketType) {
      dimensionScores.marketType = DIMENSION_WEIGHTS.marketType;
      matchReasons.push(`market type match: ${query.marketType}`);
    }
  }

  // County
  if (query.county && item.county) {
    if (item.county.toLowerCase() === query.county.toLowerCase()) {
      dimensionScores.county = DIMENSION_WEIGHTS.county;
      matchReasons.push(`county match: ${query.county}`);
    }
  }

  // City
  if (query.city && item.city) {
    if (item.city.toLowerCase() === query.city.toLowerCase()) {
      dimensionScores.city = DIMENSION_WEIGHTS.city;
      matchReasons.push(`city match: ${query.city}`);
    }
  }

  // State
  if (query.state && item.state) {
    if (item.state.toLowerCase() === query.state.toLowerCase()) {
      dimensionScores.state = DIMENSION_WEIGHTS.state;
      matchReasons.push(`state match: ${query.state}`);
    }
  }

  // Subject condition
  if (query.subjectCondition && item.subjectCondition) {
    if (item.subjectCondition === query.subjectCondition) {
      dimensionScores.subjectCondition = DIMENSION_WEIGHTS.subjectCondition;
      matchReasons.push(`condition match: ${query.subjectCondition}`);
    }
  }

  // Sum dimension scores
  total = Object.values(dimensionScores).reduce((sum, v) => sum + (v || 0), 0);

  // ── Source trust bonus ──────────────────────────────────────────────────
  const sourceTrustBonus = SOURCE_TRUST_BONUS[item.sourceType] || 0;
  if (sourceTrustBonus > 0) {
    matchReasons.push(`source trust: ${item.sourceType} (+${sourceTrustBonus})`);
  }
  total += sourceTrustBonus;

  // ── Quality bonus ──────────────────────────────────────────────────────
  const qualityBonus = Math.round((item.qualityScore || 0) * QUALITY_WEIGHT);
  if (qualityBonus > 0) {
    matchReasons.push(`quality: ${item.qualityScore} (+${qualityBonus})`);
  }
  total += qualityBonus;

  // ── Recency bonus ──────────────────────────────────────────────────────
  const recencyBonus = computeRecencyBonus(item.createdAt);
  if (recencyBonus > 0) {
    matchReasons.push(`recency (+${recencyBonus})`);
  }
  total += recencyBonus;

  // ── Pinned bonus ───────────────────────────────────────────────────────
  const pinnedBonus = item.pinned ? PINNED_BONUS : 0;
  if (pinnedBonus > 0) {
    matchReasons.push(`pinned (+${PINNED_BONUS})`);
  }
  total += pinnedBonus;

  // ── Tag overlap ────────────────────────────────────────────────────────
  const tagOverlapScore = computeTagOverlap(
    item.issueTags || [],
    item.styleTags || [],
    query.issueTags || [],
    query.styleTags || [],
  );
  if (tagOverlapScore > 0) {
    matchReasons.push(`tag overlap (+${tagOverlapScore})`);
  }
  total += tagOverlapScore;

  // ── Learning boost (Phase 11) ────────────────────────────────────────
  const learningBoost = computeLearningBoost(item, query);
  if (learningBoost.score !== 0) {
    matchReasons.push(...learningBoost.reasons);
  }
  total += learningBoost.score;

  return {
    totalScore: total,
    dimensionScores,
    sourceTrustBonus,
    qualityBonus,
    recencyBonus,
    pinnedBonus,
    tagOverlapScore,
    learningBoost: learningBoost.score,
    learningBoostReasons: learningBoost.reasons,
    textSimilarityScore: 0, // reserved for future text similarity
    matchReasons,
  };
}

/**
 * Score a comp commentary item against a query.
 */
function scoreCompCommentary(item, query) {
  const dimensionScores = {};
  const matchReasons = [];
  let total = 0;

  // Commentary type relevance
  if (query.commentaryType && item.commentaryType === query.commentaryType) {
    dimensionScores.commentaryType = 25;
    matchReasons.push(`commentary type match: ${query.commentaryType}`);
  }

  // Canonical field
  if (query.canonicalFieldId && item.canonicalFieldId === query.canonicalFieldId) {
    dimensionScores.canonicalFieldId = 20;
    matchReasons.push(`field match: ${query.canonicalFieldId}`);
  }

  // Report family
  if (query.reportFamily && item.reportFamily === query.reportFamily) {
    dimensionScores.reportFamily = 15;
    matchReasons.push(`report family match`);
  }

  // Property type match
  if (query.propertyType && item.subjectPropertyType === query.propertyType) {
    dimensionScores.propertyType = 10;
    matchReasons.push(`property type match`);
  }

  // Market density
  if (query.marketDensity && item.marketDensity === query.marketDensity) {
    dimensionScores.marketDensity = 8;
    matchReasons.push(`market density match`);
  }

  // Urban/suburban/rural
  if (query.marketType && item.urbanSuburbanRural === query.marketType) {
    dimensionScores.urbanSuburbanRural = 8;
    matchReasons.push(`urban/suburban/rural match`);
  }

  total = Object.values(dimensionScores).reduce((sum, v) => sum + (v || 0), 0);

  // Quality bonus
  const qualityBonus = Math.round((item.qualityScore || 0) * QUALITY_WEIGHT);
  total += qualityBonus;

  // Pinned bonus
  const pinnedBonus = item.pinned ? PINNED_BONUS : 0;
  total += pinnedBonus;

  // Tag overlap
  const tagOverlapScore = computeTagOverlap(
    item.issueTags || [], [], query.issueTags || [], []
  );
  total += tagOverlapScore;

  // Adjustment category overlap
  if (query.adjustmentCategories && item.adjustmentCategories) {
    const overlap = item.adjustmentCategories.filter(
      c => query.adjustmentCategories.includes(c)
    ).length;
    const adjScore = overlap * 5;
    if (adjScore > 0) {
      dimensionScores.adjustmentCategories = adjScore;
      matchReasons.push(`adjustment category overlap: ${overlap}`);
      total += adjScore;
    }
  }

  return {
    totalScore: total,
    dimensionScores,
    sourceTrustBonus: 0,
    qualityBonus,
    recencyBonus: 0,
    pinnedBonus,
    tagOverlapScore,
    textSimilarityScore: 0,
    matchReasons,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Compute recency bonus using exponential decay.
 * Items created within the last RECENCY_HALF_LIFE_DAYS get up to RECENCY_WEIGHT bonus.
 */
function computeRecencyBonus(createdAt) {
  if (!createdAt) return 0;
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays < 0) return RECENCY_WEIGHT;
  const decay = Math.exp(-0.693 * ageDays / RECENCY_HALF_LIFE_DAYS); // ln(2) ≈ 0.693
  return Math.round(RECENCY_WEIGHT * decay);
}

/**
 * Compute tag overlap score.
 * Each matching tag contributes TAG_OVERLAP_WEIGHT points.
 */
function computeTagOverlap(itemIssueTags, itemStyleTags, queryIssueTags, queryStyleTags) {
  let overlap = 0;

  if (queryIssueTags.length > 0 && itemIssueTags.length > 0) {
    const querySet = new Set(queryIssueTags.map(t => t.toLowerCase()));
    overlap += itemIssueTags.filter(t => querySet.has(t.toLowerCase())).length;
  }

  if (queryStyleTags.length > 0 && itemStyleTags.length > 0) {
    const querySet = new Set(queryStyleTags.map(t => t.toLowerCase()));
    overlap += itemStyleTags.filter(t => querySet.has(t.toLowerCase())).length;
  }

  return overlap * TAG_OVERLAP_WEIGHT;
}

/**
 * Infer section group from a canonical field ID.
 * Used for partial matching when exact field doesn't match.
 */
function inferSectionGroup(canonicalFieldId) {
  const groupMap = {
    neighborhood_description: 'neighborhood',
    market_conditions: 'neighborhood',
    site_description: 'site',
    zoning_description: 'site',
    improvements_description: 'improvements',
    condition_description: 'improvements',
    highest_best_use: 'analysis',
    sales_comparison_summary: 'analysis',
    reconciliation: 'analysis',
    conclusion_remarks: 'analysis',
    cost_approach: 'approaches',
    income_approach: 'approaches',
    certification: 'certification',
    addendum: 'addendum',
  };
  return groupMap[canonicalFieldId] || null;
}

// ── Learning Boost (Phase 11) ────────────────────────────────────────────────

const LEARNING_BOOST_MAX = 20;

/**
 * Compute learning boost for a memory item based on prior appraiser patterns.
 * If the appraiser previously accepted similar items, boost the score.
 * If the appraiser previously rejected similar items, lower the score.
 * All boosts are transparent and explainable.
 *
 * @param {Object} item — memory item being scored
 * @param {Object} query — retrieval query
 * @returns {{ score: number, reasons: string[] }}
 */
function computeLearningBoost(item, query) {
  try {
    const boost = getLearningBoostForItem(item, query);
    return boost || { score: 0, reasons: [] };
  } catch {
    // Learning system is optional — if it fails, return zero boost
    return { score: 0, reasons: [] };
  }
}

// ── Exports ─────────────────────────────────────────────────────────────────

export {
  DIMENSION_WEIGHTS,
  SOURCE_TRUST_BONUS,
  LEARNING_BOOST_MAX,
  scoreItem as _scoreItem,           // exported for testing
  scoreCompCommentary as _scoreComp, // exported for testing
  computeLearningBoost as _computeLearningBoost, // exported for testing
};
