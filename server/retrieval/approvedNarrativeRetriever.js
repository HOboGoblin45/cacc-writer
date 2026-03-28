/**
 * approvedNarrativeRetriever.js
 * ------------------------------
 * Personal Appraiser Voice Engine — Retrieval Layer
 *
 * Retrieves the most relevant approved narrative examples from
 * knowledge_base/approvedNarratives/ using weighted multi-dimensional scoring.
 *
 * Scoring model:
 *   Each candidate entry is scored against the query dimensions using
 *   weights from server/config/retrievalWeights.js. The source type bonus
 *   ensures approvedNarrative entries always outrank lower-trust sources
 *   when metadata match is equal.
 *
 * Two-phase retrieval:
 *   Phase 1 — Score all index entries (metadata only, no file I/O)
 *   Phase 2 — Load text for top-N candidates (targeted file reads)
 *
 * This design keeps retrieval fast even as the index grows to thousands
 * of entries, because text is only loaded for the final top-N results.
 *
 * Active production scope: 1004 (ACI) + commercial (Real Quantum)
 */

import {
  getApprovedNarrativeIndex,
  getApprovedNarrativeById,
} from '../storage/saveApprovedNarrative.js';

import {
  DIMENSION_WEIGHTS,
  SOURCE_BONUSES,
  QUALITY_SCORE_DIVISOR,
  MAX_VOICE_EXAMPLES,
} from '../config/retrievalWeights.js';

// ── Scoring engine ────────────────────────────────────────────────────────────

/**
 * scoreEntry(entry, query)
 *
 * Computes a relevance score for a single index entry against the query.
 * Higher score = better match.
 *
 * @param {object} entry  Index entry (metadata only)
 * @param {object} query  Query dimensions
 * @returns {number}      Total score
 */
function scoreEntry(entry, query) {
  let score = 0;

  // ── Dimension match scores ────────────────────────────────────────────────
  // Each dimension awards its full weight on exact string match (case-insensitive).
  // No partial credit — exact match only for retrieval consistency.

  const dims = [
    ['sectionType',       'sectionType'],
    ['formType',          'formType'],
    ['propertyType',      'propertyType'],
    ['subjectCondition',  'subjectCondition'],
    ['county',            'county'],
    ['city',              'city'],
    ['marketType',        'marketType'],
    ['assignmentPurpose', 'assignmentPurpose'],
    ['loanProgram',       'loanProgram'],
  ];

  for (const [entryKey, queryKey] of dims) {
    const ev = String(entry[entryKey]  || '').trim().toLowerCase();
    const qv = String(query[queryKey]  || '').trim().toLowerCase();
    if (ev && qv && ev === qv) {
      score += DIMENSION_WEIGHTS[queryKey] || 0;
    }
  }

  // ── Source trust bonus ────────────────────────────────────────────────────
  const sourceBonus = SOURCE_BONUSES[entry.sourceType] ?? SOURCE_BONUSES.unknown;
  score += sourceBonus;

  // ── Quality score bonus ───────────────────────────────────────────────────
  const qs = typeof entry.qualityScore === 'number' ? entry.qualityScore : 50;
  score += qs / QUALITY_SCORE_DIVISOR;

  return score;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * getApprovedNarratives(query, limit)
 *
 * Returns the top-N approved narrative examples most relevant to the query.
 * Results include the full text (loaded from individual entry files).
 *
 * @param {object} query
 *   @param {string} [query.sectionType]       e.g. 'neighborhood_description'
 *   @param {string} [query.formType]          e.g. '1004', 'commercial'
 *   @param {string} [query.propertyType]      e.g. 'residential'
 *   @param {string} [query.subjectCondition]  e.g. 'C3'
 *   @param {string} [query.county]            e.g. 'McLean'
 *   @param {string} [query.city]              e.g. 'Bloomington'
 *   @param {string} [query.marketType]        e.g. 'suburban'
 *   @param {string} [query.assignmentPurpose] e.g. 'Purchase'
 *   @param {string} [query.loanProgram]       e.g. 'Conventional'
 *
 * @param {number} [limit]  Max results to return (default: MAX_VOICE_EXAMPLES)
 *
 * @returns {object[]} Top-N entries with full text, sorted by score descending.
 *                     Each entry includes a _score field for debugging.
 */
export function getApprovedNarratives(query = {}, limit = MAX_VOICE_EXAMPLES) {
  const indexEntries = getApprovedNarrativeIndex();
  if (!indexEntries.length) return [];

  // Phase 1: Score all index entries (no file I/O — metadata only)
  const scored = indexEntries
    .filter(e => e.hasText && e.sectionType) // skip corrupt/incomplete entries
    .map(e => ({ entry: e, score: scoreEntry(e, query) }))
    .filter(({ score }) => score > 0)        // skip zero-score entries
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (!scored.length) return [];

  // Phase 2: Load text for top-N candidates (targeted file reads)
  const results = [];
  for (const { entry, score } of scored) {
    const full = getApprovedNarrativeById(entry.id);
    if (!full?.text) continue;
    results.push({
      ...full,
      _score:     score,
      sourceType: 'approvedNarrative', // ensure consistent source label
    });
  }

  return results;
}

/**
 * scoreApprovedNarratives(query, limit)
 *
 * Returns scored index entries WITHOUT loading text.
 * Used for debugging, analytics, and batch queue workflows
 * where you want to inspect scores before committing to file reads.
 *
 * @param {object} query  Same as getApprovedNarratives()
 * @param {number} [limit]
 * @returns {Array<{entry, score}>}
 */
export function scoreApprovedNarratives(query = {}, limit = MAX_VOICE_EXAMPLES) {
  const indexEntries = getApprovedNarrativeIndex();
  return indexEntries
    .filter(e => e.hasText && e.sectionType)
    .map(e => ({ entry: e, score: scoreEntry(e, query) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
