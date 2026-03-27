/**
 * server/intelligence/canonicalFields.js
 * -----------------------------------------
 * Phase 4 — Canonical Field Registry for Planning
 *
 * Internal registry of canonical content targets that the orchestrator
 * and section planner use to decide WHAT to generate.
 *
 * This is distinct from server/fieldRegistry.js which focuses on
 * software target metadata (ACI/RQ insertion). This registry focuses on
 * assignment intelligence: when is a field needed, what triggers it,
 * what report families use it, and what QC hints apply.
 *
 * Each canonical field defines:
 *   - fieldId             — unique identifier (matches fieldRegistry.js fieldId)
 *   - label               — human-readable name
 *   - sectionGroup        — which section group it belongs to
 *   - contentType         — 'narrative' | 'commentary' | 'analysis' | 'boilerplate'
 *   - whenNeeded          — description of when this field is typically needed
 *   - triggeringFlags     — which DerivedAssignmentFlags make this field applicable
 *   - applicableReportFamilies — which report family ids include this field
 *   - qcHints             — QC categories that should check this field
 *   - destinationHints    — future insertion target hints
 *
 * Usage:
 *   import { getApplicableFields, getCanonicalField } from './intelligence/canonicalFields.js';
 *   const fields = getApplicableFields(flags, reportFamilyId);
 */

// ── Canonical field definitions ─────────────────────────────────────────────

const CANONICAL_FIELDS = [

  // ── Neighborhood / Market ───────────────────────────────────────────────
  {
    fieldId:    'neighborhood_description',
    label:      'Neighborhood Description',
    sectionGroup: 'neighborhood',
    contentType: 'narrative',
    whenNeeded: 'Always required for all residential and commercial reports',
    triggeringFlags: [],  // always included
    applicableReportFamilies: ['urar_1004', 'urar_1025', 'urar_1073', 'urar_1004c', 'commercial_narrative'],
    qcHints: ['narrative_consistency', 'data_accuracy'],
    destinationHints: { aci: 'Neig', rq: 'market_data' },
  },
  {
    fieldId:    'market_conditions',
    label:      'Market Conditions',
    sectionGroup: 'neighborhood',
    contentType: 'analysis',
    whenNeeded: 'Always required — market trend and DOM analysis',
    triggeringFlags: [],
    applicableReportFamilies: ['urar_1004', 'urar_1025', 'urar_1073', 'urar_1004c'],
    qcHints: ['data_accuracy', 'value_support'],
    destinationHints: { aci: 'Neig' },
  },
  {
    fieldId:    'neighborhood_boundaries',
    label:      'Neighborhood Boundaries',
    sectionGroup: 'neighborhood',
    contentType: 'boilerplate',
    whenNeeded: 'Standard residential reports',
    triggeringFlags: [],
    applicableReportFamilies: ['urar_1004', 'urar_1025', 'urar_1073', 'urar_1004c'],
    qcHints: ['data_accuracy'],
    destinationHints: { aci: 'Neig' },
  },

  // ── Site ────────────────────────────────────────────────────────────────
  {
    fieldId:    'site_comments',
    label:      'Site Comments',
    sectionGroup: 'site',
    contentType: 'narrative',
    whenNeeded: 'Always required — site characteristics, utilities, adverse conditions',
    triggeringFlags: [],
    applicableReportFamilies: ['urar_1004', 'urar_1025', 'urar_1073', 'urar_1004c'],
    qcHints: ['data_accuracy', 'flood_zone_documentation', 'zoning_analysis'],
    destinationHints: { aci: 'Site' },
  },
  {
    fieldId:    'site_description',
    label:      'Site Description',
    sectionGroup: 'property_data',
    contentType: 'narrative',
    whenNeeded: 'Commercial reports — detailed site analysis',
    triggeringFlags: [],
    applicableReportFamilies: ['commercial_narrative'],
    qcHints: ['data_accuracy'],
    destinationHints: { rq: 'property_data' },
  },

  // ── Improvements ────────────────────────────────────────────────────────
  {
    fieldId:    'improvements_condition',
    label:      'Improvements / Condition',
    sectionGroup: 'improvements',
    contentType: 'narrative',
    whenNeeded: 'Always required — physical improvements and condition rating',
    triggeringFlags: [],
    applicableReportFamilies: ['urar_1004', 'urar_1025', 'urar_1073', 'urar_1004c'],
    qcHints: ['data_accuracy', 'narrative_consistency'],
    destinationHints: { aci: 'Impr' },
  },
  {
    fieldId:    'improvement_description',
    label:      'Improvement Description',
    sectionGroup: 'property_data',
    contentType: 'narrative',
    whenNeeded: 'Commercial reports — detailed improvements analysis',
    triggeringFlags: [],
    applicableReportFamilies: ['commercial_narrative'],
    qcHints: ['data_accuracy'],
    destinationHints: { rq: 'property_data' },
  },

  // ── Contract ────────────────────────────────────────────────────────────
  {
    fieldId:    'contract_analysis',
    label:      'Contract Analysis',
    sectionGroup: 'contract',
    contentType: 'boilerplate',
    whenNeeded: 'Purchase transactions — contract terms analysis',
    triggeringFlags: [],
    applicableReportFamilies: ['urar_1004', 'urar_1025', 'urar_1073', 'urar_1004c'],
    qcHints: ['data_accuracy'],
    destinationHints: { aci: 'SCA' },
  },
  {
    fieldId:    'concessions',
    label:      'Concessions / Financial Assistance',
    sectionGroup: 'contract',
    contentType: 'boilerplate',
    whenNeeded: 'Purchase transactions — concession analysis',
    triggeringFlags: [],
    applicableReportFamilies: ['urar_1004', 'urar_1025', 'urar_1073', 'urar_1004c'],
    qcHints: ['data_accuracy'],
    destinationHints: { aci: 'SCA' },
  },
  {
    fieldId:    'offering_history',
    label:      'Offering History',
    sectionGroup: 'contract',
    contentType: 'boilerplate',
    whenNeeded: 'All assignments — 3-year offering history',
    triggeringFlags: [],
    applicableReportFamilies: ['urar_1004', 'urar_1025', 'urar_1073', 'urar_1004c'],
    qcHints: ['uspap_compliance'],
    destinationHints: { aci: '' },
  },

  // ── Sales Comparison ───────────────────────────────────────────────────
  {
    fieldId:    'sca_summary',
    label:      'Sales Comparison Summary',
    sectionGroup: 'sales_comparison',
    contentType: 'analysis',
    whenNeeded: 'Always required when sales approach is applicable',
    triggeringFlags: ['sales_approach_required'],
    applicableReportFamilies: ['urar_1004', 'urar_1025', 'urar_1073', 'urar_1004c'],
    qcHints: ['value_support', 'data_accuracy'],
    destinationHints: { aci: 'Sales' },
  },
  {
    fieldId:    'sales_comparison',
    label:      'Sales Comparison Narrative',
    sectionGroup: 'sales_comparison',
    contentType: 'analysis',
    whenNeeded: 'Commercial reports — sales comparison approach',
    triggeringFlags: ['sales_approach_required'],
    applicableReportFamilies: ['commercial_narrative'],
    qcHints: ['value_support', 'data_accuracy'],
    destinationHints: { rq: 'sale_valuation' },
  },

  // ── Reconciliation ─────────────────────────────────────────────────────
  {
    fieldId:    'reconciliation',
    label:      'Reconciliation',
    sectionGroup: 'reconciliation',
    contentType: 'narrative',
    whenNeeded: 'Always required — final value opinion and approach reconciliation',
    triggeringFlags: [],
    applicableReportFamilies: ['urar_1004', 'urar_1025', 'urar_1073', 'urar_1004c', 'commercial_narrative'],
    qcHints: ['value_support', 'narrative_consistency', 'uspap_compliance'],
    destinationHints: { aci: 'Reco', rq: 'reconciliation' },
  },
  {
    fieldId:    'exposure_time',
    label:      'Exposure Time',
    sectionGroup: 'reconciliation',
    contentType: 'boilerplate',
    whenNeeded: 'Standard residential reports',
    triggeringFlags: [],
    applicableReportFamilies: ['urar_1004', 'urar_1025', 'urar_1073', 'urar_1004c'],
    qcHints: ['value_support'],
    destinationHints: { aci: 'Reco' },
  },

  // ── Highest and Best Use ───────────────────────────────────────────────
  {
    fieldId:    'hbu_analysis',
    label:      'Highest and Best Use — As Vacant',
    sectionGroup: 'highest_best_use',
    contentType: 'analysis',
    whenNeeded: 'Commercial reports — four-part HBU test',
    triggeringFlags: [],
    applicableReportFamilies: ['commercial_narrative'],
    qcHints: ['uspap_compliance'],
    destinationHints: { rq: 'highest_best_use' },
  },
  {
    fieldId:    'hbu_as_improved',
    label:      'Highest and Best Use — As Improved',
    sectionGroup: 'highest_best_use',
    contentType: 'analysis',
    whenNeeded: 'Commercial reports — improved HBU conclusion',
    triggeringFlags: [],
    applicableReportFamilies: ['commercial_narrative'],
    qcHints: ['uspap_compliance'],
    destinationHints: { rq: 'highest_best_use' },
  },

  // ── Cost Approach ──────────────────────────────────────────────────────
  {
    fieldId:    'cost_approach',
    label:      'Cost Approach Comments',
    sectionGroup: 'cost_approach',
    contentType: 'analysis',
    whenNeeded: 'When cost approach is applicable (new construction, proposed, etc.)',
    triggeringFlags: ['cost_approach_likely'],
    applicableReportFamilies: ['urar_1004', 'urar_1025', 'urar_1004c', 'commercial_narrative'],
    qcHints: ['value_support'],
    destinationHints: { aci: 'Cost', rq: 'cost_approach' },
  },

  // ── Income Approach ────────────────────────────────────────────────────
  {
    fieldId:    'income_approach',
    label:      'Income Approach',
    sectionGroup: 'income_approach',
    contentType: 'analysis',
    whenNeeded: 'Multi-unit (1025), commercial, or income-producing properties',
    triggeringFlags: ['income_approach_likely'],
    applicableReportFamilies: ['urar_1025', 'commercial_narrative'],
    qcHints: ['value_support', 'data_accuracy'],
    destinationHints: { aci: 'Income', rq: 'income_approach' },
  },
  {
    fieldId:    'rental_analysis',
    label:      'Rental Analysis',
    sectionGroup: 'income_approach',
    contentType: 'analysis',
    whenNeeded: '1025 multi-unit — market rent and rental comparison',
    triggeringFlags: ['income_approach_likely', 'multi_unit'],
    applicableReportFamilies: ['urar_1025'],
    qcHints: ['data_accuracy'],
    destinationHints: { aci: 'Income' },
  },
  {
    fieldId:    'market_rent_analysis',
    label:      'Market Rent Analysis',
    sectionGroup: 'market_rent',
    contentType: 'analysis',
    whenNeeded: 'Commercial reports — market rent introduction and analysis',
    triggeringFlags: ['income_approach_likely'],
    applicableReportFamilies: ['commercial_narrative'],
    qcHints: ['data_accuracy'],
    destinationHints: { rq: 'market_rent_analysis' },
  },

  // ── Form-specific sections ─────────────────────────────────────────────
  {
    fieldId:    'condo_project_analysis',
    label:      'Condo Project Analysis',
    sectionGroup: 'condo_project',
    contentType: 'narrative',
    whenNeeded: '1073 condo unit — project information, HOA, budget review',
    triggeringFlags: ['condo'],
    applicableReportFamilies: ['urar_1073'],
    qcHints: ['data_accuracy', 'condo_project_compliance'],
    destinationHints: { aci: 'Subj' },
  },
  {
    fieldId:    'manufactured_home_comments',
    label:      'Manufactured Housing Comments',
    sectionGroup: 'manufactured_home',
    contentType: 'narrative',
    whenNeeded: '1004c — HUD data plate, foundation, manufactured home analysis',
    triggeringFlags: ['manufactured_home'],
    applicableReportFamilies: ['urar_1004c'],
    qcHints: ['data_accuracy', 'manufactured_home_documentation'],
    destinationHints: { aci: '' },
  },
  {
    fieldId:    'introduction',
    label:      'Introduction',
    sectionGroup: 'introduction',
    contentType: 'narrative',
    whenNeeded: 'Commercial reports — assignment introduction and scope of work',
    triggeringFlags: [],
    applicableReportFamilies: ['commercial_narrative'],
    qcHints: ['uspap_compliance'],
    destinationHints: { rq: 'introduction' },
  },
  {
    fieldId:    'market_area',
    label:      'Market Area Analysis',
    sectionGroup: 'market_data',
    contentType: 'narrative',
    whenNeeded: 'Commercial reports — national/regional/local market overview',
    triggeringFlags: [],
    applicableReportFamilies: ['commercial_narrative'],
    qcHints: ['data_accuracy'],
    destinationHints: { rq: 'market_data' },
  },

  // ── Special commentary blocks (triggered by flags) ─────────────────────
  {
    fieldId:    'flood_comment',
    label:      'Flood Zone Commentary',
    sectionGroup: 'site',
    contentType: 'commentary',
    whenNeeded: 'When property is in a flood zone (not Zone X/C/B)',
    triggeringFlags: ['flood_commentary_required'],
    applicableReportFamilies: ['urar_1004', 'urar_1025', 'urar_1073', 'urar_1004c', 'commercial_narrative'],
    qcHints: ['flood_zone_documentation'],
    destinationHints: {},
  },
  {
    fieldId:    'zoning_comment',
    label:      'Zoning Nonconformity Commentary',
    sectionGroup: 'site',
    contentType: 'commentary',
    whenNeeded: 'When zoning is legal nonconforming or illegal',
    triggeringFlags: ['zoning_commentary_required'],
    applicableReportFamilies: ['urar_1004', 'urar_1025', 'urar_1004c', 'commercial_narrative'],
    qcHints: ['zoning_analysis'],
    destinationHints: {},
  },
  {
    fieldId:    'adu_comment',
    label:      'ADU Commentary',
    sectionGroup: 'improvements',
    contentType: 'commentary',
    whenNeeded: 'When an accessory dwelling unit is present',
    triggeringFlags: ['adu_present'],
    applicableReportFamilies: ['urar_1004'],
    qcHints: ['adu_compliance'],
    destinationHints: {},
  },
  {
    fieldId:    'mixed_use_comment',
    label:      'Mixed-Use Commentary',
    sectionGroup: 'improvements',
    contentType: 'commentary',
    whenNeeded: 'When property has mixed residential/commercial use',
    triggeringFlags: ['mixed_use'],
    applicableReportFamilies: ['urar_1004', 'commercial_narrative'],
    qcHints: ['data_accuracy'],
    destinationHints: {},
  },
  {
    fieldId:    'subject_to_repairs_comment',
    label:      'Subject-To Repairs Commentary',
    sectionGroup: 'improvements',
    contentType: 'commentary',
    whenNeeded: 'When value is subject to repairs/alterations',
    triggeringFlags: ['subject_to_repairs'],
    applicableReportFamilies: ['urar_1004', 'urar_1025', 'urar_1073', 'urar_1004c'],
    qcHints: ['condition_documentation'],
    destinationHints: {},
  },
  {
    fieldId:    'subject_to_completion_comment',
    label:      'Subject-To Completion Commentary',
    sectionGroup: 'improvements',
    contentType: 'commentary',
    whenNeeded: 'When value is subject to completion of construction',
    triggeringFlags: ['subject_to_completion'],
    applicableReportFamilies: ['urar_1004', 'urar_1025', 'urar_1004c'],
    qcHints: ['condition_documentation'],
    destinationHints: {},
  },
  {
    fieldId:    'fha_repair_comment',
    label:      'FHA Repair Requirements Commentary',
    sectionGroup: 'improvements',
    contentType: 'commentary',
    whenNeeded: 'FHA loans with repair requirements',
    triggeringFlags: ['fha_repair_required'],
    applicableReportFamilies: ['urar_1004', 'urar_1025', 'urar_1073', 'urar_1004c'],
    qcHints: ['fha_minimum_property_requirements'],
    destinationHints: {},
  },
  {
    fieldId:    'usda_site_eligibility_comment',
    label:      'USDA Site Eligibility Commentary',
    sectionGroup: 'site',
    contentType: 'commentary',
    whenNeeded: 'USDA loans — rural site eligibility verification',
    triggeringFlags: ['usda_site_eligibility_required'],
    applicableReportFamilies: ['urar_1004', 'urar_1004c'],
    qcHints: ['usda_site_eligibility'],
    destinationHints: {},
  },
  {
    fieldId:    'certification_addendum_comment',
    label:      'Certification Addendum Commentary',
    sectionGroup: 'reconciliation',
    contentType: 'commentary',
    whenNeeded: 'When additional certification language is needed (EA, HC, subject-to)',
    triggeringFlags: ['additional_certification_risk'],
    applicableReportFamilies: ['urar_1004', 'urar_1025', 'urar_1073', 'urar_1004c', 'commercial_narrative'],
    qcHints: ['certification_language', 'assignment_condition_disclosure'],
    destinationHints: {},
  },
];

// ── Build lookup indexes ────────────────────────────────────────────────────

const _byId = new Map();
for (const field of CANONICAL_FIELDS) {
  _byId.set(field.fieldId, field);
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Get a canonical field definition by fieldId.
 *
 * @param {string} fieldId
 * @returns {object|null}
 */
export function getCanonicalField(fieldId) {
  return _byId.get(fieldId) || null;
}

/**
 * Get all canonical field definitions.
 *
 * @returns {object[]}
 */
export function getAllCanonicalFields() {
  return [...CANONICAL_FIELDS];
}

/**
 * Get all canonical fields applicable to a report family and set of flags.
 *
 * A field is applicable if:
 *   1. It belongs to the given report family
 *   2. Its triggering flags are all true (or it has no triggering flags)
 *
 * @param {object} flags — DerivedAssignmentFlags
 * @param {string} reportFamilyId — e.g. 'urar_1004'
 * @returns {object[]} applicable canonical fields
 */
export function getApplicableFields(flags, reportFamilyId) {
  return CANONICAL_FIELDS.filter(field => {
    // Must belong to this report family
    if (!field.applicableReportFamilies.includes(reportFamilyId)) return false;

    // If no triggering flags, always applicable within the family
    if (field.triggeringFlags.length === 0) return true;

    // At least one triggering flag must be true
    return field.triggeringFlags.some(flagName => flags[flagName] === true);
  });
}

/**
 * Get canonical fields grouped by section group.
 *
 * @param {object[]} fields — array of canonical field definitions
 * @returns {Object<string, object[]>}
 */
export function groupFieldsBySectionGroup(fields) {
  const groups = {};
  for (const field of fields) {
    if (!groups[field.sectionGroup]) groups[field.sectionGroup] = [];
    groups[field.sectionGroup].push(field);
  }
  return groups;
}

/**
 * Get registry stats for diagnostics.
 *
 * @returns {{ totalFields: number, byContentType: object, byFamily: object }}
 */
export function getCanonicalFieldStats() {
  const byContentType = {};
  const byFamily = {};

  for (const field of CANONICAL_FIELDS) {
    byContentType[field.contentType] = (byContentType[field.contentType] || 0) + 1;
    for (const family of field.applicableReportFamilies) {
      byFamily[family] = (byFamily[family] || 0) + 1;
    }
  }

  return { totalFields: CANONICAL_FIELDS.length, byContentType, byFamily };
}
