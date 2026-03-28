/**
 * server/qc/checkers/complianceSignalChecker.js
 * ------------------------------------------------
 * Phase 7 — Assignment-Aware Compliance Signal Checks
 *
 * Signal checks based on the Phase 4 compliance profile and assignment flags.
 * These are NOT a full compliance engine — they catch obvious coverage failures
 * and review risks based on what the assignment intelligence tells us.
 *
 * Examples:
 *   - FHA assignment but FHA commentary omitted
 *   - USDA assignment but rural/site commentary omitted
 *   - Flood zone but flood commentary missing
 *   - Nonconforming zoning but zoning commentary missing
 *   - Mixed-use but mixed-use explanation omitted
 *   - ADU present but ADU commentary omitted
 *   - Subject-to but repair commentary omitted
 *   - EA/HC flagged but insufficient acknowledgment
 *   - Report family implies section presence but missing
 *
 * All checks are deterministic — driven by flags and compliance profile.
 */

import { registerRules } from '../qcRuleRegistry.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Check if a section exists and has substantive content.
 * @param {Object} sections
 * @param {string} sectionId
 * @param {number} [minChars=40]
 * @returns {boolean}
 */
function hasSectionContent(sections, sectionId, minChars = 40) {
  const sec = sections[sectionId];
  return sec && sec.text && sec.text.trim().length >= minChars;
}

/**
 * Check if any section text mentions a pattern.
 * @param {Object} sections
 * @param {RegExp} pattern
 * @returns {boolean}
 */
function anySectionMentions(sections, pattern) {
  for (const sec of Object.values(sections)) {
    if (sec && sec.text && pattern.test(sec.text)) return true;
  }
  return false;
}

// ── Rule definitions ────────────────────────────────────────────────────────

const rules = [
  {
    ruleId: 'CMP-001',
    displayName: 'FHA Commentary Missing',
    category: 'compliance_signal',
    defaultSeverity: 'high',
    scope: 'draft_package',
    applicableReportFamilies: [],
    applicableCanonicalFields: [],
    applicableFlags: ['fha_assignment'],
    requiredInputs: ['sections', 'flags'],
    ruleType: 'deterministic',
    sourceReference: 'HUD 4000.1',
    active: true,
    description: 'FHA assignment but no FHA-specific commentary found in the draft.',
    check: checkFhaCommentary,
  },
  {
    ruleId: 'CMP-002',
    displayName: 'FHA Repair Commentary Missing',
    category: 'compliance_signal',
    defaultSeverity: 'high',
    scope: 'draft_package',
    applicableReportFamilies: [],
    applicableCanonicalFields: ['fha_repair_comment'],
    applicableFlags: ['fha_repair_required'],
    requiredInputs: ['sections', 'flags'],
    ruleType: 'deterministic',
    sourceReference: 'HUD 4000.1 — Minimum Property Requirements',
    active: true,
    description: 'FHA assignment with repairs required but no repair commentary found.',
    check: checkFhaRepairCommentary,
  },
  {
    ruleId: 'CMP-003',
    displayName: 'USDA Site Eligibility Commentary Missing',
    category: 'compliance_signal',
    defaultSeverity: 'high',
    scope: 'draft_package',
    applicableReportFamilies: [],
    applicableCanonicalFields: ['usda_site_eligibility_comment'],
    applicableFlags: ['usda_assignment'],
    requiredInputs: ['sections', 'flags'],
    ruleType: 'deterministic',
    sourceReference: 'USDA Rural Development Guidelines',
    active: true,
    description: 'USDA assignment but no rural site eligibility commentary found.',
    check: checkUsdaCommentary,
  },
  {
    ruleId: 'CMP-004',
    displayName: 'Flood Zone Commentary Missing',
    category: 'compliance_signal',
    defaultSeverity: 'high',
    scope: 'draft_package',
    applicableReportFamilies: [],
    applicableCanonicalFields: ['flood_comment'],
    applicableFlags: ['flood_commentary_required'],
    requiredInputs: ['sections', 'flags'],
    ruleType: 'deterministic',
    sourceReference: null,
    active: true,
    description: 'Property is in a flood zone but no flood commentary found.',
    check: checkFloodCommentary,
  },
  {
    ruleId: 'CMP-005',
    displayName: 'Zoning Nonconformity Commentary Missing',
    category: 'compliance_signal',
    defaultSeverity: 'high',
    scope: 'draft_package',
    applicableReportFamilies: [],
    applicableCanonicalFields: ['zoning_comment'],
    applicableFlags: ['zoning_commentary_required'],
    requiredInputs: ['sections', 'flags'],
    ruleType: 'deterministic',
    sourceReference: null,
    active: true,
    description: 'Nonconforming zoning flagged but no zoning commentary found.',
    check: checkZoningCommentary,
  },
  {
    ruleId: 'CMP-006',
    displayName: 'Mixed-Use Commentary Missing',
    category: 'compliance_signal',
    defaultSeverity: 'high',
    scope: 'draft_package',
    applicableReportFamilies: [],
    applicableCanonicalFields: ['mixed_use_comment'],
    applicableFlags: ['mixed_use'],
    requiredInputs: ['sections', 'flags'],
    ruleType: 'deterministic',
    sourceReference: null,
    active: true,
    description: 'Mixed-use property flagged but no mixed-use commentary found.',
    check: checkMixedUseCommentary,
  },
  {
    ruleId: 'CMP-007',
    displayName: 'ADU Commentary Missing',
    category: 'compliance_signal',
    defaultSeverity: 'medium',
    scope: 'draft_package',
    applicableReportFamilies: [],
    applicableCanonicalFields: ['adu_comment'],
    applicableFlags: ['adu_present'],
    requiredInputs: ['sections', 'flags'],
    ruleType: 'deterministic',
    sourceReference: null,
    active: true,
    description: 'ADU present but no ADU commentary found.',
    check: checkAduCommentary,
  },
  {
    ruleId: 'CMP-008',
    displayName: 'Subject-To Repairs Commentary Missing',
    category: 'compliance_signal',
    defaultSeverity: 'high',
    scope: 'draft_package',
    applicableReportFamilies: [],
    applicableCanonicalFields: ['subject_to_repairs_comment'],
    applicableFlags: ['subject_to_repairs'],
    requiredInputs: ['sections', 'flags'],
    ruleType: 'deterministic',
    sourceReference: null,
    active: true,
    description: 'Subject-to-repairs condition but no repair commentary found.',
    check: checkSubjectToRepairsCommentary,
  },
  {
    ruleId: 'CMP-009',
    displayName: 'Extraordinary Assumption Not Acknowledged',
    category: 'compliance_signal',
    defaultSeverity: 'high',
    scope: 'draft_package',
    applicableReportFamilies: [],
    applicableCanonicalFields: ['certification_addendum_comment'],
    applicableFlags: ['extraordinary_assumption_present'],
    requiredInputs: ['sections', 'flags'],
    ruleType: 'deterministic',
    sourceReference: 'USPAP Standards Rule 2-2(a)(x)',
    active: true,
    description: 'Extraordinary assumption flagged but not acknowledged in the draft.',
    check: checkExtraordinaryAssumption,
  },
  {
    ruleId: 'CMP-010',
    displayName: 'Hypothetical Condition Not Acknowledged',
    category: 'compliance_signal',
    defaultSeverity: 'high',
    scope: 'draft_package',
    applicableReportFamilies: [],
    applicableCanonicalFields: ['certification_addendum_comment'],
    applicableFlags: ['hypothetical_condition_present'],
    requiredInputs: ['sections', 'flags'],
    ruleType: 'deterministic',
    sourceReference: 'USPAP Standards Rule 2-2(a)(x)',
    active: true,
    description: 'Hypothetical condition flagged but not acknowledged in the draft.',
    check: checkHypotheticalCondition,
  },
  {
    ruleId: 'CMP-011',
    displayName: 'Cost Approach Expected but Missing',
    category: 'compliance_signal',
    defaultSeverity: 'medium',
    scope: 'draft_package',
    applicableReportFamilies: [],
    applicableCanonicalFields: ['cost_approach'],
    applicableFlags: ['cost_approach_likely'],
    requiredInputs: ['sections', 'flags'],
    ruleType: 'deterministic',
    sourceReference: null,
    active: true,
    description: 'Cost approach is likely applicable but no cost approach section found.',
    check: checkCostApproachPresence,
  },
  {
    ruleId: 'CMP-012',
    displayName: 'Income Approach Expected but Missing',
    category: 'compliance_signal',
    defaultSeverity: 'medium',
    scope: 'draft_package',
    applicableReportFamilies: [],
    applicableCanonicalFields: ['income_approach'],
    applicableFlags: ['income_approach_likely'],
    requiredInputs: ['sections', 'flags'],
    ruleType: 'deterministic',
    sourceReference: null,
    active: true,
    description: 'Income approach is likely applicable but no income approach section found.',
    check: checkIncomeApproachPresence,
  },
  {
    ruleId: 'CMP-013',
    displayName: 'Subject-To Completion Commentary Missing',
    category: 'compliance_signal',
    defaultSeverity: 'high',
    scope: 'draft_package',
    applicableReportFamilies: [],
    applicableCanonicalFields: ['subject_to_completion_comment'],
    applicableFlags: ['subject_to_completion'],
    requiredInputs: ['sections', 'flags'],
    ruleType: 'deterministic',
    sourceReference: null,
    active: true,
    description: 'Subject-to-completion condition but no completion commentary found.',
    check: checkSubjectToCompletionCommentary,
  },
];

// ── Check implementations ───────────────────────────────────────────────────

/** @param {import('../types.js').QCRuleContext} ctx */
function checkFhaCommentary(ctx) {
  if (!ctx.flags.fha_assignment) return [];

  const fhaPattern = /\b(FHA|HUD|federal\s+housing|minimum\s+property\s+(?:requirements|standards)|MPR)\b/i;
  const hasCommentary = hasSectionContent(ctx.sections, 'fha_repair_comment') ||
    anySectionMentions(ctx.sections, fhaPattern);

  if (hasCommentary) return [];

  return [{
    ruleId: 'CMP-001',
    severity: 'high',
    category: 'compliance_signal',
    sectionIds: [],
    canonicalFieldIds: ['fha_repair_comment'],
    message: 'FHA assignment but no FHA-specific commentary found.',
    detailMessage: 'This is an FHA assignment. The draft should include FHA-specific language addressing minimum property requirements, health/safety items, or FHA compliance. No such language was detected.',
    suggestedAction: 'Add FHA-specific commentary addressing minimum property requirements.',
    evidence: { type: 'missing_field', expectedValue: 'FHA commentary' },
    sourceRefs: ['HUD 4000.1'],
  }];
}

/** @param {import('../types.js').QCRuleContext} ctx */
function checkFhaRepairCommentary(ctx) {
  if (!ctx.flags.fha_repair_required) return [];

  const repairPattern = /\b(repair|deficien|health\s+and\s+safety|MPR|minimum\s+property|required\s+repair|subject[\s-]to[\s-]repair)/i;
  const hasCommentary = hasSectionContent(ctx.sections, 'fha_repair_comment') ||
    hasSectionContent(ctx.sections, 'subject_to_repairs_comment') ||
    anySectionMentions(ctx.sections, repairPattern);

  if (hasCommentary) return [];

  return [{
    ruleId: 'CMP-002',
    severity: 'high',
    category: 'compliance_signal',
    sectionIds: [],
    canonicalFieldIds: ['fha_repair_comment'],
    message: 'FHA repair requirements not addressed in draft.',
    detailMessage: 'This FHA assignment has repair requirements, but no repair-specific commentary was found. FHA requires explicit documentation of required repairs.',
    suggestedAction: 'Add commentary addressing the specific repairs required for FHA compliance.',
    evidence: { type: 'missing_field', expectedValue: 'FHA repair commentary' },
    sourceRefs: ['HUD 4000.1 — Minimum Property Requirements'],
  }];
}

/** @param {import('../types.js').QCRuleContext} ctx */
function checkUsdaCommentary(ctx) {
  if (!ctx.flags.usda_assignment) return [];

  const usdaPattern = /\b(USDA|rural\s+development|rural\s+(?:eligib|site|area|property)|RD\s+(?:loan|program))\b/i;
  const hasCommentary = hasSectionContent(ctx.sections, 'usda_site_eligibility_comment') ||
    anySectionMentions(ctx.sections, usdaPattern);

  if (hasCommentary) return [];

  return [{
    ruleId: 'CMP-003',
    severity: 'high',
    category: 'compliance_signal',
    sectionIds: [],
    canonicalFieldIds: ['usda_site_eligibility_comment'],
    message: 'USDA assignment but no rural site eligibility commentary found.',
    detailMessage: 'This is a USDA assignment. The draft should address rural site eligibility and USDA-specific requirements. No such language was detected.',
    suggestedAction: 'Add USDA rural site eligibility commentary.',
    evidence: { type: 'missing_field', expectedValue: 'USDA site eligibility commentary' },
    sourceRefs: ['USDA Rural Development Guidelines'],
  }];
}

/** @param {import('../types.js').QCRuleContext} ctx */
function checkFloodCommentary(ctx) {
  if (!ctx.flags.flood_commentary_required) return [];

  const floodPattern = /\b(flood\s+zone|flood\s+(?:insurance|plain|hazard|map|panel)|FEMA|SFHA|special\s+flood)\b/i;
  const hasCommentary = hasSectionContent(ctx.sections, 'flood_comment') ||
    anySectionMentions(ctx.sections, floodPattern);

  if (hasCommentary) return [];

  return [{
    ruleId: 'CMP-004',
    severity: 'high',
    category: 'compliance_signal',
    sectionIds: [],
    canonicalFieldIds: ['flood_comment'],
    message: 'Property in flood zone but no flood commentary found.',
    detailMessage: 'The assignment context indicates the property is in a flood zone, but no flood-specific commentary was detected in the draft.',
    suggestedAction: 'Add flood zone commentary addressing the flood designation, insurance requirements, and impact on value.',
    evidence: { type: 'missing_field', expectedValue: 'flood zone commentary' },
  }];
}

/** @param {import('../types.js').QCRuleContext} ctx */
function checkZoningCommentary(ctx) {
  if (!ctx.flags.zoning_commentary_required) return [];

  const zoningPattern = /\b(non[\s-]?conforming|legal(?:ly)?\s+non[\s-]?conforming|zoning\s+(?:variance|exception|nonconform))\b/i;
  const hasCommentary = hasSectionContent(ctx.sections, 'zoning_comment') ||
    anySectionMentions(ctx.sections, zoningPattern);

  if (hasCommentary) return [];

  return [{
    ruleId: 'CMP-005',
    severity: 'high',
    category: 'compliance_signal',
    sectionIds: [],
    canonicalFieldIds: ['zoning_comment'],
    message: 'Nonconforming zoning flagged but no zoning commentary found.',
    detailMessage: 'The assignment context indicates nonconforming zoning, but no zoning-specific commentary was detected addressing the nonconformity.',
    suggestedAction: 'Add zoning commentary explaining the nonconformity, its legality, and impact on marketability/value.',
    evidence: { type: 'missing_field', expectedValue: 'zoning nonconformity commentary' },
  }];
}

/** @param {import('../types.js').QCRuleContext} ctx */
function checkMixedUseCommentary(ctx) {
  if (!ctx.flags.mixed_use) return [];

  const mixedPattern = /\b(mixed[\s-]?use|commercial\s+(?:and|&)\s+residential|dual[\s-]?use)\b/i;
  const hasCommentary = hasSectionContent(ctx.sections, 'mixed_use_comment') ||
    anySectionMentions(ctx.sections, mixedPattern);

  if (hasCommentary) return [];

  return [{
    ruleId: 'CMP-006',
    severity: 'high',
    category: 'compliance_signal',
    sectionIds: [],
    canonicalFieldIds: ['mixed_use_comment'],
    message: 'Mixed-use property but no mixed-use commentary found.',
    detailMessage: 'The assignment flags indicate a mixed-use property, but no mixed-use explanation was found in the draft.',
    suggestedAction: 'Add commentary explaining the mixed-use nature, commercial component, and impact on value.',
    evidence: { type: 'missing_field', expectedValue: 'mixed-use commentary' },
  }];
}

/** @param {import('../types.js').QCRuleContext} ctx */
function checkAduCommentary(ctx) {
  if (!ctx.flags.adu_present) return [];

  const aduPattern = /\b(ADU|accessory\s+dwelling|guest\s+house|granny\s+flat|in[\s-]?law\s+(?:suite|unit|quarters))\b/i;
  const hasCommentary = hasSectionContent(ctx.sections, 'adu_comment') ||
    anySectionMentions(ctx.sections, aduPattern);

  if (hasCommentary) return [];

  return [{
    ruleId: 'CMP-007',
    severity: 'medium',
    category: 'compliance_signal',
    sectionIds: [],
    canonicalFieldIds: ['adu_comment'],
    message: 'ADU present but no ADU commentary found.',
    detailMessage: 'The assignment flags indicate an ADU is present, but no ADU-specific commentary was found in the draft.',
    suggestedAction: 'Add ADU commentary addressing legality, permits, and impact on value.',
    evidence: { type: 'missing_field', expectedValue: 'ADU commentary' },
  }];
}

/** @param {import('../types.js').QCRuleContext} ctx */
function checkSubjectToRepairsCommentary(ctx) {
  if (!ctx.flags.subject_to_repairs) return [];

  const repairPattern = /\b(subject[\s-]to[\s-](?:the\s+)?(?:completion\s+of\s+)?repairs?|required\s+repairs?|repair\s+(?:items?|requirements?))\b/i;
  const hasCommentary = hasSectionContent(ctx.sections, 'subject_to_repairs_comment') ||
    anySectionMentions(ctx.sections, repairPattern);

  if (hasCommentary) return [];

  return [{
    ruleId: 'CMP-008',
    severity: 'high',
    category: 'compliance_signal',
    sectionIds: [],
    canonicalFieldIds: ['subject_to_repairs_comment'],
    message: 'Subject-to-repairs condition but no repair commentary found.',
    detailMessage: 'The assignment is subject to repairs, but no repair-specific commentary was found in the draft.',
    suggestedAction: 'Add commentary describing the required repairs and their impact on value.',
    evidence: { type: 'missing_field', expectedValue: 'subject-to-repairs commentary' },
  }];
}

/** @param {import('../types.js').QCRuleContext} ctx */
function checkExtraordinaryAssumption(ctx) {
  if (!ctx.flags.extraordinary_assumption_present) return [];

  const eaPattern = /\b(extraordinary\s+assumption|EA\b)/i;
  const hasAcknowledgment = anySectionMentions(ctx.sections, eaPattern);

  if (hasAcknowledgment) return [];

  return [{
    ruleId: 'CMP-009',
    severity: 'high',
    category: 'compliance_signal',
    sectionIds: [],
    canonicalFieldIds: ['certification_addendum_comment', 'reconciliation'],
    message: 'Extraordinary assumption flagged but not acknowledged in draft.',
    detailMessage: 'The assignment context includes an extraordinary assumption, but no acknowledgment was found in the draft. USPAP requires disclosure of extraordinary assumptions.',
    suggestedAction: 'Add extraordinary assumption disclosure to the certification/addendum and reconciliation.',
    evidence: { type: 'missing_field', expectedValue: 'extraordinary assumption disclosure' },
    sourceRefs: ['USPAP Standards Rule 2-2(a)(x)'],
  }];
}

/** @param {import('../types.js').QCRuleContext} ctx */
function checkHypotheticalCondition(ctx) {
  if (!ctx.flags.hypothetical_condition_present) return [];

  const hcPattern = /\b(hypothetical\s+condition|HC\b)/i;
  const hasAcknowledgment = anySectionMentions(ctx.sections, hcPattern);

  if (hasAcknowledgment) return [];

  return [{
    ruleId: 'CMP-010',
    severity: 'high',
    category: 'compliance_signal',
    sectionIds: [],
    canonicalFieldIds: ['certification_addendum_comment', 'reconciliation'],
    message: 'Hypothetical condition flagged but not acknowledged in draft.',
    detailMessage: 'The assignment context includes a hypothetical condition, but no acknowledgment was found in the draft. USPAP requires disclosure of hypothetical conditions.',
    suggestedAction: 'Add hypothetical condition disclosure to the certification/addendum and reconciliation.',
    evidence: { type: 'missing_field', expectedValue: 'hypothetical condition disclosure' },
    sourceRefs: ['USPAP Standards Rule 2-2(a)(x)'],
  }];
}

/** @param {import('../types.js').QCRuleContext} ctx */
function checkCostApproachPresence(ctx) {
  if (!ctx.flags.cost_approach_likely) return [];

  const hasSection = hasSectionContent(ctx.sections, 'cost_approach', 80);
  if (hasSection) return [];

  return [{
    ruleId: 'CMP-011',
    severity: 'medium',
    category: 'compliance_signal',
    sectionIds: [],
    canonicalFieldIds: ['cost_approach'],
    message: 'Cost approach likely applicable but not found in draft.',
    detailMessage: 'Assignment flags suggest the cost approach is applicable (new construction, proposed, etc.), but no cost approach section was found.',
    suggestedAction: 'Add a cost approach section or explain why it was not developed.',
    evidence: { type: 'missing_field', expectedValue: 'cost approach section' },
  }];
}

/** @param {import('../types.js').QCRuleContext} ctx */
function checkIncomeApproachPresence(ctx) {
  if (!ctx.flags.income_approach_likely) return [];

  const hasSection = hasSectionContent(ctx.sections, 'income_approach', 80) ||
    hasSectionContent(ctx.sections, 'rental_analysis', 80);
  if (hasSection) return [];

  return [{
    ruleId: 'CMP-012',
    severity: 'medium',
    category: 'compliance_signal',
    sectionIds: [],
    canonicalFieldIds: ['income_approach'],
    message: 'Income approach likely applicable but not found in draft.',
    detailMessage: 'Assignment flags suggest the income approach is applicable (multi-unit, income-producing, etc.), but no income approach section was found.',
    suggestedAction: 'Add an income approach section or explain why it was not developed.',
    evidence: { type: 'missing_field', expectedValue: 'income approach section' },
  }];
}

/** @param {import('../types.js').QCRuleContext} ctx */
function checkSubjectToCompletionCommentary(ctx) {
  if (!ctx.flags.subject_to_completion) return [];

  const completionPattern = /\b(subject[\s-]to[\s-](?:the\s+)?completion|proposed\s+construction|plans?\s+and\s+spec)/i;
  const hasCommentary = hasSectionContent(ctx.sections, 'subject_to_completion_comment') ||
    anySectionMentions(ctx.sections, completionPattern);

  if (hasCommentary) return [];

  return [{
    ruleId: 'CMP-013',
    severity: 'high',
    category: 'compliance_signal',
    sectionIds: [],
    canonicalFieldIds: ['subject_to_completion_comment'],
    message: 'Subject-to-completion condition but no completion commentary found.',
    detailMessage: 'The assignment is subject to completion of construction, but no completion-specific commentary was found.',
    suggestedAction: 'Add commentary describing the proposed improvements and completion assumptions.',
    evidence: { type: 'missing_field', expectedValue: 'subject-to-completion commentary' },
  }];
}

// ── Register all rules ──────────────────────────────────────────────────────

registerRules(rules);

export { rules as complianceSignalRules };
export default rules;
