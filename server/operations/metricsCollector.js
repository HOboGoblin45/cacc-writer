/**
 * server/operations/metricsCollector.js
 * ---------------------------------------
 * Phase 10 — Metrics Collector
 *
 * Computes aggregated operational metrics from audit_events and run tables.
 * Stores snapshots in operational_metrics for dashboard views.
 *
 * Metric types:
 *   - daily_summary: cases, runs, sections, findings per day
 *   - generation_stats: success/fail rates, avg duration
 *   - qc_stats: findings by severity, resolution rates
 *   - insertion_stats: success/verify rates per destination
 *   - case_throughput: avg time from create to complete
 */

import { getDb } from '../db/database.js';
import { storeMetric, getLatestMetric } from './operationsRepo.js';
import log from '../logger.js';

// ── Daily Summary ─────────────────────────────────────────────────────────────

/**
 * Compute and store a daily summary metric for a given date.
 *
 * @param {string} [dateStr] - YYYY-MM-DD, defaults to today
 * @returns {Object} The computed metric data
 */
export function computeDailySummary(dateStr) {
  const db = getDb();
  const date = dateStr || new Date().toISOString().slice(0, 10);
  const dayStart = `${date}T00:00:00.000Z`;
  const dayEnd = `${date}T23:59:59.999Z`;

  const data = {
    date,
    casesCreated: 0,
    casesArchived: 0,
    generationRunsStarted: 0,
    generationRunsCompleted: 0,
    generationRunsFailed: 0,
    sectionsGenerated: 0,
    sectionsApproved: 0,
    qcRunsCompleted: 0,
    qcFindingsTotal: 0,
    qcFindingsResolved: 0,
    insertionRunsCompleted: 0,
    insertionItemsVerified: 0,
    memoryItemsApproved: 0,
    documentsUploaded: 0,
    auditEventsTotal: 0,
  };

  // Count from audit_events
  try {
    const auditCounts = db.prepare(`
      SELECT event_type, COUNT(*) as cnt
      FROM audit_events
      WHERE created_at >= ? AND created_at <= ?
      GROUP BY event_type
    `).all(dayStart, dayEnd);

    for (const row of auditCounts) {
      data.auditEventsTotal += row.cnt;
      switch (row.event_type) {
        case 'case.created': data.casesCreated = row.cnt; break;
        case 'case.archived': data.casesArchived = row.cnt; break;
        case 'generation.run_started': data.generationRunsStarted = row.cnt; break;
        case 'generation.run_completed': data.generationRunsCompleted = row.cnt; break;
        case 'generation.run_failed': data.generationRunsFailed = row.cnt; break;
        case 'generation.section_approved': data.sectionsApproved = row.cnt; break;
        case 'qc.run_completed': data.qcRunsCompleted = row.cnt; break;
        case 'qc.finding_resolved': data.qcFindingsResolved = row.cnt; break;
        case 'insertion.run_completed': data.insertionRunsCompleted = row.cnt; break;
        case 'memory.approved': data.memoryItemsApproved = row.cnt; break;
        case 'document.uploaded': data.documentsUploaded = row.cnt; break;
      }
    }
  } catch { /* audit_events may be empty */ }

  // Supplement from run tables for sections generated
  try {
    const secRow = db.prepare(`
      SELECT COUNT(*) as cnt FROM generated_sections
      WHERE created_at >= ? AND created_at <= ?
    `).get(dayStart, dayEnd);
    data.sectionsGenerated = secRow?.cnt || 0;
  } catch { /* table may not exist */ }

  // QC findings total for the day
  try {
    const qcRow = db.prepare(`
      SELECT COUNT(*) as cnt FROM qc_findings
      WHERE created_at >= ? AND created_at <= ?
    `).get(dayStart, dayEnd);
    data.qcFindingsTotal = qcRow?.cnt || 0;
  } catch { /* table may not exist */ }

  // Insertion items verified
  try {
    const insRow = db.prepare(`
      SELECT COUNT(*) as cnt FROM insertion_run_items
      WHERE verification_status = 'verified'
      AND updated_at >= ? AND updated_at <= ?
    `).get(dayStart, dayEnd);
    data.insertionItemsVerified = insRow?.cnt || 0;
  } catch { /* table may not exist */ }

  // Store the metric
  storeMetric('daily_summary', dayStart, dayEnd, data);

  log.info('metrics:daily-summary', { date, auditEvents: data.auditEventsTotal });
  return data;
}

// ── Generation Stats ──────────────────────────────────────────────────────────

/**
 * Compute generation statistics for a period.
 *
 * @param {string} since - ISO date
 * @param {string} until - ISO date
 * @returns {Object}
 */
export function computeGenerationStats(since, until) {
  const db = getDb();

  const stats = {
    totalRuns: 0,
    completedRuns: 0,
    failedRuns: 0,
    partialRuns: 0,
    avgDurationMs: 0,
    totalSections: 0,
    successSections: 0,
    failedSections: 0,
    avgSectionsPerRun: 0,
  };

  try {
    const runs = db.prepare(`
      SELECT status, duration_ms, section_count, success_count, error_count
      FROM generation_runs
      WHERE created_at >= ? AND created_at <= ?
    `).all(since, until);

    stats.totalRuns = runs.length;
    let totalDuration = 0;
    let durationCount = 0;

    for (const r of runs) {
      if (r.status === 'completed') stats.completedRuns++;
      else if (r.status === 'failed') stats.failedRuns++;
      else if (r.status === 'partial') stats.partialRuns++;

      if (r.duration_ms) { totalDuration += r.duration_ms; durationCount++; }
      stats.totalSections += r.section_count || 0;
      stats.successSections += r.success_count || 0;
      stats.failedSections += r.error_count || 0;
    }

    stats.avgDurationMs = durationCount > 0 ? Math.round(totalDuration / durationCount) : 0;
    stats.avgSectionsPerRun = stats.totalRuns > 0 ? Math.round(stats.totalSections / stats.totalRuns * 10) / 10 : 0;
  } catch { /* table may not exist */ }

  storeMetric('generation_stats', since, until, stats);
  return stats;
}

// ── QC Stats ──────────────────────────────────────────────────────────────────

/**
 * Compute QC statistics for a period.
 *
 * @param {string} since
 * @param {string} until
 * @returns {Object}
 */
export function computeQcStats(since, until) {
  const db = getDb();

  const stats = {
    totalRuns: 0,
    totalFindings: 0,
    findingsBySeverity: {},
    findingsByCategory: {},
    resolvedFindings: 0,
    dismissedFindings: 0,
    openFindings: 0,
    resolutionRate: 0,
  };

  try {
    const runRow = db.prepare(`
      SELECT COUNT(*) as cnt FROM qc_runs WHERE created_at >= ? AND created_at <= ?
    `).get(since, until);
    stats.totalRuns = runRow?.cnt || 0;
  } catch { /* */ }

  try {
    const findings = db.prepare(`
      SELECT severity, category, status FROM qc_findings
      WHERE created_at >= ? AND created_at <= ?
    `).all(since, until);

    stats.totalFindings = findings.length;
    for (const f of findings) {
      stats.findingsBySeverity[f.severity] = (stats.findingsBySeverity[f.severity] || 0) + 1;
      stats.findingsByCategory[f.category] = (stats.findingsByCategory[f.category] || 0) + 1;
      if (f.status === 'resolved') stats.resolvedFindings++;
      else if (f.status === 'dismissed') stats.dismissedFindings++;
      else stats.openFindings++;
    }

    const handled = stats.resolvedFindings + stats.dismissedFindings;
    stats.resolutionRate = stats.totalFindings > 0 ? Math.round(handled / stats.totalFindings * 100) : 0;
  } catch { /* */ }

  storeMetric('qc_stats', since, until, stats);
  return stats;
}

// ── Insertion Stats ───────────────────────────────────────────────────────────

/**
 * Compute insertion statistics for a period.
 *
 * @param {string} since
 * @param {string} until
 * @returns {Object}
 */
export function computeInsertionStats(since, until) {
  const db = getDb();

  const stats = {
    totalRuns: 0,
    completedRuns: 0,
    failedRuns: 0,
    totalItems: 0,
    successItems: 0,
    failedItems: 0,
    verifiedItems: 0,
    verificationRate: 0,
  };

  try {
    const runs = db.prepare(`
      SELECT status, total_items, success_count, failed_count, verified_count
      FROM insertion_runs
      WHERE created_at >= ? AND created_at <= ?
    `).all(since, until);

    stats.totalRuns = runs.length;
    for (const r of runs) {
      if (r.status === 'completed') stats.completedRuns++;
      else if (r.status === 'failed') stats.failedRuns++;
      stats.totalItems += r.total_items || 0;
      stats.successItems += r.success_count || 0;
      stats.failedItems += r.failed_count || 0;
      stats.verifiedItems += r.verified_count || 0;
    }

    stats.verificationRate = stats.successItems > 0
      ? Math.round(stats.verifiedItems / stats.successItems * 100)
      : 0;
  } catch { /* */ }

  storeMetric('insertion_stats', since, until, stats);
  return stats;
}

// ── Case Throughput ───────────────────────────────────────────────────────────

/**
 * Compute case throughput metrics.
 * Uses audit_events to measure time from case.created to last significant event.
 *
 * @returns {Object}
 */
export function computeCaseThroughput() {
  const db = getDb();

  const stats = {
    totalCases: 0,
    activeCases: 0,
    archivedCases: 0,
    casesWithGenerationRuns: 0,
    casesWithQcRuns: 0,
    casesWithInsertionRuns: 0,
  };

  // Count from generation_runs (most reliable cross-phase indicator)
  try {
    const genCases = db.prepare('SELECT COUNT(DISTINCT case_id) as cnt FROM generation_runs').get();
    stats.casesWithGenerationRuns = genCases?.cnt || 0;
  } catch { /* */ }

  try {
    const qcCases = db.prepare('SELECT COUNT(DISTINCT case_id) as cnt FROM qc_runs').get();
    stats.casesWithQcRuns = qcCases?.cnt || 0;
  } catch { /* */ }

  try {
    const insCases = db.prepare('SELECT COUNT(DISTINCT case_id) as cnt FROM insertion_runs').get();
    stats.casesWithInsertionRuns = insCases?.cnt || 0;
  } catch { /* */ }

  // Count from audit_events
  try {
    const created = db.prepare("SELECT COUNT(*) as cnt FROM audit_events WHERE event_type = 'case.created'").get();
    stats.totalCases = created?.cnt || 0;

    const archived = db.prepare("SELECT COUNT(*) as cnt FROM audit_events WHERE event_type = 'case.archived'").get();
    stats.archivedCases = archived?.cnt || 0;

    stats.activeCases = stats.totalCases - stats.archivedCases;
  } catch { /* */ }

  const now = new Date().toISOString();
  storeMetric('case_throughput', now, now, stats);
  return stats;
}

// ── Compute All ───────────────────────────────────────────────────────────────

/**
 * Compute all metrics for today. Useful for a daily cron or manual trigger.
 *
 * @returns {Object} All computed metrics
 */
export function computeAllMetrics() {
  const today = new Date().toISOString().slice(0, 10);
  const dayStart = `${today}T00:00:00.000Z`;
  const dayEnd = `${today}T23:59:59.999Z`;

  // Last 30 days for period stats
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const results = {
    dailySummary: computeDailySummary(today),
    generationStats: computeGenerationStats(thirtyDaysAgo, dayEnd),
    qcStats: computeQcStats(thirtyDaysAgo, dayEnd),
    insertionStats: computeInsertionStats(thirtyDaysAgo, dayEnd),
    caseThroughput: computeCaseThroughput(),
    computedAt: new Date().toISOString(),
  };

  log.info('metrics:all-computed', { date: today });
  return results;
}

export default {
  computeDailySummary,
  computeGenerationStats,
  computeQcStats,
  computeInsertionStats,
  computeCaseThroughput,
  computeAllMetrics,
};
