/**
 * retrievalWeights.js
 * -------------------
 * Centralized retrieval scoring weights for the Personal Appraiser Voice Engine.
 *
 * These weights control how strongly each metadata dimension influences
 * which approved narrative examples are retrieved for a given generation request.
 *
 * TUNING GUIDE:
 *   - Increase a weight to make that dimension more decisive in retrieval.
 *   - Decrease a weight to make retrieval more permissive across that dimension.
 *   - Source bonuses are additive — they reward higher-trust sources regardless of metadata match.
 *   - Total possible score = sum of all dimension weights + source bonus + qualityScore bonus.
 *
 * PRIORITY ORDER (by design):
 *   1. approvedNarratives  — appraiser's own completed reports (highest trust)
 *   2. approved_edits      — appraiser-approved edits from the feedback loop
 *   3. curated_examples    — hand-curated examples per form type
 *   4. imported_examples   — extracted from past PDFs (moderate trust)
 *   5. phrase_bank         — reusable clauses (injected separately, not ranked here)
 *
 * Active production scope: 1004 (ACI) + commercial (Real Quantum)
 */

// ── Dimension match weights ───────────────────────────────────────────────────
// Each weight is awarded when the candidate entry's field exactly matches
// the query's field. Partial/fuzzy matching is not used — exact match only.

export const DIMENSION_WEIGHTS = {
  // Most critical: same section type = same writing purpose
  sectionType:       30,

  // Form type: 1004 vs commercial narrative structure differs significantly
  formType:          20,

  // Property type: residential vs commercial vs condo affects tone
  propertyType:      15,

  // UAD condition rating (C1–C6): affects condition language throughout
  subjectCondition:  10,

  // Geographic match: county-level is most useful for market context
  county:             8,

  // City-level match: useful for neighborhood/market area sections
  city:               5,

  // Market type: suburban/urban/rural affects neighborhood framing
  marketType:         5,

  // Assignment purpose: Purchase vs Refinance affects contract/concession language
  assignmentPurpose:  3,

  // Loan program: FHA/VA/USDA/Conventional affects compliance language
  loanProgram:        2,
};

// ── Source trust bonuses ──────────────────────────────────────────────────────
// Added to the total score based on the source type of the candidate entry.
// These bonuses ensure higher-trust sources rank above lower-trust sources
// even when metadata match scores are equal.

export const SOURCE_BONUSES = {
  // Appraiser's own completed, approved reports — highest trust
  approvedNarrative:  25,

  // Appraiser-approved edits from the feedback loop
  approved_edit:      15,

  // Hand-curated examples per form type
  curated:            10,

  // Extracted from past PDFs — moderate trust
  imported:            5,

  // Default for unknown source types
  unknown:             0,
};

// ── Quality score bonus ───────────────────────────────────────────────────────
// qualityScore is stored 0–100. Divide by 10 to add up to 10 bonus points.
// This rewards higher-quality entries within the same source tier.

export const QUALITY_SCORE_DIVISOR = 10; // qualityScore / 10 = bonus points (max 10)

// ── Retrieval limits ──────────────────────────────────────────────────────────

export const MIN_VOICE_EXAMPLES  = 1;  // Minimum voice examples before falling back
export const MAX_VOICE_EXAMPLES  = 3;  // Max voice examples injected into prompt
export const MAX_OTHER_EXAMPLES  = 3;  // Max non-voice examples injected into prompt
export const MAX_TOTAL_EXAMPLES  = 5;  // Hard cap on total examples in prompt

// ── Computed total max score (for reference / debugging) ─────────────────────
// Max possible score = sum of all dimension weights + max source bonus + max quality bonus
export const MAX_POSSIBLE_SCORE = (
  Object.values(DIMENSION_WEIGHTS).reduce((a, b) => a + b, 0) +
  Math.max(...Object.values(SOURCE_BONUSES)) +
  QUALITY_SCORE_DIVISOR  // max quality bonus = 100/10 = 10
);
