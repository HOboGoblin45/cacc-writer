/**
 * server/intelligence/reportFamilyManifest.js
 * ----------------------------------------------
 * Phase 4 — Report Family Manifest System
 *
 * Structured manifest definitions for each supported report family.
 * Each manifest describes the report structure, required/conditional sections,
 * section groups, dependency hints, and applicable property/assignment types.
 *
 * This is report structure metadata only — not insertion automation.
 *
 * Supported report families:
 *   - urar_1004         — URAR Single-Family Residential
 *   - urar_1025         — Small Residential Income (2-4 units)
 *   - urar_1073         — Individual Condominium Unit
 *   - urar_1004c        — Manufactured Home
 *   - commercial_narrative — Narrative Commercial Report
 *
 * Usage:
 *   import { getReportManifest, resolveReportFamily } from './intelligence/reportFamilyManifest.js';
 *   const manifest = getReportManifest('urar_1004');
 */

// ── Report family manifests ─────────────────────────────────────────────────

const MANIFESTS = {

  // ── URAR 1004 — Single-Family Residential ───────────────────────────────
  urar_1004: {
    id:          'urar_1004',
    formType:    '1004',
    displayName: 'URAR 1004 — Single-Family Residential',

    sectionGroups: [
      { id: 'contract',         label: 'Contract / Offering History',   order: 1 },
      { id: 'neighborhood',     label: 'Neighborhood',                  order: 2 },
      { id: 'site',             label: 'Site',                          order: 3 },
      { id: 'improvements',     label: 'Improvements',                  order: 4 },
      { id: 'sales_comparison', label: 'Sales Comparison Approach',     order: 5 },
      { id: 'cost_approach',    label: 'Cost Approach',                 order: 6 },
      { id: 'income_approach',  label: 'Income Approach',               order: 7 },
      { id: 'reconciliation',   label: 'Reconciliation',                order: 8 },
    ],

    canonicalFieldGroups: {
      contract:         ['offering_history', 'contract_analysis', 'concessions'],
      neighborhood:     ['neighborhood_boundaries', 'neighborhood_description', 'market_conditions'],
      site:             ['site_comments'],
      improvements:     ['improvements_condition'],
      sales_comparison: ['sca_summary', 'sales_comparison_commentary'],
      cost_approach:    ['cost_approach'],
      income_approach:  ['income_approach'],
      reconciliation:   ['reconciliation', 'exposure_time'],
    },

    requiredSections: [
      'neighborhood_description', 'market_conditions', 'site_comments',
      'improvements_condition', 'sca_summary', 'reconciliation',
    ],

    conditionalSections: [
      { sectionId: 'cost_approach',    condition: 'cost_approach_likely',    label: 'Cost Approach' },
      { sectionId: 'income_approach',  condition: 'income_approach_likely',  label: 'Income Approach' },
      { sectionId: 'offering_history', condition: 'always',                  label: 'Offering History' },
      { sectionId: 'contract_analysis', condition: 'always',                 label: 'Contract Analysis' },
      { sectionId: 'concessions',      condition: 'always',                  label: 'Concessions' },
      { sectionId: 'exposure_time',    condition: 'always',                  label: 'Exposure Time' },
    ],

    dependencyHints: {
      reconciliation: ['neighborhood_description', 'market_conditions', 'improvements_condition', 'sca_summary'],
    },

    applicablePropertyTypes: ['single_family', 'townhouse', 'pud'],
    applicableAssignmentTypes: ['purchase', 'refinance', 'equity', 'relocation', 'estate', 'divorce', 'pmi_removal'],

    optionalCommentaryBlocks: [
      { id: 'flood_comment',           triggerFlag: 'flood_commentary_required' },
      { id: 'zoning_comment',          triggerFlag: 'zoning_commentary_required' },
      { id: 'adu_comment',             triggerFlag: 'adu_present' },
      { id: 'mixed_use_comment',       triggerFlag: 'mixed_use' },
      { id: 'subject_to_repairs_comment', triggerFlag: 'subject_to_repairs' },
      { id: 'subject_to_completion_comment', triggerFlag: 'subject_to_completion' },
      { id: 'fha_repair_comment',      triggerFlag: 'fha_repair_required' },
      { id: 'declining_market_comment', triggerFlag: 'declining_market' },
      { id: 'ea_comment',              triggerFlag: 'extraordinary_assumption_present' },
      { id: 'hc_comment',              triggerFlag: 'hypothetical_condition_present' },
    ],

    destinationHints: {
      primary:   'aci',
      secondary: null,
    },
  },

  // ── URAR 1025 — Small Residential Income (2-4 Units) ───────────────────
  urar_1025: {
    id:          'urar_1025',
    formType:    '1025',
    displayName: 'URAR 1025 — Small Residential Income (2-4 Units)',

    sectionGroups: [
      { id: 'contract',         label: 'Contract / Offering History',   order: 1 },
      { id: 'neighborhood',     label: 'Neighborhood',                  order: 2 },
      { id: 'site',             label: 'Site',                          order: 3 },
      { id: 'improvements',     label: 'Improvements',                  order: 4 },
      { id: 'sales_comparison', label: 'Sales Comparison Approach',     order: 5 },
      { id: 'income_approach',  label: 'Income Approach',               order: 6 },
      { id: 'cost_approach',    label: 'Cost Approach',                 order: 7 },
      { id: 'reconciliation',   label: 'Reconciliation',                order: 8 },
    ],

    canonicalFieldGroups: {
      contract:         ['offering_history', 'contract_analysis', 'concessions'],
      neighborhood:     ['neighborhood_boundaries', 'neighborhood_description', 'market_conditions'],
      site:             ['site_comments'],
      improvements:     ['improvements_condition'],
      sales_comparison: ['sca_summary', 'sales_comparison_commentary'],
      income_approach:  ['income_approach', 'rental_analysis'],
      cost_approach:    ['cost_approach'],
      reconciliation:   ['reconciliation', 'exposure_time'],
    },

    requiredSections: [
      'neighborhood_description', 'market_conditions', 'site_comments',
      'improvements_condition', 'sca_summary', 'income_approach', 'reconciliation',
    ],

    conditionalSections: [
      { sectionId: 'cost_approach',    condition: 'cost_approach_likely', label: 'Cost Approach' },
      { sectionId: 'rental_analysis',  condition: 'always',              label: 'Rental Analysis' },
    ],

    dependencyHints: {
      reconciliation: ['neighborhood_description', 'market_conditions', 'improvements_condition', 'sca_summary', 'income_approach'],
    },

    applicablePropertyTypes: ['multi_unit_2', 'multi_unit_3', 'multi_unit_4'],
    applicableAssignmentTypes: ['purchase', 'refinance', 'equity', 'relocation', 'estate', 'divorce'],

    optionalCommentaryBlocks: [
      { id: 'flood_comment',           triggerFlag: 'flood_commentary_required' },
      { id: 'zoning_comment',          triggerFlag: 'zoning_commentary_required' },
      { id: 'subject_to_repairs_comment', triggerFlag: 'subject_to_repairs' },
      { id: 'fha_repair_comment',      triggerFlag: 'fha_repair_required' },
      { id: 'declining_market_comment', triggerFlag: 'declining_market' },
    ],

    destinationHints: { primary: 'aci', secondary: null },
  },

  // ── URAR 1073 — Individual Condominium Unit ────────────────────────────
  urar_1073: {
    id:          'urar_1073',
    formType:    '1073',
    displayName: 'URAR 1073 — Individual Condominium Unit',

    sectionGroups: [
      { id: 'contract',         label: 'Contract / Offering History',   order: 1 },
      { id: 'neighborhood',     label: 'Neighborhood',                  order: 2 },
      { id: 'site',             label: 'Site',                          order: 3 },
      { id: 'improvements',     label: 'Improvements',                  order: 4 },
      { id: 'condo_project',    label: 'Condo Project',                 order: 5 },
      { id: 'sales_comparison', label: 'Sales Comparison Approach',     order: 6 },
      { id: 'reconciliation',   label: 'Reconciliation',                order: 7 },
    ],

    canonicalFieldGroups: {
      contract:         ['offering_history', 'contract_analysis', 'concessions'],
      neighborhood:     ['neighborhood_boundaries', 'neighborhood_description', 'market_conditions'],
      site:             ['site_comments'],
      improvements:     ['improvements_condition'],
      condo_project:    ['condo_project_analysis'],
      sales_comparison: ['sca_summary', 'sales_comparison_commentary'],
      reconciliation:   ['reconciliation', 'exposure_time'],
    },

    requiredSections: [
      'neighborhood_description', 'market_conditions', 'site_comments',
      'improvements_condition', 'condo_project_analysis', 'sca_summary', 'reconciliation',
    ],

    conditionalSections: [],

    dependencyHints: {
      reconciliation: ['neighborhood_description', 'market_conditions', 'improvements_condition', 'condo_project_analysis', 'sca_summary'],
    },

    applicablePropertyTypes: ['condo'],
    applicableAssignmentTypes: ['purchase', 'refinance', 'equity', 'relocation', 'estate', 'divorce', 'pmi_removal'],

    optionalCommentaryBlocks: [
      { id: 'flood_comment',           triggerFlag: 'flood_commentary_required' },
      { id: 'declining_market_comment', triggerFlag: 'declining_market' },
      { id: 'fha_repair_comment',      triggerFlag: 'fha_repair_required' },
    ],

    destinationHints: { primary: 'aci', secondary: null },
  },

  // ── URAR 1004c — Manufactured Home ─────────────────────────────────────
  urar_1004c: {
    id:          'urar_1004c',
    formType:    '1004c',
    displayName: 'URAR 1004c — Manufactured Home',

    sectionGroups: [
      { id: 'contract',           label: 'Contract / Offering History',   order: 1 },
      { id: 'neighborhood',       label: 'Neighborhood',                  order: 2 },
      { id: 'site',               label: 'Site',                          order: 3 },
      { id: 'improvements',       label: 'Improvements',                  order: 4 },
      { id: 'manufactured_home',  label: 'Manufactured Home',             order: 5 },
      { id: 'sales_comparison',   label: 'Sales Comparison Approach',     order: 6 },
      { id: 'reconciliation',     label: 'Reconciliation',                order: 7 },
    ],

    canonicalFieldGroups: {
      contract:          ['offering_history', 'contract_analysis', 'concessions'],
      neighborhood:      ['neighborhood_boundaries', 'neighborhood_description', 'market_conditions'],
      site:              ['site_comments'],
      improvements:      ['improvements_condition'],
      manufactured_home: ['manufactured_home_comments'],
      sales_comparison:  ['sca_summary', 'sales_comparison_commentary'],
      reconciliation:    ['reconciliation', 'exposure_time'],
    },

    requiredSections: [
      'neighborhood_description', 'market_conditions', 'site_comments',
      'improvements_condition', 'manufactured_home_comments', 'sca_summary', 'reconciliation',
    ],

    conditionalSections: [
      { sectionId: 'cost_approach', condition: 'cost_approach_likely', label: 'Cost Approach' },
    ],

    dependencyHints: {
      reconciliation: ['neighborhood_description', 'market_conditions', 'improvements_condition', 'manufactured_home_comments', 'sca_summary'],
    },

    applicablePropertyTypes: ['manufactured_home', 'modular_home'],
    applicableAssignmentTypes: ['purchase', 'refinance', 'equity', 'estate'],

    optionalCommentaryBlocks: [
      { id: 'flood_comment',           triggerFlag: 'flood_commentary_required' },
      { id: 'zoning_comment',          triggerFlag: 'zoning_commentary_required' },
      { id: 'fha_repair_comment',      triggerFlag: 'fha_repair_required' },
    ],

    destinationHints: { primary: 'aci', secondary: null },
  },

  // ── Commercial Narrative ──────────────────────────────────────────────────
  commercial_narrative: {
    id:          'commercial_narrative',
    formType:    'commercial',
    displayName: 'Narrative Commercial Appraisal Report',

    sectionGroups: [
      { id: 'introduction',       label: 'Introduction',                 order: 1 },
      { id: 'market_data',        label: 'Market Data',                  order: 2 },
      { id: 'property_data',      label: 'Property Data',               order: 3 },
      { id: 'highest_best_use',   label: 'Highest and Best Use',        order: 4 },
      { id: 'cost_approach',      label: 'Cost Approach',               order: 5 },
      { id: 'sales_comparison',   label: 'Sales Comparison Approach',   order: 6 },
      { id: 'market_rent',        label: 'Market Rent Analysis',        order: 7 },
      { id: 'income_approach',    label: 'Income Approach',             order: 8 },
      { id: 'reconciliation',     label: 'Reconciliation',              order: 9 },
    ],

    canonicalFieldGroups: {
      introduction:     ['introduction', 'general_assumptions'],
      market_data:      ['market_area', 'regional_overview', 'local_market_analysis', 'industry_overview', 'neighborhood_description', 'demographics', 'demographics_conclusions'],
      property_data:    ['zoning_remarks', 'site_description', 'improvement_description', 'real_estate_taxes_remarks', 'real_estate_taxes_comparables'],
      highest_best_use: ['hbu_analysis', 'hbu_as_improved'],
      cost_approach:    ['cost_approach', 'depreciation_remarks', 'cost_approach_reconciliation', 'cost_approach_final_conclusion', 'insurable_replacement_cost'],
      sales_comparison: ['sales_comparison', 'sale_comparable_detail'],
      market_rent:      ['market_rent_analysis', 'rent_roll_remarks', 'rent_reconciliation', 'lease_gain_loss', 'other_revenue', 'commercial_market_summary', 'commercial_market_summary_standalone', 'vacancy_credit_loss'],
      income_approach:  ['expense_remarks', 'investment_classifications', 'investor_survey_remarks', 'income_approach', 'investment_considerations', 'property_class_investment_overview', 'market_participants', 'direct_capitalization_conclusion', 'dcf_assumptions', 'dcf_analysis', 'dcf_conclusions', 'dcf_reconciliation', 'income_approach_reconciliation', 'income_approach_conclusion'],
      reconciliation:   ['reconciliation'],
    },

    requiredSections: [
      'introduction', 'market_area', 'neighborhood_description',
      'site_description', 'improvement_description',
      'hbu_analysis', 'hbu_as_improved',
      'sales_comparison', 'income_approach', 'reconciliation',
    ],

    conditionalSections: [
      { sectionId: 'cost_approach',              condition: 'cost_approach_likely',  label: 'Cost Approach' },
      { sectionId: 'market_rent_analysis',       condition: 'income_approach_likely', label: 'Market Rent Analysis' },
      { sectionId: 'rent_roll_remarks',          condition: 'income_approach_likely', label: 'Rent Roll' },
      { sectionId: 'expense_remarks',            condition: 'income_approach_likely', label: 'Expense Analysis' },
      { sectionId: 'direct_capitalization_conclusion', condition: 'income_approach_likely', label: 'Cap Rate Conclusion' },
    ],

    dependencyHints: {
      reconciliation: ['market_area', 'improvement_description', 'hbu_analysis', 'sales_comparison', 'income_approach'],
      hbu_as_improved: ['hbu_analysis'],
    },

    applicablePropertyTypes: ['commercial', 'industrial', 'mixed_use', 'special_purpose'],
    applicableAssignmentTypes: ['purchase', 'refinance', 'equity', 'estate', 'other'],

    optionalCommentaryBlocks: [
      { id: 'flood_comment',           triggerFlag: 'flood_commentary_required' },
      { id: 'zoning_comment',          triggerFlag: 'zoning_commentary_required' },
      { id: 'ea_comment',              triggerFlag: 'extraordinary_assumption_present' },
      { id: 'hc_comment',              triggerFlag: 'hypothetical_condition_present' },
      { id: 'declining_market_comment', triggerFlag: 'declining_market' },
    ],

    destinationHints: {
      primary:   'real_quantum',
      secondary: null,
    },
  },
};

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Get the full report family manifest by family id.
 *
 * @param {string} familyId — e.g. 'urar_1004', 'commercial_narrative'
 * @returns {object|null}
 */
export function getReportManifest(familyId) {
  return MANIFESTS[familyId] || null;
}

/**
 * Resolve the report family id from a form type and flags.
 *
 * @param {string} formType
 * @param {object} flags — DerivedAssignmentFlags
 * @returns {string} report family id
 */
export function resolveReportFamily(formType, flags) {
  const ft = (formType || '1004').toLowerCase();
  if (ft === 'commercial') return 'commercial_narrative';
  if (ft === '1073' || flags?.condo) return 'urar_1073';
  if (ft === '1025' || flags?.multi_unit) return 'urar_1025';
  if (ft === '1004c' || flags?.manufactured_home) return 'urar_1004c';
  return 'urar_1004';
}

/**
 * Get the manifest for a form type (convenience wrapper).
 *
 * @param {string} formType
 * @param {object} [flags]
 * @returns {object}
 */
export function getManifestForFormType(formType, flags) {
  const familyId = resolveReportFamily(formType, flags);
  return MANIFESTS[familyId] || MANIFESTS.urar_1004;
}

/**
 * List all available report family ids.
 *
 * @returns {string[]}
 */
export function listReportFamilies() {
  return Object.keys(MANIFESTS);
}

/**
 * Get a summary of all manifests (for diagnostics).
 *
 * @returns {object[]}
 */
export function getManifestSummaries() {
  return Object.values(MANIFESTS).map(m => ({
    id:               m.id,
    formType:         m.formType,
    displayName:      m.displayName,
    sectionGroupCount: m.sectionGroups.length,
    requiredSections: m.requiredSections.length,
    conditionalSections: m.conditionalSections.length,
    optionalCommentary: m.optionalCommentaryBlocks.length,
  }));
}
