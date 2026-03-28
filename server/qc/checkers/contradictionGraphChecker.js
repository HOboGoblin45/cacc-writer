/**
 * server/qc/checkers/contradictionGraphChecker.js
 * -----------------------------------------------
 * QC bridge for the unified contradiction graph.
 *
 * Comparable-specific contradictions continue to flow through CMP-001.
 * This rule covers deterministic case/workspace contradictions so QC,
 * workspace review, and gating all reference the same model.
 */

import { buildContradictionGraph } from '../../contradictionGraph/contradictionGraphService.js';
import { registerRules } from '../qcRuleRegistry.js';

const rules = [
  {
    ruleId: 'CTG-001',
    displayName: 'Case Contradiction Graph',
    category: 'consistency',
    defaultSeverity: 'high',
    scope: 'assignment',
    applicableReportFamilies: [],
    applicableCanonicalFields: [],
    applicableFlags: [],
    requiredInputs: ['context'],
    ruleType: 'heuristic',
    sourceReference: null,
    active: true,
    description: 'Deterministic contradiction graph flags case-level and cross-section inconsistencies.',
    check: checkContradictionGraph,
  },
];

/** @param {import('../types.js').QCRuleContext} ctx */
function checkContradictionGraph(ctx) {
  const graph = buildContradictionGraph(ctx.caseId);
  const items = (graph?.items || []).filter((item) => item.source !== 'comparable_intelligence');
  if (!items.length) return [];

  return items.map((item) => ({
    ruleId: 'CTG-001',
    severity: item.severity === 'blocker' ? 'high' : (item.severity || 'medium'),
    category: 'consistency',
    sectionIds: item.sectionIds || [],
    canonicalFieldIds: item.canonicalFieldIds || [],
    message: item.message,
    detailMessage: item.detailMessage,
    suggestedAction: 'Review the contradiction in the workspace, confirm the supported value, and clear the mismatch before final QC approval.',
    evidence: {
      type: 'value_conflict',
      expectedValue: item.expectedValue,
      actualValue: item.actualValue,
      factPaths: item.factPaths || [],
      source: item.source,
      category: item.category,
    },
  }));
}

registerRules(rules);

export default { rules };
