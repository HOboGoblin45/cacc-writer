/**
 * server/intelligence/hardComplianceRules.js
 * -------------------------------------------
 * Deterministic compliance hard-rule evaluator (v1).
 *
 * Produces explainable blocker/warning findings with rule IDs and reason codes.
 * No model calls, no heuristics, no non-deterministic behavior.
 */

function asText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function hasActiveSection(sectionRequirements, sectionId) {
  if (!sectionRequirements || !sectionId) return false;
  const section = (sectionRequirements.sections || []).find(s => s.sectionId === sectionId);
  if (!section) return false;
  return section.status === 'required' || section.status === 'conditional_required' || section.status === 'optional';
}

function hasAnyActiveSection(sectionRequirements, sectionIds = []) {
  return sectionIds.some(sectionId => hasActiveSection(sectionRequirements, sectionId));
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function buildCheck({
  ruleId,
  severity,
  passed,
  reasonCode,
  message,
  evidence = null,
}) {
  return {
    ruleId,
    severity,
    passed: Boolean(passed),
    reasonCode,
    message,
    evidence,
  };
}

/**
 * Evaluate deterministic compliance rules against assignment intelligence.
 *
 * @param {object} params
 * @param {object} params.context
 * @param {object} params.flags
 * @param {object} params.compliance
 * @param {object} params.sectionRequirements
 * @returns {object}
 */
export function evaluateHardComplianceRules({
  context = {},
  flags = {},
  compliance = {},
  sectionRequirements = {},
}) {
  const checks = [];
  const effectiveDate = asText(context?.assignment?.effectiveDate);
  const intendedUser = asText(context?.assignment?.intendedUser || context?.intendedUser);
  const subjectState = asText(context?.subject?.state).toUpperCase();

  checks.push(buildCheck({
    ruleId: 'rule.uspap.applicable',
    severity: 'blocker',
    passed: compliance.uspap_applicable === true,
    reasonCode: compliance.uspap_applicable === true ? 'uspap_active' : 'uspap_missing',
    message: compliance.uspap_applicable === true
      ? 'USPAP applicability is confirmed.'
      : 'USPAP applicability flag is missing or false.',
  }));

  checks.push(buildCheck({
    ruleId: 'rule.section_matrix.available',
    severity: 'blocker',
    passed: Array.isArray(sectionRequirements.sections) && sectionRequirements.sections.length > 0,
    reasonCode: Array.isArray(sectionRequirements.sections) && sectionRequirements.sections.length > 0
      ? 'section_matrix_present'
      : 'section_matrix_missing',
    message: Array.isArray(sectionRequirements.sections) && sectionRequirements.sections.length > 0
      ? 'Section requirement matrix is available.'
      : 'Section requirement matrix is missing.',
  }));

  checks.push(buildCheck({
    ruleId: 'rule.assignment.intended_user',
    severity: 'warning',
    passed: Boolean(intendedUser),
    reasonCode: intendedUser ? 'intended_user_present' : 'intended_user_missing',
    message: intendedUser
      ? 'Intended user is present in the assignment context.'
      : 'Intended user is missing from the assignment context.',
    evidence: {
      intendedUser: intendedUser || null,
    },
  }));

  const baselineRequiredSectionIds = unique(
    (sectionRequirements.sections || [])
      .filter(section => (
        section?.reasonCode === 'manifest_required'
        || section?.reasonCode === 'manifest_condition_met'
      ))
      .map(section => section.sectionId),
  );
  const missingBaselineRequiredSectionIds = baselineRequiredSectionIds.filter(
    sectionId => !hasActiveSection(sectionRequirements, sectionId),
  );
  checks.push(buildCheck({
    ruleId: 'rule.manifest_required_sections.active',
    severity: 'blocker',
    passed: missingBaselineRequiredSectionIds.length === 0,
    reasonCode: missingBaselineRequiredSectionIds.length === 0
      ? 'manifest_required_sections_active'
      : 'manifest_required_sections_missing',
    message: missingBaselineRequiredSectionIds.length === 0
      ? 'All manifest-required sections are active in the section matrix.'
      : 'One or more manifest-required sections are not active in the section matrix.',
    evidence: {
      expectedSectionIds: baselineRequiredSectionIds,
      missingSectionIds: missingBaselineRequiredSectionIds,
    },
  }));

  checks.push(buildCheck({
    ruleId: 'rule.reconciliation.section',
    severity: 'blocker',
    passed: hasActiveSection(sectionRequirements, 'reconciliation'),
    reasonCode: hasActiveSection(sectionRequirements, 'reconciliation')
      ? 'reconciliation_present'
      : 'reconciliation_missing',
    message: hasActiveSection(sectionRequirements, 'reconciliation')
      ? 'Reconciliation section is present.'
      : 'Reconciliation section is missing from the active section matrix.',
  }));

  if (flags.sales_approach_required) {
    const passed = hasAnyActiveSection(sectionRequirements, ['sca_summary', 'sales_comparison']);
    checks.push(buildCheck({
      ruleId: 'rule.sales_approach.section',
      severity: 'blocker',
      passed,
      reasonCode: passed ? 'sales_section_present' : 'sales_section_missing',
      message: passed
        ? 'Sales approach section is present.'
        : 'Sales approach is required but no sales section is active.',
      evidence: { expectedSectionIds: ['sca_summary', 'sales_comparison'] },
    }));
  } else {
    checks.push(buildCheck({
      ruleId: 'rule.sales_approach.section',
      severity: 'info',
      passed: true,
      reasonCode: 'sales_not_required',
      message: 'Sales approach is not required for this assignment.',
    }));
  }

  if (flags.income_approach_likely) {
    const expectedSectionIds = ['income_approach', 'market_rent_analysis', 'rental_analysis'];
    const passed = hasAnyActiveSection(sectionRequirements, expectedSectionIds);
    checks.push(buildCheck({
      ruleId: 'rule.income_approach.section',
      severity: 'blocker',
      passed,
      reasonCode: passed ? 'income_section_present' : 'income_section_missing',
      message: passed
        ? 'Income approach section is present.'
        : 'Income approach is likely required but no income section is active.',
      evidence: { expectedSectionIds },
    }));
  } else {
    checks.push(buildCheck({
      ruleId: 'rule.income_approach.section',
      severity: 'info',
      passed: true,
      reasonCode: 'income_not_required',
      message: 'Income approach is not required for this assignment.',
    }));
  }

  if (flags.cost_approach_likely) {
    const expectedSectionIds = ['cost_approach'];
    const passed = hasAnyActiveSection(sectionRequirements, expectedSectionIds);
    checks.push(buildCheck({
      ruleId: 'rule.cost_approach.section',
      severity: 'blocker',
      passed,
      reasonCode: passed ? 'cost_section_present' : 'cost_section_missing',
      message: passed
        ? 'Cost approach section is present.'
        : 'Cost approach is likely required but no cost approach section is active.',
      evidence: { expectedSectionIds },
    }));
  } else {
    checks.push(buildCheck({
      ruleId: 'rule.cost_approach.section',
      severity: 'info',
      passed: true,
      reasonCode: 'cost_not_required',
      message: 'Cost approach is not required for this assignment.',
    }));
  }

  if (flags.subject_to_repairs || flags.repair_commentary_required) {
    const passed = hasAnyActiveSection(sectionRequirements, ['subject_to_repairs_comment', 'fha_repair_comment']);
    checks.push(buildCheck({
      ruleId: 'rule.subject_to_repairs.disclosure',
      severity: flags.fha_assignment ? 'blocker' : 'warning',
      passed,
      reasonCode: passed ? 'repairs_disclosure_present' : 'repairs_disclosure_missing',
      message: passed
        ? 'Subject-to repairs disclosure section is present.'
        : 'Subject-to repairs is active but repairs disclosure commentary is missing.',
      evidence: { expectedSectionIds: ['subject_to_repairs_comment', 'fha_repair_comment'] },
    }));
  }

  if (flags.subject_to_completion) {
    const passed = hasActiveSection(sectionRequirements, 'subject_to_completion_comment');
    checks.push(buildCheck({
      ruleId: 'rule.subject_to_completion.disclosure',
      severity: 'warning',
      passed,
      reasonCode: passed ? 'completion_disclosure_present' : 'completion_disclosure_missing',
      message: passed
        ? 'Subject-to completion disclosure section is present.'
        : 'Subject-to completion is active but completion commentary is missing.',
      evidence: { expectedSectionId: 'subject_to_completion_comment' },
    }));
  }

  if (flags.extraordinary_assumption_present) {
    const passed = hasActiveSection(sectionRequirements, 'ea_comment');
    checks.push(buildCheck({
      ruleId: 'rule.extraordinary_assumption.disclosure',
      severity: 'warning',
      passed,
      reasonCode: passed ? 'ea_disclosure_present' : 'ea_disclosure_missing',
      message: passed
        ? 'Extraordinary assumption disclosure section is present.'
        : 'Extraordinary assumptions were detected but EA disclosure commentary is missing.',
      evidence: { expectedSectionId: 'ea_comment' },
    }));
  }

  if (flags.hypothetical_condition_present) {
    const passed = hasActiveSection(sectionRequirements, 'hc_comment');
    checks.push(buildCheck({
      ruleId: 'rule.hypothetical_condition.disclosure',
      severity: 'warning',
      passed,
      reasonCode: passed ? 'hc_disclosure_present' : 'hc_disclosure_missing',
      message: passed
        ? 'Hypothetical condition disclosure section is present.'
        : 'Hypothetical conditions were detected but HC disclosure commentary is missing.',
      evidence: { expectedSectionId: 'hc_comment' },
    }));
  }

  if (flags.additional_certification_risk) {
    const expectedSectionIds = [];
    if (flags.extraordinary_assumption_present) expectedSectionIds.push('ea_comment');
    if (flags.hypothetical_condition_present) expectedSectionIds.push('hc_comment');
    if (
      flags.subject_to_any ||
      flags.retrospective_value ||
      flags.prospective_value
    ) {
      expectedSectionIds.push('certification_addendum_comment');
    }
    if (expectedSectionIds.length === 0) expectedSectionIds.push('certification_addendum_comment');

    const passed = hasAnyActiveSection(sectionRequirements, expectedSectionIds);
    checks.push(buildCheck({
      ruleId: 'rule.certification.disclosure',
      severity: 'warning',
      passed,
      reasonCode: passed ? 'certification_comment_present' : 'certification_comment_missing',
      message: passed
        ? 'Certification risk disclosure section is present.'
        : 'Certification-risk conditions were detected but no certification disclosure section is active.',
      evidence: { expectedSectionIds },
    }));
  }

  if (flags.subject_to_any || flags.retrospective_value || flags.prospective_value) {
    const passed = hasActiveSection(sectionRequirements, 'certification_addendum_comment');
    const assignmentCondition = flags.subject_to_any
      ? 'subject_to'
      : (flags.retrospective_value ? 'retrospective_value' : 'prospective_value');
    checks.push(buildCheck({
      ruleId: 'rule.assignment_condition.certification_addendum',
      severity: 'blocker',
      passed,
      reasonCode: passed ? 'assignment_condition_addendum_present' : 'assignment_condition_addendum_missing',
      message: passed
        ? 'Certification addendum commentary is present for assignment-condition reporting.'
        : 'Assignment condition requires certification addendum commentary, but section is missing.',
      evidence: {
        expectedSectionId: 'certification_addendum_comment',
        assignmentCondition,
      },
    }));
  }

  if (flags.retrospective_value || flags.prospective_value) {
    checks.push(buildCheck({
      ruleId: 'rule.value_condition.effective_date',
      severity: 'blocker',
      passed: Boolean(effectiveDate),
      reasonCode: effectiveDate ? 'effective_date_present' : 'effective_date_missing',
      message: effectiveDate
        ? 'Effective date is present for non-as-is value condition.'
        : 'Prospective/retrospective value condition requires an explicit effective date.',
      evidence: {
        valueCondition: flags.retrospective_value ? 'retrospective' : 'prospective',
        effectiveDate: effectiveDate || null,
      },
    }));
  }

  if (flags.flood_commentary_required) {
    const passed = hasActiveSection(sectionRequirements, 'flood_comment');
    checks.push(buildCheck({
      ruleId: 'rule.flood.disclosure',
      severity: 'warning',
      passed,
      reasonCode: passed ? 'flood_comment_present' : 'flood_comment_missing',
      message: passed
        ? 'Flood commentary section is present.'
        : 'Flood commentary is required but flood comment section is missing.',
      evidence: { expectedSectionId: 'flood_comment' },
    }));
  }

  if (flags.government_loan && flags.high_risk_flood_zone) {
    const passed = hasActiveSection(sectionRequirements, 'flood_comment');
    checks.push(buildCheck({
      ruleId: 'rule.flood.high_risk_government_loan',
      severity: 'blocker',
      passed,
      reasonCode: passed ? 'high_risk_flood_comment_present' : 'high_risk_flood_comment_missing',
      message: passed
        ? 'High-risk flood commentary is present for government-backed assignment.'
        : 'Government-backed assignment in high-risk flood zone requires flood commentary section.',
      evidence: {
        expectedSectionId: 'flood_comment',
        floodZoneRisk: 'high',
        loanType: flags.fha_assignment ? 'fha' : (flags.usda_assignment ? 'usda' : (flags.va_assignment ? 'va' : 'government')),
      },
    }));
  }

  if (flags.zoning_commentary_required) {
    const passed = hasActiveSection(sectionRequirements, 'zoning_comment');
    checks.push(buildCheck({
      ruleId: 'rule.zoning.disclosure',
      severity: 'warning',
      passed,
      reasonCode: passed ? 'zoning_comment_present' : 'zoning_comment_missing',
      message: passed
        ? 'Zoning commentary section is present.'
        : 'Zoning commentary is required but zoning comment section is missing.',
      evidence: { expectedSectionId: 'zoning_comment' },
    }));
  }

  if (flags.fha_repair_required) {
    const passed = hasActiveSection(sectionRequirements, 'fha_repair_comment');
    checks.push(buildCheck({
      ruleId: 'rule.fha.repair_commentary',
      severity: 'blocker',
      passed,
      reasonCode: passed ? 'fha_repair_comment_present' : 'fha_repair_comment_missing',
      message: passed
        ? 'FHA repair commentary section is present.'
        : 'FHA assignment requires repair commentary, but section is missing.',
      evidence: { expectedSectionId: 'fha_repair_comment' },
    }));
  }

  if (flags.usda_site_eligibility_required) {
    const passed = hasActiveSection(sectionRequirements, 'usda_site_eligibility_comment');
    checks.push(buildCheck({
      ruleId: 'rule.usda.site_eligibility',
      severity: 'blocker',
      passed,
      reasonCode: passed ? 'usda_eligibility_comment_present' : 'usda_eligibility_comment_missing',
      message: passed
        ? 'USDA eligibility commentary section is present.'
        : 'USDA assignment detected, but site eligibility commentary section is missing.',
      evidence: { expectedSectionId: 'usda_site_eligibility_comment' },
    }));
  }

  if (flags.condo) {
    const passed = hasActiveSection(sectionRequirements, 'condo_project_analysis');
    checks.push(buildCheck({
      ruleId: 'rule.condo.project_analysis',
      severity: 'warning',
      passed,
      reasonCode: passed ? 'condo_project_section_present' : 'condo_project_section_missing',
      message: passed
        ? 'Condo project analysis section is present.'
        : 'Condo assignment detected, but condo project analysis section is missing.',
      evidence: { expectedSectionId: 'condo_project_analysis' },
    }));
  }

  if (flags.manufactured_home) {
    const passed = hasActiveSection(sectionRequirements, 'manufactured_home_comments');
    checks.push(buildCheck({
      ruleId: 'rule.manufactured_home.comments',
      severity: 'blocker',
      passed,
      reasonCode: passed ? 'manufactured_home_section_present' : 'manufactured_home_section_missing',
      message: passed
        ? 'Manufactured home commentary section is present.'
        : 'Manufactured-home assignment requires manufactured home commentary section.',
      evidence: { expectedSectionId: 'manufactured_home_comments' },
    }));
  }

  if (flags.mixed_use) {
    const passed = hasActiveSection(sectionRequirements, 'mixed_use_comment');
    checks.push(buildCheck({
      ruleId: 'rule.mixed_use.commentary',
      severity: 'blocker',
      passed,
      reasonCode: passed ? 'mixed_use_comment_present' : 'mixed_use_comment_missing',
      message: passed
        ? 'Mixed-use commentary section is present.'
        : 'Mixed-use assignment detected, but mixed-use commentary section is missing.',
      evidence: { expectedSectionId: 'mixed_use_comment' },
    }));
  }

  if (flags.adu_present) {
    const passed = hasActiveSection(sectionRequirements, 'adu_comment');
    checks.push(buildCheck({
      ruleId: 'rule.adu.commentary',
      severity: 'warning',
      passed,
      reasonCode: passed ? 'adu_comment_present' : 'adu_comment_missing',
      message: passed
        ? 'ADU commentary section is present.'
        : 'ADU indicator detected, but ADU commentary section is missing.',
      evidence: { expectedSectionId: 'adu_comment' },
    }));
  }

  if (subjectState === 'IL' || subjectState === 'ILLINOIS') {
    const county = asText(context?.subject?.county);
    const passed = Boolean(county);
    checks.push(buildCheck({
      ruleId: 'rule.illinois.county_disclosure',
      severity: 'warning',
      passed,
      reasonCode: passed ? 'county_present' : 'county_missing',
      message: passed
        ? 'Illinois assignment includes county disclosure in the subject context.'
        : 'Illinois assignment is missing subject county in the normalized context.',
      evidence: {
        state: subjectState,
        county: county || null,
      },
    }));
  }

  const blockers = checks.filter(c => c.severity === 'blocker' && c.passed === false);
  const warnings = checks.filter(c => c.severity === 'warning' && c.passed === false);
  const info = checks.filter(c => c.severity === 'info');
  const passedRules = checks.filter(c => c.passed).length;

  return {
    checkedAt: new Date().toISOString(),
    context: {
      caseId: asText(context.caseId),
      formType: asText(context.formType),
      reportFamilyId: asText(compliance.report_family),
    },
    summary: {
      totalRules: checks.length,
      passedRules,
      failedRules: checks.length - passedRules,
      blockerCount: blockers.length,
      warningCount: warnings.length,
      infoCount: info.length,
    },
    blockers,
    warnings,
    info,
    checks,
  };
}

