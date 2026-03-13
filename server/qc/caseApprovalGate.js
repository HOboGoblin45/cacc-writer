/**
 * server/qc/caseApprovalGate.js
 * ------------------------------
 * Deterministic gate that controls when a case can move into
 * submitted/approved/inserting/complete lifecycle states.
 */

import { listQcRuns, getFindings } from './qcRepo.js';
import { getRunsForCase as getGenerationRunsForCase } from '../db/repositories/generationRepo.js';
import { evaluateAllSectionsFreshness } from '../services/sectionFreshnessService.js';
import { buildContradictionGraph } from '../contradictionGraph/contradictionGraphService.js';
import { buildResolutionSummary } from '../contradictionGraph/contradictionResolutionService.js';

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

function summarizeGenerationRun(run) {
  if (!run || typeof run !== 'object') return null;
  return {
    runId: asText(run.id),
    status: asText(run.status) || 'unknown',
    createdAt: asText(run.created_at) || null,
    completedAt: asText(run.completed_at) || null,
  };
}

function toEpoch(value) {
  const text = asText(value);
  if (!text) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? text.replace(' ', 'T') + 'Z'
    : text;
  const ts = Date.parse(normalized);
  return Number.isNaN(ts) ? null : ts;
}

function isQcCompleteStatus(status) {
  const normalized = asText(status).toLowerCase();
  return normalized === 'complete' || normalized === 'completed';
}

/**
 * Evaluate whether a case is allowed to enter approval/finalization states.
 *
 * @param {string} caseId
 * @param {object} [deps]
 * @param {(caseId:string, opts?:object)=>object[]} [deps.listQcRuns]
 * @param {(qcRunId:string, filters?:object)=>object[]} [deps.getFindings]
 * @param {(caseId:string)=>object[]} [deps.listGenerationRuns]
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
  const listGenerationRuns = deps.listGenerationRuns || getGenerationRunsForCase;
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
  if (!isQcCompleteStatus(latestRun.status)) {
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

  const generationRuns = Array.isArray(listGenerationRuns(normalizedCaseId))
    ? listGenerationRuns(normalizedCaseId)
    : [];
  const latestCompletedGenerationRun = generationRuns.find(run => (
    run?.status === 'complete' || run?.status === 'partial_complete'
  ));
  const latestQcCreatedAt = toEpoch(latestRun.created_at);
  const latestGenerationCreatedAt = toEpoch(latestCompletedGenerationRun?.created_at);
  if (
    latestCompletedGenerationRun
    && latestQcCreatedAt !== null
    && latestGenerationCreatedAt !== null
    && latestQcCreatedAt < latestGenerationCreatedAt
  ) {
    return {
      ok: false,
      code: 'QC_STALE_FOR_CURRENT_DRAFT',
      message: 'Latest completed draft is newer than the latest QC run. Re-run QC before approval/finalization.',
      latestQcRun: latestSummary,
      latestGenerationRun: summarizeGenerationRun(latestCompletedGenerationRun),
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

  // ── Freshness gate: block if any generated sections are stale ──────────────
  const evaluateFreshness = deps.evaluateAllSectionsFreshness || evaluateAllSectionsFreshness;
  try {
    const freshnessResult = evaluateFreshness(normalizedCaseId);
    if (freshnessResult.summary.stale > 0) {
      const staleSections = freshnessResult.sections
        .filter(s => s.freshness !== 'current' && s.freshness !== 'not_generated')
        .map(s => s.sectionId);
      return {
        ok: false,
        code: 'SECTIONS_STALE',
        message: `${freshnessResult.summary.stale} section(s) are stale and must be regenerated before approval.`,
        latestQcRun: latestSummary,
        staleSections,
        staleSectionCount: freshnessResult.summary.stale,
      };
    }
  } catch {
    // Freshness check failure is non-fatal — allow gate to continue
  }

  // ── Quality gate: block if any generated section scores below threshold ────
  const QUALITY_THRESHOLD = deps.qualityThreshold ?? 30;
  try {
    const freshnessResult = evaluateFreshness(normalizedCaseId);
    const lowQualitySections = freshnessResult.sections
      .filter(s => s.qualityScore !== null && s.qualityScore < QUALITY_THRESHOLD);
    if (lowQualitySections.length > 0) {
      return {
        ok: false,
        code: 'SECTIONS_LOW_QUALITY',
        message: `${lowQualitySections.length} section(s) have quality scores below ${QUALITY_THRESHOLD}. Regenerate or review before approval.`,
        latestQcRun: latestSummary,
        lowQualitySections: lowQualitySections.map(s => ({
          sectionId: s.sectionId,
          qualityScore: s.qualityScore,
        })),
      };
    }
  } catch {
    // Quality check failure is non-fatal
  }

  // ── Contradiction gate: block if unresolved contradictions remain ───────────
  const buildGraph = deps.buildContradictionGraph || buildContradictionGraph;
  const buildResSummary = deps.buildResolutionSummary || buildResolutionSummary;
  try {
    const graph = buildGraph(normalizedCaseId);
    const items = graph?.items || [];
    if (items.length > 0) {
      const resSummary = buildResSummary(normalizedCaseId, items);
      if (!resSummary.allAddressed) {
        return {
          ok: false,
          code: 'CONTRADICTIONS_UNRESOLVED',
          message: `${resSummary.open} unresolved contradiction(s) must be addressed before approval.`,
          latestQcRun: latestSummary,
          contradictionSummary: {
            total: resSummary.total,
            open: resSummary.open,
            resolved: resSummary.resolved,
            dismissed: resSummary.dismissed,
            acknowledged: resSummary.acknowledged,
          },
        };
      }
    }
  } catch {
    // Contradiction check failure is non-fatal
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
