/**
 * server/config/coreSections.js
 * -----------------------------
 * Canonical core section definitions by form type.
 */

export const CORE_SECTIONS = {
  '1004': [
    { id: 'neighborhood_description', title: 'Neighborhood Description' },
    { id: 'market_conditions', title: 'Market Conditions' },
    { id: 'improvements_condition', title: 'Improvements / Condition' },
    { id: 'adverse_conditions', title: 'Adverse Conditions / External Factors' },
    { id: 'functional_utility', title: 'Functional Utility' },
    { id: 'functional_utility_conformity', title: 'Functional Utility / Conformity' },
    { id: 'sca_summary', title: 'Sales Comparison Summary' },
    { id: 'sales_comparison_commentary', title: 'Sales Comparison Commentary' },
    { id: 'reconciliation', title: 'Reconciliation' },
  ],
  commercial: [
    { id: 'market_area', title: 'Market Area / Neighborhood' },
    { id: 'improvement_description', title: 'Improvements Description' },
    { id: 'hbu_analysis', title: 'Highest & Best Use' },
    { id: 'reconciliation', title: 'Reconciliation / Conclusion' },
    { id: 'site_description', title: 'Site Description' },
  ],
};
