/**
 * server/operations/caseTimeline.js
 * -----------------------------------
 * Phase 10 — Case Timeline Builder
 *
 * Builds a unified, chronological timeline for a case by querying:
 *   1. case_timeline_events table (primary — populated by auditLogger)
 *   2. Supplementary data from generation_runs, qc_runs, insertion_runs
 *      (for historical runs that predate Phase 10 audit logging)
 *
 * The timeline is case-scoped and designed for the Case tab detail view.
 */

import { getDb } from '../db/database.js';
import { queryCaseTimeline, countCaseTimelineEvents, getCaseTimelineCategoryCounts } from './operationsRepo.js';

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build a full case timeline, merging audit-logged events with
 * pre-existing run history from earlier phases.
 *
 * @param {string} caseId
 * @param {Object} [opts={}]
 * @param {string} [opts.category]
 * @param {number} [opts.limit=50]
 * @param {number} [opts.offset=0]
 * @param {string} [opts.since]
 * @param {string} [opts.until]
 * @param {boolean} [opts.includePreAudit=true] - Include pre-Phase-10 run history
 * @returns {Object} { events, total, categoryCounts }
 */
export function buildCaseTimeline(caseId, opts = {}) {
  const includePreAudit = opts.includePreAudit !== false;
  const limit = opts.limit || 50;
  const offset = opts.offset || 0;

  // Get audit-logged timeline events
  const auditEvents = queryCaseTimeline({
    caseId,
    category: opts.category,
    limit: limit + 100, // fetch extra to merge with pre-audit
    offset: 0,
    since: opts.since,
    until: opts.until,
  });

  let allEvents = auditEvents.map(e => ({
    id: e.id,
    caseId: e.case_id,
    eventType: e.event_type,
    category: e.category,
    summary: e.summary,
    entityType: e.entity_type,
    entityId: e.entity_id,
    icon: e.icon,
    detail: e.detail_json,
    createdAt: e.created_at,
    source: 'audit',
  }));

  // Merge pre-audit run history if requested
  if (includePreAudit) {
    const preAuditEvents = getPreAuditRunHistory(caseId, opts);
    // Deduplicate: if an audit event references the same entity, skip the pre-audit version
    const auditEntityIds = new Set(allEvents.filter(e => e.entityId).map(e => `${e.entityType}:${e.entityId}`));
    const newPreAudit = preAuditEvents.filter(e => !auditEntityIds.has(`${e.entityType}:${e.entityId}`));
    allEvents = allEvents.concat(newPreAudit);
  }

  // Sort by createdAt descending
  allEvents.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // Apply category filter if not already applied
  if (opts.category && includePreAudit) {
    allEvents = allEvents.filter(e => e.category === opts.category);
  }

  const total = allEvents.length;

  // Apply pagination
  const paginated = allEvents.slice(offset, offset + limit);

  // Category counts
  const categoryCounts = getCaseTimelineCategoryCounts(caseId);

  return {
    events: paginated,
    total,
    categoryCounts,
  };
}

/**
 * Get a quick timeline summary for a case (for Case tab header).
 *
 * @param {string} caseId
 * @returns {Object}
 */
export function getCaseTimelineSummary(caseId) {
  const db = getDb();

  const totalEvents = countCaseTimelineEvents(caseId);
  const categoryCounts = getCaseTimelineCategoryCounts(caseId);

  // Get last 5 events for quick preview
  const recentEvents = queryCaseTimeline({ caseId, limit: 5 });

  // Get first event (case creation)
  const firstEvent = db.prepare(
    'SELECT * FROM case_timeline_events WHERE case_id = ? ORDER BY created_at ASC LIMIT 1'
  ).get(caseId);

  // Get last event
  const lastEvent = db.prepare(
    'SELECT * FROM case_timeline_events WHERE case_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(caseId);

  return {
    caseId,
    totalEvents,
    categoryCounts,
    recentEvents: recentEvents.map(e => ({
      eventType: e.event_type,
      summary: e.summary,
      icon: e.icon,
      createdAt: e.created_at,
    })),
    firstEventAt: firstEvent?.created_at || null,
    lastEventAt: lastEvent?.created_at || null,
  };
}

// ── Pre-Audit Run History ─────────────────────────────────────────────────────
// Synthesize timeline events from existing run tables for cases that
// have history predating Phase 10 audit logging.

/**
 * @param {string} caseId
 * @param {Object} opts
 * @returns {Array<Object>}
 */
function getPreAuditRunHistory(caseId, opts = {}) {
  const db = getDb();
  const events = [];

  // Generation runs
  try {
    const genRuns = db.prepare(
      'SELECT id, status, started_at, completed_at, section_count, success_count, error_count, form_type FROM generation_runs WHERE case_id = ? ORDER BY created_at DESC LIMIT 20'
    ).all(caseId);

    for (const run of genRuns) {
      if (run.started_at) {
        events.push({
          id: `pre-gen-start-${run.id}`,
          caseId,
          eventType: 'generation.run_started',
          category: 'generation',
          summary: `Generation run started (${run.form_type}, ${run.section_count || 0} sections)`,
          entityType: 'generation_run',
          entityId: run.id,
          icon: 'generate',
          detail: { formType: run.form_type, sectionCount: run.section_count },
          createdAt: run.started_at,
          source: 'pre-audit',
        });
      }
      if (run.completed_at && (run.status === 'completed' || run.status === 'partial')) {
        events.push({
          id: `pre-gen-done-${run.id}`,
          caseId,
          eventType: run.status === 'completed' ? 'generation.run_completed' : 'generation.run_failed',
          category: 'generation',
          summary: `Generation run ${run.status} (${run.success_count || 0}/${run.section_count || 0} sections)`,
          entityType: 'generation_run',
          entityId: run.id,
          icon: run.status === 'completed' ? 'generate' : 'error',
          detail: { status: run.status, successCount: run.success_count, errorCount: run.error_count },
          createdAt: run.completed_at,
          source: 'pre-audit',
        });
      }
    }
  } catch { /* table may not exist in edge cases */ }

  // QC runs
  try {
    const qcRuns = db.prepare(
      'SELECT id, status, created_at, findings_count, blocker_count, high_count FROM qc_runs WHERE case_id = ? ORDER BY created_at DESC LIMIT 20'
    ).all(caseId);

    for (const run of qcRuns) {
      events.push({
        id: `pre-qc-${run.id}`,
        caseId,
        eventType: 'qc.run_completed',
        category: 'qc',
        summary: `QC run completed: ${run.findings_count || 0} findings (${run.blocker_count || 0} blockers, ${run.high_count || 0} high)`,
        entityType: 'qc_run',
        entityId: run.id,
        icon: 'qc',
        detail: { findingsCount: run.findings_count, blockerCount: run.blocker_count, highCount: run.high_count },
        createdAt: run.created_at,
        source: 'pre-audit',
      });
    }
  } catch { /* table may not exist */ }

  // Insertion runs
  try {
    const insRuns = db.prepare(
      'SELECT id, status, started_at, completed_at, total_items, success_count, failed_count, verified_count FROM insertion_runs WHERE case_id = ? ORDER BY created_at DESC LIMIT 20'
    ).all(caseId);

    for (const run of insRuns) {
      if (run.started_at) {
        events.push({
          id: `pre-ins-start-${run.id}`,
          caseId,
          eventType: 'insertion.run_started',
          category: 'insertion',
          summary: `Insertion run started (${run.total_items || 0} items)`,
          entityType: 'insertion_run',
          entityId: run.id,
          icon: 'insert',
          detail: { totalItems: run.total_items },
          createdAt: run.started_at,
          source: 'pre-audit',
        });
      }
      if (run.completed_at) {
        events.push({
          id: `pre-ins-done-${run.id}`,
          caseId,
          eventType: run.status === 'completed' ? 'insertion.run_completed' : 'insertion.run_failed',
          category: 'insertion',
          summary: `Insertion run ${run.status} (${run.success_count || 0} ok, ${run.failed_count || 0} failed, ${run.verified_count || 0} verified)`,
          entityType: 'insertion_run',
          entityId: run.id,
          icon: run.status === 'completed' ? 'verify' : 'error',
          detail: { status: run.status, successCount: run.success_count, failedCount: run.failed_count, verifiedCount: run.verified_count },
          createdAt: run.completed_at,
          source: 'pre-audit',
        });
      }
    }
  } catch { /* table may not exist */ }

  // Apply time filters
  let filtered = events;
  if (opts.since) filtered = filtered.filter(e => e.createdAt >= opts.since);
  if (opts.until) filtered = filtered.filter(e => e.createdAt <= opts.until);

  return filtered;
}

export default {
  buildCaseTimeline,
  getCaseTimelineSummary,
};
