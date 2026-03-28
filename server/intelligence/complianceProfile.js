/**
 * server/intelligence/complianceProfile.js
 * -------------------------------------------
 * Phase 4 — Compliance Profile Skeleton Builder
 *
 * NOT a full rule engine. Identifies likely compliance families and
 * reporting overlays from the derived flags and normalized context.
 *
 * Output is a structured profile that:
 *   - Identifies baseline USPAP applicability
 *   - Tags FHA/USDA/VA overlays
 *   - Lists property-type implications
 *   - Lists assignment-condition implications
 *   - Identifies likely commentary families required
 *   - Identifies likely future QC categories
 *
 * Usage:
 *   import { buildComplianceProfile } from './intelligence/complianceProfile.js';
 *   const profile = buildComplianceProfile(ctx, flags);
 */

/**
 * Build a compliance profile skeleton from context and flags.
 *
 * @param {import('./assignmentSchema.js').NormalizedAssignmentContext} ctx
 * @param {import('./derivedFlags.js').DerivedAssignmentFlags} flags
 * @returns {import('./assignmentSchema.js').ComplianceProfile}
 */
export function buildComplianceProfile(ctx, flags) {
  // ── Baseline USPAP ──────────────────────────────────────────────────────
  const uspap_applicable = true; // Always applicable for real property appraisal

  // ── Program overlays ────────────────────────────────────────────────────
  const fha_overlay  = flags.fha_assignment;
  const usda_overlay = flags.usda_assignment;
  const va_overlay   = flags.va_assignment;

  // ── Report family resolution ────────────────────────────────────────────
  const report_family = resolveReportFamily(ctx.formType, flags);

  // ── Property type implications ──────────────────────────────────────────
  const property_type_implications = [];

  if (flags.single_family) {
    property_type_implications.push('standard_residential_scope');
  }
  if (flags.condo) {
    property_type_implications.push('condo_project_analysis_required');
    property_type_implications.push('hoa_review_required');
    property_type_implications.push('project_approval_status_check');
  }
  if (flags.multi_unit) {
    property_type_implications.push('income_approach_required');
    property_type_implications.push('rental_analysis_required');
    property_type_implications.push('unit_by_unit_description');
  }
  if (flags.manufactured_home) {
    property_type_implications.push('hud_data_plate_required');
    property_type_implications.push('foundation_certification_required');
    property_type_implications.push('manufactured_home_addendum');
  }
  if (flags.mixed_use) {
    property_type_implications.push('mixed_use_analysis_required');
    property_type_implications.push('commercial_component_description');
    property_type_implications.push('residential_predominance_test');
  }
  if (flags.adu_present) {
    property_type_implications.push('adu_description_required');
    property_type_implications.push('adu_zoning_compliance_check');
    property_type_implications.push('adu_value_contribution_analysis');
  }
  if (flags.rural_property) {
    property_type_implications.push('rural_market_analysis');
    property_type_implications.push('extended_comparable_search');
    if (flags.usda_assignment) {
      property_type_implications.push('usda_site_eligibility_verification');
    }
  }
  if (flags.commercial_property) {
    property_type_implications.push('commercial_scope_of_work');
    property_type_implications.push('three_approach_analysis');
  }

  // ── Assignment condition implications ───────────────────────────────────
  const assignment_condition_implications = [];

  if (flags.subject_to_repairs) {
    assignment_condition_implications.push('repair_list_required');
    assignment_condition_implications.push('cost_to_cure_estimate');
    assignment_condition_implications.push('as_repaired_value_opinion');
    if (fha_overlay) {
      assignment_condition_implications.push('fha_repair_requirements_commentary');
    }
  }
  if (flags.subject_to_completion) {
    assignment_condition_implications.push('plans_and_specs_required');
    assignment_condition_implications.push('completion_timeline_stated');
    assignment_condition_implications.push('as_completed_value_opinion');
  }
  if (flags.prospective_value) {
    assignment_condition_implications.push('prospective_date_stated');
    assignment_condition_implications.push('market_projection_basis');
  }
  if (flags.retrospective_value) {
    assignment_condition_implications.push('retrospective_date_stated');
    assignment_condition_implications.push('historical_market_data_required');
    assignment_condition_implications.push('historical_comparable_search');
  }
  if (flags.extraordinary_assumption_present) {
    assignment_condition_implications.push('ea_disclosure_required');
    assignment_condition_implications.push('ea_impact_on_value_stated');
  }
  if (flags.hypothetical_condition_present) {
    assignment_condition_implications.push('hc_disclosure_required');
    assignment_condition_implications.push('hc_impact_on_value_stated');
  }
  if (flags.new_construction || flags.proposed_construction) {
    assignment_condition_implications.push('construction_status_documented');
    assignment_condition_implications.push('cost_approach_development');
  }

  // ── Likely commentary families ──────────────────────────────────────────
  const likely_commentary_families = buildCommentaryFamilies(flags);

  // ── Likely QC categories ────────────────────────────────────────────────
  const likely_qc_categories = buildQcCategories(flags, ctx);

  return {
    uspap_applicable,
    fha_overlay,
    usda_overlay,
    va_overlay,
    report_family,
    property_type_implications,
    assignment_condition_implications,
    likely_commentary_families,
    likely_qc_categories,
  };
}

// ── Report family resolution ────────────────────────────────────────────────

function resolveReportFamily(formType, flags) {
  const ft = (formType || '1004').toLowerCase();
  if (ft === 'commercial') return 'commercial_narrative';
  if (ft === '1073' || flags.condo) return 'urar_1073';
  if (ft === '1025' || flags.multi_unit) return 'urar_1025';
  if (ft === '1004c' || flags.manufactured_home) return 'urar_1004c';
  return 'urar_1004';
}

// ── Commentary families ─────────────────────────────────────────────────────

function buildCommentaryFamilies(flags) {
  const families = [
    'neighborhood',
    'market_conditions',
    'site',
    'improvements',
    'sales_comparison',
    'reconciliation',
  ];

  if (flags.flood_commentary_required) families.push('flood');
  if (flags.zoning_commentary_required) families.push('zoning_nonconformity');
  if (flags.repair_commentary_required) families.push('repairs');
  if (flags.subject_to_completion) families.push('completion_status');
  if (flags.cost_approach_likely) families.push('cost_approach');
  if (flags.income_approach_likely) families.push('income_approach');
  if (flags.adu_present) families.push('adu');
  if (flags.mixed_use) families.push('mixed_use');
  if (flags.manufactured_home) families.push('manufactured_home');
  if (flags.condo) families.push('condo_project');
  if (flags.extraordinary_assumption_present) families.push('extraordinary_assumptions');
  if (flags.hypothetical_condition_present) families.push('hypothetical_conditions');
  if (flags.fha_assignment) families.push('fha_requirements');
  if (flags.usda_site_eligibility_required) families.push('usda_eligibility');
  if (flags.va_assignment) families.push('va_requirements');
  if (flags.market_time_adjustment) families.push('market_time_adjustment');
  if (flags.declining_market) families.push('declining_market');
  if (flags.retrospective_value) families.push('retrospective_analysis');
  if (flags.prospective_value) families.push('prospective_analysis');

  return families;
}

// ── QC categories ───────────────────────────────────────────────────────────

function buildQcCategories(flags, ctx) {
  const categories = [
    'uspap_compliance',
    'data_accuracy',
    'narrative_consistency',
    'value_support',
  ];
  const subjectState = String(ctx?.subject?.state || '').trim().toUpperCase();

  if (flags.government_loan) categories.push('government_program_compliance');
  if (flags.fha_assignment) categories.push('fha_minimum_property_requirements');
  if (flags.usda_assignment) categories.push('usda_site_eligibility');
  if (flags.va_assignment) categories.push('va_minimum_property_requirements');
  if (flags.subject_to_any) categories.push('condition_documentation');
  if (flags.extraordinary_assumption_present || flags.hypothetical_condition_present) {
    categories.push('assignment_condition_disclosure');
  }
  if (flags.flood_zone) categories.push('flood_zone_documentation');
  if (flags.nonconforming_zoning) categories.push('zoning_analysis');
  if (flags.additional_certification_risk) categories.push('certification_language');
  if (flags.limited_comps) categories.push('limited_comparable_data');
  if (flags.declining_market) categories.push('declining_market_analysis');
  if (flags.adu_present) categories.push('adu_compliance');
  if (flags.manufactured_home) categories.push('manufactured_home_documentation');
  if (subjectState === 'IL' || subjectState === 'ILLINOIS') categories.push('illinois_state_scope');

  return categories;
}
