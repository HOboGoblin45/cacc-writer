/**
 * server/qc/checkers/comparableIntelligenceChecker.js
 * ---------------------------------------------------
 * Comparable Intelligence QC bridge:
 * surfaces comparable contradiction flags and burden risks as QC findings.
 */

import { buildComparableIntelligence } from '../../comparableIntelligence/comparableIntelligenceService.js';
import { registerRules } from '../qcRuleRegistry.js';

const rules = [
  {
    ruleId: 'CMP-001',
    displayName: 'Comparable Contradictions',
    category: 'consistency',
    defaultSeverity: 'high',
    scope: 'assignment',
    applicableReportFamilies: [],
    applicableCanonicalFields: ['sales_comparison'],
    applicableFlags: [],
    requiredInputs: ['context'],
    ruleType: 'heuristic',
    sourceReference: null,
    active: true,
    description: 'Accepted comparables contain contradiction flags or unsupported burden levels.',
    check: checkComparableContradictions,
  },
];

/** @param {import('../types.js').QCRuleContext} ctx */
function checkComparableContradictions(ctx) {
  const intelligence = buildComparableIntelligence(ctx.caseId);
  const contradictions = intelligence?.contradictions || [];
  if (!contradictions.length) return [];

  return contradictions.map((flag) => ({
    ruleId: 'CMP-001',
    severity: flag.severity === 'high' ? 'high' : 'medium',
    category: 'consistency',
    sectionIds: ['sales_comparison', 'reconciliation'],
    canonicalFieldIds: ['sales_comp_grid'],
    message: flag.message,
    detailMessage: `Comparable contradiction flag ${flag.code} was raised for ${flag.gridSlot || 'an accepted comparable'} in the sales comparison workspace.`,
    suggestedAction: 'Review the accepted comparable, confirm source support, and resolve the adjustment or data mismatch before final reconciliation.',
    evidence: {
      type: 'value_conflict',
      expectedValue: flag.expectedValue,
      actualValue: flag.actualValue,
    },
  }));
}

registerRules(rules);

export default { rules };
