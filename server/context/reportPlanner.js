/**
 * server/context/reportPlanner.js
 * ---------------------------------
 * Builds a deterministic ReportPlan from an AssignmentContext.
 *
 * The ReportPlan defines:
 *   - Required sections for this form type
 *   - Generator profile per section
 *   - Parallel vs dependent section classification
 *   - Analysis jobs required
 *   - Estimated total duration
 *
 * Performance target: < 150ms
 *
 * Usage:
 *   import { buildReportPlan } from './context/reportPlanner.js';
 *   const plan = buildReportPlan(context);
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/database.js';

// ── Section definitions ───────────────────────────────────────────────────────
// Each section specifies:
//   id               — matches fieldId in the existing system
//   label            — human-readable name
//   generatorProfile — which profile to use (see generatorProfiles.js)
//   dependsOn        — section IDs that must complete first (empty = parallel)
//   analysisRequired — analysis artifact types needed before generation
//   priority         — lower = higher priority within a batch
//   insertionTarget  — software target (aci | real_quantum)

const SECTION_PLANS = {

  // ── 1004 Single-Family Residential ─────────────────────────────────────────
  '1004': [
    {
      id:               'neighborhood_description',
      label:            'Neighborhood Description',
      generatorProfile: 'retrieval-guided',
      dependsOn:        [],
      analysisRequired: [],
      priority:         1,
      insertionTarget:  'aci',
      aciTab:           'Neig',
    },
    {
      id:               'market_conditions',
      label:            'Market Conditions',
      generatorProfile: 'retrieval-guided',
      dependsOn:        [],
      analysisRequired: ['market_analysis'],
      priority:         1,
      insertionTarget:  'aci',
      aciTab:           'Neig',
    },
    {
      id:               'site_description',
      label:            'Site Description',
      generatorProfile: 'data-driven',
      dependsOn:        [],
      analysisRequired: [],
      priority:         2,
      insertionTarget:  'aci',
      aciTab:           'Site',
    },
    {
      id:               'improvements_description',
      label:            'Improvements Description',
      generatorProfile: 'data-driven',
      dependsOn:        [],
      analysisRequired: [],
      priority:         2,
      insertionTarget:  'aci',
      aciTab:           'Impr',
    },
    {
      id:               'condition_description',
      label:            'Condition Description',
      generatorProfile: 'data-driven',
      dependsOn:        [],
      analysisRequired: [],
      priority:         2,
      insertionTarget:  'aci',
      aciTab:           'Impr',
    },
    {
      id:               'contract_analysis',
      label:            'Contract Analysis',
      generatorProfile: 'template-heavy',
      dependsOn:        [],
      analysisRequired: [],
      priority:         3,
      insertionTarget:  'aci',
      aciTab:           'SCA',
    },
    {
      id:               'concessions_analysis',
      label:            'Concessions Analysis',
      generatorProfile: 'template-heavy',
      dependsOn:        [],
      analysisRequired: [],
      priority:         3,
      insertionTarget:  'aci',
      aciTab:           'SCA',
    },
    {
      id:               'highest_best_use',
      label:            'Highest and Best Use',
      generatorProfile: 'logic-template',
      dependsOn:        [],
      analysisRequired: ['hbu_logic'],
      priority:         3,
      insertionTarget:  'aci',
      aciTab:           'SCA',
    },
    {
      id:               'sales_comparison_summary',
      label:            'Sales Comparison Summary',
      generatorProfile: 'analysis-narrative',
      dependsOn:        [],
      analysisRequired: ['comp_analysis'],
      priority:         4,
      insertionTarget:  'aci',
      aciTab:           'SCA',
    },
    {
      id:               'reconciliation',
      label:            'Reconciliation',
      generatorProfile: 'synthesis',
      dependsOn:        [
        'neighborhood_description',
        'market_conditions',
        'improvements_description',
        'sales_comparison_summary',
      ],
      analysisRequired: [],
      priority:         5,
      insertionTarget:  'aci',
      aciTab:           'Recon',
    },
  ],

  // ── Commercial (Real Quantum) ───────────────────────────────────────────────
  'commercial': [
    {
      id:               'neighborhood',
      label:            'Neighborhood',
      generatorProfile: 'retrieval-guided',
      dependsOn:        [],
      analysisRequired: [],
      priority:         1,
      insertionTarget:  'real_quantum',
      rqSection:        'Introduction',
    },
    {
      id:               'market_overview',
      label:            'Market Overview',
      generatorProfile: 'retrieval-guided',
      dependsOn:        [],
      analysisRequired: ['market_analysis'],
      priority:         1,
      insertionTarget:  'real_quantum',
      rqSection:        'MarketData',
    },
    {
      id:               'improvements_description',
      label:            'Improvements Description',
      generatorProfile: 'data-driven',
      dependsOn:        [],
      analysisRequired: [],
      priority:         2,
      insertionTarget:  'real_quantum',
      rqSection:        'PropertyData',
    },
    {
      id:               'highest_best_use',
      label:            'Highest and Best Use',
      generatorProfile: 'logic-template',
      dependsOn:        [],
      analysisRequired: ['hbu_logic'],
      priority:         2,
      insertionTarget:  'real_quantum',
      rqSection:        'HighestBestUse',
    },
    {
      id:               'reconciliation',
      label:            'Reconciliation',
      generatorProfile: 'synthesis',
      dependsOn:        [
        'neighborhood',
        'market_overview',
        'improvements_description',
        'highest_best_use',
      ],
      analysisRequired: [],
      priority:         3,
      insertionTarget:  'real_quantum',
      rqSection:        'Reconciliation',
    },
  ],
};

// ── Duration estimator ────────────────────────────────────────────────────────

/**
 * Estimate total generation duration in ms.
 * Based on: parallel batches × 4s + dependent sections × 3s + 2s overhead.
 */
function estimateDuration(sections) {
  const parallelCount  = sections.filter(s => s.dependsOn.length === 0).length;
  const dependentCount = sections.filter(s => s.dependsOn.length > 0).length;
  const parallelBatches = Math.ceil(parallelCount / 3); // max 3 concurrent
  return (parallelBatches * 4000) + (dependentCount * 3000) + 2000;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build a deterministic ReportPlan from an AssignmentContext.
 * Stores the plan in SQLite and returns it.
 *
 * @param {object} context — AssignmentContext from buildAssignmentContext()
 * @returns {object} ReportPlan
 */
export function buildReportPlan(context) {
  const t0       = Date.now();
  const formType = context.formType || '1004';
  const caseId   = context.caseId;

  // Fall back to 1004 plan if form type not explicitly defined
  const sectionDefs = SECTION_PLANS[formType] || SECTION_PLANS['1004'];

  // Classify sections
  const parallelSections  = sectionDefs.filter(s => s.dependsOn.length === 0);
  const dependentSections = sectionDefs.filter(s => s.dependsOn.length > 0);

  // Collect unique analysis jobs required across all sections
  const analysisJobs = [
    ...new Set(sectionDefs.flatMap(s => s.analysisRequired)),
  ];

  const plan = {
    id:           uuidv4(),
    assignmentId: context.id,
    formType,
    caseId,

    sections:          sectionDefs,
    parallelSections:  parallelSections.map(s => s.id),
    dependentSections: dependentSections.map(s => s.id),
    analysisJobs,

    totalSections:       sectionDefs.length,
    parallelCount:       parallelSections.length,
    dependentCount:      dependentSections.length,
    estimatedDurationMs: estimateDuration(sectionDefs),

    _builtAt: new Date().toISOString(),
    _buildMs: Date.now() - t0,
  };

  // Persist to SQLite
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO report_plans
      (id, assignment_id, form_type, plan_json, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(plan.id, context.id || '', formType, JSON.stringify(plan));

  return plan;
}

/**
 * Get the section definition for a specific section ID within a form type.
 *
 * @param {string} formType
 * @param {string} sectionId
 * @returns {object|null}
 */
export function getSectionDef(formType, sectionId) {
  const defs = SECTION_PLANS[formType] || SECTION_PLANS['1004'];
  return defs.find(s => s.id === sectionId) || null;
}

/**
 * Get all section definitions for a form type.
 *
 * @param {string} formType
 * @returns {object[]}
 */
export function getSectionDefs(formType) {
  return SECTION_PLANS[formType] || SECTION_PLANS['1004'];
}

/**
 * Get the list of sections that depend on a given section.
 * Used to determine what to re-run when a section is regenerated.
 *
 * @param {string} formType
 * @param {string} sectionId
 * @returns {string[]} IDs of sections that depend on sectionId
 */
export function getDependentSections(formType, sectionId) {
  const defs = SECTION_PLANS[formType] || SECTION_PLANS['1004'];
  return defs
    .filter(s => s.dependsOn.includes(sectionId))
    .map(s => s.id);
}
