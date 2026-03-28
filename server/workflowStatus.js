/**
 * server/workflowStatus.js
 * ------------------------
 * NEW — Workflow status definitions, transitions, and helpers.
 *
 * workflowStatus runs ALONGSIDE the legacy pipelineStage field.
 * Do NOT remove pipelineStage — it is preserved for backward compatibility.
 *
 * workflowStatus provides finer-grained visibility into where a case stands
 * in the production pipeline, including exception states.
 */

// ── Status values ─────────────────────────────────────────────────────────────

export const WORKFLOW_STATUSES = [
  'facts_incomplete',
  'ready_for_generation',
  'generation_in_progress',
  'sections_drafted',
  'awaiting_review',
  'automation_ready',
  'insertion_in_progress',
  'verified',
  'exception_flagged',
];

// ── Human-readable labels ─────────────────────────────────────────────────────

export const WORKFLOW_STATUS_LABELS = {
  facts_incomplete:       'Facts Incomplete',
  ready_for_generation:   'Ready to Generate',
  generation_in_progress: 'Generating',
  sections_drafted:       'Sections Drafted',
  awaiting_review:        'Awaiting Review',
  automation_ready:       'Automation Ready',
  insertion_in_progress:  'Inserting',
  verified:               'Verified',
  exception_flagged:      'Exception Flagged',
};

// ── Color codes for UI chips (ok / warn / err) ────────────────────────────────

export const WORKFLOW_STATUS_COLORS = {
  facts_incomplete:       'warn',
  ready_for_generation:   'ok',
  generation_in_progress: 'warn',
  sections_drafted:       'ok',
  awaiting_review:        'warn',
  automation_ready:       'ok',
  insertion_in_progress:  'warn',
  verified:               'ok',
  exception_flagged:      'err',
};

// ── pipelineToWorkflowStatus ──────────────────────────────────────────────────
/**
 * Maps a legacy pipelineStage value to the closest workflowStatus equivalent.
 * Used when loading older cases that only have pipelineStage set.
 *
 * @param {string} pipelineStage
 * @returns {string} workflowStatus
 */
export function pipelineToWorkflowStatus(pipelineStage) {
  const map = {
    intake:      'facts_incomplete',
    extracting:  'facts_incomplete',
    generating:  'generation_in_progress',
    review:      'awaiting_review',
    approved:    'automation_ready',
    inserting:   'insertion_in_progress',
    complete:    'verified',
  };
  return map[pipelineStage] || 'facts_incomplete';
}

// ── computeWorkflowStatus ─────────────────────────────────────────────────────
/**
 * Derives the current workflowStatus from case state.
 * Called when loading a case to ensure workflowStatus is always current.
 *
 * Priority order:
 *   1. exception_flagged — preserved if explicitly set
 *   2. verified — preserved if explicitly set
 *   3. automation_ready — all outputs approved
 *   4. awaiting_review — some outputs exist, not all approved
 *   5. sections_drafted — outputs exist
 *   6. ready_for_generation — facts exist
 *   7. facts_incomplete — default
 *
 * @param {object} meta    — case meta.json
 * @param {object} facts   — case facts.json
 * @param {object} outputs — case outputs.json
 * @returns {string} workflowStatus
 */
export function computeWorkflowStatus(meta, facts, outputs) {
  // Preserve explicit exception / verified states
  if (meta.workflowStatus === 'exception_flagged') return 'exception_flagged';
  if (meta.workflowStatus === 'verified')          return 'verified';

  const hasFacts = facts && Object.keys(facts).filter(
    k => k !== 'extractedAt' && k !== 'updatedAt'
  ).length > 0;

  const outputEntries = outputs
    ? Object.entries(outputs).filter(([k]) => k !== 'updatedAt')
    : [];
  const hasOutputs = outputEntries.length > 0;

  if (hasOutputs) {
    const allApproved = outputEntries.every(([, v]) => v?.approved === true);
    if (allApproved) return 'automation_ready';
    return 'sections_drafted';
  }

  if (hasFacts) return 'ready_for_generation';
  return 'facts_incomplete';
}

// ── isValidWorkflowStatus ─────────────────────────────────────────────────────

export function isValidWorkflowStatus(status) {
  return WORKFLOW_STATUSES.includes(status);
}
