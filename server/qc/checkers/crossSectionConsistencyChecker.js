/**
 * server/qc/checkers/crossSectionConsistencyChecker.js
 * -------------------------------------------------------
 * Phase 7 — Cross-Section Consistency Engine
 *
 * Checks whether different parts of the report are materially aligned.
 * Uses normalized assignment context, canonical field outputs, and
 * section text to detect contradictions and inconsistencies.
 *
 * All checks are deterministic or pattern-based — no LLM involvement.
 *
 * Categories of consistency checks:
 *   - Zoning references across sections
 *   - Flood zone references across sections
 *   - Property type / use references
 *   - Condition / quality references
 *   - Subject-to / value condition references
 *   - Approach applicability vs reconciliation
 *   - Contract / sale references
 *   - Unit count / occupancy references
 *   - ADU / mixed-use references
 */

import { registerRules } from '../qcRuleRegistry.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract all section texts into a flat array of { sectionId, text } for scanning.
 * @param {Object<string, { text: string }>} sections
 * @returns {{ sectionId: string, text: string, textLower: string }[]}
 */
function flattenSections(sections) {
  const result = [];
  for (const [sectionId, sec] of Object.entries(sections)) {
    if (sec && sec.text && sec.text.trim().length > 0) {
      result.push({
        sectionId,
        text: sec.text.trim(),
        textLower: sec.text.trim().toLowerCase(),
      });
    }
  }
  return result;
}

/**
 * Find sections that mention a term (case-insensitive).
 * @param {{ sectionId: string, textLower: string }[]} flatSections
 * @param {RegExp} pattern
 * @returns {string[]} sectionIds that match
 */
function findSectionsMentioning(flatSections, pattern) {
  return flatSections
    .filter(s => pattern.test(s.textLower))
    .map(s => s.sectionId);
}

/**
 * Check if a value from the assignment context is contradicted in section text.
 * @param {string} textLower
 * @param {string} expectedValue
 * @param {string[]} contradictoryPatterns
 * @returns {boolean}
 */
function hasContradiction(textLower, expectedValue, contradictoryPatterns) {
  if (!expectedValue) return false;
  for (const pattern of contradictoryPatterns) {
    if (textLower.includes(pattern.toLowerCase())) return true;
  }
  return false;
}

// ── Rule definitions ────────────────────────────────────────────────────────

const rules = [
  {
    ruleId: 'CON-001',
    displayName: 'Flood Zone Inconsistency',
    category: 'consistency',
    defaultSeverity: 'high',
    scope: 'cross_section',
    applicableReportFamilies: [],
    applicableCanonicalFields: [],
    applicableFlags: [],
    requiredInputs: ['sections', 'context'],
    ruleType: 'pattern',
    sourceReference: null,
    active: true,
    description: 'Flood zone references are inconsistent across sections or contradict assignment context.',
    check: checkFloodZoneConsistency,
  },
  {
    ruleId: 'CON-002',
    displayName: 'Zoning Inconsistency',
    category: 'consistency',
    defaultSeverity: 'high',
    scope: 'cross_section',
    applicableReportFamilies: [],
    applicableCanonicalFields: [],
    applicableFlags: [],
    requiredInputs: ['sections', 'context', 'flags'],
    ruleType: 'pattern',
    sourceReference: null,
    active: true,
    description: 'Zoning conformity references are inconsistent across sections or contradict assignment context.',
    check: checkZoningConsistency,
  },
  {
    ruleId: 'CON-003',
    displayName: 'Subject-To Condition Inconsistency',
    category: 'consistency',
    defaultSeverity: 'high',
    scope: 'cross_section',
    applicableReportFamilies: [],
    applicableCanonicalFields: [],
    applicableFlags: ['subject_to_any'],
    requiredInputs: ['sections', 'flags'],
    ruleType: 'pattern',
    sourceReference: null,
    active: true,
    description: 'Subject-to condition mentioned in some sections but omitted where expected.',
    check: checkSubjectToConsistency,
  },
  {
    ruleId: 'CON-004',
    displayName: 'Property Type Mismatch',
    category: 'consistency',
    defaultSeverity: 'high',
    scope: 'cross_section',
    applicableReportFamilies: [],
    applicableCanonicalFields: [],
    applicableFlags: [],
    requiredInputs: ['sections', 'context'],
    ruleType: 'pattern',
    sourceReference: null,
    active: true,
    description: 'Property type references are inconsistent across sections.',
    check: checkPropertyTypeMismatch,
  },
  {
    ruleId: 'CON-005',
    displayName: 'Approach Applicability vs Reconciliation',
    category: 'reconciliation',
    defaultSeverity: 'high',
    scope: 'cross_section',
    applicableReportFamilies: [],
    applicableCanonicalFields: ['reconciliation'],
    applicableFlags: [],
    requiredInputs: ['sections', 'flags'],
    ruleType: 'pattern',
    sourceReference: null,
    active: true,
    description: 'Reconciliation language is inconsistent with which approaches were actually developed.',
    check: checkApproachReconciliation,
  },
  {
    ruleId: 'CON-006',
    displayName: 'ADU Reference Inconsistency',
    category: 'consistency',
    defaultSeverity: 'medium',
    scope: 'cross_section',
    applicableReportFamilies: [],
    applicableCanonicalFields: [],
    applicableFlags: ['adu_present'],
    requiredInputs: ['sections', 'flags'],
    ruleType: 'pattern',
    sourceReference: null,
    active: true,
    description: 'ADU is flagged but not consistently referenced across relevant sections.',
    check: checkAduConsistency,
  },
  {
    ruleId: 'CON-007',
    displayName: 'Mixed-Use Reference Inconsistency',
    category: 'consistency',
    defaultSeverity: 'medium',
    scope: 'cross_section',
    applicableReportFamilies: [],
    applicableCanonicalFields: [],
    applicableFlags: ['mixed_use'],
    requiredInputs: ['sections', 'flags'],
    ruleType: 'pattern',
    sourceReference: null,
    active: true,
    description: 'Mixed-use is flagged but not consistently referenced across relevant sections.',
    check: checkMixedUseConsistency,
  },
  {
    ruleId: 'CON-008',
    displayName: 'Contract Reference Inconsistency',
    category: 'consistency',
    defaultSeverity: 'medium',
    scope: 'cross_section',
    applicableReportFamilies: [],
    applicableCanonicalFields: [],
    applicableFlags: [],
    requiredInputs: ['sections', 'context'],
    ruleType: 'pattern',
    sourceReference: null,
    active: true,
    description: 'Contract/sale price references are inconsistent with assignment facts.',
    check: checkContractConsistency,
  },
  {
    ruleId: 'CON-009',
    displayName: 'Occupancy / Unit Count Inconsistency',
    category: 'consistency',
    defaultSeverity: 'medium',
    scope: 'cross_section',
    applicableReportFamilies: [],
    applicableCanonicalFields: [],
    applicableFlags: [],
    requiredInputs: ['sections', 'context'],
    ruleType: 'pattern',
    sourceReference: null,
    active: true,
    description: 'Occupancy type or unit count references are inconsistent across sections.',
    check: checkOccupancyConsistency,
  },
  {
    ruleId: 'CON-010',
    displayName: 'Condition/Quality Rating Inconsistency',
    category: 'consistency',
    defaultSeverity: 'medium',
    scope: 'cross_section',
    applicableReportFamilies: [],
    applicableCanonicalFields: [],
    applicableFlags: [],
    requiredInputs: ['sections'],
    ruleType: 'pattern',
    sourceReference: null,
    active: true,
    description: 'Condition or quality rating language is contradictory across sections.',
    check: checkConditionQualityConsistency,
  },
];

// ── Check implementations ───────────────────────────────────────────────────

/** @param {import('../types.js').QCRuleContext} ctx */
function checkFloodZoneConsistency(ctx) {
  const results = [];
  const flat = flattenSections(ctx.sections);
  const assignmentCtx = ctx.assignmentContext || {};
  const site = assignmentCtx.site || {};
  const contextFloodZone = (site.floodZone || '').trim();

  if (!contextFloodZone) return results;

  const floodPattern = /flood\s*zone\s*[a-z0-9]+/gi;

  // Collect all flood zone mentions across sections
  const mentions = [];
  for (const sec of flat) {
    const matches = sec.text.match(floodPattern);
    if (matches) {
      for (const m of matches) {
        mentions.push({ sectionId: sec.sectionId, mention: m.trim() });
      }
    }
  }

  if (mentions.length < 2) return results;

  // Normalize mentions and check for conflicts
  const normalized = mentions.map(m => ({
    ...m,
    zone: m.mention.replace(/flood\s*zone\s*/i, '').trim().toUpperCase(),
  }));

  const uniqueZones = new Set(normalized.map(m => m.zone));
  if (uniqueZones.size > 1) {
    const conflictingSections = [...new Set(normalized.map(m => m.sectionId))];
    results.push({
      ruleId: 'CON-001',
      severity: 'high',
      category: 'consistency',
      sectionIds: conflictingSections,
      canonicalFieldIds: [],
      message: `Flood zone referenced inconsistently: ${[...uniqueZones].join(' vs ')}.`,
      detailMessage: `Multiple flood zone designations found across sections: ${normalized.map(m => `"${m.mention}" in ${m.sectionId}`).join('; ')}. Assignment context says: "${contextFloodZone}".`,
      suggestedAction: 'Verify the correct flood zone designation and ensure all sections reference it consistently.',
      evidence: {
        type: 'value_conflict',
        expectedValue: contextFloodZone,
        actualValue: [...uniqueZones].join(', '),
        conflictingSections,
      },
    });
  }

  return results;
}

/** @param {import('../types.js').QCRuleContext} ctx */
function checkZoningConsistency(ctx) {
  const results = [];
  const flat = flattenSections(ctx.sections);
  const flags = ctx.flags || {};

  // Check if nonconforming zoning is flagged but sections say "conforming"
  if (flags.nonconforming_zoning) {
    const conformingPattern = /(?:legally?\s+)?conforming(?!\s*non)/i;
    const nonconformingPattern = /non[\s-]?conforming|legal(?:ly)?\s+non[\s-]?conforming/i;

    for (const sec of flat) {
      const saysConforming = conformingPattern.test(sec.text);
      const saysNonconforming = nonconformingPattern.test(sec.text);

      if (saysConforming && !saysNonconforming) {
        results.push({
          ruleId: 'CON-002',
          severity: 'high',
          category: 'consistency',
          sectionIds: [sec.sectionId],
          canonicalFieldIds: [],
          message: `Section "${sec.sectionId}" says conforming, but assignment flags indicate nonconforming zoning.`,
          detailMessage: `The assignment context indicates nonconforming zoning, but the section text appears to describe the zoning as conforming without acknowledging the nonconformity.`,
          suggestedAction: 'Review zoning language and ensure it accurately reflects the nonconforming status.',
          evidence: {
            type: 'value_conflict',
            expectedValue: 'nonconforming',
            actualValue: 'conforming',
            conflictingSections: [sec.sectionId],
          },
        });
      }
    }
  }

  return results;
}

/** @param {import('../types.js').QCRuleContext} ctx */
function checkSubjectToConsistency(ctx) {
  const results = [];
  const flat = flattenSections(ctx.sections);
  const flags = ctx.flags || {};

  if (!flags.subject_to_any) return results;

  const subjectToPattern = /subject[\s-]to\s+(repairs|completion|inspection|alterations)/i;

  // Sections where subject-to should be mentioned
  const expectedSections = ['reconciliation', 'improvements_condition', 'certification_addendum_comment'];
  const mentioningSections = findSectionsMentioning(flat, subjectToPattern);

  for (const expected of expectedSections) {
    const section = ctx.sections[expected];
    if (section && section.text && section.text.trim().length > 0) {
      if (!mentioningSections.includes(expected)) {
        results.push({
          ruleId: 'CON-003',
          severity: 'high',
          category: 'consistency',
          sectionIds: [expected],
          canonicalFieldIds: [expected],
          message: `Subject-to condition not mentioned in "${expected}" section.`,
          detailMessage: `The assignment is flagged as subject-to (repairs/completion/inspection), but the "${expected}" section does not reference this condition. This is a common review flag.`,
          suggestedAction: `Add subject-to language to the "${expected}" section.`,
          evidence: {
            type: 'missing_field',
            expectedValue: 'subject-to reference',
            actualValue: null,
            conflictingSections: [expected],
          },
        });
      }
    }
  }

  return results;
}

/** @param {import('../types.js').QCRuleContext} ctx */
function checkPropertyTypeMismatch(ctx) {
  const results = [];
  const flat = flattenSections(ctx.sections);
  const assignmentCtx = ctx.assignmentContext || {};
  const propertyType = (assignmentCtx.propertyType || '').toLowerCase();

  if (!propertyType) return results;

  // Define contradictory patterns for common property types
  const contradictions = {
    'single_family': [/\b(condo(?:minium)?|townhouse|multi[\s-]?family|duplex|triplex|fourplex|manufactured)\b/i],
    'condo': [/\bsingle[\s-]?family\b(?!\s*(?:style|design|appearance))/i],
    'multi_unit': [/\bsingle[\s-]?family\b(?!\s*(?:style|design|appearance))/i],
    'manufactured': [/\bsite[\s-]?built\b/i],
  };

  const patterns = contradictions[propertyType];
  if (!patterns) return results;

  for (const sec of flat) {
    for (const pattern of patterns) {
      const match = sec.text.match(pattern);
      if (match) {
        results.push({
          ruleId: 'CON-004',
          severity: 'high',
          category: 'consistency',
          sectionIds: [sec.sectionId],
          canonicalFieldIds: [],
          message: `Property type mismatch in "${sec.sectionId}": found "${match[0]}" but assignment says "${propertyType}".`,
          detailMessage: `The assignment context identifies the property as "${propertyType}", but section "${sec.sectionId}" contains language suggesting a different property type: "${match[0]}".`,
          suggestedAction: 'Verify the property type and correct the section language.',
          evidence: {
            type: 'value_conflict',
            expectedValue: propertyType,
            actualValue: match[0],
            conflictingSections: [sec.sectionId],
            excerpt: sec.text.substring(Math.max(0, match.index - 50), match.index + match[0].length + 50),
          },
        });
      }
    }
  }

  return results;
}

/** @param {import('../types.js').QCRuleContext} ctx */
function checkApproachReconciliation(ctx) {
  const results = [];
  const flags = ctx.flags || {};
  const reconSection = ctx.sections['reconciliation'];

  if (!reconSection || !reconSection.text) return results;

  const reconLower = reconSection.text.toLowerCase();

  // Check: if sales approach was required, reconciliation should mention it
  if (flags.sales_approach_required) {
    const salesMentioned = /sales\s+comparison|market\s+approach|comparable\s+sales/i.test(reconSection.text);
    if (!salesMentioned) {
      results.push({
        ruleId: 'CON-005',
        severity: 'high',
        category: 'reconciliation',
        sectionIds: ['reconciliation'],
        canonicalFieldIds: ['reconciliation'],
        message: 'Reconciliation does not mention the Sales Comparison Approach.',
        detailMessage: 'The Sales Comparison Approach was developed for this assignment, but the reconciliation section does not reference it. The reconciliation must address all developed approaches.',
        suggestedAction: 'Add Sales Comparison Approach discussion to the reconciliation.',
        evidence: { type: 'missing_field', expectedValue: 'sales comparison reference' },
      });
    }
  }

  // Check: if cost approach was developed, reconciliation should mention it
  if (flags.cost_approach_likely) {
    const hasCostSection = ctx.sections['cost_approach'] && ctx.sections['cost_approach'].text;
    const costMentioned = /cost\s+approach/i.test(reconSection.text);
    if (hasCostSection && !costMentioned) {
      results.push({
        ruleId: 'CON-005',
        severity: 'high',
        category: 'reconciliation',
        sectionIds: ['reconciliation'],
        canonicalFieldIds: ['reconciliation'],
        message: 'Reconciliation does not mention the Cost Approach, which was developed.',
        detailMessage: 'A Cost Approach section exists in the draft, but the reconciliation does not reference it.',
        suggestedAction: 'Add Cost Approach discussion to the reconciliation.',
        evidence: { type: 'missing_field', expectedValue: 'cost approach reference' },
      });
    }
  }

  // Check: if income approach was developed, reconciliation should mention it
  if (flags.income_approach_likely) {
    const hasIncomeSection = ctx.sections['income_approach'] && ctx.sections['income_approach'].text;
    const incomeMentioned = /income\s+(?:capitalization\s+)?approach/i.test(reconSection.text);
    if (hasIncomeSection && !incomeMentioned) {
      results.push({
        ruleId: 'CON-005',
        severity: 'high',
        category: 'reconciliation',
        sectionIds: ['reconciliation'],
        canonicalFieldIds: ['reconciliation'],
        message: 'Reconciliation does not mention the Income Approach, which was developed.',
        detailMessage: 'An Income Approach section exists in the draft, but the reconciliation does not reference it.',
        suggestedAction: 'Add Income Approach discussion to the reconciliation.',
        evidence: { type: 'missing_field', expectedValue: 'income approach reference' },
      });
    }
  }

  return results;
}

/** @param {import('../types.js').QCRuleContext} ctx */
function checkAduConsistency(ctx) {
  const results = [];
  const flat = flattenSections(ctx.sections);
  const flags = ctx.flags || {};

  if (!flags.adu_present) return results;

  const aduPattern = /\b(adu|accessory\s+dwelling\s+unit|guest\s+house|granny\s+flat|in[\s-]?law\s+(?:suite|unit|quarters))\b/i;

  // ADU should be mentioned in improvements and site at minimum
  const expectedSections = ['improvements_condition', 'site_comments', 'sca_summary'];

  for (const expected of expectedSections) {
    const section = ctx.sections[expected];
    if (section && section.text && section.text.trim().length > 0) {
      if (!aduPattern.test(section.text)) {
        results.push({
          ruleId: 'CON-006',
          severity: 'medium',
          category: 'consistency',
          sectionIds: [expected],
          canonicalFieldIds: [],
          message: `ADU not mentioned in "${expected}" section.`,
          detailMessage: `The assignment flags indicate an ADU is present, but the "${expected}" section does not reference it. ADU presence typically requires acknowledgment in improvements, site, and sales comparison sections.`,
          suggestedAction: `Add ADU reference to the "${expected}" section.`,
          evidence: {
            type: 'missing_field',
            expectedValue: 'ADU reference',
            actualValue: null,
          },
        });
      }
    }
  }

  return results;
}

/** @param {import('../types.js').QCRuleContext} ctx */
function checkMixedUseConsistency(ctx) {
  const results = [];
  const flat = flattenSections(ctx.sections);
  const flags = ctx.flags || {};

  if (!flags.mixed_use) return results;

  const mixedUsePattern = /\b(mixed[\s-]?use|commercial\s+(?:and|&)\s+residential|residential\s+(?:and|&)\s+commercial)\b/i;

  const expectedSections = ['improvements_condition', 'site_comments', 'reconciliation'];

  for (const expected of expectedSections) {
    const section = ctx.sections[expected];
    if (section && section.text && section.text.trim().length > 0) {
      if (!mixedUsePattern.test(section.text)) {
        results.push({
          ruleId: 'CON-007',
          severity: 'medium',
          category: 'consistency',
          sectionIds: [expected],
          canonicalFieldIds: [],
          message: `Mixed-use not mentioned in "${expected}" section.`,
          detailMessage: `The assignment flags indicate a mixed-use property, but the "${expected}" section does not reference the mixed-use nature.`,
          suggestedAction: `Add mixed-use reference to the "${expected}" section.`,
          evidence: {
            type: 'missing_field',
            expectedValue: 'mixed-use reference',
            actualValue: null,
          },
        });
      }
    }
  }

  return results;
}

/** @param {import('../types.js').QCRuleContext} ctx */
function checkContractConsistency(ctx) {
  const results = [];
  const flat = flattenSections(ctx.sections);
  const assignmentCtx = ctx.assignmentContext || {};
  const contract = assignmentCtx.contract || {};
  const salePrice = contract.salePrice || contract.contractPrice;

  if (!salePrice) return results;

  const priceStr = String(salePrice).replace(/[,$]/g, '');
  const priceNum = parseFloat(priceStr);
  if (isNaN(priceNum) || priceNum <= 0) return results;

  // Look for price mentions in sections
  const pricePattern = new RegExp(`\\$?${priceStr.replace(/\B(?=(\d{3})+(?!\d))/g, '[,]?')}`, 'g');

  // Also check for significantly different prices
  const priceMentions = [];
  const dollarPattern = /\$[\d,]+(?:\.\d{2})?/g;

  for (const sec of flat) {
    const matches = sec.text.match(dollarPattern);
    if (matches) {
      for (const m of matches) {
        const val = parseFloat(m.replace(/[$,]/g, ''));
        // Only flag large values that could be sale prices (> $50k)
        if (val > 50000 && Math.abs(val - priceNum) > 1 && val !== priceNum) {
          // Check if this is close enough to be a typo of the sale price
          const diff = Math.abs(val - priceNum) / priceNum;
          if (diff < 0.15 && diff > 0.001) {
            priceMentions.push({ sectionId: sec.sectionId, value: m, numericValue: val });
          }
        }
      }
    }
  }

  if (priceMentions.length > 0) {
    const conflictingSections = [...new Set(priceMentions.map(m => m.sectionId))];
    results.push({
      ruleId: 'CON-008',
      severity: 'medium',
      category: 'consistency',
      sectionIds: conflictingSections,
      canonicalFieldIds: ['contract_analysis'],
      message: `Possible sale price inconsistency: contract says $${priceNum.toLocaleString()}, but different values found.`,
      detailMessage: `The assignment context lists a sale price of $${priceNum.toLocaleString()}, but the following sections contain similar but different dollar amounts: ${priceMentions.map(m => `${m.value} in ${m.sectionId}`).join('; ')}. These may be typos or references to different values.`,
      suggestedAction: 'Verify all dollar amounts referencing the sale price are correct.',
      evidence: {
        type: 'value_conflict',
        expectedValue: `$${priceNum.toLocaleString()}`,
        actualValue: priceMentions.map(m => m.value).join(', '),
        conflictingSections,
      },
    });
  }

  return results;
}

/** @param {import('../types.js').QCRuleContext} ctx */
function checkOccupancyConsistency(ctx) {
  const results = [];
  const flat = flattenSections(ctx.sections);
  const assignmentCtx = ctx.assignmentContext || {};
  const occupancyType = (assignmentCtx.occupancyType || '').toLowerCase();
  const unitCount = assignmentCtx.unitCount || 1;

  // Check occupancy type contradictions
  if (occupancyType === 'owner_occupied' || occupancyType === 'owner occupied') {
    const investmentPattern = /\b(investment\s+property|tenant[\s-]?occupied|rental\s+property|non[\s-]?owner[\s-]?occupied)\b/i;
    for (const sec of flat) {
      if (investmentPattern.test(sec.text)) {
        results.push({
          ruleId: 'CON-009',
          severity: 'medium',
          category: 'consistency',
          sectionIds: [sec.sectionId],
          canonicalFieldIds: [],
          message: `Section "${sec.sectionId}" suggests investment/rental, but assignment says owner-occupied.`,
          detailMessage: `The assignment context indicates owner-occupied, but section text contains language suggesting investment or tenant-occupied use.`,
          suggestedAction: 'Verify occupancy type and correct section language.',
          evidence: {
            type: 'value_conflict',
            expectedValue: 'owner-occupied',
            actualValue: 'investment/rental language found',
            conflictingSections: [sec.sectionId],
          },
        });
      }
    }
  }

  return results;
}

/** @param {import('../types.js').QCRuleContext} ctx */
function checkConditionQualityConsistency(ctx) {
  const results = [];
  const flat = flattenSections(ctx.sections);

  // Condition rating patterns (C1-C6 scale)
  const conditionPattern = /\b[Cc]([1-6])\b/g;
  const qualityPattern = /\b[Qq]([1-6])\b/g;

  // Collect all condition ratings across sections
  const conditionRatings = {};
  const qualityRatings = {};

  for (const sec of flat) {
    const condMatches = [...sec.text.matchAll(conditionPattern)];
    for (const m of condMatches) {
      if (!conditionRatings[sec.sectionId]) conditionRatings[sec.sectionId] = [];
      conditionRatings[sec.sectionId].push(m[1]);
    }

    const qualMatches = [...sec.text.matchAll(qualityPattern)];
    for (const m of qualMatches) {
      if (!qualityRatings[sec.sectionId]) qualityRatings[sec.sectionId] = [];
      qualityRatings[sec.sectionId].push(m[1]);
    }
  }

  // Check for conflicting condition ratings across sections
  const allConditions = new Set();
  for (const ratings of Object.values(conditionRatings)) {
    for (const r of ratings) allConditions.add(r);
  }

  if (allConditions.size > 1) {
    const conflictingSections = Object.keys(conditionRatings);
    results.push({
      ruleId: 'CON-010',
      severity: 'medium',
      category: 'consistency',
      sectionIds: conflictingSections,
      canonicalFieldIds: ['improvements_condition'],
      message: `Conflicting condition ratings found: C${[...allConditions].join(', C')}.`,
      detailMessage: `Multiple condition ratings detected across sections: ${Object.entries(conditionRatings).map(([s, r]) => `${s}: C${r.join(', C')}`).join('; ')}. The subject should have one consistent condition rating.`,
      suggestedAction: 'Ensure all sections reference the same condition rating for the subject.',
      evidence: {
        type: 'value_conflict',
        expectedValue: 'single consistent rating',
        actualValue: `C${[...allConditions].join(', C')}`,
        conflictingSections,
      },
    });
  }

  // Same for quality ratings
  const allQualities = new Set();
  for (const ratings of Object.values(qualityRatings)) {
    for (const r of ratings) allQualities.add(r);
  }

  if (allQualities.size > 1) {
    const conflictingSections = Object.keys(qualityRatings);
    results.push({
      ruleId: 'CON-010',
      severity: 'medium',
      category: 'consistency',
      sectionIds: conflictingSections,
      canonicalFieldIds: ['improvements_condition'],
      message: `Conflicting quality ratings found: Q${[...allQualities].join(', Q')}.`,
      detailMessage: `Multiple quality ratings detected across sections: ${Object.entries(qualityRatings).map(([s, r]) => `${s}: Q${r.join(', Q')}`).join('; ')}. The subject should have one consistent quality rating.`,
      suggestedAction: 'Ensure all sections reference the same quality rating for the subject.',
      evidence: {
        type: 'value_conflict',
        expectedValue: 'single consistent rating',
        actualValue: `Q${[...allQualities].join(', Q')}`,
        conflictingSections,
      },
    });
  }

  return results;
}

// ── Register all rules ──────────────────────────────────────────────────────

registerRules(rules);

export { rules as crossSectionConsistencyRules };
export default rules;
