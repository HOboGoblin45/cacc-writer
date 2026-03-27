/**
 * server/caseRecord/workflowStateMachine.js
 * ------------------------------------------
 * Deterministic workflow/pipeline transition rules for canonical case records.
 */

export const PIPELINE_STAGES = [
  'intake',
  'extracting',
  'generating',
  'review',
  'approved',
  'inserting',
  'complete',
];

function stageIndex(stage) {
  return PIPELINE_STAGES.indexOf(String(stage || '').trim().toLowerCase());
}

export function getAllowedNextPipelineStages(currentStage) {
  const idx = stageIndex(currentStage);
  if (idx < 0) return ['intake'];
  const allowed = [PIPELINE_STAGES[idx]];
  if (idx < PIPELINE_STAGES.length - 1) {
    allowed.push(PIPELINE_STAGES[idx + 1]);
  }
  return allowed;
}

/**
 * Evaluate a requested pipeline-stage transition.
 *
 * @param {object} params
 * @param {string} params.currentStage
 * @param {string} params.nextStage
 * @param {string} [params.caseStatus]
 * @returns {{ok:boolean, code:string, message:string, fromStage:string, toStage:string, allowedNextStages:string[]}}
 */
export function evaluatePipelineTransition({
  currentStage,
  nextStage,
  caseStatus = 'active',
} = {}) {
  const fromStage = String(currentStage || 'intake').trim().toLowerCase();
  const toStage = String(nextStage || '').trim().toLowerCase();
  const fromIdx = stageIndex(fromStage);
  const toIdx = stageIndex(toStage);

  if (toIdx < 0) {
    return {
      ok: false,
      code: 'PIPELINE_STAGE_INVALID',
      message: `Invalid pipeline stage: ${toStage}`,
      fromStage,
      toStage,
      allowedNextStages: getAllowedNextPipelineStages(fromStage),
    };
  }

  if (fromIdx < 0) {
    return {
      ok: false,
      code: 'PIPELINE_STAGE_UNKNOWN_CURRENT',
      message: `Current pipeline stage is invalid: ${fromStage}`,
      fromStage,
      toStage,
      allowedNextStages: ['intake'],
    };
  }

  if (String(caseStatus || '').toLowerCase() === 'archived' && toStage !== fromStage) {
    return {
      ok: false,
      code: 'CASE_ARCHIVED_LOCKED',
      message: 'Archived cases cannot advance pipeline stages.',
      fromStage,
      toStage,
      allowedNextStages: [fromStage],
    };
  }

  if (toStage === fromStage) {
    return {
      ok: true,
      code: 'NO_OP',
      message: 'Pipeline stage unchanged.',
      fromStage,
      toStage,
      allowedNextStages: getAllowedNextPipelineStages(fromStage),
    };
  }

  if (fromStage === 'complete') {
    return {
      ok: false,
      code: 'PIPELINE_TERMINAL',
      message: 'Complete is a terminal pipeline stage.',
      fromStage,
      toStage,
      allowedNextStages: ['complete'],
    };
  }

  if (toIdx === fromIdx + 1) {
    return {
      ok: true,
      code: 'OK',
      message: 'Valid forward transition.',
      fromStage,
      toStage,
      allowedNextStages: getAllowedNextPipelineStages(fromStage),
    };
  }

  if (toIdx > fromIdx + 1) {
    return {
      ok: false,
      code: 'PIPELINE_SKIP_NOT_ALLOWED',
      message: `Cannot skip from ${fromStage} to ${toStage}.`,
      fromStage,
      toStage,
      allowedNextStages: getAllowedNextPipelineStages(fromStage),
    };
  }

  return {
    ok: false,
    code: 'PIPELINE_BACKWARD_NOT_ALLOWED',
    message: `Cannot move pipeline backward from ${fromStage} to ${toStage}.`,
    fromStage,
    toStage,
    allowedNextStages: getAllowedNextPipelineStages(fromStage),
  };
}

