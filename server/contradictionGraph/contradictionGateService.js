/**
 * server/contradictionGraph/contradictionGateService.js
 * -------------------------------------------------------
 * Contradiction gate check for final review gating.
 *
 * Determines whether all contradictions for a case have been addressed
 * (resolved, dismissed, or acknowledged) before allowing final review.
 *
 * Also provides a timeline of all resolution events for audit/history.
 */

import { buildContradictionGraph } from './contradictionGraphService.js';
import {
  getAllResolutions,
  buildResolutionSummary,
  mergeResolutionStatus,
  RESOLUTION_STATUS,
} from './contradictionResolutionService.js';
import log from '../logger.js';

/**
 * Check whether all contradictions are addressed for final review gating.
 *
 * @param {string} caseId
 * @param {object} [opts] - optional overrides for the contradiction graph
 * @returns {{ passed: boolean, summary: object, blockers: object[] }}
 */
export function checkContradictionGate(caseId, opts = {}) {
  let graphItems = [];

  try {
    const graph = buildContradictionGraph(caseId, opts);
    graphItems = graph?.items || [];
  } catch (err) {
    log.warn('contradiction-gate:graph-build-failed', { caseId, error: err.message });
    // If the graph can't be built (e.g. no case projection), gate passes vacuously
  }

  const summary = buildResolutionSummary(caseId, graphItems);

  // Items that are still open are blockers
  const resolutions = getAllResolutions(caseId);
  const blockers = graphItems.filter(item => {
    const resolution = resolutions[item.id];
    return !resolution || resolution.status === RESOLUTION_STATUS.OPEN;
  }).map(item => ({
    id: item.id,
    category: item.category,
    severity: item.severity,
    message: item.message,
  }));

  return {
    passed: summary.allAddressed,
    summary: {
      total: summary.total,
      open: summary.open,
      resolved: summary.resolved,
      dismissed: summary.dismissed,
      acknowledged: summary.acknowledged,
    },
    blockers,
  };
}

/**
 * Get the full resolution history for all contradictions in a case.
 * Returns a flat timeline of all resolution events, sorted chronologically.
 *
 * @param {string} caseId
 * @returns {object[]} Array of resolution history events
 */
export function getContradictionHistory(caseId) {
  const resolutions = getAllResolutions(caseId);
  const timeline = [];

  for (const [contradictionId, record] of Object.entries(resolutions)) {
    const history = record.history || [];
    for (const event of history) {
      timeline.push({
        contradictionId,
        action: event.action,
        actor: event.actor,
        note: event.note || event.reason || '',
        at: event.at,
      });
    }
  }

  // Sort chronologically
  timeline.sort((a, b) => {
    const da = a.at || '';
    const db = b.at || '';
    return da.localeCompare(db);
  });

  return timeline;
}

export default { checkContradictionGate, getContradictionHistory };
