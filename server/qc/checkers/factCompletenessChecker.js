/**
 * server/qc/checkers/factCompletenessChecker.js
 * ------------------------------------------------
 * Phase 7 — Fact Completeness Checker
 *
 * Verifies that critical appraisal facts have been populated in the
 * assignment context before draft generation. Missing critical facts
 * result in excessive [INSERT] placeholders and low-quality output.
 *
 * Rules:
 *   FACT-001: Critical Subject Facts Missing (blocker)
 *   FACT-002: Critical Market/Comp Facts Missing (high)
 *   FACT-003: Assignment Context Incomplete (medium)
 */

import { registerRules } from '../qcRuleRegistry.js';

// Define critical fact paths for 1004 URAR form
const CRITICAL_SUBJECT_FACTS = [
  { path: 'subject.address', label: 'Subject Address' },
  { path: 'subject.city', label: 'Subject City' },
  { path: 'subject.gla', label: 'Gross Living Area (GLA)' },
  { path: 'subject.beds', label: 'Bedroom Count' },
  { path: 'subject.baths', label: 'Bathroom Count' },
  { path: 'subject.condition', label: 'UAD Condition Rating' },
  { path: 'subject.yearBuilt', label: 'Year Built' },
  { path: 'subject.siteSize', label: 'Site Size' },
];

const CRITICAL_MARKET_COMP_FACTS = [
  { path: 'market.trend', label: 'Market Trend' },
  { path: 'contract.contractPrice', label: 'Contract Price' },
  // At least one comp should have address + sale price
];

const ASSIGNMENT_CONTEXT_FACTS = [
  { path: 'assignment.intendedUse', label: 'Intended Use' },
  { path: 'assignment.intendedUser', label: 'Intended User' },
  { path: 'assignment.effectiveDate', label: 'Effective Date' },
  { path: 'subject.quality', label: 'UAD Quality Rating' },
  { path: 'subject.zoning', label: 'Zoning Classification' },
  { path: 'subject.style', label: 'Architectural Style' },
];

// Helper to resolve a dot-path from a nested object
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

function checkCriticalSubjectFacts(ctx) {
  const results = [];
  const context = ctx.assignmentContext || {};
  const facts = context.facts || context;

  const missing = [];
  for (const { path, label } of CRITICAL_SUBJECT_FACTS) {
    const value = resolvePath(facts, path);
    if (value == null || value === '' || value === 'null') {
      missing.push({ path, label });
    }
  }

  if (missing.length >= 3) {
    results.push({
      ruleId: 'FACT-001',
      severity: 'blocker',
      category: 'completeness',
      sectionIds: [],
      canonicalFieldIds: missing.map(m => m.path),
      message: `${missing.length} critical subject facts missing — draft quality will be severely impacted.`,
      detailMessage: `Missing: ${missing.map(m => m.label).join(', ')}. These facts are essential for generating accurate narrative sections. Without them, the draft will contain excessive [INSERT] placeholders.`,
      suggestedAction: 'Complete the subject property data entry before generating a draft.',
      evidence: {
        type: 'missing_field',
        missingPaths: missing.map(m => m.path),
        missingLabels: missing.map(m => m.label),
        totalRequired: CRITICAL_SUBJECT_FACTS.length,
        totalMissing: missing.length,
      },
    });
  } else if (missing.length > 0) {
    results.push({
      ruleId: 'FACT-001',
      severity: 'high',
      category: 'completeness',
      sectionIds: [],
      canonicalFieldIds: missing.map(m => m.path),
      message: `${missing.length} critical subject fact(s) missing.`,
      detailMessage: `Missing: ${missing.map(m => m.label).join(', ')}. Sections depending on these facts will use [INSERT] placeholders.`,
      suggestedAction: 'Fill in the missing subject data to improve draft quality.',
      evidence: {
        type: 'missing_field',
        missingPaths: missing.map(m => m.path),
        missingLabels: missing.map(m => m.label),
        totalRequired: CRITICAL_SUBJECT_FACTS.length,
        totalMissing: missing.length,
      },
    });
  }

  return results;
}

function checkMarketCompFacts(ctx) {
  const results = [];
  const context = ctx.assignmentContext || {};
  const facts = context.facts || context;

  const missing = [];
  for (const { path, label } of CRITICAL_MARKET_COMP_FACTS) {
    const value = resolvePath(facts, path);
    if (value == null || value === '' || value === 'null') {
      missing.push({ path, label });
    }
  }

  // Check if at least one comp has address + salePrice
  const comps = facts?.comps || [];
  let hasValidComp = false;
  for (const comp of (Array.isArray(comps) ? comps : [])) {
    const addr = resolvePath(comp, 'address');
    const price = resolvePath(comp, 'salePrice');
    if (addr && price) {
      hasValidComp = true;
      break;
    }
  }

  if (!hasValidComp) {
    missing.push({ path: 'comps[].address+salePrice', label: 'At least one comparable with address and sale price' });
  }

  if (missing.length > 0) {
    results.push({
      ruleId: 'FACT-002',
      severity: missing.length >= 3 ? 'high' : 'medium',
      category: 'completeness',
      sectionIds: ['sca_summary', 'sales_comparison_commentary', 'reconciliation', 'market_conditions'],
      canonicalFieldIds: missing.map(m => m.path),
      message: `${missing.length} market/comparable fact(s) missing.`,
      detailMessage: `Missing: ${missing.map(m => m.label).join(', ')}. Sales comparison and market condition sections require this data for accurate narratives.`,
      suggestedAction: 'Enter comparable sales data and market statistics before generating.',
      evidence: {
        type: 'missing_field',
        missingPaths: missing.map(m => m.path),
        missingLabels: missing.map(m => m.label),
      },
    });
  }

  return results;
}

function checkAssignmentContext(ctx) {
  const results = [];
  const context = ctx.assignmentContext || {};
  const facts = context.facts || context;

  const missing = [];
  for (const { path, label } of ASSIGNMENT_CONTEXT_FACTS) {
    const value = resolvePath(facts, path);
    if (value == null || value === '' || value === 'null') {
      missing.push({ path, label });
    }
  }

  if (missing.length >= 3) {
    results.push({
      ruleId: 'FACT-003',
      severity: 'medium',
      category: 'completeness',
      sectionIds: [],
      canonicalFieldIds: missing.map(m => m.path),
      message: `${missing.length} assignment context facts incomplete.`,
      detailMessage: `Missing: ${missing.map(m => m.label).join(', ')}. These facts improve narrative quality and USPAP compliance.`,
      suggestedAction: 'Fill in assignment context details for better draft quality.',
      evidence: {
        type: 'missing_field',
        missingPaths: missing.map(m => m.path),
        missingLabels: missing.map(m => m.label),
      },
    });
  }

  return results;
}

const rules = [
  {
    ruleId: 'FACT-001',
    displayName: 'Critical Subject Facts Missing',
    category: 'completeness',
    defaultSeverity: 'blocker',
    scope: 'assignment',
    applicableReportFamilies: [],
    applicableCanonicalFields: [],
    applicableFlags: [],
    requiredInputs: ['context'],
    ruleType: 'deterministic',
    sourceReference: null,
    active: true,
    description: 'Critical subject property facts (address, GLA, condition, etc.) are missing, resulting in excessive placeholders.',
    check: checkCriticalSubjectFacts,
  },
  {
    ruleId: 'FACT-002',
    displayName: 'Critical Market/Comp Facts Missing',
    category: 'completeness',
    defaultSeverity: 'high',
    scope: 'assignment',
    applicableReportFamilies: [],
    applicableCanonicalFields: [],
    applicableFlags: [],
    requiredInputs: ['context'],
    ruleType: 'deterministic',
    sourceReference: null,
    active: true,
    description: 'Market data or comparable sales facts are missing, impacting sales comparison and market sections.',
    check: checkMarketCompFacts,
  },
  {
    ruleId: 'FACT-003',
    displayName: 'Assignment Context Incomplete',
    category: 'completeness',
    defaultSeverity: 'medium',
    scope: 'assignment',
    applicableReportFamilies: [],
    applicableCanonicalFields: [],
    applicableFlags: [],
    requiredInputs: ['context'],
    ruleType: 'deterministic',
    sourceReference: null,
    active: true,
    description: 'Assignment context facts (intended use, quality rating, zoning) are incomplete.',
    check: checkAssignmentContext,
  },
];

registerRules(rules);

export { rules as factCompletenessRules };
export default rules;
