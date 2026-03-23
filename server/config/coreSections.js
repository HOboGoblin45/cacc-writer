/**
 * server/config/coreSections.js
 * -----------------------------
 * Canonical core section definitions by form type.
 *
 * Form types:
 *   1004     — Legacy Uniform Residential Appraisal Report (UAD 2.6)
 *   commercial — Commercial/Income-Producing
 *   uad36    — Redesigned URAR (UAD 3.6), mandatory November 2, 2026
 */

export const CORE_SECTIONS = {
  '1004': [
    { id: 'neighborhood_description', title: 'Neighborhood Description' },
    { id: 'market_conditions', title: 'Market Conditions' },
    { id: 'site_description', title: 'Site Description' },
    { id: 'improvements_condition', title: 'Improvements / Condition' },
    { id: 'adverse_conditions', title: 'Adverse Conditions / External Factors' },
    { id: 'functional_utility', title: 'Functional Utility' },
    { id: 'functional_utility_conformity', title: 'Functional Utility / Conformity' },
    { id: 'highest_best_use', title: 'Highest & Best Use' },
    { id: 'sca_summary', title: 'Sales Comparison Summary' },
    { id: 'sales_comparison_commentary', title: 'Sales Comparison Commentary' },
    { id: 'reconciliation', title: 'Reconciliation' },
    { id: 'scope_of_work', title: 'Scope of Work' },
    { id: 'conditions_of_appraisal', title: 'Conditions of Appraisal' },
    { id: 'contract_analysis', title: 'Contract Analysis' },
    { id: 'prior_sales_subject', title: 'Prior Sales / Listing History' },
  ],
  commercial: [
    { id: 'market_area', title: 'Market Area / Neighborhood' },
    { id: 'improvement_description', title: 'Improvements Description' },
    { id: 'hbu_analysis', title: 'Highest & Best Use' },
    { id: 'reconciliation', title: 'Reconciliation / Conclusion' },
    { id: 'site_description', title: 'Site Description' },
  ],

  // ── UAD 3.6 / Redesigned URAR — Mandatory November 2, 2026 ───────────────
  // Single universal form replacing legacy 1004 / 1025 / 1073.
  // Narrative sections only (data, grid, and photo sections are tracked separately).
  uad36: [
    { id: 'contract_analysis',           title: 'Contract Analysis' },
    { id: 'neighborhood_description',    title: 'Neighborhood Description' },
    { id: 'market_conditions',           title: 'Market Conditions Analysis' },
    { id: 'site_description',            title: 'Site Description' },
    { id: 'improvements_description',    title: 'Description of Improvements' },
    { id: 'condition_description',       title: 'Condition of Improvements' },
    { id: 'energy_features',             title: 'Energy Efficient / Green Features' },
    { id: 'adu_description',             title: 'Accessory Dwelling Unit (ADU)' },
    { id: 'highest_best_use',            title: 'Highest & Best Use Analysis' },
    { id: 'sales_comparison_narrative',  title: 'Sales Comparison Analysis' },
    { id: 'cost_approach',               title: 'Cost Approach' },
    { id: 'income_approach',             title: 'Income Approach' },
    { id: 'reconciliation',              title: 'Reconciliation & Final Value Opinion' },
    { id: 'scope_of_work',               title: 'Scope of Work' },
    { id: 'prior_sales',                 title: 'Prior Sales / Transfers History' },
    { id: 'conditions_assumptions',      title: 'General Assumptions & Limiting Conditions' },
    { id: 'extraordinary_assumptions',   title: 'Extraordinary Assumptions' },
    { id: 'hypothetical_conditions',     title: 'Hypothetical Conditions' },
  ],
};
