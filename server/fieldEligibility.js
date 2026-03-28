/**
 * server/fieldEligibility.js
 * --------------------------
 * NEW — Field-level AI eligibility classification.
 *
 * Classifies each narrative field as one of:
 *   ai_draft      — AI writes the full narrative (most fields)
 *   fact_autofill — value is derived directly from facts, no AI needed
 *   manual_review — AI drafts but human must review before use (high-stakes)
 *   read_only     — extracted from documents, not AI-generated
 *
 * This enables the UI and workflow to know which fields should be
 * AI-generated vs. data-filled vs. manually written.
 */

// ── Eligibility constants ─────────────────────────────────────────────────────

export const AI_ELIGIBILITY = {
  AI_DRAFT:      'ai_draft',
  FACT_AUTOFILL: 'fact_autofill',
  MANUAL_REVIEW: 'manual_review',
  READ_ONLY:     'read_only',
};

export const AI_ELIGIBILITY_LABELS = {
  ai_draft:      'AI Draft',
  fact_autofill: 'Auto-fill',
  manual_review: 'AI + Review',
  read_only:     'Read Only',
};

// ── 1004 URAR field eligibility ───────────────────────────────────────────────

export const FIELD_ELIGIBILITY_1004 = {
  offering_history:       'ai_draft',
  contract_analysis:      'ai_draft',
  concessions:            'ai_draft',
  neighborhood_boundaries:'ai_draft',
  neighborhood_description:'ai_draft',
  market_conditions:      'ai_draft',
  site_comments:          'ai_draft',
  improvements_condition: 'ai_draft',
  sca_summary:            'ai_draft',
  reconciliation:         'manual_review',  // high-stakes — always human-reviewed
  exposure_time:          'ai_draft',
};

// ── 1025 Small Residential Income field eligibility ───────────────────────────

export const FIELD_ELIGIBILITY_1025 = {
  neighborhood_description: 'ai_draft',
  site_comments:            'ai_draft',
  improvements_condition:   'ai_draft',
  sales_comparison_commentary: 'ai_draft',
  reconciliation:           'manual_review',
  income_approach:          'ai_draft',
};

// ── 1073 Individual Condo field eligibility ───────────────────────────────────

export const FIELD_ELIGIBILITY_1073 = {
  neighborhood_description: 'ai_draft',
  project_information:      'ai_draft',
  site_comments:            'ai_draft',
  improvements_condition:   'ai_draft',
  sales_comparison_commentary: 'ai_draft',
  reconciliation:           'manual_review',
};

// ── 1004C Manufactured Home field eligibility ─────────────────────────────────

export const FIELD_ELIGIBILITY_1004C = {
  neighborhood_description: 'ai_draft',
  site_comments:            'ai_draft',
  improvements_condition:   'ai_draft',
  sales_comparison_commentary: 'ai_draft',
  reconciliation:           'manual_review',
};

// ── Commercial field eligibility ──────────────────────────────────────────────

export const FIELD_ELIGIBILITY_COMMERCIAL = {
  site_description:         'ai_draft',
  improvements_description: 'ai_draft',
  market_area:              'ai_draft',
  sales_comparison:         'ai_draft',
  reconciliation:           'manual_review',
  income_approach:          'ai_draft',
  highest_best_use:         'ai_draft',
};

// ── Shared fallback map ───────────────────────────────────────────────────────

const ELIGIBILITY_BY_FORM = {
  '1004':       FIELD_ELIGIBILITY_1004,
  '1025':       FIELD_ELIGIBILITY_1025,
  '1073':       FIELD_ELIGIBILITY_1073,
  '1004c':      FIELD_ELIGIBILITY_1004C,
  'commercial': FIELD_ELIGIBILITY_COMMERCIAL,
};

// ── getFieldEligibility ───────────────────────────────────────────────────────
/**
 * Returns the AI eligibility classification for a given form + field.
 * Defaults to 'ai_draft' if not explicitly classified.
 *
 * @param {string} formType — '1004' | '1025' | '1073' | '1004c' | 'commercial'
 * @param {string} fieldId  — field identifier
 * @returns {string} eligibility value
 */
export function getFieldEligibility(formType, fieldId) {
  const map = ELIGIBILITY_BY_FORM[formType] || {};
  return map[fieldId] || 'ai_draft';
}

// ── isAIDraftEligible ─────────────────────────────────────────────────────────
/**
 * Returns true if the field should be AI-drafted (ai_draft or manual_review).
 * Returns false for fact_autofill and read_only fields.
 */
export function isAIDraftEligible(formType, fieldId) {
  const e = getFieldEligibility(formType, fieldId);
  return e === 'ai_draft' || e === 'manual_review';
}
