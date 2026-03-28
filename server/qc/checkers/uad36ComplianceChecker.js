/**
 * server/qc/checkers/uad36ComplianceChecker.js
 * ─────────────────────────────────────────────
 * Phase 7 — UAD 3.6 Compliance Checker
 *
 * Enforces UAD 3.6 mandatory requirements:
 *   - Condition ratings must be C1-C6
 *   - Quality ratings must be Q1-Q6
 *   - Market conditions must include structured data
 *   - Comparable adjustments must be quantified in dollars
 *   - GLA adjustments must show per-SF rate
 *   - Design/style must use UAD abbreviations
 *   - View ratings must be N/B/A
 *   - Age/effective age must be stated
 *   - Adjustment percentages within tolerance
 *
 * Rules:
 *   UAD-001: Condition rating must be C1-C6 (critical/blocker)
 *   UAD-002: Quality rating must be Q1-Q6 (critical/blocker)
 *   UAD-003: Market conditions must include appreciation rate (high)
 *   UAD-004: Comparable adjustments must be quantified (high)
 *   UAD-005: GLA adjustment must show per-SF rate (medium)
 *   UAD-006: Design/style must use UAD abbreviations (medium)
 *   UAD-007: View must use N/B/A classification (medium)
 *   UAD-008: Net adjustment should not exceed 15% (warning)
 *   UAD-009: Gross adjustment should not exceed 25% (warning)
 *   UAD-010: Effective age must be stated (high)
 */

import { registerRules } from '../qcRuleRegistry.js';

// Valid UAD values
const VALID_CONDITION_RATINGS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'];
const VALID_QUALITY_RATINGS = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'];
const VALID_VIEW_RATINGS = ['N', 'B', 'A'];
const VALID_LOCATION_RATINGS = ['Urban', 'Suburban', 'Rural'];
const VALID_DESIGN_ABBREVIATIONS = ['DT', 'AT', 'SD', 'RD', 'CP', 'MV', 'CC', 'TW'];

// Helper to resolve dot-path from nested object
function resolvePath(obj, path) {
  if (!obj) return null;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return null;
    current = current[part];
  }
  // Handle fact schema format: { value, confidence, source }
  if (current && typeof current === 'object' && 'value' in current) {
    return current.value;
  }
  return current;
}

// ─────────────────────────────────────────────────────────────────
// Rule Check Functions
// ─────────────────────────────────────────────────────────────────

function checkConditionRating(ctx) {
  const results = [];
  const context = ctx.assignmentContext || {};
  const facts = context.facts || context;

  const rating = resolvePath(facts, 'subject.conditionRating');
  if (!rating) {
    results.push({
      ruleId: 'UAD-001',
      severity: 'blocker',
      category: 'uad36_compliance',
      sectionIds: ['condition_description'],
      canonicalFieldIds: ['subject.conditionRating'],
      message: 'UAD 3.6: Subject condition rating (C1-C6) is required but missing.',
      detailMessage:
        'Condition rating must be one of: C1 (New), C2 (Like New), C3 (Well Maintained), ' +
        'C4 (Average), C5 (Fair), C6 (Poor). This is a mandatory UAD 3.6 requirement.',
      suggestedAction: 'Assign a UAD condition rating (C1-C6) in subject property data before generation.',
      evidence: {
        type: 'missing_uad_rating',
        ratingType: 'condition',
        validValues: VALID_CONDITION_RATINGS,
      },
    });
  } else if (!VALID_CONDITION_RATINGS.includes(String(rating).toUpperCase())) {
    results.push({
      ruleId: 'UAD-001',
      severity: 'blocker',
      category: 'uad36_compliance',
      sectionIds: ['condition_description'],
      canonicalFieldIds: ['subject.conditionRating'],
      message: `UAD 3.6: Condition rating '${rating}' is invalid. Must be C1-C6.`,
      detailMessage:
        `Invalid condition rating '${rating}'. Valid UAD ratings are: ${VALID_CONDITION_RATINGS.join(', ')}.`,
      suggestedAction: 'Correct the condition rating to one of the valid UAD values (C1-C6).',
      evidence: {
        type: 'invalid_uad_rating',
        ratingType: 'condition',
        receivedValue: rating,
        validValues: VALID_CONDITION_RATINGS,
      },
    });
  }

  return results;
}

function checkQualityRating(ctx) {
  const results = [];
  const context = ctx.assignmentContext || {};
  const facts = context.facts || context;

  const rating = resolvePath(facts, 'subject.qualityRating');
  if (!rating) {
    results.push({
      ruleId: 'UAD-002',
      severity: 'blocker',
      category: 'uad36_compliance',
      sectionIds: ['quality_rating_detail'],
      canonicalFieldIds: ['subject.qualityRating'],
      message: 'UAD 3.6: Subject quality rating (Q1-Q6) is required but missing.',
      detailMessage:
        'Quality rating must be one of: Q1 (Excellent), Q2 (Very Good), Q3 (Good), ' +
        'Q4 (Average), Q5 (Fair), Q6 (Poor). This is a mandatory UAD 3.6 requirement.',
      suggestedAction: 'Assign a UAD quality rating (Q1-Q6) in subject property data before generation.',
      evidence: {
        type: 'missing_uad_rating',
        ratingType: 'quality',
        validValues: VALID_QUALITY_RATINGS,
      },
    });
  } else if (!VALID_QUALITY_RATINGS.includes(String(rating).toUpperCase())) {
    results.push({
      ruleId: 'UAD-002',
      severity: 'blocker',
      category: 'uad36_compliance',
      sectionIds: ['quality_rating_detail'],
      canonicalFieldIds: ['subject.qualityRating'],
      message: `UAD 3.6: Quality rating '${rating}' is invalid. Must be Q1-Q6.`,
      detailMessage:
        `Invalid quality rating '${rating}'. Valid UAD ratings are: ${VALID_QUALITY_RATINGS.join(', ')}.`,
      suggestedAction: 'Correct the quality rating to one of the valid UAD values (Q1-Q6).',
      evidence: {
        type: 'invalid_uad_rating',
        ratingType: 'quality',
        receivedValue: rating,
        validValues: VALID_QUALITY_RATINGS,
      },
    });
  }

  return results;
}

function checkMarketConditions(ctx) {
  const results = [];
  const context = ctx.assignmentContext || {};
  const facts = context.facts || context;

  const appreciationRate = resolvePath(facts, 'market.appreciationRate');
  const medianDOM = resolvePath(facts, 'market.medianDOM');
  const listToSaleRatio = resolvePath(facts, 'market.listToSaleRatio');

  const missing = [];
  if (!appreciationRate) missing.push('appreciation rate (%)');
  if (!medianDOM) missing.push('median DOM (days)');
  if (!listToSaleRatio) missing.push('list-to-sale ratio');

  if (missing.length > 0) {
    results.push({
      ruleId: 'UAD-003',
      severity: 'high',
      category: 'uad36_compliance',
      sectionIds: ['market_conditions'],
      canonicalFieldIds: missing.map(m => `market.${m.split(' ')[0]}`),
      message: `UAD 3.6: Market conditions missing required structured data: ${missing.join(', ')}.`,
      detailMessage:
        'UAD 3.6 requires quantified market conditions: appreciation rate (%), median DOM, ' +
        'and list-to-sale ratio. These structured metrics are essential for compliance.',
      suggestedAction: 'Complete market conditions data entry with specific numeric values for all UAD metrics.',
      evidence: {
        type: 'missing_market_metric',
        missing,
        hasAppreciationRate: !!appreciationRate,
        hasMedianDOM: !!medianDOM,
        hasListToSaleRatio: !!listToSaleRatio,
      },
    });
  }

  return results;
}

function checkComparableAdjustments(ctx) {
  const results = [];
  const context = ctx.assignmentContext || {};
  const facts = context.facts || context;

  const comps = facts.comps || [];
  for (let i = 0; i < comps.length; i++) {
    const comp = comps[i];
    if (!comp || !comp.adjustments) continue;

    const adjustments = comp.adjustments;
    // Check if any adjustment categories lack quantified amounts
    const categories = ['location', 'gla', 'age', 'condition', 'quality', 'view'];
    const unquantified = [];

    for (const category of categories) {
      const adjValue = resolvePath(adjustments, category);
      // If category is stated but not quantified (not a number), flag it
      if (adjValue && isNaN(parseFloat(adjValue))) {
        unquantified.push(category);
      }
    }

    if (unquantified.length > 0) {
      results.push({
        ruleId: 'UAD-004',
        severity: 'high',
        category: 'uad36_compliance',
        sectionIds: ['sales_comparison_narrative'],
        canonicalFieldIds: [`comps.${i}.adjustments.${unquantified[0]}`],
        message: `UAD 3.6: Comparable ${i + 1} has non-quantified adjustments: ${unquantified.join(', ')}.`,
        detailMessage:
          `Adjustments for ${unquantified.join(', ')} must be stated as dollar amounts ($), ` +
          `not as text descriptions. UAD 3.6 requires all adjustments to be quantified.`,
        suggestedAction: `Enter dollar amounts for all adjustment categories in Comparable ${i + 1}.`,
        evidence: {
          type: 'unquantified_adjustment',
          compNumber: i + 1,
          unquantifiedCategories: unquantified,
        },
      });
    }
  }

  return results;
}

function checkGLAAdjustment(ctx) {
  const results = [];
  const context = ctx.assignmentContext || {};
  const facts = context.facts || context;

  const comps = facts.comps || [];
  for (let i = 0; i < comps.length; i++) {
    const comp = comps[i];
    if (!comp) continue;

    const adjustmentPerSF = resolvePath(comp, 'adjustmentPerSF');
    const glaAdjustment = resolvePath(comp, 'adjustments.gla');

    // If GLA adjustment exists but no per-SF rate, flag it
    if (glaAdjustment && !adjustmentPerSF) {
      results.push({
        ruleId: 'UAD-005',
        severity: 'medium',
        category: 'uad36_compliance',
        sectionIds: ['sales_comparison_narrative'],
        canonicalFieldIds: [`comps.${i}.adjustmentPerSF`],
        message: `UAD 3.6: Comparable ${i + 1} GLA adjustment missing per-SF rate.`,
        detailMessage:
          `GLA adjustment of $${glaAdjustment} requires a corresponding per-SF rate ` +
          `(e.g., $15/SF). This helps support the adjustment reasonableness.`,
        suggestedAction: `Calculate and enter per-SF adjustment rate for Comparable ${i + 1} GLA adjustment.`,
        evidence: {
          type: 'missing_per_sf_rate',
          compNumber: i + 1,
          glaAdjustmentAmount: glaAdjustment,
        },
      });
    }
  }

  return results;
}

function checkDesignStyle(ctx) {
  const results = [];
  const context = ctx.assignmentContext || {};
  const facts = context.facts || context;

  const designStyle = resolvePath(facts, 'subject.designStyle');
  if (designStyle && !VALID_DESIGN_ABBREVIATIONS.includes(String(designStyle).toUpperCase())) {
    results.push({
      ruleId: 'UAD-006',
      severity: 'medium',
      category: 'uad36_compliance',
      sectionIds: ['improvements_description'],
      canonicalFieldIds: ['subject.designStyle'],
      message: `UAD 3.6: Design/style '${designStyle}' is not a valid UAD abbreviation.`,
      detailMessage:
        `Valid UAD design abbreviations: ${VALID_DESIGN_ABBREVIATIONS.join(', ')}. ` +
        `Current value '${designStyle}' does not match UAD coding standards.`,
      suggestedAction: `Update design/style to a valid UAD abbreviation (e.g., DT=Detached, AT=Attached).`,
      evidence: {
        type: 'invalid_uad_abbreviation',
        fieldType: 'designStyle',
        receivedValue: designStyle,
        validValues: VALID_DESIGN_ABBREVIATIONS,
      },
    });
  }

  return results;
}

function checkViewRating(ctx) {
  const results = [];
  const context = ctx.assignmentContext || {};
  const facts = context.facts || context;

  const viewRating = resolvePath(facts, 'subject.viewRating');
  if (viewRating && !VALID_VIEW_RATINGS.includes(String(viewRating).toUpperCase())) {
    results.push({
      ruleId: 'UAD-007',
      severity: 'medium',
      category: 'uad36_compliance',
      sectionIds: ['improvements_description'],
      canonicalFieldIds: ['subject.viewRating'],
      message: `UAD 3.6: View rating '${viewRating}' is invalid. Must be N, B, or A.`,
      detailMessage:
        `Valid view ratings: N (Neutral), B (Beneficial), A (Adverse). ` +
        `Current value '${viewRating}' does not conform to UAD 3.6 classification.`,
      suggestedAction: `Update view rating to one of: ${VALID_VIEW_RATINGS.join(', ')}.`,
      evidence: {
        type: 'invalid_uad_rating',
        ratingType: 'view',
        receivedValue: viewRating,
        validValues: VALID_VIEW_RATINGS,
      },
    });
  }

  return results;
}

function checkAdjustmentPercentages(ctx) {
  const results = [];
  const context = ctx.assignmentContext || {};
  const facts = context.facts || context;

  const comps = facts.comps || [];
  for (let i = 0; i < comps.length; i++) {
    const comp = comps[i];
    if (!comp) continue;

    const salePrice = resolvePath(comp, 'salePrice');
    const netAdj = resolvePath(comp, 'netAdjustment');
    const grossAdj = resolvePath(comp, 'grossAdjustment');

    if (salePrice && netAdj) {
      const netPercent = (parseFloat(netAdj) / parseFloat(salePrice)) * 100;
      if (netPercent > 15) {
        results.push({
          ruleId: 'UAD-008',
          severity: 'warning',
          category: 'uad36_compliance',
          sectionIds: ['sales_comparison_narrative'],
          canonicalFieldIds: [`comps.${i}.netAdjustment`],
          message: `UAD 3.6: Comparable ${i + 1} net adjustment ${netPercent.toFixed(1)}% exceeds 15% threshold.`,
          detailMessage:
            `Net adjustments should typically not exceed 15% of the comparable's sale price. ` +
            `This comp's adjustments of $${netAdj} on $${salePrice} sale price (${netPercent.toFixed(1)}%) ` +
            `may indicate poor comp selection or excessive adjustments.`,
          suggestedAction: `Review comp selection and adjustment reasonableness for Comparable ${i + 1}.`,
          evidence: {
            type: 'excessive_adjustment',
            compNumber: i + 1,
            netAdjustmentDollars: netAdj,
            salePrice,
            netAdjustmentPercent: netPercent.toFixed(1),
            threshold: 15,
          },
        });
      }
    }

    if (salePrice && grossAdj) {
      const grossPercent = (parseFloat(grossAdj) / parseFloat(salePrice)) * 100;
      if (grossPercent > 25) {
        results.push({
          ruleId: 'UAD-009',
          severity: 'warning',
          category: 'uad36_compliance',
          sectionIds: ['sales_comparison_narrative'],
          canonicalFieldIds: [`comps.${i}.grossAdjustment`],
          message: `UAD 3.6: Comparable ${i + 1} gross adjustment ${grossPercent.toFixed(1)}% exceeds 25% threshold.`,
          detailMessage:
            `Gross adjustments should typically not exceed 25% of the comparable's sale price. ` +
            `This comp's total adjustments of $${grossAdj} on $${salePrice} sale price (${grossPercent.toFixed(1)}%) ` +
            `may suggest quality issues with the comparable.`,
          suggestedAction: `Review all adjustments and comp quality for Comparable ${i + 1}.`,
          evidence: {
            type: 'excessive_adjustment',
            compNumber: i + 1,
            grossAdjustmentDollars: grossAdj,
            salePrice,
            grossAdjustmentPercent: grossPercent.toFixed(1),
            threshold: 25,
          },
        });
      }
    }
  }

  return results;
}

function checkEffectiveAge(ctx) {
  const results = [];
  const context = ctx.assignmentContext || {};
  const facts = context.facts || context;

  const effectiveAge = resolvePath(facts, 'subject.effectiveAge');
  if (!effectiveAge) {
    results.push({
      ruleId: 'UAD-010',
      severity: 'high',
      category: 'uad36_compliance',
      sectionIds: ['improvements_description'],
      canonicalFieldIds: ['subject.effectiveAge'],
      message: 'UAD 3.6: Subject effective age is missing and must be stated.',
      detailMessage:
        'Effective age (as opposed to chronological age) must be explicitly stated in the appraisal. ' +
        'This is a required UAD 3.6 field that supports condition and quality conclusions.',
      suggestedAction: 'Determine and enter the subject property\'s effective age based on condition and updates.',
      evidence: {
        type: 'missing_required_field',
        fieldType: 'effectiveAge',
        comparisonField: 'subject.yearBuilt',
      },
    });
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────
// Register Rules
// ─────────────────────────────────────────────────────────────────

const uad36Rules = [
  {
    ruleId: 'UAD-001',
    ruleType: 'uad36_validation',
    category: 'uad36_compliance',
    title: 'Condition Rating C1-C6 Required',
    severity: 'blocker',
    active: true,
    applicableReportFamilies: ['uad36'],
    checkFn: checkConditionRating,
  },
  {
    ruleId: 'UAD-002',
    ruleType: 'uad36_validation',
    category: 'uad36_compliance',
    title: 'Quality Rating Q1-Q6 Required',
    severity: 'blocker',
    active: true,
    applicableReportFamilies: ['uad36'],
    checkFn: checkQualityRating,
  },
  {
    ruleId: 'UAD-003',
    ruleType: 'uad36_validation',
    category: 'uad36_compliance',
    title: 'Market Conditions Structured Data Required',
    severity: 'high',
    active: true,
    applicableReportFamilies: ['uad36'],
    checkFn: checkMarketConditions,
  },
  {
    ruleId: 'UAD-004',
    ruleType: 'uad36_validation',
    category: 'uad36_compliance',
    title: 'Comparable Adjustments Must Be Quantified',
    severity: 'high',
    active: true,
    applicableReportFamilies: ['uad36'],
    checkFn: checkComparableAdjustments,
  },
  {
    ruleId: 'UAD-005',
    ruleType: 'uad36_validation',
    category: 'uad36_compliance',
    title: 'GLA Adjustment Per-SF Rate Required',
    severity: 'medium',
    active: true,
    applicableReportFamilies: ['uad36'],
    checkFn: checkGLAAdjustment,
  },
  {
    ruleId: 'UAD-006',
    ruleType: 'uad36_validation',
    category: 'uad36_compliance',
    title: 'Design/Style Must Use UAD Abbreviations',
    severity: 'medium',
    active: true,
    applicableReportFamilies: ['uad36'],
    checkFn: checkDesignStyle,
  },
  {
    ruleId: 'UAD-007',
    ruleType: 'uad36_validation',
    category: 'uad36_compliance',
    title: 'View Rating N/B/A Classification Required',
    severity: 'medium',
    active: true,
    applicableReportFamilies: ['uad36'],
    checkFn: checkViewRating,
  },
  {
    ruleId: 'UAD-008',
    ruleType: 'uad36_validation',
    category: 'uad36_compliance',
    title: 'Net Adjustment Percentage Threshold Check',
    severity: 'warning',
    active: true,
    applicableReportFamilies: ['uad36'],
    checkFn: checkAdjustmentPercentages,
  },
  {
    ruleId: 'UAD-009',
    ruleType: 'uad36_validation',
    category: 'uad36_compliance',
    title: 'Gross Adjustment Percentage Threshold Check',
    severity: 'warning',
    active: true,
    applicableReportFamilies: ['uad36'],
    checkFn: checkAdjustmentPercentages,
  },
  {
    ruleId: 'UAD-010',
    ruleType: 'uad36_validation',
    category: 'uad36_compliance',
    title: 'Effective Age Must Be Stated',
    severity: 'high',
    active: true,
    applicableReportFamilies: ['uad36'],
    checkFn: checkEffectiveAge,
  },
];

// Register all UAD 3.6 rules
registerRules(uad36Rules);
