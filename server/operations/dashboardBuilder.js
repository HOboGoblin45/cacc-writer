/**
 * server/operations/dashboardBuilder.js
 * ----------------------------------------
 * Phase 10 — Dashboard Builder
 *
 * Aggregates operational data for dashboard views.
 * Provides a single entry point for the UI to get a comprehensive
 * operational overview without making many separate API calls.
 */

import { getDb } from '../db/database.js';
import { queryAuditEvents, countAuditEvents, getAuditCountsByCategory, getLatestMetric } from './operationsRepo.js';
import { quickHealthCheck, runHealthDiagnostics } from './healthDiagnostics.js';
import log from '../logger.js';

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build a comprehensive dashboard data payload.
 *
 * @returns {Promise<import('./types.js').DashboardData>}
 */
export async function buildDashboard() {
  const [overview, recentActivity, throughput, generationStats, qcStats, insertionStats, health] = await Promise.all([
    getOverview(),
    getRecentActivity(),
    getThroughput(),
    getGenerationOverview(),
    getQcOverview(),
    getInsertionOverview(),
    runHealthDiagnostics(),
  ]);

  return {
    overview,
    recentActivity,
    throughput,
    generationStats,
    qcStats,
    insertionStats,
    health,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Build a lightweight dashboard (no agent health probes).
 * Faster for frequent polling.
 *
 * @returns {Object}
 */
export function buildLightDashboard() {
  return {
    overview: getOverview(),
    recentActivity: getRecentActivity(10),
    throughput: getThroughput(),
    generationStats: getGenerationOverview(),
    qcStats: getQcOverview(),
    insertionStats: getInsertionOverview(),
    generatedAt: new Date().toISOString(),
  };
}

// ── Overview ──────────────────────────────────────────────────────────────────

function getOverview() {
  const db = getDb();
  const overview = {
    totalAuditEvents: 0,
    auditEventsByCategory: {},
    activeCases: 0,
    totalGenerationRuns: 0,
    totalQcRuns: 0,
    totalInsertionRuns: 0,
    totalMemoryItems: 0,
    totalDocuments: 0,
  };

  try {
    overview.totalAuditEvents = countAuditEvents();
    overview.auditEventsByCategory = getAuditCountsByCategory();
  } catch { /* */ }

  try {
    const genRow = db.prepare('SELECT COUNT(*) as cnt FROM generation_runs').get();
    overview.totalGenerationRuns = genRow?.cnt || 0;
  } catch { /* */ }

  try {
    const qcRow = db.prepare('SELECT COUNT(*) as cnt FROM qc_runs').get();
    overview.totalQcRuns = qcRow?.cnt || 0;
  } catch { /* */ }

  try {
    const insRow = db.prepare('SELECT COUNT(*) as cnt FROM insertion_runs').get();
    overview.totalInsertionRuns = insRow?.cnt || 0;
  } catch { /* */ }

  try {
    const memRow = db.prepare('SELECT COUNT(*) as cnt FROM memory_items WHERE approved = 1').get();
    overview.totalMemoryItems = memRow?.cnt || 0;
  } catch { /* */ }

  try {
    const docRow = db.prepare('SELECT COUNT(*) as cnt FROM case_documents').get();
    overview.totalDocuments = docRow?.cnt || 0;
  } catch { /* */ }

  return overview;
}

// ── Recent Activity ───────────────────────────────────────────────────────────

function getRecentActivity(limit = 20) {
  try {
    return queryAuditEvents({ limit });
  } catch {
    return [];
  }
}

// ── Throughput ────────────────────────────────────────────────────────────────

function getThroughput() {
  const db = getDb();
  const throughput = {
    last7Days: { generationRuns: 0, qcRuns: 0, insertionRuns: 0, auditEvents: 0 },
    last30Days: { generationRuns: 0, qcRuns: 0, insertionRuns: 0, auditEvents: 0 },
  };

  const now = new Date();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  try {
    throughput.last7Days.generationRuns = db.prepare(
      'SELECT COUNT(*) as cnt FROM generation_runs WHERE created_at >= ?'
    ).get(sevenDaysAgo)?.cnt || 0;

    throughput.last30Days.generationRuns = db.prepare(
      'SELECT COUNT(*) as cnt FROM generation_runs WHERE created_at >= ?'
    ).get(thirtyDaysAgo)?.cnt || 0;
  } catch { /* */ }

  try {
    throughput.last7Days.qcRuns = db.prepare(
      'SELECT COUNT(*) as cnt FROM qc_runs WHERE created_at >= ?'
    ).get(sevenDaysAgo)?.cnt || 0;

    throughput.last30Days.qcRuns = db.prepare(
      'SELECT COUNT(*) as cnt FROM qc_runs WHERE created_at >= ?'
    ).get(thirtyDaysAgo)?.cnt || 0;
  } catch { /* */ }

  try {
    throughput.last7Days.insertionRuns = db.prepare(
      'SELECT COUNT(*) as cnt FROM insertion_runs WHERE created_at >= ?'
    ).get(sevenDaysAgo)?.cnt || 0;

    throughput.last30Days.insertionRuns = db.prepare(
      'SELECT COUNT(*) as cnt FROM insertion_runs WHERE created_at >= ?'
    ).get(thirtyDaysAgo)?.cnt || 0;
  } catch { /* */ }

  try {
    throughput.last7Days.auditEvents = countAuditEvents({ since: sevenDaysAgo });
    throughput.last30Days.auditEvents = countAuditEvents({ since: thirtyDaysAgo });
  } catch { /* */ }

  return throughput;
}

// ── Generation Overview ───────────────────────────────────────────────────────

function getGenerationOverview() {
  const db = getDb();
  const stats = {
    totalRuns: 0,
    byStatus: {},
    recentRuns: [],
  };

  try {
    const statusRows = db.prepare(
      'SELECT status, COUNT(*) as cnt FROM generation_runs GROUP BY status'
    ).all();
    for (const r of statusRows) {
      stats.byStatus[r.status] = r.cnt;
      stats.totalRuns += r.cnt;
    }
  } catch { /* */ }

  try {
    stats.recentRuns = db.prepare(
      'SELECT id, case_id, status, form_type, started_at, completed_at, duration_ms, section_count, success_count, error_count FROM generation_runs ORDER BY created_at DESC LIMIT 5'
    ).all();
  } catch { /* */ }

  return stats;
}

// ── QC Overview ───────────────────────────────────────────────────────────────

function getQcOverview() {
  const db = getDb();
  const stats = {
    totalRuns: 0,
    totalFindings: 0,
    openFindings: 0,
    findingsBySeverity: {},
    recentRuns: [],
  };

  try {
    const runRow = db.prepare('SELECT COUNT(*) as cnt FROM qc_runs').get();
    stats.totalRuns = runRow?.cnt || 0;
  } catch { /* */ }

  try {
    const findingRows = db.prepare(
      'SELECT severity, status, COUNT(*) as cnt FROM qc_findings GROUP BY severity, status'
    ).all();
    for (const r of findingRows) {
      stats.totalFindings += r.cnt;
      if (r.status === 'open') stats.openFindings += r.cnt;
      stats.findingsBySeverity[r.severity] = (stats.findingsBySeverity[r.severity] || 0) + r.cnt;
    }
  } catch { /* */ }

  try {
    stats.recentRuns = db.prepare(
      'SELECT id, case_id, status, created_at, findings_count, blocker_count, high_count, readiness_signal FROM qc_runs ORDER BY created_at DESC LIMIT 5'
    ).all();
  } catch { /* */ }

  return stats;
}

// ── Insertion Overview ────────────────────────────────────────────────────────

function getInsertionOverview() {
  const db = getDb();
  const stats = {
    totalRuns: 0,
    byStatus: {},
    totalItems: 0,
    verifiedItems: 0,
    recentRuns: [],
  };

  try {
    const statusRows = db.prepare(
      'SELECT status, COUNT(*) as cnt FROM insertion_runs GROUP BY status'
    ).all();
    for (const r of statusRows) {
      stats.byStatus[r.status] = r.cnt;
      stats.totalRuns += r.cnt;
    }
  } catch { /* */ }

  try {
    const itemRow = db.prepare('SELECT COUNT(*) as cnt FROM insertion_run_items').get();
    stats.totalItems = itemRow?.cnt || 0;

    const verRow = db.prepare("SELECT COUNT(*) as cnt FROM insertion_run_items WHERE verification_status = 'verified'").get();
    stats.verifiedItems = verRow?.cnt || 0;
  } catch { /* */ }

  try {
    stats.recentRuns = db.prepare(
      'SELECT id, case_id, status, destination, started_at, completed_at, total_items, success_count, failed_count, verified_count FROM insertion_runs ORDER BY created_at DESC LIMIT 5'
    ).all();
  } catch { /* */ }

  return stats;
}

export default {
  buildDashboard,
  buildLightDashboard,
};
