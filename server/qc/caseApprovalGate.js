/**
 * server/qc/caseApprovalGate.js
 * ------------------------------
 * Deterministic gate that controls when a case can move into
 * submitted/approved/inserting/complete lifecycle states.
 */

import { listQcRuns, getFindings } from './qcRepo.js';

function asText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function summarizeRun(run) {
  if (!run || typeof run !== 'object') return null;
  return {
    qcRunId: asText(run.id),
    status: asText(run.status) || 'unknown',
    draftReadiness: asText(run.draft_readiness) || 'unknown',
    createdAt: asText(run.created_at) || null,
    completedAt: asText(run.completed_at) || null,
  };
}

/**
 * Evaluate whether a case is allowed to enter approval/finalization states.
 *
 * @param {string} caseId
 * @param {object} [deps]
 * @param {(caseId:string, opts?:object)=>object[]} [deps.listQcRuns]
 * @param {(qcRunId:string, filters?:object)=>object[]} [deps.getFindings]
 * @returns {object}
 */
export function evaluateCaseApprovalGate(caseId, deps = {}) {
  const normalizedCaseId = asText(caseId);
  if (!normalizedCaseId) {
    return {
      ok: false,
      code: 'CASE_ID_REQUIRED',
      message: 'caseId is required to evaluate approval gate.',
      latestQcRun: null,
    };
  }

  const listRuns = deps.listQcRuns || listQcRuns;
  const listFindings = deps.getFindings || getFindings;
  const fetchedRuns = listRuns(normalizedCaseId, { limit: 25 });
  const runs = Array.isArray(fetchedRuns) ? fetchedRuns : [];

  if (!runs.length) {
    return {
      ok: false,
      code: 'QC_REQUIRED_BEFORE_APPROVAL',
      message: 'A completed QC run is required before approval/finalization.',
      latestQcRun: null,
    };
  }

  const latestRun = runs[0];
  const latestSummary = summarizeRun(latestRun);
  if (latestRun.status !== 'complete') {
    return {
      ok: false,
      code: latestRun.status === 'running'
        ? 'QC_IN_PROGRESS'
        : 'QC_LAST_RUN_NOT_COMPLETE',
      message: latestRun.status === 'running'
        ? 'QC is still running for this case. Wait for completion before approval/finalization.'
        : 'Latest QC run is not complete. Re-run QC before approval/finalization.',
      latestQcRun: latestSummary,
    };
  }

  const blockerFindings = listFindings(latestRun.id, { status: 'open', severity: 'blocker' });
  const openBlockers = Array.isArray(blockerFindings) ? blockerFindings : [];
  if (openBlockers.length > 0) {
    return {
      ok: false,
      code: 'QC_BLOCKERS_OPEN',
      message: 'Open blocker QC findings must be resolved before approval/finalization.',
      latestQcRun: latestSummary,
      openBlockerCount: openBlockers.length,
    };
  }

  if (latestRun.draft_readiness === 'not_ready') {
    return {
      ok: false,
      code: 'QC_NOT_READY',
      message: 'Latest QC run marked the draft as not ready for finalization.',
      latestQcRun: latestSummary,
      openBlockerCount: 0,
    };
  }

  return {
    ok: true,
    code: 'OK',
    message: 'QC gate passed.',
    latestQcRun: latestSummary,
    openBlockerCount: 0,
  };
}

export default {
  evaluateCaseApprovalGate,
};
